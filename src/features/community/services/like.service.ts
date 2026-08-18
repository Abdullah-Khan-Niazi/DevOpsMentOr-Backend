import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { LikeResultDto, LikeTargetType } from '../dto/community.dto';
import type { ICommunityRepository } from '../repositories/community.repository';
import { communityRepository } from '../repositories/community.repository';

/**
 * F8 §07 likes (OPS-18).
 *
 * The `likes.unique_user_target` key enforces one like per (user, target):
 * a duplicate like returns 409, and unlike is a DELETE on the same key
 * (invariant 6). Denormalized counters are kept in sync:
 * `comments.likes_count` and `reviews.helpful_count`.
 */
export interface LikeServiceDeps {
  repo: Pick<
    ICommunityRepository,
    | 'insertLike'
    | 'findLike'
    | 'deleteLike'
    | 'findCommentById'
    | 'findReviewById'
    | 'adjustCommentLikesCount'
  >;
}

function defaultDeps(): LikeServiceDeps {
  return { repo: communityRepository };
}

export class LikeService {
  constructor(private readonly deps: LikeServiceDeps = defaultDeps()) {}

  /** OPS-18: like a comment or review. 409 when already liked. */
  async like(
    userId: number,
    input: {
      targetType: LikeTargetType;
      targetId: number;
      likeType: 'like' | 'love' | 'useful' | 'funny';
    },
  ): Promise<LikeResultDto> {
    await this.assertTargetExists(input.targetType, input.targetId);

    const alreadyLiked = await this.deps.repo.findLike(userId, input.targetType, input.targetId);
    if (alreadyLiked) {
      throw new ConflictError('You have already liked this content.');
    }

    await this.deps.repo.insertLike({ userId, ...input });
    const likesCount = await this.bumpCounter(input.targetType, input.targetId, 1);

    return {
      targetType: input.targetType,
      targetId: input.targetId,
      liked: true,
      likesCount,
    };
  }

  /** OPS-18 (unlike): `DELETE /api/likes/:targetType/:targetId`. */
  async unlike(userId: number, targetType: LikeTargetType, targetId: number): Promise<LikeResultDto> {
    const deleted = await this.deps.repo.deleteLike(userId, targetType, targetId);
    if (deleted === 0) {
      throw new NotFoundError('Like not found.');
    }
    const likesCount = await this.bumpCounter(targetType, targetId, -1);

    return { targetType, targetId, liked: false, likesCount };
  }

  private async assertTargetExists(
    targetType: LikeTargetType,
    targetId: number,
  ): Promise<void> {
    const exists =
      targetType === 'comment'
        ? await this.deps.repo.findCommentById(targetId)
        : await this.deps.repo.findReviewById(targetId);
    if (!exists) {
      throw new NotFoundError('Target not found.');
    }
  }

  private async bumpCounter(
    targetType: LikeTargetType,
    targetId: number,
    delta: number,
  ): Promise<number> {
    if (targetType === 'comment') {
      await this.deps.repo.adjustCommentLikesCount(targetId, delta);
      const comment = await this.deps.repo.findCommentById(targetId);
      return comment?.likesCount ?? 0;
    }

    const review = await this.deps.repo.findReviewById(targetId);
    return review?.helpfulCount ?? 0;
  }
}

export const likeService = new LikeService();