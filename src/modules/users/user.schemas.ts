import { z } from 'zod';
import { idSchema } from '../../common/schemas';

export const createUserBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const userIdParamsSchema = z.object({
  userId: idSchema,
});
