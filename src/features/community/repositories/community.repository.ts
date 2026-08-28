import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  comments,
  labs,
  likes,
  reports,
  reviews,
  users,
} from '../../../app/database/schema';
import type {
  CommentTargetType,
  LikeTargetType,
  ReportTargetType,
  ReviewTargetType,
} from '../dto/community.dto';

/**
 * F8 data access for reviews, comments, likes and reports. Every ownership
 * filter uses the session-derived user id. Author summaries are joined from
 * `users` in a single query (no N+1).
 */

export interface ReviewRow {
  reviewId: number;
  userId: number;
  targetType: 'machine' | 'challenge' | 'course' | 'lab' | 'writeup';
  targetId: number;
  rating: number | null;
  title: string | null;
  content: string | null;
  isApproved: boolean;
  helpfulCount: number;
  createdAt: Date;
}

export interface ReviewWithAuthorRow extends ReviewRow {
  authorFullName: string | null;
  authorAvatarUrl: string | null;
}

export interface CommentRow {
  commentId: number;
  userId: number;
  parentCommentId: number | null;
  targetType: 'machine' | 'challenge' | 'writeup' | 'forum' | 'course' | 'lab' | 'news';
  targetId: number;
  content: string;
  isPinned: boolean;
  isHidden: boolean;
  likesCount: number;
  createdAt: Date;
}

export interface CommentWithAuthorRow extends CommentRow {
  authorFullName: string | null;
  authorAvatarUrl: string | null;
}

export interface ReportRow {
  reportId: number;
  reporterUserId: number;
  reportedUserId: number | null;
  targetType: 'user' | 'comment' | 'review' | 'machine' | 'writeup' | 'challenge' | 'course';
  targetId: number;
  reportReason: string;
  description: string | null;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  resolvedBy: number | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ReportWithReporterRow extends ReportRow {
  reporterFullName: string | null;
}

export interface ICommunityRepository {
  // reviews
  insertReview(input: {
    userId: number;
    targetType: ReviewTargetType;
    targetId: number;
    rating: number;
    title?: string;
    content?: string;
  }): Promise<number>;
  findReviewById(reviewId: number): Promise<ReviewWithAuthorRow | undefined>;
  countUserReviews(userId: number, targetType: ReviewTargetType, targetId: number): Promise<number>;
  listApprovedReviews(
    targetType: ReviewTargetType,
    targetId: number,
    skip: number,
    take: number,
  ): Promise<ReviewWithAuthorRow[]>;
  countApprovedReviews(targetType: ReviewTargetType, targetId: number): Promise<number>;
  listAllReviews(
    status: 'all' | 'pending' | 'approved',
    skip: number,
    take: number,
  ): Promise<ReviewWithAuthorRow[]>;
  countAllReviews(status: 'all' | 'pending' | 'approved'): Promise<number>;
  setReviewApproved(reviewId: number, isApproved: boolean): Promise<void>;
  deleteReview(reviewId: number): Promise<void>;
  computeTargetRating(
    targetType: ReviewTargetType,
    targetId: number,
  ): Promise<{ average: number; total: number }>;
  updateCourseRating(courseId: number, average: number, total: number): Promise<void>;
  courseExists(courseId: number): Promise<boolean>;
  labExists(labId: number): Promise<boolean>;
  // comments
  insertComment(input: {
    userId: number;
    parentCommentId: number | null;
    targetType: CommentTargetType;
    targetId: number;
    content: string;
  }): Promise<number>;
  findCommentById(commentId: number): Promise<CommentWithAuthorRow | undefined>;
  listComments(
    targetType: CommentTargetType,
    targetId: number,
    skip: number,
    take: number,
  ): Promise<CommentWithAuthorRow[]>;
  countComments(targetType: CommentTargetType, targetId: number): Promise<number>;
  listAllComments(skip: number, take: number): Promise<CommentWithAuthorRow[]>;
  countAllComments(): Promise<number>;
  deleteOwnComment(userId: number, commentId: number): Promise<number>;
  setCommentHidden(commentId: number, isHidden: boolean): Promise<void>;
  setCommentPinned(commentId: number, isPinned: boolean): Promise<void>;
  adjustCommentLikesCount(commentId: number, delta: number): Promise<void>;
  // likes
  insertLike(input: {
    userId: number;
    targetType: LikeTargetType;
    targetId: number;
    likeType: 'like' | 'love' | 'useful' | 'funny';
  }): Promise<number>;
  findLike(userId: number, targetType: LikeTargetType, targetId: number): Promise<boolean>;
  deleteLike(userId: number, targetType: LikeTargetType, targetId: number): Promise<number>;
  // reports
  insertReport(input: {
    reporterUserId: number;
    reportedUserId: number | null;
    targetType: ReportTargetType;
    targetId: number;
    reportReason: string;
    description: string | null;
  }): Promise<number>;
  findReportById(reportId: number): Promise<ReportWithReporterRow | undefined>;
  listReports(
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined,
    skip: number,
    take: number,
  ): Promise<ReportWithReporterRow[]>;
  countReports(status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined): Promise<number>;
  countReportsByStatus(): Promise<
    Array<{ status: 'pending' | 'reviewing' | 'resolved' | 'dismissed'; value: number }>
  >;
  setReportStatus(
    reportId: number,
    status: 'resolved' | 'dismissed',
    resolvedBy: number,
  ): Promise<void>;
  userExists(userId: number): Promise<boolean>;
  reviewExists(reviewId: number): Promise<boolean>;
}

export class CommunityRepository implements ICommunityRepository {
  // ---------------- reviews ----------------

