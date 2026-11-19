import { Router } from 'express';
import type { UserController } from './user.controller';

export function buildUserRouter(controller: UserController): Router {
  const router = Router();
  router.post('/create', controller.create);
  router.get('/:userId', controller.getById);
  router.get('/:userId/chats', controller.listChats);
  return router;
}
