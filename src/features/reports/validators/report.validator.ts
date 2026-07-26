import { z } from 'zod';

export const reportTypeQuerySchema = z.object({
  type: z.enum(['users']).optional().default('users'),
});