  async insertReview(input: {
    userId: number;
    targetType: ReviewTargetType;
    targetId: number;
    rating: number;
    title?: string;
    content?: string;
  }): Promise<number> {
    const inserted = await db.insert(reviews).values({
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      rating: input.rating,
      title: input.title ?? null,
      content: input.content ?? null,
    });
    const reviewId = inserted[0]?.insertId;
    if (!reviewId) {
      throw new Error('Review insert failed.');
    }
    return reviewId;
  }

  async findReviewById(reviewId: number): Promise<ReviewWithAuthorRow | undefined> {
    const rows = await db
      .select({
        reviewId: reviews.reviewId,
        userId: reviews.userId,
        targetType: reviews.targetType,
        targetId: reviews.targetId,
        rating: reviews.rating,
        title: reviews.title,
        content: reviews.content,
        isApproved: reviews.isApproved,
        helpfulCount: reviews.helpfulCount,
        createdAt: reviews.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(reviews)
      .innerJoin(users, eq(users.userId, reviews.userId))
      .where(eq(reviews.reviewId, reviewId))
      .limit(1);
    return rows[0];
  }

  async countUserReviews(
    userId: number,
    targetType: ReviewTargetType,
    targetId: number,
  ): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reviews)
      .where(
        and(
          eq(reviews.userId, userId),
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async listApprovedReviews(
    targetType: ReviewTargetType,
    targetId: number,
    skip: number,
    take: number,
  ): Promise<ReviewWithAuthorRow[]> {
    return db
      .select({
        reviewId: reviews.reviewId,
        userId: reviews.userId,
        targetType: reviews.targetType,
        targetId: reviews.targetId,
        rating: reviews.rating,
        title: reviews.title,
        content: reviews.content,
        isApproved: reviews.isApproved,
        helpfulCount: reviews.helpfulCount,
        createdAt: reviews.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(reviews)
      .innerJoin(users, eq(users.userId, reviews.userId))
      .where(
        and(
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
          eq(reviews.isApproved, true),
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countApprovedReviews(
    targetType: ReviewTargetType,
    targetId: number,
  ): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reviews)
      .where(
        and(
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
          eq(reviews.isApproved, true),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async listAllReviews(
    status: 'all' | 'pending' | 'approved',
    skip: number,
    take: number,
  ): Promise<ReviewWithAuthorRow[]> {
    return db
      .select({
        reviewId: reviews.reviewId,
        userId: reviews.userId,
        targetType: reviews.targetType,
        targetId: reviews.targetId,
        rating: reviews.rating,
        title: reviews.title,
        content: reviews.content,
        isApproved: reviews.isApproved,
        helpfulCount: reviews.helpfulCount,
        createdAt: reviews.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(reviews)
      .innerJoin(users, eq(users.userId, reviews.userId))
      .where(
        status === 'all' ? undefined : eq(reviews.isApproved, status === 'approved'),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countAllReviews(status: 'all' | 'pending' | 'approved'): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reviews)
      .where(
        status === 'all' ? undefined : eq(reviews.isApproved, status === 'approved'),
      );
    return rows[0]?.value ?? 0;
  }

  async setReviewApproved(reviewId: number, isApproved: boolean): Promise<void> {
    await db
      .update(reviews)
      .set({ isApproved })
      .where(eq(reviews.reviewId, reviewId));
  }

  async deleteReview(reviewId: number): Promise<void> {
    await db.delete(reviews).where(eq(reviews.reviewId, reviewId));
  }

  async computeTargetRating(
    targetType: ReviewTargetType,
    targetId: number,
  ): Promise<{ average: number; total: number }> {
    const rows = await db
      .select({
        average: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
        total: count(),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
          eq(reviews.isApproved, true),
        ),
      );
    const row = rows[0];
    return {
      average: Math.round((row?.average ?? 0) * 10) / 10,
      total: row?.total ?? 0,
    };
  }

  async updateCourseRating(courseId: number, average: number, total: number): Promise<void> {
    await db
      .update(academyCourses)
      .set({
        averageRating: average.toFixed(2),
        totalRatings: total,
      })
      .where(eq(academyCourses.courseId, courseId));
  }

  async courseExists(courseId: number): Promise<boolean> {
    const rows = await db
      .select({ id: academyCourses.courseId })
      .from(academyCourses)
      .where(eq(academyCourses.courseId, courseId))
      .limit(1);
    return rows.length > 0;
  }

  async labExists(labId: number): Promise<boolean> {
    const rows = await db
      .select({ id: labs.labId })
      .from(labs)
      .where(eq(labs.labId, labId))
      .limit(1);
    return rows.length > 0;
  }

  // ---------------- comments ----------------

  async insertComment(input: {
    userId: number;
    parentCommentId: number | null;
    targetType: CommentTargetType;
    targetId: number;
    content: string;
  }): Promise<number> {
    const inserted = await db.insert(comments).values({
      userId: input.userId,
      parentCommentId: input.parentCommentId,
      targetType: input.targetType,
      targetId: input.targetId,
      content: input.content,
    });
    const commentId = inserted[0]?.insertId;
    if (!commentId) {
      throw new Error('Comment insert failed.');
    }
    return commentId;
  }

  async findCommentById(commentId: number): Promise<CommentWithAuthorRow | undefined> {
    const rows = await db
      .select({
        commentId: comments.commentId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        targetType: comments.targetType,
        targetId: comments.targetId,
        content: comments.content,
        isPinned: comments.isPinned,
        isHidden: comments.isHidden,
        likesCount: comments.likesCount,
        createdAt: comments.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.userId, comments.userId))
      .where(eq(comments.commentId, commentId))
      .limit(1);
    return rows[0];
  }

  async listComments(
    targetType: CommentTargetType,
    targetId: number,
    skip: number,
    take: number,
  ): Promise<CommentWithAuthorRow[]> {
    return db
      .select({
        commentId: comments.commentId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        targetType: comments.targetType,
        targetId: comments.targetId,
        content: comments.content,
        isPinned: comments.isPinned,
        isHidden: comments.isHidden,
        likesCount: comments.likesCount,
        createdAt: comments.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.userId, comments.userId))
      .where(
        and(
          eq(comments.targetType, targetType),
          eq(comments.targetId, targetId),
          eq(comments.isHidden, false),
        ),
      )
      .orderBy(desc(comments.isPinned), desc(comments.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countComments(targetType: CommentTargetType, targetId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(comments)
      .where(
        and(
          eq(comments.targetType, targetType),
          eq(comments.targetId, targetId),
          eq(comments.isHidden, false),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async listAllComments(skip: number, take: number): Promise<CommentWithAuthorRow[]> {
    return db
      .select({
        commentId: comments.commentId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        targetType: comments.targetType,
        targetId: comments.targetId,
        content: comments.content,
        isPinned: comments.isPinned,
        isHidden: comments.isHidden,
        likesCount: comments.likesCount,
        createdAt: comments.createdAt,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.userId, comments.userId))
      .orderBy(desc(comments.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countAllComments(): Promise<number> {
    const rows = await db.select({ value: count() }).from(comments);
    return rows[0]?.value ?? 0;
  }

  async deleteOwnComment(userId: number, commentId: number): Promise<number> {
    const deleted = await db
      .delete(comments)
      .where(and(eq(comments.commentId, commentId), eq(comments.userId, userId)));
    return deleted[0]?.affectedRows ?? 0;
  }

  async setCommentHidden(commentId: number, isHidden: boolean): Promise<void> {
    await db
      .update(comments)
      .set({ isHidden })
      .where(eq(comments.commentId, commentId));
  }

  async setCommentPinned(commentId: number, isPinned: boolean): Promise<void> {
    await db
      .update(comments)
      .set({ isPinned })
      .where(eq(comments.commentId, commentId));
  }

  async adjustCommentLikesCount(commentId: number, delta: number): Promise<void> {
    await db
      .update(comments)
      .set({ likesCount: sql`${comments.likesCount} + ${delta}` })
      .where(eq(comments.commentId, commentId));
  }

  // ---------------- likes ----------------

  async insertLike(input: {
    userId: number;
    targetType: LikeTargetType;
    targetId: number;
    likeType: 'like' | 'love' | 'useful' | 'funny';
  }): Promise<number> {
    const inserted = await db.insert(likes).values({
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      likeType: input.likeType,
    });
    const likeId = inserted[0]?.insertId;
    if (!likeId) {
      throw new Error('Like insert failed.');
    }
    return likeId;
  }

  async findLike(
    userId: number,
    targetType: LikeTargetType,
    targetId: number,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: likes.likeId })
      .from(likes)
      .where(
        and(
          eq(likes.userId, userId),
          eq(likes.targetType, targetType),
          eq(likes.targetId, targetId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async deleteLike(userId: number, targetType: LikeTargetType, targetId: number): Promise<number> {
    const deleted = await db
      .delete(likes)
      .where(
        and(
          eq(likes.userId, userId),
          eq(likes.targetType, targetType),
          eq(likes.targetId, targetId),
        ),
      );
    return deleted[0]?.affectedRows ?? 0;
  }

  // ---------------- reports ----------------

  async insertReport(input: {
    reporterUserId: number;
    reportedUserId: number | null;
    targetType: ReportTargetType;
    targetId: number;
    reportReason: string;
    description: string | null;
  }): Promise<number> {
    const inserted = await db.insert(reports).values({
      reporterUserId: input.reporterUserId,
      reportedUserId: input.reportedUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      reportReason: input.reportReason,
      description: input.description,
    });
    const reportId = inserted[0]?.insertId;
    if (!reportId) {
      throw new Error('Report insert failed.');
    }
    return reportId;
  }

  async findReportById(reportId: number): Promise<ReportWithReporterRow | undefined> {
    const rows = await db
      .select({
        reportId: reports.reportId,
        reporterUserId: reports.reporterUserId,
        reportedUserId: reports.reportedUserId,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reportReason: reports.reportReason,
        description: reports.description,
        status: reports.status,
        resolvedBy: reports.resolvedBy,
        resolvedAt: reports.resolvedAt,
        createdAt: reports.createdAt,
        reporterFullName: users.fullName,
      })
      .from(reports)
      .innerJoin(users, eq(users.userId, reports.reporterUserId))
      .where(eq(reports.reportId, reportId))
      .limit(1);
    return rows[0];
  }

  async listReports(
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined,
    skip: number,
    take: number,
  ): Promise<ReportWithReporterRow[]> {
    return db
      .select({
        reportId: reports.reportId,
        reporterUserId: reports.reporterUserId,
        reportedUserId: reports.reportedUserId,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reportReason: reports.reportReason,
        description: reports.description,
        status: reports.status,
        resolvedBy: reports.resolvedBy,
        resolvedAt: reports.resolvedAt,
        createdAt: reports.createdAt,
        reporterFullName: users.fullName,
      })
      .from(reports)
      .innerJoin(users, eq(users.userId, reports.reporterUserId))
      .where(status ? eq(reports.status, status) : undefined)
      .orderBy(desc(reports.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countReports(
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined,
  ): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reports)
      .where(status ? eq(reports.status, status) : undefined);
    return rows[0]?.value ?? 0;
  }

  async countReportsByStatus(): Promise<
    Array<{ status: 'pending' | 'reviewing' | 'resolved' | 'dismissed'; value: number }>
  > {
    return db
      .select({
        status: reports.status,
        value: count(),
      })
      .from(reports)
      .groupBy(reports.status);
  }

  async setReportStatus(
    reportId: number,
    status: 'resolved' | 'dismissed',
    resolvedBy: number,
  ): Promise<void> {
    await db
      .update(reports)
      .set({ status, resolvedBy, resolvedAt: new Date() })
      .where(eq(reports.reportId, reportId));
  }

  async userExists(userId: number): Promise<boolean> {
    const rows = await db
      .select({ id: users.userId })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  async reviewExists(reviewId: number): Promise<boolean> {
    const rows = await db
      .select({ id: reviews.reviewId })
      .from(reviews)
      .where(eq(reviews.reviewId, reviewId))
      .limit(1);
    return rows.length > 0;
  }
}

export const communityRepository = new CommunityRepository();