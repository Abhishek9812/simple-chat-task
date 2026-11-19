import { z } from 'zod';
import { idSchema } from '../../common/schemas';

export const chatIdParamsSchema = z.object({
  chatId: idSchema,
});

export const chatMemberParamsSchema = z.object({
  chatId: idSchema,
  userId: idSchema,
});

export const createDirectChatBodySchema = z.object({
  userAId: idSchema,
  userBId: idSchema,
});

const groupNameSchema = z.string().trim().min(1).max(100);

export const createGroupChatBodySchema = z.object({
  creatorId: idSchema,
  name: groupNameSchema,
  memberIds: z.array(idSchema).min(1).max(255),
});

export const addMembersBodySchema = z.object({
  actorId: idSchema,
  userIds: z.array(idSchema).min(1).max(255),
});

export const removeMemberBodySchema = z.object({
  actorId: idSchema,
});

export const renameGroupBodySchema = z.object({
  actorId: idSchema,
  name: groupNameSchema,
});
