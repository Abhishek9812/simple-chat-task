import { randomBytes } from 'node:crypto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../src/common/errors';
import type { MessageRepository } from '../../src/modules/messages/message.repository';
import type {
  CreateMessageInput,
  LastSeen,
  LastSeenUpdate,
  ListMessagesOptions,
  Message,
  MessagePage,
  ReadReceipt,
} from '../../src/modules/messages/message.types';

/**
 * In-memory implementation of the MessageRepository contract that mirrors the
 * Firestore implementation's semantics (ordering, cursors, idempotent receipts,
 * forward-only last seen). Used by unit and API tests.
 */
export class InMemoryMessageRepository implements MessageRepository {
  private readonly messages = new Map<string, Message[]>();
  private readonly lastSeen = new Map<string, Map<string, LastSeen>>();
  private clock = Date.now();

  /** Strictly increasing clock so ordering is deterministic in tests. */
  private now(): Date {
    this.clock += 1;
    return new Date(this.clock);
  }

  create({ chatId, senderId, text }: CreateMessageInput): Promise<Message> {
    const message: Message = {
      id: randomBytes(10).toString('hex'),
      chatId,
      senderId,
      text,
      createdAt: this.now(),
      editedAt: null,
      deletedAt: null,
      isDeleted: false,
      readBy: {},
    };
    this.chatMessages(chatId).push(message);
    return Promise.resolve(clone(message));
  }

  findById(chatId: string, messageId: string): Promise<Message | null> {
    const message = this.find(chatId, messageId);
    return Promise.resolve(message ? clone(message) : null);
  }

  list(chatId: string, { limit, before }: ListMessagesOptions): Promise<MessagePage> {
    let newestFirst = [...this.chatMessages(chatId)].reverse();
    if (before) {
      const index = newestFirst.findIndex((m) => m.id === before);
      if (index === -1) {
        return Promise.reject(new BadRequestError(`Cursor message ${before} does not exist`));
      }
      newestFirst = newestFirst.slice(index + 1);
    }
    const page = newestFirst.slice(0, limit);
    return Promise.resolve({
      messages: page.map(clone).reverse(),
      nextCursor: newestFirst.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  }

  markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    const message = this.find(chatId, messageId);
    if (!message) return Promise.reject(new NotFoundError(`Message ${messageId} not found`));

    const alreadyRead = message.senderId === userId || Boolean(message.readBy[userId]);
    if (!alreadyRead) message.readBy[userId] = this.now();

    return Promise.resolve({
      chatId,
      messageId,
      userId,
      readAt: message.readBy[userId] ?? null,
      alreadyRead,
    });
  }

  updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    const message = this.find(chatId, messageId);
    if (!message) return Promise.reject(new NotFoundError(`Message ${messageId} not found`));

    const perChat = this.lastSeen.get(chatId) ?? new Map<string, LastSeen>();
    this.lastSeen.set(chatId, perChat);
    const current = perChat.get(userId);

    if (current && message.createdAt <= current.messageCreatedAt) {
      return Promise.resolve({ lastSeen: { ...current }, updated: false });
    }

    const next: LastSeen = {
      chatId,
      userId,
      messageId,
      messageCreatedAt: message.createdAt,
      updatedAt: this.now(),
    };
    perChat.set(userId, next);
    return Promise.resolve({ lastSeen: { ...next }, updated: true });
  }

  listLastSeen(chatId: string): Promise<LastSeen[]> {
    return Promise.resolve([...(this.lastSeen.get(chatId)?.values() ?? [])].map((l) => ({ ...l })));
  }

  edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    return Promise.resolve().then(() => {
      const message = this.assertModifiable(chatId, messageId, userId);
      message.text = text;
      message.editedAt = this.now();
      return clone(message);
    });
  }

  softDelete(chatId: string, messageId: string, userId: string): Promise<Message> {
    return Promise.resolve().then(() => {
      const message = this.assertModifiable(chatId, messageId, userId);
      message.text = null;
      message.deletedAt = this.now();
      message.isDeleted = true;
      return clone(message);
    });
  }

  private assertModifiable(chatId: string, messageId: string, userId: string): Message {
    const message = this.find(chatId, messageId);
    if (!message) throw new NotFoundError(`Message ${messageId} not found`);
    if (message.senderId !== userId)
      throw new ForbiddenError('Only the sender can modify this message');
    if (message.isDeleted) throw new ConflictError('Message has already been deleted');
    return message;
  }

  private chatMessages(chatId: string): Message[] {
    const list = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, list);
    return list;
  }

  private find(chatId: string, messageId: string): Message | undefined {
    return this.chatMessages(chatId).find((m) => m.id === messageId);
  }
}

const clone = (message: Message): Message => ({ ...message, readBy: { ...message.readBy } });
