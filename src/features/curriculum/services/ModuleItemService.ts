import type { z } from 'zod';
import { db } from '../../../app/database';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import {
  ConflictError,
  ERROR_CODES,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { auditLogService } from '../../admin/services/audit-log.service';
import { labsRepository } from '../../labs/repositories/labs.repository';
import type { AdminModuleItemDto, CurriculumActor } from '../dto/curriculum.dto';
import {
  curriculumRepository,
  type ModuleItemRow,
} from '../repositories/curriculum.repository';
import type { createModuleItemSchema } from '../validators/curriculum.validator';
import { curriculumSlugService } from './curriculum-slug.service';
import { labSpecStatusOf, toModuleItemDto } from './CurriculumService';

export interface ModuleItemServiceDeps {
  repo: typeof curriculumRepository;
  labs: typeof labsRepository;
  audit: typeof auditLogService;
}

function defaultDeps(): ModuleItemServiceDeps {
  return { repo: curriculumRepository, labs: labsRepository, audit: auditLogService };
}

export type CreateModuleItemInput = z.infer<typeof createModuleItemSchema>;

/**
 * Admin write path for module items (lesson, lab and quiz spine rows, C§4.2 and
 * C§6.1). Every write runs in one transaction where it spans rows, refreshes the
 * course's published counts when published state can change, recomputes the
 * course's item slugs (C§11.1), and writes one audit row.
 */
export class ModuleItemService {
  constructor(private readonly deps: ModuleItemServiceDeps = defaultDeps()) {}

  /** Admin item list of one module in order, with publish state and learner-data flags. */
  async listAdminItems(moduleId: number): Promise<AdminModuleItemDto[]> {
    await this.requireModule(moduleId);
    const rows = await this.deps.repo.listItemsByModule(moduleId);
    return Promise.all(rows.map((row) => this.toAdminDto(row)));
  }

  /**
   * Creates a DRAFT item at the end of the module (`lesson_order` = max + 1).
   * Lab items default their title to the lab name. Quiz items insert the quiz and
   * its spine row in one transaction.
   */
  async createItem(
    actor: CurriculumActor,
    moduleId: number,
    body: CreateModuleItemInput,
  ): Promise<AdminModuleItemDto> {
    const module = await this.requireModule(moduleId);

    let labName: string | null = null;
    let labId: number | null = null;
    if (body.kind === 'lab') {
      const lab = await this.deps.labs.findLabById(body.labId);
      if (!lab) {
        throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
      }
      labId = lab.labId;
      labName = lab.labName;
    }

    let tagIds: number[] = [];
    if (body.kind === 'lesson' && body.tagIds && body.tagIds.length > 0) {
      tagIds = [...new Set(body.tagIds)];
      const validIds = await this.deps.repo.findTagsByIds(tagIds);
      if (validIds.length !== tagIds.length) {
        throw new NotFoundError('One or more tags were not found.');
      }
    }

    let itemId = 0;
    await db.transaction(async (tx) => {
      await this.lockModuleOrThrow(moduleId, tx);
      const lessonOrder = ((await this.deps.repo.maxLessonOrder(moduleId, tx)) ?? 0) + 1;

      if (body.kind === 'lesson') {
        itemId = await this.deps.repo.createLesson({
          moduleId,
          title: body.title,
          content: body.content ?? null,
          contentType: body.contentType,
          videoUrl: body.videoUrl ?? null,
          videoDurationSeconds: body.videoDurationSeconds ?? null,
          lessonOrder,
        }, tx);
        if (tagIds.length > 0) {
          await this.deps.repo.setLessonTags(itemId, tagIds, tx);
        }
      } else if (body.kind === 'lab' && labId !== null && labName !== null) {
        itemId = await this.deps.repo.createLabItem({
          moduleId,
          labId,
          title: body.title ?? labName,
          lessonOrder,
        }, tx);
      } else if (body.kind === 'quiz') {
        const created = await this.deps.repo.createQuizItem({
          moduleId,
          lessonOrder,
          quiz: {
            title: body.title,
            description: body.description ?? null,
            passingScore: body.passingScore,
            timeLimitMinutes: body.timeLimitMinutes ?? null,
            isRequired: body.isRequired,
          },
        }, tx);
        itemId = created.itemId;
      }

      await curriculumSlugService.recomputeCourse(tx, module.courseId);
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_ITEM, 'lesson', itemId, {
      moduleId,
      kind: body.kind,
      labId,
    });

    return this.readItemOrThrow(itemId);
  }

  /** Renames an item. For quiz items the quiz title is updated in the same transaction. */
  async updateItemTitle(actor: CurriculumActor, itemId: number, title: string): Promise<AdminModuleItemDto> {
    const item = await this.requireItem(itemId);

    await db.transaction(async (tx) => {
      await this.deps.repo.updateLesson(itemId, { title }, tx);
      if (item.kind === 'quiz' && item.quizId !== null) {
        await this.deps.repo.updateQuiz(item.quizId, { title }, tx);
      }
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_ITEM, 'lesson', itemId, { title });
    return this.readItemOrThrow(itemId);
  }

  /**
   * Sets the module's item order. `itemIds` must be exactly the module's item set
   * (C§6.1); anything else is 422 `REORDER_SET_MISMATCH`.
   */
  async reorderItems(actor: CurriculumActor, moduleId: number, itemIds: number[]): Promise<AdminModuleItemDto[]> {
    await this.requireModule(moduleId);

    await db.transaction(async (tx) => {
      // Lock the module first, then validate against the rows as they are under the lock.
      const module = await this.lockModuleOrThrow(moduleId, tx);
      const existing = await this.deps.repo.listItemsByModule(moduleId, {}, tx);
      const existingIds = new Set(existing.map((row) => row.itemId));
      const requestedIds = new Set(itemIds);
      const isExactSet = requestedIds.size === itemIds.length
        && itemIds.length === existingIds.size
        && itemIds.every((id) => existingIds.has(id));
      if (!isExactSet) {
        throw new ValidationError(
          'The reorder list must contain every item of the module exactly once.',
          [{ code: ERROR_CODES.REORDER_SET_MISMATCH }],
        );
      }

      await this.deps.repo.bulkUpdateLessonOrders(
        moduleId,
        itemIds.map((lessonId, index) => ({ lessonId, lessonOrder: index + 1 })),
        tx,
      );
      await curriculumSlugService.recomputeCourse(tx, module.courseId);
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REORDER_ITEMS, 'module', moduleId, { itemIds });
    return this.listAdminItems(moduleId);
  }

  /**
   * Hard-deletes an item. Refused with 409 `ITEM_HAS_LEARNER_DATA` when any learner
   * row exists for it. A quiz item deletes its quiz (the spine row cascades).
   * Remaining items are renumbered and the published counts are refreshed.
   */
  async deleteItem(actor: CurriculumActor, itemId: number): Promise<void> {
    const item = await this.requireItem(itemId);
    const module = await this.requireModule(item.moduleId);

    await db.transaction(async (tx) => {
      await this.lockModuleOrThrow(item.moduleId, tx);
      if (await this.deps.repo.hasItemLearnerData(itemId, tx)) {
        throw new ConflictError(
          'This item has learner progress and cannot be deleted.',
          [{ code: ERROR_CODES.ITEM_HAS_LEARNER_DATA }],
        );
      }

      if (item.kind === 'quiz' && item.quizId !== null) {
        await this.deps.repo.deleteQuiz(item.quizId, tx);
      } else {
        await this.deps.repo.deleteLesson(itemId, tx);
      }

      // Renumber the remaining items 1..n, touching only rows whose position moved.
      const remaining = await this.deps.repo.listItemsByModule(item.moduleId, {}, tx);
      const renumbered = remaining.flatMap((row, index) => (
        row.position === index + 1 ? [] : [{ lessonId: row.itemId, lessonOrder: index + 1 }]
      ));
      if (renumbered.length > 0) {
        await this.deps.repo.bulkUpdateLessonOrders(item.moduleId, renumbered, tx);
      }

      await this.deps.repo.refreshCourseCounts(module.courseId, tx);
      await curriculumSlugService.recomputeCourse(tx, module.courseId);
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_ITEM, 'lesson', itemId, {
      moduleId: item.moduleId,
      kind: item.kind,
    });
  }

  /**
   * Publishes or unpublishes an item. Publishing requires a published module
   * (409 `PUBLISH_PARENT_FIRST`), a lab item with an active lab and a v2 spec
   * (409 `LAB_NOT_READY`), or a quiz item with at least one active question
   * (409 `QUIZ_EMPTY`). A quiz item flips its quiz in the same transaction.
   */
  async publishItem(actor: CurriculumActor, itemId: number, isPublished: boolean): Promise<AdminModuleItemDto> {
    const lookup = await this.requireItem(itemId);

    await db.transaction(async (tx) => {
      // Lock the parent module, then validate item and module as they are under the lock.
      const module = await this.lockModuleOrThrow(lookup.moduleId, tx);
      const item = await this.deps.repo.findItemById(itemId, tx);
      if (!item || item.moduleId !== module.moduleId) {
        throw new NotFoundError('Item not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
      }

      if (isPublished) {
        if (!module.isPublished) {
          throw new ConflictError(
            'Publish the parent module before publishing its items.',
            [{ code: ERROR_CODES.PUBLISH_PARENT_FIRST }],
          );
        }
        if (item.kind === 'lab') {
          const ready = item.lab !== null
            && item.lab.isActive
            && labSpecStatusOf(item.lab.flagValues).specStatus === 'v2';
          if (!ready) {
            throw new ConflictError(
              'The lab must be active and have a valid v2 spec before it can be published.',
              [{ code: ERROR_CODES.LAB_NOT_READY }],
            );
          }
        }
        if (item.kind === 'quiz' && (item.quiz === null || item.quiz.activeQuestionCount < 1)) {
          throw new ConflictError(
            'Add at least one active question before publishing this quiz.',
            [{ code: ERROR_CODES.QUIZ_EMPTY }],
          );
        }
      }

      await this.deps.repo.setLessonPublished(itemId, isPublished, tx);
      if (item.kind === 'quiz' && item.quizId !== null) {
        await this.deps.repo.setQuizPublished(item.quizId, isPublished, tx);
      }
      await this.deps.repo.refreshCourseCounts(module.courseId, tx);
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.PUBLISH_LESSON, 'lesson', itemId, {
      isPublished,
      kind: lookup.kind,
    });
    return this.readItemOrThrow(itemId);
  }

  /* ── Shared guards & helpers ────────────────────────────────────────── */

  private async requireModule(moduleId: number) {
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    return module;
  }

  /** Locks the module row inside `tx` and returns its fresh state (404 when it vanished). */
  private async lockModuleOrThrow(moduleId: number, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
    if (!(await this.deps.repo.lockModule(moduleId, tx))) {
      throw new NotFoundError('Module not found.');
    }
    const module = await this.deps.repo.findModuleById(moduleId, tx);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    return module;
  }

  private async requireItem(itemId: number): Promise<ModuleItemRow> {
    const item = await this.deps.repo.findItemById(itemId);
    if (!item) {
      throw new NotFoundError('Item not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
    }
    return item;
  }

  private async readItemOrThrow(itemId: number): Promise<AdminModuleItemDto> {
    return this.toAdminDto(await this.requireItem(itemId));
  }

  /** Admin item DTO: learner shape plus publish state, lab spec status and learner-data flag. */
  private async toAdminDto(row: ModuleItemRow): Promise<AdminModuleItemDto> {
    const base = toModuleItemDto(row);
    return {
      ...base,
      isPublished: row.isPublished,
      lab: row.lab && base.lab
        ? {
          ...base.lab,
          isActive: row.lab.isActive,
          specStatus: labSpecStatusOf(row.lab.flagValues).specStatus,
        }
        : null,
      quiz: row.quiz && base.quiz
        ? {
          ...base.quiz,
          isPublished: row.quiz.isPublished,
          activeQuestionCount: row.quiz.activeQuestionCount,
        }
        : null,
      hasLearnerData: await this.deps.repo.hasItemLearnerData(row.itemId),
    };
  }
}

/** Fire-and-forget audit write (same pattern as the other curriculum services). */
function crashAudit(
  audit: typeof auditLogService,
  actor: CurriculumActor,
  action: string,
  targetType: string,
  targetId: number | null,
  changes: Record<string, unknown>,
): void {
  void audit
    .record({
      adminUserId: actor.userId,
      action,
      targetType,
      targetId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    })
    .catch(() => undefined);
}

export const moduleItemService = new ModuleItemService();
