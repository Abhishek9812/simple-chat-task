import { randomUUID } from 'node:crypto';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../src/common/errors';
import type { ChatRepository } from '../../src/modules/chats/chat.repository';
import { buildDirectKey } from '../../src/modules/chats/chat.repository';
import { ChatService } from '../../src/modules/chats/chat.service';
import type { Chat, ChatMember } from '../../src/modules/chats/chat.types';
import type { UserService } from '../../src/modules/users/user.service';

const makeChat = (overrides: Partial<Chat> = {}): Chat => ({
  id: randomUUID(),
  type: 'group',
  name: 'Team',
  createdBy: randomUUID(),
  lastMessageAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMember = (userId: string, role: ChatMember['role'] = 'member'): ChatMember => ({
  userId,
  role,
  joinedAt: new Date(),
});

describe('ChatService', () => {
  let chats: jest.Mocked<ChatRepository>;
  let users: jest.Mocked<UserService>;
  let service: ChatService;

  beforeEach(() => {
    chats = {
      findById: jest.fn(),
      findDetailsById: jest.fn(),
      findMember: jest.fn(),
      listMembers: jest.fn(),
      createOrGetDirect: jest.fn(),
      createGroup: jest.fn(),
      listForUser: jest.fn(),
      addMembers: jest.fn(),
      removeMember: jest.fn(),
      rename: jest.fn(),
      updateLastMessageAt: jest.fn(),
    } as unknown as jest.Mocked<ChatRepository>;
    users = {
      assertUsersExist: jest.fn().mockResolvedValue(undefined),
      getUser: jest.fn(),
    } as unknown as jest.Mocked<UserService>;
    service = new ChatService(chats, users);
  });

  describe('buildDirectKey', () => {
    it('is independent of argument order', () => {
      const a = randomUUID();
      const b = randomUUID();
      expect(buildDirectKey(a, b)).toBe(buildDirectKey(b, a));
    });
  });

  describe('createOrGetDirectChat', () => {
    it('rejects a chat with yourself', async () => {
      const id = randomUUID();
      await expect(service.createOrGetDirectChat(id, id)).rejects.toBeInstanceOf(BadRequestError);
      expect(chats.createOrGetDirect).not.toHaveBeenCalled();
    });

    it('validates that both users exist before creating', async () => {
      users.assertUsersExist.mockRejectedValueOnce(new NotFoundError('missing'));
      await expect(
        service.createOrGetDirectChat(randomUUID(), randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(chats.createOrGetDirect).not.toHaveBeenCalled();
    });

    it('returns the chat id and whether it was newly created', async () => {
      const chat = makeChat({ type: 'direct', name: null });
      chats.createOrGetDirect.mockResolvedValueOnce({ chat, created: false });
      await expect(service.createOrGetDirectChat(randomUUID(), randomUUID())).resolves.toEqual({
        chatId: chat.id,
        created: false,
      });
    });
  });

  describe('createGroupChat', () => {
    it('requires at least one other member', async () => {
      const creator = randomUUID();
      await expect(service.createGroupChat(creator, 'Solo', [creator])).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });

    it('de-duplicates members and always includes the creator', async () => {
      const creator = randomUUID();
      const other = randomUUID();
      chats.createGroup.mockResolvedValueOnce({ ...makeChat(), members: [] });

      await service.createGroupChat(creator, 'Team', [other, other]);

      expect(users.assertUsersExist).toHaveBeenCalledWith([creator, other]);
      expect(chats.createGroup).toHaveBeenCalledWith(creator, 'Team', [creator, other]);
    });
  });

  describe('assertMember', () => {
    it('throws NotFound when the chat does not exist', async () => {
      chats.findById.mockResolvedValueOnce(null);
      await expect(service.assertMember(randomUUID(), randomUUID())).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws Forbidden when the user is not a member', async () => {
      chats.findById.mockResolvedValueOnce(makeChat());
      chats.findMember.mockResolvedValueOnce(null);
      await expect(service.assertMember(randomUUID(), randomUUID())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe('group management', () => {
    it('rejects group operations on direct chats', async () => {
      chats.findById.mockResolvedValueOnce(makeChat({ type: 'direct', name: null }));
      await expect(service.renameGroup(randomUUID(), randomUUID(), 'x')).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });

    it('only lets admins rename a group', async () => {
      const actor = randomUUID();
      chats.findById.mockResolvedValueOnce(makeChat());
      chats.findMember.mockResolvedValueOnce(makeMember(actor, 'member'));
      await expect(service.renameGroup(randomUUID(), actor, 'x')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('lets a regular member leave the group', async () => {
      const actor = randomUUID();
      const chatId = randomUUID();
      chats.findById.mockResolvedValueOnce(makeChat({ id: chatId }));
      chats.findMember.mockResolvedValueOnce(makeMember(actor, 'member'));
      chats.removeMember.mockResolvedValueOnce(true);

      await service.removeGroupMember(chatId, actor, actor);
      expect(chats.removeMember).toHaveBeenCalledWith(chatId, actor);
    });

    it('does not let a regular member remove someone else', async () => {
      const actor = randomUUID();
      chats.findById.mockResolvedValueOnce(makeChat());
      chats.findMember.mockResolvedValueOnce(makeMember(actor, 'member'));
      await expect(
        service.removeGroupMember(randomUUID(), actor, randomUUID()),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(chats.removeMember).not.toHaveBeenCalled();
    });
  });
});
