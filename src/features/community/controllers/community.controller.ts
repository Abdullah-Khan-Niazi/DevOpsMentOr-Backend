import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { ReviewService } from '../services/review.service';
import { reviewService } from '../services/review.service';
import type { CommentService } from '../services/comment.service';
import { commentService } from '../services/comment.service';
import type { LikeService } from '../services/like.service';
import { likeService } from '../services/like.service';
import type { ReportService } from '../services/report.service';
import { reportService } from '../services/report.service';

/** F8 §07 learner community HTTP handlers (OPS-13..19). */
export class CommunityController {
  constructor(
    private readonly reviews: ReviewService = reviewService,
    private readonly comments: CommentService = commentService,
    private readonly likes: LikeService = likeService,
    private readonly reports: ReportService = reportService,
  ) {}

  /** OPS-13: public approved-review list. */
  async listReviews(req: Request, res: Response): Promise<Response> {
    const result = await this.reviews.listApproved(
      req.query.targetType as 'course' | 'lab',
      Number(req.query.targetId),
      Number(req.query.page),
      Number(req.query.limit),
    );
    return sendSuccess(res, result, 'Reviews retrieved successfully.');
  }

  /** OPS-14: submit a review (pending approval). */
  async createReview(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      targetType: 'course' | 'lab';
      targetId: number;
      rating: number;
      title?: string;
      content?: string;
    };
    const review = await this.reviews.create(Number(req.user?.sub), body);
    return sendSuccess(res, review, 'Review submitted for approval.', 201);
  }

  /** OPS-15: public visible-comment list. */
  async listComments(req: Request, res: Response): Promise<Response> {
    const result = await this.comments.list(
      req.query.targetType as 'course' | 'lab' | 'news',
      Number(req.query.targetId),
      Number(req.query.page),
      Number(req.query.limit),
    );
    return sendSuccess(res, result, 'Comments retrieved successfully.');
  }

  /** OPS-16: create a comment. */
  async createComment(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      targetType: 'course' | 'lab' | 'news';
      targetId: number;
      parentCommentId?: number;
      content: string;
    };
    const comment = await this.comments.create(Number(req.user?.sub), {
      targetType: body.targetType,
      targetId: body.targetId,
      parentCommentId: body.parentCommentId ?? null,
      content: body.content,
    });
    return sendSuccess(res, comment, 'Comment created.', 201);
  }

  /** OPS-17: delete own comment. */
  async deleteComment(req: Request, res: Response): Promise<Response> {
    await this.comments.deleteOwn(Number(req.user?.sub), Number(req.params.id));
    return sendSuccess(res, { commentId: Number(req.params.id) }, 'Comment deleted.');
  }

  /** OPS-18: like content. */
  async like(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      targetType: 'comment' | 'review';
      targetId: number;
      likeType: 'like' | 'love' | 'useful' | 'funny';
    };
    const result = await this.likes.like(Number(req.user?.sub), body);
    return sendSuccess(res, result, 'Content liked.', 201);
  }

  /** OPS-18 (unlike): `DELETE /api/likes/:targetType/:targetId`. */
  async unlike(req: Request, res: Response): Promise<Response> {
    const { targetType, targetId } = req.params as { targetType: 'comment' | 'review'; targetId: string };
    const result = await this.likes.unlike(Number(req.user?.sub), targetType, Number(targetId));
    return sendSuccess(res, result, 'Content unliked.');
  }

  /** OPS-19: file a report. */
  async createReport(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      targetType: 'user' | 'comment' | 'review' | 'course';
      targetId: number;
      reportedUserId?: number;
      reportReason: string;
      description?: string;
    };
    const report = await this.reports.create(Number(req.user?.sub), {
      targetType: body.targetType,
      targetId: body.targetId,
      reportedUserId: body.reportedUserId ?? null,
      reportReason: body.reportReason,
      description: body.description ?? null,
    });
    return sendSuccess(res, report, 'Report filed.', 201);
  }
}

export const communityController = new CommunityController();