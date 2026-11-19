export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  /** `null` once the message has been deleted. */
  text: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  isDeleted: boolean;
  /** Read receipts: userId -> time the user read the message. */
  readBy: Record<string, Date>;
}

export interface MessagePage {
  /** Ordered oldest -> newest. */
  messages: Message[];
  /** Pass as `before` to fetch the next (older) page; `null` when there are no more. */
  nextCursor: string | null;
}

export interface ListMessagesOptions {
  limit: number;
  /** Message id; only messages strictly older than this one are returned. */
  before?: string | undefined;
}

export interface ReadReceipt {
  chatId: string;
  messageId: string;
  userId: string;
  readAt: Date | null;
  /** True when the receipt already existed (the call was a no-op). */
  alreadyRead: boolean;
}

export interface LastSeen {
  chatId: string;
  userId: string;
  messageId: string;
  messageCreatedAt: Date;
  updatedAt: Date;
}

export interface LastSeenUpdate {
  lastSeen: LastSeen;
  /** False when the requested message is older than the stored one (pointer never moves back). */
  updated: boolean;
}

export interface CreateMessageInput {
  chatId: string;
  senderId: string;
  text: string;
}
