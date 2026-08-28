import { AUDIT_ACTIONS } from '../../../shared/constants';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import type {
  AdminReportDto,
  CommentDto,
  ModerationQueueSummary,
  ReviewDto,
} from '../dto/community.dto';
import type { ICommunityRepository } from '../repositories/community.repository';
import { communityRepository } from '../repositories/community.repository';
import type { AuditLogService } from '../../../features/admin/services/audit-log.service';
import { auditLogService } from '../../../features/admin/services/audit-log.service';

/** Identity of the platform admin performing a moderation action. */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * F8 §07 content moderation (OPS-27..34), behind
 * `platform.content.moderate`. Every mutation writes an audit row.
 *
 * Review approval denormalizes the average rating into
 * `academy_courses.average_rating`/`total_ratings` (AC-04). The `labs`
 * table has no rating column in the authoritative schema (devops_db.sql),
 * so lab approval recomputes the average and logs a skip instead of
 * writing a non-existent column (documented drift decision).
 */
export interface AdminModerationServiceDeps {
  repo: Pick<
    ICommunityRepository,
    | 'listAllReviews'
    | 'countAllReviews'
    | 'findReviewById'
    | 'setReviewApproved'
    | 'deleteReview'
    | 'computeTargetRating'
    | 'updateCourseRating'
    | 'listAllComments'
    | 'countAllComments'
    | 'findCommentById'
    | 'setCommentHidden'
    | 'setCommentPinned'
    | 'listReports'
    | 'countReports'
    | 'countReportsByStatus'
    | 'findReportById'
    | 'setReportStatus'
  >;
  audit: Pick<AuditLogService, 'record'>;
}

function defaultDeps(): AdminModerationServiceDeps {
  return { repo: communityRepository, audit: auditLogService };
}

export class AdminModerationService {
  constructor(private readonly deps: AdminModerationServiceDeps = defaultDeps()) {}

