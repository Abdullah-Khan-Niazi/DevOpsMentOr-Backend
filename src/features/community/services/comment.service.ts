import { NotFoundError, ValidationError } from '../../../shared/errors';
import type {
  CommentDto,
  CommentListDto,
  CommentTargetType,
} from '../dto/community.dto';
import type {
  CommentWithAuthorRow,
  ICommunityRepository,
} from '../repositories/community.repository';
import { communityRepository } from '../repositories/community.repository';

/**
 * F8 §07 comment surface (OPS-15..17).
 *
 * - Target validation: course/lab rows must exist; `news` has no backing
 *   table in DevOps Mentor (accepted as-is).
 * - Parent comments must exist AND share the same (target_type, target_id)
 *   (IDOR mitigation, contract §05).
 * - Own-delete is scoped `user_id = session.userId` (AC-12).
 */
export interface CommentServiceDeps {
  repo: Pick<
    ICommunityRepository,
    | 'insertComment'
    | 'findCommentById'
    | 'listComments'
    | 'countComments'
    | 'deleteOwnComment'
    | 'courseExists'
    | 'labExists'
  >;
}

function defaultDeps(): CommentServiceDeps {
  return { repo: communityRepository };
}

function toDto(row: CommentWithAuthorRow): CommentDto {
  return {
    commentId: row.commentId,
    parentCommentId: row.parentCommentId,
    targetType: row.targetType as CommentTargetType,
    targetId: row.targetId,
    content: row.content,
    isPinned: row.isPinned,
    isHidden: row.isHidden,
    likesCount: row.likesCount,
    createdAt: row.createdAt.toISOString(),
    author: {
      userId: row.userId,
      fullName: row.authorFullName,
      avatarUrl: row.authorAvatarUrl,
    },
  };
}

export class CommentService {
  constructor(private readonly deps: CommentServiceDeps = defaultDeps()) {}

  /** OPS-15: visible (non-hidden) comments for a target. */
  async list(
    targetType: CommentTargetType,
    targetId: number,
    page: number,
    limit: number,
  ): Promise<CommentListDto> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listComments(targetType, targetId, (page - 1) * limit, limit),
      this.deps.repo.countComments(targetType, targetId),
    ]);

    return { data: rows.map(toDto), total, page };
  }

  /** OPS-16: create a comment on a course, lab or news target. */
  async create(
    userId: number,
    input: {
      targetType: CommentTargetType;
      targetId: number;
      parentCommentId: number | null;
      content: string;
    },
  ): Promise<CommentDto> {
    if (input.targetType !== 'news') {
      await this.assertTargetExists(input.targetType, input.targetId);
    }

    if (input.parentCommentId !== null) {
      const parent = await this.deps.repo.findCommentById(input.parentCommentId);
      if (
        !parent ||
        parent.targetType !== input.targetType ||
        parent.targetId !== input.targetId
      ) {
        throw new ValidationError('Parent comment does not belong to the same target.');
      }
    }

    const commentId = await this.deps.repo.insertComment({ userId, ...input });

    const comment = await this.deps.repo.findCommentById(commentId);
    if (!comment) {
      throw new NotFoundError('Comment not found.');
    }
    return toDto(comment);
  }

  /** OPS-17: delete own comment (404 when the row is not owned). */
  async deleteOwn(userId: number, commentId: number): Promise<void> {
    const deleted = await this.deps.repo.deleteOwnComment(userId, commentId);
    if (deleted === 0) {
      throw new NotFoundError('Comment not found.');
    }
  }

  private async assertTargetExists(
    targetType: Exclude<CommentTargetType, 'news'>,
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

export const commentService = new CommentService();