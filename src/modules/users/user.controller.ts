import type { Request, Response } from 'express';
import { parseRequest, sendSuccess } from '../../common/http';
import { paginationQuerySchema } from '../../common/schemas';
import type { ChatService } from '../chats/chat.service';
import { createUserBodySchema, userIdParamsSchema } from './user.schemas';
import type { UserService } from './user.service';

export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly chatService: ChatService,
  ) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const { body } = parseRequest(req, { body: createUserBodySchema });
    const user = await this.userService.createUser(body.name);
    sendSuccess(res, user, 201);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { params } = parseRequest(req, { params: userIdParamsSchema });
    sendSuccess(res, await this.userService.getUser(params.userId));
  };

  /** GET /user/:userId/chats */
  listChats = async (req: Request, res: Response): Promise<void> => {
    const { params, query } = parseRequest(req, {
      params: userIdParamsSchema,
      query: paginationQuerySchema,
    });
    const chats = await this.chatService.listUserChats(params.userId, query);
    sendSuccess(res, chats);
  };
}
