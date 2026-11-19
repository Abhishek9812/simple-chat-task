import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError } from '../../src/common/errors';
import type { ChatService } from '../../src/modules/chats/chat.service';
import { MessageService } from '../../src/modules/messages/message.service';
import { InMemoryMessageRepository } from '../helpers/in-memory-message.repository';
import { silentLogger } from '../helpers/logger';

describe('MessageService', () => {
  const chatId = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();

  let chatService: jest.Mocked<ChatService>;
  let repo: InMemoryMessageRepository;
  let service: MessageService;

  beforeEach(() => {
    chatService = {
      assertMember: jest.fn().mockResolvedValue(undefined),
      getChat: jest.fn().mockResolvedValue(undefined),
      recordActivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ChatService>;
    repo = new InMemoryMessageRepository();
    service = new MessageService(repo, chatService, silentLogger);
  });

  it('only lets chat members send messages', async () => {
    chatService.assertMember.mockRejectedValueOnce(new ForbiddenError('nope'));
    await expect(service.sendMessage(chatId, alice, 'hi')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('stores the message and records chat activity', async () => {
    const message = await service.sendMessage(chatId, alice, 'hello');
    expect(message).toMatchObject({ chatId, senderId: alice, text: 'hello', isDeleted: false });
    expect(chatService.recordActivity).toHaveBeenCalledWith(chatId, message.createdAt);
  });

  it('still succeeds when activity tracking fails', async () => {
    chatService.recordActivity.mockRejectedValueOnce(new Error('db down'));
    await expect(service.sendMessage(chatId, alice, 'hello')).resolves.toBeDefined();
  });

  it('returns the latest messages in chronological order with a cursor', async () => {
    for (let i = 1; i <= 5; i += 1) await service.sendMessage(chatId, alice, `m${i}`);

    const page1 = await service.getMessages(chatId, { limit: 2 });
    expect(page1.messages.map((m) => m.text)).toEqual(['m4', 'm5']);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.getMessages(chatId, { limit: 2, before: page1.nextCursor! });
    expect(page2.messages.map((m) => m.text)).toEqual(['m2', 'm3']);

    const page3 = await service.getMessages(chatId, { limit: 2, before: page2.nextCursor! });
    expect(page3.messages.map((m) => m.text)).toEqual(['m1']);
    expect(page3.nextCursor).toBeNull();
  });

  it('marks messages as read idempotently', async () => {
    const message = await service.sendMessage(chatId, alice, 'hello');

    const first = await service.markRead(chatId, message.id, bob);
    const second = await service.markRead(chatId, message.id, bob);

    expect(first.alreadyRead).toBe(false);
    expect(second.alreadyRead).toBe(true);
    expect(second.readAt).toEqual(first.readAt);
  });

  it('never moves the last seen pointer backwards', async () => {
    const older = await service.sendMessage(chatId, alice, 'one');
    const newer = await service.sendMessage(chatId, alice, 'two');

    await service.updateLastSeen(chatId, bob, newer.id);
    const result = await service.updateLastSeen(chatId, bob, older.id);

    expect(result.updated).toBe(false);
    expect(result.lastSeen.messageId).toBe(newer.id);
  });

  it('only lets the sender edit or delete a message', async () => {
    const message = await service.sendMessage(chatId, alice, 'hello');
    await expect(service.editMessage(chatId, message.id, bob, 'hacked')).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const edited = await service.editMessage(chatId, message.id, alice, 'hello!');
    expect(edited.text).toBe('hello!');
    expect(edited.editedAt).not.toBeNull();

    const deleted = await service.deleteMessage(chatId, message.id, alice);
    expect(deleted).toMatchObject({ isDeleted: true, text: null });

    await expect(service.editMessage(chatId, message.id, alice, 'again')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
