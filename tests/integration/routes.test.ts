import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app';
import { ForbiddenError, NotFoundError } from '../../src/common/errors';
import type { ChatService } from '../../src/modules/chats/chat.service';
import type { MessageService } from '../../src/modules/messages/message.service';
import type { UserService } from '../../src/modules/users/user.service';
import { silentLogger } from '../helpers/logger';

/** HTTP-layer tests: routing, validation, status codes and error mapping. */
describe('HTTP routes', () => {
  const chatService = {
    createOrGetDirectChat: jest.fn(),
    listUserChats: jest.fn(),
  } as unknown as jest.Mocked<ChatService>;
  const messageService = {
    sendMessage: jest.fn(),
    getMessages: jest.fn(),
    markRead: jest.fn(),
    updateLastSeen: jest.fn(),
  } as unknown as jest.Mocked<MessageService>;
  const userService = {} as UserService;

  const app = createApp({ logger: silentLogger, chatService, messageService, userService });

  it('GET /health', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/nope').expect(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/chat/create')
      .set('content-type', 'application/json')
      .send('{bad json')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  describe('POST /chat/create', () => {
    it('validates the body', async () => {
      const res = await request(app).post('/chat/create').send({ userAId: 'x' }).expect(400);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
        expect.arrayContaining(['userAId', 'userBId']),
      );
    });

    it('returns 201 when the chat is created and 200 when it already existed', async () => {
      const body = { userAId: randomUUID(), userBId: randomUUID() };
      const chatId = randomUUID();

      chatService.createOrGetDirectChat.mockResolvedValueOnce({ chatId, created: true });
      const created = await request(app).post('/chat/create').send(body).expect(201);
      expect(created.body).toEqual({ success: true, data: { chatId, created: true } });

      chatService.createOrGetDirectChat.mockResolvedValueOnce({ chatId, created: false });
      await request(app).post('/chat/create').send(body).expect(200);
    });

    it('maps domain errors to status codes', async () => {
      chatService.createOrGetDirectChat.mockRejectedValueOnce(new NotFoundError('User not found'));
      const res = await request(app)
        .post('/chat/create')
        .send({ userAId: randomUUID(), userBId: randomUUID() })
        .expect(404);
      expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'User not found' });
    });
  });

  describe('POST /chat/:chatId/message/send', () => {
    it('rejects empty text', async () => {
      await request(app)
        .post(`/chat/${randomUUID()}/message/send`)
        .send({ senderId: randomUUID(), text: '   ' })
        .expect(400);
      expect(messageService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 403 for non-members', async () => {
      messageService.sendMessage.mockRejectedValueOnce(new ForbiddenError('not a member'));
      await request(app)
        .post(`/chat/${randomUUID()}/message/send`)
        .send({ senderId: randomUUID(), text: 'hi' })
        .expect(403);
    });

    it('trims text and returns 201', async () => {
      const chatId = randomUUID();
      const senderId = randomUUID();
      messageService.sendMessage.mockResolvedValueOnce({ id: 'm1' } as never);
      await request(app)
        .post(`/chat/${chatId}/message/send`)
        .send({ senderId, text: '  hi  ' })
        .expect(201);
      expect(messageService.sendMessage).toHaveBeenCalledWith(chatId, senderId, 'hi');
    });
  });

  describe('GET /chat/:chatId/messages', () => {
    it('defaults limit to 50', async () => {
      const chatId = randomUUID();
      messageService.getMessages.mockResolvedValueOnce({ messages: [], nextCursor: null });
      await request(app).get(`/chat/${chatId}/messages`).expect(200);
      expect(messageService.getMessages).toHaveBeenCalledWith(chatId, { limit: 50 });
    });

    it('rejects a limit above the maximum', async () => {
      await request(app).get(`/chat/${randomUUID()}/messages?limit=1000`).expect(400);
    });
  });

  it('POST /chat/:chatId/message/:messageId/read validates the message id', async () => {
    await request(app)
      .post(`/chat/${randomUUID()}/message/bad.id/read`)
      .send({ userId: randomUUID() })
      .expect(400);
  });

  it('POST /chat/:chatId/lastseen requires userId and messageId', async () => {
    await request(app).post(`/chat/${randomUUID()}/lastseen`).send({}).expect(400);
  });

  it('GET /user/:userId/chats passes pagination', async () => {
    const userId = randomUUID();
    chatService.listUserChats.mockResolvedValueOnce({ items: [], total: 0, limit: 10, offset: 5 });
    await request(app).get(`/user/${userId}/chats?limit=10&offset=5`).expect(200);
    expect(chatService.listUserChats).toHaveBeenCalledWith(userId, { limit: 10, offset: 5 });
  });
});
