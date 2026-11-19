import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createErrorHandler, notFoundHandler } from './middlewares/error-handler';
import { ChatController } from './modules/chats/chat.controller';
import { buildChatRouter } from './modules/chats/chat.routes';
import type { ChatService } from './modules/chats/chat.service';
import { MessageController } from './modules/messages/message.controller';
import type { MessageService } from './modules/messages/message.service';
import { UserController } from './modules/users/user.controller';
import { buildUserRouter } from './modules/users/user.routes';
import type { UserService } from './modules/users/user.service';

export interface AppDependencies {
  logger: Logger;
  userService: UserService;
  chatService: ChatService;
  messageService: MessageService;
  /** Resolves when downstream dependencies (DB) are reachable. */
  readinessCheck?: () => Promise<void>;
  corsOrigin?: string;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: parseCorsOrigin(deps.corsOrigin ?? '*') }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      // Keep access logs compact: no headers / remote address noise.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      await deps.readinessCheck?.();
      res.json({ status: 'ready' });
    } catch (error) {
      deps.logger.warn({ err: error }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const userController = new UserController(deps.userService, deps.chatService);
  const chatController = new ChatController(deps.chatService);
  const messageController = new MessageController(deps.messageService);

  app.use('/user', buildUserRouter(userController));
  app.use('/chat', buildChatRouter(chatController, messageController));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));

  return app;
}

function parseCorsOrigin(value: string): string | string[] {
  if (value === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
