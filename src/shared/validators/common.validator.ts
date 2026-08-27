import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid id format.'),
});

export const numberParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid id format.'),
});

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;
export type UuidParamDto = z.infer<typeof uuidParamSchema>;
export type NumberParamDto = z.infer<typeof numberParamSchema>;
