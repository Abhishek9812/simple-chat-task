import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app';
import { buildContainer } from '../../src/container';
import { runMigrations } from '../../src/db/migrate';
import { createPool } from '../../src/db/postgres';
import { InMemoryMessageRepository } from '../helpers/in-memory-message.repository';
import { silentLogger } from '../helpers/logger';

/**
 * End-to-end API flow against a real PostgreSQL database.
 * Firestore is replaced by the in-memory MessageRepository.
 *
 * Opt-in: set TEST_DATABASE_URL to a disposable database to run it.
 *   TEST_DATABASE_URL=postgres://chat:chat@localhost:5432/chat_test npm test
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('Chat API (PostgreSQL e2e)', () => {
  let pool: Pool;
  let app: Express;

  const createUser = async (name: string): Promise<string> => {
    const res = await request(app).post('/user/create').send({ name }).expect(201);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    pool = createPool({ connectionString: databaseUrl!, max: 5, ssl: false });
    await runMigrations(pool, () => undefined);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE chat_members, chats, users CASCADE');
    app = createApp(
      buildContainer({
        pool,
        logger: silentLogger,
        messageRepository: new InMemoryMessageRepository(),
      }),
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runs the full 1:1 chat flow', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');

    // 1. Create or get chat - idempotent and order independent
    const created = await request(app)
      .post('/chat/create')
      .send({ userAId: alice, userBId: bob })
      .expect(201);
    const chatId = created.body.data.chatId as string;
    const again = await request(app)
      .post('/chat/create')
      .send({ userAId: bob, userBId: alice })
      .expect(200);
    expect(again.body.data).toEqual({ chatId, created: false });

    // 2. Send messages
    const sent = [];
    for (const [senderId, text] of [
      [alice, 'Hi Bob'],
      [bob, 'Hey Alice'],
      [alice, 'How are you?'],
    ] as const) {
      const res = await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId, text })
        .expect(201);
      sent.push(res.body.data as { id: string });
    }

    // 3. Get messages, ordered by timestamp
    const list = await request(app).get(`/chat/${chatId}/messages?limit=50`).expect(200);
    expect(list.body.data.messages.map((m: { text: string }) => m.text)).toEqual([
      'Hi Bob',
      'Hey Alice',
      'How are you?',
    ]);

    // 4. Mark read
    const read = await request(app)
      .post(`/chat/${chatId}/message/${sent[0]!.id}/read`)
      .send({ userId: bob })
      .expect(200);
    expect(read.body.data).toMatchObject({ userId: bob, alreadyRead: false });

    // 5. Last seen
    const lastSeen = await request(app)
      .post(`/chat/${chatId}/lastseen`)
      .send({ userId: bob, messageId: sent[2]!.id })
      .expect(200);
    expect(lastSeen.body.data).toMatchObject({
      updated: true,
      lastSeen: { messageId: sent[2]!.id },
    });

    // 6. List user chats with member ids from PostgreSQL
    const chats = await request(app).get(`/user/${alice}/chats`).expect(200);
    expect(chats.body.data.total).toBe(1);
    expect(chats.body.data.items[0]).toMatchObject({ id: chatId, type: 'direct' });
    expect([...chats.body.data.items[0].memberIds].sort()).toEqual([alice, bob].sort());
    expect(chats.body.data.items[0].lastMessageAt).not.toBeNull();
  });

  it('creates exactly one direct chat under concurrent requests', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post('/chat/create')
          .send(i % 2 ? { userAId: alice, userBId: bob } : { userAId: bob, userBId: alice }),
      ),
    );

    const ids = new Set(responses.map((r) => r.body.data.chatId as string));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('rejects messages from non-members and unknown users', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const eve = await createUser('Eve');
    const { body } = await request(app).post('/chat/create').send({ userAId: alice, userBId: bob });

    await request(app)
      .post(`/chat/${body.data.chatId}/message/send`)
      .send({ senderId: eve, text: 'let me in' })
      .expect(403);

    await request(app)
      .post('/chat/create')
      .send({ userAId: alice, userBId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('manages group chats', async () => {
    const [alice, bob, carol, dave] = await Promise.all(
      ['Alice', 'Bob', 'Carol', 'Dave'].map(createUser),
    );

    const group = await request(app)
      .post('/chat/group/create')
      .send({ creatorId: alice, name: 'Project', memberIds: [bob, carol] })
      .expect(201);
    const chatId = group.body.data.id as string;
    expect(group.body.data.members).toHaveLength(3);

    // Non-admin cannot add members
    await request(app)
      .post(`/chat/${chatId}/members`)
      .send({ actorId: bob, userIds: [dave] })
      .expect(403);

    // Admin adds and renames
    const added = await request(app)
      .post(`/chat/${chatId}/members`)
      .send({ actorId: alice, userIds: [dave] })
      .expect(200);
    expect(added.body.data.members).toHaveLength(4);

    const renamed = await request(app)
      .patch(`/chat/${chatId}`)
      .send({ actorId: alice, name: 'Project X' })
      .expect(200);
    expect(renamed.body.data.name).toBe('Project X');

    // Admin leaves: the longest-standing member is promoted
    await request(app)
      .delete(`/chat/${chatId}/members/${alice}`)
      .send({ actorId: alice })
      .expect(204);
    const details = await request(app).get(`/chat/${chatId}`).expect(200);
    const admins = details.body.data.members.filter((m: { role: string }) => m.role === 'admin');
    expect(admins).toHaveLength(1);
  });
});
