import type { Logger } from 'pino';
import type { ChatService } from '../chats/chat.service';
import type { MessageRepository } from './message.repository';
import type {
  LastSeen,
  LastSeenUpdate,
  ListMessagesOptions,
  Message,
  MessagePage,
  ReadReceipt,
} from './message.types';

export class MessageService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly chatService: ChatService,
    private readonly logger: Logger,
  ) {}

  /** POST /chat/:chatId/message/send */
  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    await this.chatService.assertMember(chatId, senderId);
    const message = await this.messages.create({ chatId, senderId, text });

    // Activity tracking is non-critical: the message is already persisted, so a
    // failure here must not turn a successful send into an error for the client.
    this.chatService.recordActivity(chatId, message.createdAt).catch((error: unknown) => {
      this.logger.warn({ err: error, chatId }, 'Failed to update chat last_message_at');
    });

    return message;
  }

  /** GET /chat/:chatId/messages */
  async getMessages(chatId: string, options: ListMessagesOptions): Promise<MessagePage> {
    await this.chatService.getChat(chatId);
    return this.messages.list(chatId, options);
  }

  /** POST /chat/:chatId/message/:messageId/read */
  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    await this.chatService.assertMember(chatId, userId);
    return this.messages.markRead(chatId, messageId, userId);
  }

  /** POST /chat/:chatId/lastseen */
  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    await this.chatService.assertMember(chatId, userId);
    return this.messages.updateLastSeen(chatId, userId, messageId);
  }

  /** GET /chat/:chatId/lastseen */
  async getLastSeen(chatId: string): Promise<LastSeen[]> {
    await this.chatService.getChat(chatId);
    return this.messages.listLastSeen(chatId);
  }

  /** PATCH /chat/:chatId/message/:messageId */
  async editMessage(
    chatId: string,
    messageId: string,
    userId: string,
    text: string,
  ): Promise<Message> {
    await this.chatService.assertMember(chatId, userId);
    return this.messages.edit(chatId, messageId, userId, text);
  }

  /** DELETE /chat/:chatId/message/:messageId */
  async deleteMessage(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.chatService.assertMember(chatId, userId);
    return this.messages.softDelete(chatId, messageId, userId);
  }
}
