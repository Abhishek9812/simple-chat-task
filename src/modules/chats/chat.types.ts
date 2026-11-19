export type ChatType = 'direct' | 'group';
export type ChatMemberRole = 'admin' | 'member';

export interface Chat {
  id: string;
  type: ChatType;
  /** Only set for group chats. */
  name: string | null;
  createdBy: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMember {
  userId: string;
  role: ChatMemberRole;
  joinedAt: Date;
}

export interface ChatDetails extends Chat {
  members: ChatMember[];
}

export interface ChatSummary extends Chat {
  memberIds: string[];
}

export interface Pagination {
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
