import type { Request, Response } from 'express';
import { parseRequest, sendSuccess } from '../../common/http';
import {
  chatIdParamsSchema,
  deleteMessageBodySchema,
  editMessageBodySchema,
  listMessagesQuerySchema,
  markReadBodySchema,
  messageParamsSchema,
  sendMessageBodySchema,
  updateLastSeenBodySchema,
} from './message.schemas';
import type { MessageService } from './message.service';

export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  send = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: chatIdParamsSchema,
      body: sendMessageBodySchema,
    });
    const message = await this.messageService.sendMessage(params.chatId, body.senderId, body.text);
    sendSuccess(res, message, 201);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const { params, query } = parseRequest(req, {
      params: chatIdParamsSchema,
      query: listMessagesQuerySchema,
    });
    sendSuccess(res, await this.messageService.getMessages(params.chatId, query));
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: messageParamsSchema,
      body: markReadBodySchema,
    });
    const receipt = await this.messageService.markRead(
      params.chatId,
      params.messageId,
      body.userId,
    );
    sendSuccess(res, receipt);
  };

  updateLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: chatIdParamsSchema,
      body: updateLastSeenBodySchema,
    });
    const result = await this.messageService.updateLastSeen(
      params.chatId,
      body.userId,
      body.messageId,
    );
    sendSuccess(res, result);
  };

  getLastSeen = async (req: Request, res: Response): Promise<void> => {
    const { params } = parseRequest(req, { params: chatIdParamsSchema });
    sendSuccess(res, await this.messageService.getLastSeen(params.chatId));
  };

  edit = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: messageParamsSchema,
      body: editMessageBodySchema,
    });
    const message = await this.messageService.editMessage(
      params.chatId,
      params.messageId,
      body.userId,
      body.text,
    );
    sendSuccess(res, message);
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: messageParamsSchema,
      body: deleteMessageBodySchema,
    });
    const message = await this.messageService.deleteMessage(
      params.chatId,
      params.messageId,
      body.userId,
    );
    sendSuccess(res, message);
  };
}
