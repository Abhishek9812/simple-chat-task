import { BadRequestError, ForbiddenError, NotFoundError } from '../../common/errors';
import type { UserService } from '../users/user.service';
import type { ChatRepository } from './chat.repository';
import type {
  Chat,
  ChatDetails,
  ChatMember,
  ChatSummary,
  Paginated,
  Pagination,
} from './chat.types';

export const MAX_GROUP_MEMBERS = 256;

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly userService: UserService,
  ) {}

  /** POST /chat/create - returns the existing 1:1 chat or creates it. */
  async createOrGetDirectChat(
    userAId: string,
    userBId: string,
  ): Promise<{ chatId: string; created: boolean }> {
    if (userAId === userBId) {
      throw new BadRequestError('A direct chat requires two different users');
    }
    await this.userService.assertUsersExist([userAId, userBId]);
    const { chat, created } = await this.chats.createOrGetDirect(userAId, userBId);
    return { chatId: chat.id, created };
  }

  async createGroupChat(
    creatorId: string,
    name: string,
    memberIds: string[],
  ): Promise<ChatDetails> {
    const allMembers = [...new Set([creatorId, ...memberIds])];
    if (allMembers.length < 2) {
      throw new BadRequestError('A group chat needs at least one member besides the creator');
    }
    if (allMembers.length > MAX_GROUP_MEMBERS) {
      throw new BadRequestError(`A group chat can have at most ${MAX_GROUP_MEMBERS} members`);
    }
    await this.userService.assertUsersExist(allMembers);
    return this.chats.createGroup(creatorId, name, allMembers);
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw new NotFoundError(`Chat ${chatId} not found`);
    return chat;
  }

  async getChatDetails(chatId: string): Promise<ChatDetails> {
    const chat = await this.chats.findDetailsById(chatId);
    if (!chat) throw new NotFoundError(`Chat ${chatId} not found`);
    return chat;
  }

  /** Ensures the chat exists and `userId` is one of its members. */
  async assertMember(chatId: string, userId: string): Promise<ChatMember> {
    await this.getChat(chatId);
    const member = await this.chats.findMember(chatId, userId);
    if (!member) {
      throw new ForbiddenError(`User ${userId} is not a member of chat ${chatId}`);
    }
    return member;
  }

  /** GET /user/:userId/chats */
  async listUserChats(userId: string, pagination: Pagination): Promise<Paginated<ChatSummary>> {
    await this.userService.getUser(userId);
    return this.chats.listForUser(userId, pagination);
  }

  async addGroupMembers(chatId: string, actorId: string, userIds: string[]): Promise<ChatDetails> {
    await this.assertGroupAdmin(chatId, actorId);
    const uniqueIds = [...new Set(userIds)];
    await this.userService.assertUsersExist(uniqueIds);

    const current = await this.chats.listMembers(chatId);
    const currentIds = new Set(current.map((m) => m.userId));
    const newCount = uniqueIds.filter((id) => !currentIds.has(id)).length;
    if (current.length + newCount > MAX_GROUP_MEMBERS) {
      throw new BadRequestError(`A group chat can have at most ${MAX_GROUP_MEMBERS} members`);
    }

    await this.chats.addMembers(chatId, uniqueIds);
    return this.getChatDetails(chatId);
  }

  /** Admins can remove anyone; any member can remove themselves (leave). */
  async removeGroupMember(chatId: string, actorId: string, userId: string): Promise<void> {
    const chat = await this.getChat(chatId);
    this.assertGroup(chat);

    const actor = await this.chats.findMember(chatId, actorId);
    if (!actor) throw new ForbiddenError(`User ${actorId} is not a member of chat ${chatId}`);
    if (actorId !== userId && actor.role !== 'admin') {
      throw new ForbiddenError('Only group admins can remove other members');
    }

    const removed = await this.chats.removeMember(chatId, userId);
    if (!removed) throw new NotFoundError(`User ${userId} is not a member of chat ${chatId}`);
  }

  async renameGroup(chatId: string, actorId: string, name: string): Promise<Chat> {
    await this.assertGroupAdmin(chatId, actorId);
    return this.chats.rename(chatId, name);
  }

  /** Best-effort activity tracking used to sort chat lists. */
  recordActivity(chatId: string, at: Date): Promise<void> {
    return this.chats.updateLastMessageAt(chatId, at);
  }

  private async assertGroupAdmin(chatId: string, actorId: string): Promise<void> {
    const chat = await this.getChat(chatId);
    this.assertGroup(chat);
    const actor = await this.chats.findMember(chatId, actorId);
    if (!actor || actor.role !== 'admin') {
      throw new ForbiddenError('Only group admins can perform this action');
    }
  }

  private assertGroup(chat: Chat): void {
    if (chat.type !== 'group') {
      throw new BadRequestError('This operation is only supported for group chats');
    }
  }
}
