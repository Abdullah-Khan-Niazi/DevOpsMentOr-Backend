import { z } from 'zod';

/** OPS-42: `GET /api/admin/analytics/activity?days=7|14|30`. */
export const activityTrendQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(14),
  })
  .strip();