  /** OPS-27: all reviews (pending + approved), with pagination. */
  async listReviews(
    status: 'all' | 'pending' | 'approved',
    page: number,
    limit: number,
  ): Promise<{ data: ReviewDto[]; total: number; page: number }> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listAllReviews(status, (page - 1) * limit, limit),
      this.deps.repo.countAllReviews(status),
    ]);

    const data = rows.map((row) => ({
      reviewId: row.reviewId,
      targetType: row.targetType as 'course' | 'lab',
      targetId: row.targetId,
      rating: row.rating,
      title: row.title,
      content: row.content,
      isApproved: row.isApproved,
      helpfulCount: row.helpfulCount,
      createdAt: row.createdAt.toISOString(),
      author: { userId: row.userId, fullName: row.authorFullName, avatarUrl: row.authorAvatarUrl },
    }));

    return { data, total, page };
  }

  /** Admin comment list (additive surface for OPS-30/31 pin/hide actions). */
  async listComments(page: number, limit: number): Promise<{ data: CommentDto[]; total: number; page: number }> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listAllComments((page - 1) * limit, limit),
      this.deps.repo.countAllComments(),
    ]);

    const data = rows.map((row) => ({
      commentId: row.commentId,
      parentCommentId: row.parentCommentId,
      targetType: row.targetType as 'course' | 'lab' | 'news',
      targetId: row.targetId,
      content: row.content,
      isPinned: row.isPinned,
      isHidden: row.isHidden,
      likesCount: row.likesCount,
      createdAt: row.createdAt.toISOString(),
      author: { userId: row.userId, fullName: row.authorFullName, avatarUrl: row.authorAvatarUrl },
    }));

    return { data, total, page };
  }

  /** OPS-28: approve a review and denormalize the target average rating. */  async approveReview(actor: AdminActor, reviewId: number): Promise<ReviewDto> {
    const review = await this.deps.repo.findReviewById(reviewId);
    if (!review) {
      throw new NotFoundError('Review not found.');
    }

    if (!review.isApproved) {
      await this.deps.repo.setReviewApproved(reviewId, true);
      await this.recalculateTargetRating(review.targetType as 'course' | 'lab', review.targetId);
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.APPROVE_REVIEW,
      targetType: 'review',
      targetId: reviewId,
      changes: { isApproved: true },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      reviewId: review.reviewId,
      targetType: review.targetType as 'course' | 'lab',
      targetId: review.targetId,
      rating: review.rating,
      title: review.title,
      content: review.content,
      isApproved: true,
      helpfulCount: review.helpfulCount,
      createdAt: review.createdAt.toISOString(),
      author: { userId: review.userId, fullName: review.authorFullName, avatarUrl: review.authorAvatarUrl },
    };
  }

  /** OPS-29: delete a review from the platform. */
  async deleteReview(actor: AdminActor, reviewId: number): Promise<void> {
    const review = await this.deps.repo.findReviewById(reviewId);
    if (!review) {
      throw new NotFoundError('Review not found.');
    }

    await this.deps.repo.deleteReview(reviewId);
    await this.recalculateTargetRating(review.targetType as 'course' | 'lab', review.targetId);

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.DELETE_REVIEW,
      targetType: 'review',
      targetId: reviewId,
      changes: { deleted: true },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  /** OPS-30: pin (or unpin) a comment. */
  async pinComment(actor: AdminActor, commentId: number): Promise<{ commentId: number; isPinned: boolean }> {
    const comment = await this.deps.repo.findCommentById(commentId);
    if (!comment) {
      throw new NotFoundError('Comment not found.');
    }

    const isPinned = !comment.isPinned;
    await this.deps.repo.setCommentPinned(commentId, isPinned);

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.PIN_COMMENT,
      targetType: 'comment',
      targetId: commentId,
      changes: { isPinned },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { commentId, isPinned };
  }

  /** OPS-31: hide (or unhide) a comment; hidden rows leave public lists. */
  async hideComment(actor: AdminActor, commentId: number): Promise<{ commentId: number; isHidden: boolean }> {
    const comment = await this.deps.repo.findCommentById(commentId);
    if (!comment) {
      throw new NotFoundError('Comment not found.');
    }

    const isHidden = !comment.isHidden;
    await this.deps.repo.setCommentHidden(commentId, isHidden);

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.HIDE_COMMENT,
      targetType: 'comment',
      targetId: commentId,
      changes: { isHidden },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { commentId, isHidden };
  }

  /** OPS-32: moderation queue with an optional status filter. */
  async listQueue(
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined,
    page: number,
    limit: number,
  ): Promise<{ data: AdminReportDto[]; total: number; page: number; summary: ModerationQueueSummary }> {
    const [rows, total, summaryRows] = await Promise.all([
      this.deps.repo.listReports(status, (page - 1) * limit, limit),
      this.deps.repo.countReports(status),
      this.deps.repo.countReportsByStatus(),
    ]);

    const summary = { pending: 0, reviewing: 0, resolved: 0, dismissed: 0 } satisfies ModerationQueueSummary;
    for (const row of summaryRows) {
      summary[row.status] = row.value;
    }

    const data = rows.map((row) => ({
      reportId: row.reportId,
      targetType: row.targetType as AdminReportDto['targetType'],
      targetId: row.targetId,
      reportReason: row.reportReason,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      reporter: { userId: row.reporterUserId, fullName: row.reporterFullName },
    }));

    return { data, total, page, summary };
  }

  /** OPS-33: resolve a report (recorded with the admin actor). */
  async resolveReport(actor: AdminActor, reportId: number): Promise<AdminReportDto> {
    return this.transition(actor, reportId, 'resolved', AUDIT_ACTIONS.RESOLVE_REPORT);
  }

  /** OPS-34: dismiss a report. */
  async dismissReport(actor: AdminActor, reportId: number): Promise<AdminReportDto> {
    return this.transition(actor, reportId, 'dismissed', AUDIT_ACTIONS.DISMISS_REPORT);
  }

  private async transition(
    actor: AdminActor,
    reportId: number,
    status: 'resolved' | 'dismissed',
    action: string,
  ): Promise<AdminReportDto> {
    const report = await this.deps.repo.findReportById(reportId);
    if (!report) {
      throw new NotFoundError('Report not found.');
    }

    if (report.status !== status) {
      await this.deps.repo.setReportStatus(reportId, status, actor.userId);
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action,
      targetType: 'report',
      targetId: reportId,
      changes: { status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      reportId: report.reportId,
      targetType: report.targetType as AdminReportDto['targetType'],
      targetId: report.targetId,
      reportReason: report.reportReason,
      description: report.description,
      status,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: new Date().toISOString(),
      reporter: { userId: report.reporterUserId, fullName: report.reporterFullName },
    };
  }

  private async recalculateTargetRating(
    targetType: 'course' | 'lab',
    targetId: number,
  ): Promise<void> {
    const { average, total } = await this.deps.repo.computeTargetRating(targetType, targetId);

    if (targetType === 'course') {
      await this.deps.repo.updateCourseRating(targetId, average, total);
      return;
    }

    // The `labs` table has no rating column in the authoritative schema
    // (devops_db.sql); the recomputed average is logged instead (documented
    // drift decision, contract line 373).
    logger.info(
      { labId: targetId, average, total },
      'Lab rating recomputed; labs.user_rating column unavailable in schema - update skipped',
    );
  }
}

export const adminModerationService = new AdminModerationService();