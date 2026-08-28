import { z } from 'zod';

/**
 * F8 §07 community payload, query and param schemas. Body schemas use
 * `.strip()` (unknown keys discarded at the boundary); enums enforce the
 * DevOps Mentor target subsets (AC-09/AC-10, invariant 2).
 */

const reviewTargetType = z.enum(['course', 'lab']);
const commentTargetType = z.enum(['course', 'lab', 'news']);
const likeTargetType = z.enum(['comment', 'review']);
const reportTargetType = z.enum(['user', 'comment', 'review', 'course']);

/** OPS-13: `GET /api/reviews?targetType&targetId&page&limit`. */
export const listReviewsQuerySchema = z
  .object({
    targetType: reviewTargetType,
    targetId: z.coerce.number().int().positive(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strip();

/** OPS-14: `POST /api/reviews` payload. */
export const createReviewSchema = z
  .object({
    targetType: reviewTargetType,
    targetId: z.coerce.number().int().positive(),
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().max(255).optional(),
    content: z.string().max(5000).optional(),
  })
  .strip();

/** OPS-15: `GET /api/comments?targetType&targetId&page&limit`. */
export const listCommentsQuerySchema = z
  .object({
    targetType: commentTargetType,
    targetId: z.coerce.number().int().positive(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strip();

/** OPS-16: `POST /api/comments` payload. */
export const createCommentSchema = z
  .object({
    targetType: commentTargetType,
    targetId: z.coerce.number().int().positive(),
    parentCommentId: z.coerce.number().int().positive().optional(),
    content: z.string().min(1).max(5000),
  })
  .strip();

/** OPS-17: `DELETE /api/comments/:id`. */
export const commentIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-18: `POST /api/likes` payload. */
export const createLikeSchema = z
  .object({
    targetType: likeTargetType,
    targetId: z.coerce.number().int().positive(),
    likeType: z.enum(['like', 'love', 'useful', 'funny']).default('like'),
  })
  .strip();

/** OPS-18 (unlike): `DELETE /api/likes/:targetType/:targetId`. */
export const likeTargetParamSchema = z
  .object({
    targetType: likeTargetType,
    targetId: z.coerce.number().int().positive(),
  })
  .strip();

/** OPS-19: `POST /api/reports` payload. */
export const createReportSchema = z
  .object({
    targetType: reportTargetType,
    targetId: z.coerce.number().int().positive(),
    reportedUserId: z.coerce.number().int().positive().optional(),
    reportReason: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
  })
  .strip();

/** OPS-27: `GET /api/admin/reviews?status=all|pending|approved`. */
export const adminReviewsQuerySchema = z
  .object({
    status: z.enum(['all', 'pending', 'approved']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** Admin comments list: `GET /api/admin/comments?page&limit`. */
export const adminCommentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** OPS-28/29: `PATCH/DELETE /api/admin/reviews/:id`. */
export const adminReviewIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-30/31: `PATCH /api/admin/comments/:id/(pin|hide)`. */
export const adminCommentIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-32: `GET /api/admin/reports?status=pending|reviewing|resolved|dismissed`. */
export const adminReportsQuerySchema = z
  .object({
    status: z.enum(['pending', 'reviewing', 'resolved', 'dismissed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** OPS-33/34: `PATCH /api/admin/reports/:id/(resolve|dismiss)`. */
export const adminReportIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();