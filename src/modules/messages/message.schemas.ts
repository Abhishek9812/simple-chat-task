import { z } from 'zod';
import { idSchema } from '../../common/schemas';

export const MAX_MESSAGE_LENGTH = 4000;
export const DEFAULT_MESSAGES_LIMIT = 50;
export const MAX_MESSAGES_LIMIT = 100;

/** Firestore auto-generated ids are 20 alphanumeric chars; be lenient but path-safe. */
export const messageIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, { message: 'must be a valid message id' });

const messageTextSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);

export const chatIdParamsSchema = z.object({
  chatId: idSchema,
});

export const messageParamsSchema = z.object({
  chatId: idSchema,
  messageId: messageIdSchema,
});

export const sendMessageBodySchema = z.object({
  senderId: idSchema,
  text: messageTextSchema,
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGES_LIMIT).default(DEFAULT_MESSAGES_LIMIT),
  before: messageIdSchema.optional(),
});

export const markReadBodySchema = z.object({
  userId: idSchema,
});

export const updateLastSeenBodySchema = z.object({
  userId: idSchema,
  messageId: messageIdSchema,
});

export const editMessageBodySchema = z.object({
  userId: idSchema,
  text: messageTextSchema,
});

export const deleteMessageBodySchema = z.object({
  userId: idSchema,
});
