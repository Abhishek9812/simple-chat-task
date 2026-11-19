import { Router } from 'express';
import type { MessageController } from '../messages/message.controller';
import type { ChatController } from './chat.controller';

/** All routes mounted under `/chat`. */
export function buildChatRouter(chats: ChatController, messages: MessageController): Router {
  const router = Router();

  // Chats
  router.post('/create', chats.createOrGetDirect);
  router.post('/group/create', chats.createGroup);
  router.get('/:chatId', chats.getById);
  router.patch('/:chatId', chats.rename);
  router.post('/:chatId/members', chats.addMembers);
  router.delete('/:chatId/members/:userId', chats.removeMember);

  // Messages
  router.post('/:chatId/message/send', messages.send);
  router.get('/:chatId/messages', messages.list);
  router.patch('/:chatId/message/:messageId', messages.edit);
  router.delete('/:chatId/message/:messageId', messages.remove);

  // Read receipts & last seen
  router.post('/:chatId/message/:messageId/read', messages.markRead);
  router.post('/:chatId/lastseen', messages.updateLastSeen);
  router.get('/:chatId/lastseen', messages.getLastSeen);

  return router;
}
