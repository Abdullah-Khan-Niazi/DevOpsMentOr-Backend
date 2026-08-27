import { BadRequestError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import type { ReportDto, ReportTargetType } from '../dto/community.dto';
import type { ICommunityRepository } from '../repositories/community.repository';
import { communityRepository } from '../repositories/community.repository';

/**
 * F8 §07 content reporting (OPS-19).
 *
 * - `reporter_user_id` is always the session user (no misattribution).
 * - Target existence is validated per type (IDOR mitigation, contract §05);
 *   `reported_user_id` (when targeting a user) must exist in `users`.
 * - The response never includes raw target content (3D matrix).
 */
export interface ReportServiceDeps {
  repo: Pick<
    ICommunityRepository,
    | 'insertReport'
    | 'findCommentById'
    | 'findReviewById'
    | 'courseExists'
    | 'labExists'
    | 'userExists'
  >;
}

function defaultDeps(): ReportServiceDeps {
  return { repo: communityRepository };
}

export class ReportService {
  constructor(private readonly deps: ReportServiceDeps = defaultDeps()) {}

  /** OPS-19: file a report (status = pending). */
  async create(
    reporterUserId: number,
    input: {
      targetType: ReportTargetType;
      targetId: number;
      reportedUserId: number | null;
      reportReason: string;
      description: string | null;
    },
  ): Promise<ReportDto> {
    await this.assertTargetExists(input.targetType, input.targetId);

    if (input.targetType === 'user') {
      if (input.reportedUserId === null) {
        throw new BadRequestError('reportedUserId is required when reporting a user.');
      }
      if (input.reportedUserId === reporterUserId) {
        throw new BadRequestError('You cannot report yourself.');
      }
      const reportedExists = await this.deps.repo.userExists(input.reportedUserId);
      if (!reportedExists) {
        throw new NotFoundError('Reported user not found.');
      }
    }

    const reportId = await this.deps.repo.insertReport({
      reporterUserId,
      reportedUserId: input.reportedUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      reportReason: input.reportReason,
      description: input.description,
    });

    logger.info(
      { reportId, reporterUserId, targetType: input.targetType, targetId: input.targetId },
      'Content report filed',
    );

    return {
      reportId,
      targetType: input.targetType,
      targetId: input.targetId,
      reportReason: input.reportReason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  private async assertTargetExists(
    targetType: ReportTargetType,
    targetId: number,
  ): Promise<void> {
    let exists = false;
    switch (targetType) {
      case 'user':
        exists = await this.deps.repo.userExists(targetId);
        break;
      case 'comment':
        exists = Boolean(await this.deps.repo.findCommentById(targetId));
        break;
      case 'review':
        exists = Boolean(await this.deps.repo.findReviewById(targetId));
        break;
      case 'course':
        exists = await this.deps.repo.courseExists(targetId);
        break;
    }
    if (!exists) {
      throw new NotFoundError('Reported target not found.');
    }
  }
}

export const reportService = new ReportService();