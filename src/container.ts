import type { Pool } from 'pg';
import type { Firestore } from 'firebase-admin/firestore';
import type { Logger } from 'pino';
import type { AppDependencies } from './app';
import { ChatRepository } from './modules/chats/chat.repository';
import { ChatService } from './modules/chats/chat.service';
import { FirestoreMessageRepository } from './modules/messages/message.repository';
import type { MessageRepository } from './modules/messages/message.repository';
import { MessageService } from './modules/messages/message.service';
import { UserRepository } from './modules/users/user.repository';
import { UserService } from './modules/users/user.service';

export interface ContainerOptions {
  pool: Pool;
  logger: Logger;
  /** Either a Firestore instance or a pre-built repository (useful for tests). */
  firestore?: Firestore;
  messageRepository?: MessageRepository;
  corsOrigin?: string;
}

/** Composition root: wires repositories and services together. */
export function buildContainer(options: ContainerOptions): AppDependencies {
  const { pool, logger } = options;

  const messageRepository =
    options.messageRepository ??
    (options.firestore ? new FirestoreMessageRepository(options.firestore) : undefined);
  if (!messageRepository) {
    throw new Error('Either `firestore` or `messageRepository` must be provided');
  }

  const userService = new UserService(new UserRepository(pool));
  const chatService = new ChatService(new ChatRepository(pool), userService);
  const messageService = new MessageService(messageRepository, chatService, logger);

  return {
    logger,
    userService,
    chatService,
    messageService,
    corsOrigin: options.corsOrigin,
    readinessCheck: async () => {
      await pool.query('SELECT 1');
    },
  };
}
