import type { Pool, PoolClient } from 'pg';
import type { Queryable } from '../../db/postgres';
import { withTransaction } from '../../db/postgres';
import type {
  Chat,
  ChatDetails,
  ChatMember,
  ChatMemberRole,
  ChatSummary,
  ChatType,
  Paginated,
  Pagination,
} from './chat.types';

interface ChatRow {
  id: string;
  type: ChatType;
  name: string | null;
  created_by: string;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ChatMemberRow {
  user_id: string;
  role: ChatMemberRole;
  joined_at: Date;
}

const CHAT_COLUMNS =
  'c.id, c.type, c.name, c.created_by, c.last_message_at, c.created_at, c.updated_at';

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  type: row.type,
  name: row.name,
  createdBy: row.created_by,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMember = (row: ChatMemberRow): ChatMember => ({
  userId: row.user_id,
  role: row.role,
  joinedAt: row.joined_at,
});

/** Order-independent key so (A, B) and (B, A) resolve to the same direct chat. */
export const buildDirectKey = (userAId: string, userBId: string): string =>
  [userAId, userBId].sort().join(':');

export class ChatRepository {
  constructor(private readonly pool: Pool) {}

  async findById(chatId: string, db: Queryable = this.pool): Promise<Chat | null> {
    const { rows } = await db.query<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM chats c WHERE c.id = $1`,
      [chatId],
    );
    return rows[0] ? toChat(rows[0]) : null;
  }

  async findDetailsById(chatId: string): Promise<ChatDetails | null> {
    const chat = await this.findById(chatId);
    if (!chat) return null;
    return { ...chat, members: await this.listMembers(chatId) };
  }

  async listMembers(chatId: string, db: Queryable = this.pool): Promise<ChatMember[]> {
    const { rows } = await db.query<ChatMemberRow>(
      `SELECT user_id, role, joined_at FROM chat_members
        WHERE chat_id = $1 ORDER BY joined_at, user_id`,
      [chatId],
    );
    return rows.map(toMember);
  }

  async findMember(chatId: string, userId: string): Promise<ChatMember | null> {
    const { rows } = await this.pool.query<ChatMemberRow>(
      'SELECT user_id, role, joined_at FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }

  /**
   * Idempotently creates the 1:1 chat between two users.
   * Relies on the UNIQUE(direct_key) constraint so concurrent requests for the
   * same pair can never produce two chats.
   */
  async createOrGetDirect(
    userAId: string,
    userBId: string,
  ): Promise<{ chat: Chat; created: boolean }> {
    const directKey = buildDirectKey(userAId, userBId);

    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query<ChatRow>(
        `INSERT INTO chats AS c (type, direct_key, created_by)
         VALUES ('direct', $1, $2)
         ON CONFLICT (direct_key) DO NOTHING
         RETURNING ${CHAT_COLUMNS}`,
        [directKey, userAId],
      );

      if (inserted.rows[0]) {
        const chat = toChat(inserted.rows[0]);
        await this.insertMembers(client, chat.id, [userAId, userBId], 'member');
        return { chat, created: true };
      }

      const existing = await client.query<ChatRow>(
        `SELECT ${CHAT_COLUMNS} FROM chats c WHERE c.direct_key = $1`,
        [directKey],
      );
      return { chat: toChat(existing.rows[0]!), created: false };
    });
  }

  async createGroup(creatorId: string, name: string, memberIds: string[]): Promise<ChatDetails> {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query<ChatRow>(
        `INSERT INTO chats AS c (type, name, created_by)
         VALUES ('group', $1, $2)
         RETURNING ${CHAT_COLUMNS}`,
        [name, creatorId],
      );
      const chat = toChat(rows[0]!);
      await this.insertMembers(client, chat.id, [creatorId], 'admin');
      await this.insertMembers(
        client,
        chat.id,
        memberIds.filter((id) => id !== creatorId),
        'member',
      );
      return { ...chat, members: await this.listMembers(chat.id, client) };
    });
  }

  async listForUser(
    userId: string,
    { limit, offset }: Pagination,
  ): Promise<Paginated<ChatSummary>> {
    const { rows } = await this.pool.query<ChatRow & { member_ids: string[]; total: string }>(
      `SELECT ${CHAT_COLUMNS},
              ARRAY(
                SELECT cm.user_id::text FROM chat_members cm
                 WHERE cm.chat_id = c.id
                 ORDER BY cm.joined_at, cm.user_id
              ) AS member_ids,
              COUNT(*) OVER () AS total
         FROM chats c
         JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const total = rows[0] ? Number(rows[0].total) : await this.countForUser(userId);
    return {
      items: rows.map((row) => ({ ...toChat(row), memberIds: row.member_ids })),
      total,
      limit,
      offset,
    };
  }

  /** Adds members, ignoring users that are already in the chat. Returns the ids actually added. */
  async addMembers(chatId: string, userIds: string[]): Promise<string[]> {
    return withTransaction(this.pool, async (client) => {
      const added = await this.insertMembers(client, chatId, userIds, 'member');
      if (added.length > 0) await this.touch(client, chatId);
      return added;
    });
  }

  /**
   * Removes a member. If the last admin leaves, the longest-standing remaining
   * member is promoted so a group is never left without an admin.
   */
  async removeMember(chatId: string, userId: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      // Serialise membership changes on the same chat.
      await client.query('SELECT 1 FROM chats WHERE id = $1 FOR UPDATE', [chatId]);

      const deleted = await client.query(
        'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId],
      );
      if (deleted.rowCount === 0) return false;

      await client.query(
        `UPDATE chat_members SET role = 'admin'
          WHERE chat_id = $1
            AND user_id = (
              SELECT user_id FROM chat_members WHERE chat_id = $1
               ORDER BY joined_at, user_id LIMIT 1
            )
            AND NOT EXISTS (
              SELECT 1 FROM chat_members WHERE chat_id = $1 AND role = 'admin'
            )`,
        [chatId],
      );
      await this.touch(client, chatId);
      return true;
    });
  }

  async rename(chatId: string, name: string): Promise<Chat> {
    const { rows } = await this.pool.query<ChatRow>(
      `UPDATE chats c SET name = $2, updated_at = now() WHERE c.id = $1 RETURNING ${CHAT_COLUMNS}`,
      [chatId, name],
    );
    return toChat(rows[0]!);
  }

  /** Bumps activity so chat lists can be sorted by most recent message. */
  async updateLastMessageAt(chatId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE chats SET last_message_at = GREATEST(COALESCE(last_message_at, $2::timestamptz), $2::timestamptz)
        WHERE id = $1`,
      [chatId, at],
    );
  }

  private async countForUser(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM chat_members WHERE user_id = $1',
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async insertMembers(
    client: PoolClient,
    chatId: string,
    userIds: string[],
    role: ChatMemberRole,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const { rows } = await client.query<{ user_id: string }>(
      `INSERT INTO chat_members (chat_id, user_id, role)
       SELECT $1::uuid, u.id, $3::chat_member_role FROM UNNEST($2::uuid[]) AS u(id)
       ON CONFLICT (chat_id, user_id) DO NOTHING
       RETURNING user_id`,
      [chatId, userIds, role],
    );
    return rows.map((r) => r.user_id);
  }

  private async touch(client: PoolClient, chatId: string): Promise<void> {
    await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
  }
}
