/**
 * F8 response DTOs for the community feature (reviews, comments, likes,
 * reports + admin moderation). All dates are ISO strings.
 */

/** Zod-restricted review target subset (invariant 2). */
export type ReviewTargetType = 'course' | 'lab';

/** Zod-restricted comment target subset (AC-10). */
export type CommentTargetType = 'course' | 'lab' | 'news';

/** Zod-restricted like target subset. */
export type LikeTargetType = 'comment' | 'review';

/**
 * Zod-restricted report target subset (AC-09). `'lab'` is intentionally
 * excluded: the authoritative SQL ENUM for `reports.target_type` has no
 * `'lab'` value, so such rows could never be persisted.
 */
export type ReportTargetType = 'user' | 'comment' | 'review' | 'course';

/** OPS-13/14: review row with author summary. */
export interface ReviewDto {
  reviewId: number;
  targetType: ReviewTargetType;
  targetId: number;
  rating: number | null;
  title: string | null;
  content: string | null;
  isApproved: boolean;
  helpfulCount: number;
  createdAt: string;
  author: {
    userId: number;
    fullName: string | null;
    avatarUrl: string | null;
  };
}

/** OPS-13: paginated approved-review list. */
export interface ReviewListDto {
  data: ReviewDto[];
  total: number;
  page: number;
}

/** OPS-15/16/17: comment row with author summary. */
export interface CommentDto {
  commentId: number;
  parentCommentId: number | null;
  targetType: CommentTargetType;
  targetId: number;
  content: string;
  isPinned: boolean;
  isHidden: boolean;
  likesCount: number;
  createdAt: string;
  author: {
    userId: number;
    fullName: string | null;
    avatarUrl: string | null;
  };
}

/** OPS-15: paginated visible-comment list. */
export interface CommentListDto {
  data: CommentDto[];
  total: number;
  page: number;
}

/** OPS-18: like action result. */
export interface LikeResultDto {
  targetType: LikeTargetType;
  targetId: number;
  liked: boolean;
  likesCount: number;
}

/** OPS-19: report row as returned to the reporter (never raw target content). */
export interface ReportDto {
  reportId: number;
  targetType: ReportTargetType;
  targetId: number;
  reportReason: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt: string;
}

/** OPS-32/33/34: admin moderation queue row (with reporter summary). */
export interface AdminReportDto {
  reportId: number;
  targetType: ReportTargetType;
  targetId: number;
  reportReason: string;
  description: string | null;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  reporter: {
    userId: number;
    fullName: string | null;
  };
}

/** Admin moderation queue summary widget. */
export interface ModerationQueueSummary {
  pending: number;
  reviewing: number;
  resolved: number;
  dismissed: number;
}