import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor, AdminModerationService } from '../services/admin-moderation.service';
import { adminModerationService } from '../services/admin-moderation.service';

/** F8 §07 moderation HTTP handlers (OPS-27..34). */
export class AdminModerationController {
  constructor(private readonly service: AdminModerationService = adminModerationService) {}

  private actor(req: Request): AdminActor {
    return {
      userId: Number(req.user?.sub),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  /** OPS-27: all reviews with status filter. */
  async listReviews(req: Request, res: Response): Promise<Response> {
    const result = await this.service.listReviews(
      req.query.status as 'all' | 'pending' | 'approved',
      Number(req.query.page),
      Number(req.query.limit),
    );
    return sendSuccess(res, result, 'Reviews retrieved successfully.');
  }

  /** Admin comment list (additive surface for OPS-30/31 pin/hide actions). */
  async listComments(req: Request, res: Response): Promise<Response> {
    const result = await this.service.listComments(Number(req.query.page), Number(req.query.limit));
    return sendSuccess(res, result, 'Comments retrieved successfully.');
  }

  /** OPS-28: approve a review (denormalizes target average rating). */
  async approveReview(req: Request, res: Response): Promise<Response> {
    const review = await this.service.approveReview(this.actor(req), Number(req.params.id));
    return sendSuccess(res, review, 'Review approved.');
  }

  /** OPS-29: delete a review. */
  async deleteReview(req: Request, res: Response): Promise<Response> {
    await this.service.deleteReview(this.actor(req), Number(req.params.id));
    return sendSuccess(res, { reviewId: Number(req.params.id) }, 'Review deleted.');
  }

  /** OPS-30: pin / unpin a comment. */
  async pinComment(req: Request, res: Response): Promise<Response> {
    const result = await this.service.pinComment(this.actor(req), Number(req.params.id));
    return sendSuccess(res, result, result.isPinned ? 'Comment pinned.' : 'Comment unpinned.');
  }

  /** OPS-31: hide / unhide a comment. */
  async hideComment(req: Request, res: Response): Promise<Response> {
    const result = await this.service.hideComment(this.actor(req), Number(req.params.id));
    return sendSuccess(res, result, result.isHidden ? 'Comment hidden.' : 'Comment unhidden.');
  }

  /** OPS-32: moderation queue. */
  async listQueue(req: Request, res: Response): Promise<Response> {
    const result = await this.service.listQueue(
      req.query.status as 'pending' | 'reviewing' | 'resolved' | 'dismissed' | undefined,
      Number(req.query.page),
      Number(req.query.limit),
    );
    return sendSuccess(res, result, 'Report queue retrieved successfully.');
  }

  /** OPS-33: resolve a report. */
  async resolveReport(req: Request, res: Response): Promise<Response> {
    const report = await this.service.resolveReport(this.actor(req), Number(req.params.id));
    return sendSuccess(res, report, 'Report resolved.');
  }

  /** OPS-34: dismiss a report. */
  async dismissReport(req: Request, res: Response): Promise<Response> {
    const report = await this.service.dismissReport(this.actor(req), Number(req.params.id));
    return sendSuccess(res, report, 'Report dismissed.');
  }
}

export const adminModerationController = new AdminModerationController();