import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type {
  CollectionReference,
  DocumentSnapshot,
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import type {
  CreateMessageInput,
  LastSeen,
  LastSeenUpdate,
  ListMessagesOptions,
  Message,
  MessagePage,
  ReadReceipt,
} from './message.types';

/**
 * Storage contract for messages, read receipts and last-seen pointers.
 * The service layer depends on this interface only, which keeps Firestore
 * an implementation detail and makes the domain logic easy to test.
 */
export interface MessageRepository {
  create(input: CreateMessageInput): Promise<Message>;
  findById(chatId: string, messageId: string): Promise<Message | null>;
  list(chatId: string, options: ListMessagesOptions): Promise<MessagePage>;
  markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt>;
  updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate>;
  listLastSeen(chatId: string): Promise<LastSeen[]>;
  edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message>;
  softDelete(chatId: string, messageId: string, userId: string): Promise<Message>;
}

/*
 * Firestore layout
 *
 *   chats/{chatId}/messages/{messageId}
 *     chatId, senderId, text, createdAt, editedAt, deletedAt,
 *     readBy: { [userId]: Timestamp }          <- read receipts
 *
 *   chats/{chatId}/lastSeen/{userId}
 *     userId, messageId, messageCreatedAt, updatedAt
 *
 * Messages are ordered by the server-assigned `createdAt` timestamp, with the
 * document id as a deterministic tie-breaker.
 */
interface MessageDoc {
  chatId: string;
  senderId: string;
  text: string | null;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  readBy?: Record<string, Timestamp>;
}

interface LastSeenDoc {
  userId: string;
  messageId: string;
  messageCreatedAt: Timestamp;
  updatedAt: Timestamp;
}

const CHATS = 'chats';
const MESSAGES = 'messages';
const LAST_SEEN = 'lastSeen';

export class FirestoreMessageRepository implements MessageRepository {
  constructor(private readonly db: Firestore) {}

  async create({ chatId, senderId, text }: CreateMessageInput): Promise<Message> {
    const ref = this.messages(chatId).doc();
    await ref.set({
      chatId,
      senderId,
      text,
      createdAt: FieldValue.serverTimestamp(),
      editedAt: null,
      deletedAt: null,
      readBy: {},
    });
    // Read back to return the server-assigned timestamp.
    return this.toMessage(await ref.get());
  }

  async findById(chatId: string, messageId: string): Promise<Message | null> {
    const snapshot = await this.messages(chatId).doc(messageId).get();
    return snapshot.exists ? this.toMessage(snapshot) : null;
  }

  async list(chatId: string, { limit, before }: ListMessagesOptions): Promise<MessagePage> {
    // Newest first so `limit` returns the most recent messages...
    let query = this.messages(chatId)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit + 1);

    if (before) {
      const cursor = await this.messages(chatId).doc(before).get();
      if (!cursor.exists) {
        throw new BadRequestError(`Cursor message ${before} does not exist in this chat`);
      }
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const hasMore = snapshot.docs.length > limit;

    return {
      // ...then flipped so clients receive them in chronological order.
      messages: docs.map((doc) => this.toMessage(doc)).reverse(),
      nextCursor: hasMore ? (docs[docs.length - 1]?.id ?? null) : null,
    };
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    const ref = this.messages(chatId).doc(messageId);

    const alreadyRead = await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new NotFoundError(`Message ${messageId} not found`);
      const data = snapshot.data() as MessageDoc;

      // Senders implicitly "read" their own messages; receipts are idempotent.
      if (data.senderId === userId || data.readBy?.[userId]) return true;

      tx.update(ref, new FieldPath('readBy', userId), FieldValue.serverTimestamp());
      return false;
    });

    const data = (await ref.get()).data() as MessageDoc;
    return {
      chatId,
      messageId,
      userId,
      readAt: data.readBy?.[userId]?.toDate() ?? null,
      alreadyRead,
    };
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenUpdate> {
    const messageRef = this.messages(chatId).doc(messageId);
    const lastSeenRef = this.lastSeen(chatId).doc(userId);

    const updated = await this.db.runTransaction(async (tx) => {
      const [messageSnap, lastSeenSnap] = await Promise.all([
        tx.get(messageRef),
        tx.get(lastSeenRef),
      ]);
      if (!messageSnap.exists) throw new NotFoundError(`Message ${messageId} not found`);

      const message = messageSnap.data() as MessageDoc;
      const current = lastSeenSnap.exists ? (lastSeenSnap.data() as LastSeenDoc) : null;

      // The pointer only moves forward; late/out-of-order requests are ignored.
      if (current && !isAfter(message.createdAt, messageId, current)) return false;

      tx.set(lastSeenRef, {
        userId,
        messageId,
        messageCreatedAt: message.createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    const snapshot = await lastSeenRef.get();
    return { lastSeen: toLastSeen(chatId, snapshot.data() as LastSeenDoc), updated };
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    const snapshot = await this.lastSeen(chatId).get();
    return snapshot.docs.map((doc) => toLastSeen(chatId, doc.data() as LastSeenDoc));
  }

  async edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    const ref = this.messages(chatId).doc(messageId);
    await this.db.runTransaction(async (tx) => {
      assertSenderCanModify(await tx.get(ref), messageId, userId);
      tx.update(ref, { text, editedAt: FieldValue.serverTimestamp() });
    });
    return this.toMessage(await ref.get());
  }

  async softDelete(chatId: string, messageId: string, userId: string): Promise<Message> {
    const ref = this.messages(chatId).doc(messageId);
    await this.db.runTransaction(async (tx) => {
      assertSenderCanModify(await tx.get(ref), messageId, userId);
      // Keep a tombstone so ordering, pagination cursors and receipts stay valid.
      tx.update(ref, { text: null, deletedAt: FieldValue.serverTimestamp() });
    });
    return this.toMessage(await ref.get());
  }

  private messages(chatId: string): CollectionReference {
    return this.db.collection(CHATS).doc(chatId).collection(MESSAGES);
  }

  private lastSeen(chatId: string): CollectionReference {
    return this.db.collection(CHATS).doc(chatId).collection(LAST_SEEN);
  }

  private toMessage(snapshot: DocumentSnapshot): Message {
    const data = snapshot.data() as MessageDoc;
    return {
      id: snapshot.id,
      chatId: data.chatId,
      senderId: data.senderId,
      text: data.deletedAt ? null : data.text,
      createdAt: data.createdAt.toDate(),
      editedAt: data.editedAt?.toDate() ?? null,
      deletedAt: data.deletedAt?.toDate() ?? null,
      isDeleted: data.deletedAt !== null,
      readBy: Object.fromEntries(
        Object.entries(data.readBy ?? {}).map(([uid, ts]) => [uid, ts.toDate()]),
      ),
    };
  }
}

function assertSenderCanModify(snapshot: DocumentSnapshot, messageId: string, userId: string) {
  if (!snapshot.exists) throw new NotFoundError(`Message ${messageId} not found`);
  const data = snapshot.data() as MessageDoc;
  if (data.senderId !== userId) {
    throw new ForbiddenError('Only the sender can modify this message');
  }
  if (data.deletedAt) throw new ConflictError('Message has already been deleted');
}

/** Same ordering as the list query: createdAt, then document id. */
function isAfter(createdAt: Timestamp, messageId: string, current: LastSeenDoc): boolean {
  const seen = current.messageCreatedAt;
  const diff = createdAt.seconds - seen.seconds || createdAt.nanoseconds - seen.nanoseconds;
  return diff !== 0 ? diff > 0 : messageId > current.messageId;
}

function toLastSeen(chatId: string, data: LastSeenDoc): LastSeen {
  return {
    chatId,
    userId: data.userId,
    messageId: data.messageId,
    messageCreatedAt: data.messageCreatedAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}
