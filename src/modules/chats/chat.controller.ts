import type { Request, Response } from 'express';
import { parseRequest, sendSuccess } from '../../common/http';
import {
  addMembersBodySchema,
  chatIdParamsSchema,
  chatMemberParamsSchema,
  createDirectChatBodySchema,
  createGroupChatBodySchema,
  removeMemberBodySchema,
  renameGroupBodySchema,
} from './chat.schemas';
import type { ChatService } from './chat.service';

export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** POST /chat/create */
  createOrGetDirect = async (req: Request, res: Response): Promise<void> => {
    const { body } = parseRequest(req, { body: createDirectChatBodySchema });
    const result = await this.chatService.createOrGetDirectChat(body.userAId, body.userBId);
    sendSuccess(res, result, result.created ? 201 : 200);
  };

  /** POST /chat/group/create */
  createGroup = async (req: Request, res: Response): Promise<void> => {
    const { body } = parseRequest(req, { body: createGroupChatBodySchema });
    const chat = await this.chatService.createGroupChat(body.creatorId, body.name, body.memberIds);
    sendSuccess(res, chat, 201);
  };

  /** GET /chat/:chatId */
  getById = async (req: Request, res: Response): Promise<void> => {
    const { params } = parseRequest(req, { params: chatIdParamsSchema });
    sendSuccess(res, await this.chatService.getChatDetails(params.chatId));
  };

  /** PATCH /chat/:chatId */
  rename = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: chatIdParamsSchema,
      body: renameGroupBodySchema,
    });
    sendSuccess(res, await this.chatService.renameGroup(params.chatId, body.actorId, body.name));
  };

  /** POST /chat/:chatId/members */
  addMembers = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: chatIdParamsSchema,
      body: addMembersBodySchema,
    });
    const chat = await this.chatService.addGroupMembers(params.chatId, body.actorId, body.userIds);
    sendSuccess(res, chat);
  };

  /** DELETE /chat/:chatId/members/:userId */
  removeMember = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = parseRequest(req, {
      params: chatMemberParamsSchema,
      body: removeMemberBodySchema,
    });
    await this.chatService.removeGroupMember(params.chatId, body.actorId, params.userId);
    res.status(204).send();
  };
}
