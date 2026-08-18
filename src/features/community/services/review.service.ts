import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import type { ReviewDto, ReviewListDto, ReviewTargetType } from '../dto/community.dto';
import type {
  ICommunityRepository,
  ReviewWithAuthorRow,
} from '../repositories/community.repository';
import { communityRepository } from '../repositories/community.repository';

/**
 * F8 §07 review surface (OPS-13/14).
 *
 * - Duplicate protection: one review per (user, target) enforced with a
 *   COUNT check before INSERT → 409 (invariant 2; the table has no unique key).
 * - Target existence is validated before insert → 404 (AC-03).
 * - Learner rows are inserted `is_approved=false` (invariant 3); the public
 *   list returns approved rows only.
 */
export interface ReviewServiceDeps {
  repo: Pick<
    ICommunityRepository,
    | 'insertReview'
    | 'countUserReviews'
    | 'listApprovedReviews'
    | 'countApprovedReviews'
    | 'courseExists'
    | 'labExists'
  >;
}

function defaultDeps(): ReviewServiceDeps {
  return { repo: communityRepository };
}

function toDto(row: ReviewWithAuthorRow): ReviewDto {
  return {
    reviewId: row.reviewId,
    targetType: row.targetType as ReviewTargetType,
    targetId: row.targetId,
    rating: row.rating,
    title: row.title,
    content: row.content,
    isApproved: row.isApproved,
    helpfulCount: row.helpfulCount,
    createdAt: row.createdAt.toISOString(),
    author: {
      userId: row.userId,
      fullName: row.authorFullName,
      avatarUrl: row.authorAvatarUrl,
    },
  };
}

export class ReviewService {
  constructor(private readonly deps: ReviewServiceDeps = defaultDeps()) {}

  /** OPS-13: public approved-review list for a target. */
  async listApproved(
    targetType: ReviewTargetType,
    targetId: number,
    page: number,
    limit: number,
  ): Promise<ReviewListDto> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listApprovedReviews(targetType, targetId, (page - 1) * limit, limit),
      this.deps.repo.countApprovedReviews(targetType, targetId),
    ]);

    return { data: rows.map(toDto), total, page };
  }

  /** OPS-14: submit a review (pending approval). */
  async create(
    userId: number,
    input: {
      targetType: ReviewTargetType;
      targetId: number;
      rating: number;
      title?: string;
      content?: string;
    },
  ): Promise<ReviewDto> {
    await this.assertTargetExists(input.targetType, input.targetId);

    const existing = await this.deps.repo.countUserReviews(userId, input.targetType, input.targetId);
    if (existing > 0) {
      throw new ConflictError('You have already reviewed this target.');
    }

    if (!input.title && !input.content) {
      throw new ValidationError('A review must include a title or content.');
    }

    const reviewId = await this.deps.repo.insertReview({
      userId,
      targetType: input.targetType,
      targetId: input.targetId,
      rating: input.rating,
      title: input.title,
      content: input.content,
    });

    logger.info(
      { reviewId, userId, targetType: input.targetType, targetId: input.targetId },
      'Review submitted for approval',
    );

    return {
      reviewId,
      targetType: input.targetType,
      targetId: input.targetId,
      rating: input.rating,
      title: input.title ?? null,
      content: input.content ?? null,
      isApproved: false,
      helpfulCount: 0,
      createdAt: new Date().toISOString(),
      author: { userId, fullName: null, avatarUrl: null },
    };
  }

  private async assertTargetExists(
    targetType: ReviewTargetType,
    targetId: number,
  ): Promise<void> {
    const exists =
      targetType === 'course'
        ? await this.deps.repo.courseExists(targetId)
        : await this.deps.repo.labExists(targetId);
    if (!exists) {
      throw new NotFoundError('Target not found.');
    }
  }
}

export const reviewService = new ReviewService();