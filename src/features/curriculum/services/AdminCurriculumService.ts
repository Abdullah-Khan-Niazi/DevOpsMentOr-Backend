import { db } from '../../../app/database';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import {
  ConflictError,
  ERROR_CODES,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { auditLogService } from '../../admin/services/audit-log.service';
import { parseLabSpec } from '../../labs/validators/lab-spec.validator';
import type {
  AdminCourseListItemDto,
  AdminModuleItemDto,
  CourseDto,
  CurriculumActor,
  LessonDto,
  ModuleDto,
  ModuleItemDto,
  TagDto,
} from '../dto/curriculum.dto';
import {
  curriculumRepository,
  type CourseRow,
  type DbOrTx,
  type LessonContentType,
  type LessonRow,
  type ModuleItemRow,
  type ModuleRow,
} from '../repositories/curriculum.repository';
import { toCourseDto, toLessonDto, toModuleDto } from './CurriculumService';
import { curriculumSlugService } from './curriculum-slug.service';

export interface AdminCurriculumServiceDeps {
  repo: typeof curriculumRepository;
  audit: typeof auditLogService;
}

function defaultDeps(): AdminCurriculumServiceDeps {
  return { repo: curriculumRepository, audit: auditLogService };
}

/** Highest course, module and item position that still fits a `Cxx`/`CxxMxx`/`CxxMxxLxx` code. */
const MAX_CURRICULUM_POSITION = 99;

export interface AdminCourseListFilters {
  search?: string;
  status?: 'all' | 'published' | 'draft';
}

export interface AdminModuleListFilters {
  search?: string;
  isPublished?: boolean;
}

export interface AdminModuleDetailDto {
  module: ModuleDto;
  items: AdminModuleItemDto[];
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

function courseNotFound(): NotFoundError {
  return new NotFoundError('Course not found.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
}

function slugTaken(): ConflictError {
  return new ConflictError('A course with this code already exists. Choose a different code.', [
    { code: ERROR_CODES.SLUG_TAKEN },
  ]);
}

/** Positions of a reorder body must be exactly the current child set (contracts §6.1). */
function assertExactReorderSet(requested: number[], existing: number[]): void {
  const existingIds = new Set(existing);
  const requestedIds = new Set(requested);
  const exact =
    requested.length === existing.length &&
    requestedIds.size === requested.length &&
    requested.every((id) => existingIds.has(id));
  if (!exact) {
    throw new ValidationError('The reorder list must contain every item exactly once.', [
      { code: ERROR_CODES.REORDER_SET_MISMATCH },
    ]);
  }
}

/** Admin lab summary: the spec status is read from the stored `flag_values`, never returned raw. */
function toAdminLabItem(lab: NonNullable<ModuleItemRow['lab']>): NonNullable<AdminModuleItemDto['lab']> {
  const parsed = parseLabSpec(lab.flagValues);
  return {
    labId: lab.labId,
    slug: lab.slug,
    labName: lab.labName,
    difficultyName: lab.difficultyName,
    estimatedHours: lab.estimatedHours,
    isPremium: lab.isPremium,
    stepCount: parsed.kind === 'v2' ? parsed.spec.steps.length : 0,
    isActive: lab.isActive,
    specStatus: parsed.kind,
  };
}

function crashAudit(
  audit: typeof auditLogService,
  actor: CurriculumActor,
  action: string,
  targetType: string,
  targetId: number | null,
  changes: Record<string, unknown> | null,
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
    .catch((err: unknown) => logger.warn({ err, action }, 'Audit write failed'));
}

/**
 * F4 §08 / C§6.1: Platform Admin write path for courses, modules and lessons.
 * Every course-scoped read and write takes the course id explicitly (no
 * canonical course). Multi-row writes run in one transaction; module and item
 * slugs are recomputed inside the same transaction whenever positions change.
 * Items of kind lab or quiz are edited through their own services.
 */
export class AdminCurriculumService {
  constructor(private readonly deps: AdminCurriculumServiceDeps = defaultDeps()) {}

  /* ── Course ─────────────────────────────────────────────────────────── */

  /** Admin course list with module/item counts and track memberships. */
  async listCourses(filters: AdminCourseListFilters): Promise<AdminCourseListItemDto[]> {
    const rows = await this.deps.repo.listCoursesForAdmin({
      search: filters.search,
      status: filters.status ?? 'all',
    });
    return rows.map((row) => ({
      ...toCourseDto(row),
      moduleCount: row.moduleCount,
      itemCount: row.itemCount,
      trackIds: row.trackIds,
    }));
  }

  async getCourse(courseId: number): Promise<CourseDto> {
    return toCourseDto(await this.requireCourse(courseId));
  }

  /** Lesson tag vocabulary for the editor form. */
  async listTags(): Promise<TagDto[]> {
    return this.deps.repo.listTags();
  }

  /** Difficulty options for the course-create drawer. */
  async listDifficulties(): Promise<Array<{ difficultyId: number; name: string }>> {
    return this.deps.repo.listDifficultyLevels();
  }

  /** Category options for the course-create drawer. */
  async listCategories(): Promise<Array<{ categoryId: number; name: string; slug: string }>> {
    return this.deps.repo.listCategories();
  }

  /**
   * Creates a DRAFT course. The slug defaults to the lowest unused `Cxx`.
   * Publishing is a separate, explicit action through `updateCourse`.
   */
  async createCourse(
    actor: CurriculumActor,
    input: {
      title: string;
      slug?: string;
      description?: string | null;
      difficultyId: number;
      categoryId?: number | null;
      estimatedHours?: number;
      isPremium?: boolean;
    },
  ): Promise<CourseDto> {
    const slug = input.slug ?? (await this.deps.repo.nextAvailableCourseSlug());
    if (!slug) {
      throw new ConflictError('Every course code from C01 to C99 is in use.', [
        { code: ERROR_CODES.SLUG_TAKEN },
      ]);
    }
    if (await this.deps.repo.findCourseBySlug(slug)) {
      throw slugTaken();
    }

    let courseId: number;
    try {
      courseId = await this.deps.repo.createCourse({
        title: input.title.trim(),
        slug,
        description: input.description ?? null,
        difficultyId: input.difficultyId,
        categoryId: input.categoryId ?? null,
        instructorId: actor.userId,
        estimatedHours: input.estimatedHours ?? 0,
        isPublished: false,
        isPremium: input.isPremium ?? false,
        prerequisites: null,
        learningObjectives: null,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw slugTaken();
      }
      throw error;
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_COURSE, 'academy_courses', courseId, {
      title: input.title,
      slug,
    });
    return this.getCourse(courseId);
  }

  /**
   * Updates course metadata. A slug change recomputes every item slug of the
   * course in the same transaction. Publishing requires at least one published
   * module (409 `COURSE_EMPTY`).
   */
  async updateCourse(
    actor: CurriculumActor,
    courseId: number,
    input: Partial<{
      title: string;
      slug: string;
      description: string | null;
      difficultyId: number;
      categoryId: number | null;
      coverImageUrl: string | null;
      videoTrailerUrl: string | null;
      estimatedHours: number;
      isPublished: boolean;
      isPremium: boolean;
      prerequisites: string[] | null;
      learningObjectives: string[] | null;
    }>,
  ): Promise<CourseDto> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.slug !== undefined) patch.slug = input.slug;
    if ('description' in input) patch.description = input.description;
    if (input.difficultyId !== undefined) patch.difficultyId = input.difficultyId;
    if ('categoryId' in input) patch.categoryId = input.categoryId;
    if ('coverImageUrl' in input) patch.coverImageUrl = input.coverImageUrl;
    if ('videoTrailerUrl' in input) patch.videoTrailerUrl = input.videoTrailerUrl;
    if (input.estimatedHours !== undefined) patch.estimatedHours = input.estimatedHours;
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;
    if (input.isPremium !== undefined) patch.isPremium = input.isPremium;
    if ('prerequisites' in input) patch.prerequisites = input.prerequisites;
    if ('learningObjectives' in input) patch.learningObjectives = input.learningObjectives;

    try {
      await db.transaction(async (tx) => {
        const course = await this.requireCourse(courseId, tx);

        if (input.slug !== undefined && input.slug !== course.slug) {
          const holder = await this.deps.repo.findCourseBySlug(input.slug, tx);
          if (holder && holder.courseId !== courseId) {
            throw slugTaken();
          }
        }

        if (input.isPublished === true) {
          const publishedModules = await this.deps.repo.listModules(
            courseId,
            { publishedOnly: true },
            tx,
          );
          if (publishedModules.length === 0) {
            throw new ConflictError('Publish at least one module before publishing the course.', [
              { code: ERROR_CODES.COURSE_EMPTY },
            ]);
          }
        }

        if (Object.keys(patch).length > 0) {
          await this.deps.repo.updateCourse(courseId, patch, tx);
        }
        if (input.slug !== undefined && input.slug !== course.slug) {
          await curriculumSlugService.recomputeCourse(tx, courseId);
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw slugTaken();
      }
      throw error;
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_COURSE, 'academy_courses', courseId, patch);
    return this.getCourse(courseId);
  }

  /** Unpublishes the course. Its modules and items are left as they are. */
  async archiveCourse(actor: CurriculumActor, courseId: number): Promise<CourseDto> {
    await this.requireCourse(courseId);
    await this.deps.repo.updateCourse(courseId, { isPublished: false });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ARCHIVE_COURSE, 'academy_courses', courseId, {
      isPublished: false,
    });
    return this.getCourse(courseId);
  }

  /**
   * Hard delete. Refused while learner data exists (409 `COURSE_HAS_LEARNER_DATA`)
   * or while a class is assigned to the course (409 `COURSE_ASSIGNED`). The
   * `track_content` rows, which have no FK, are removed in the same transaction.
   */
  async deleteCourse(actor: CurriculumActor, courseId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await this.requireCourse(courseId, tx);
      if (await this.deps.repo.hasCourseLearnerData(courseId, tx)) {
        throw new ConflictError(
          'This course has learner progress and cannot be deleted. Archive it instead.',
          [{ code: ERROR_CODES.COURSE_HAS_LEARNER_DATA }],
        );
      }
      if ((await this.deps.repo.countCourseAssignments(courseId, tx)) > 0) {
        throw new ConflictError(
          'This course is assigned to a class. Remove the assignment before deleting it.',
          [{ code: ERROR_CODES.COURSE_ASSIGNED }],
        );
      }
      await this.deps.repo.deleteCourseTrackContent(courseId, tx);
      await this.deps.repo.deleteCourse(courseId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_COURSE, 'academy_courses', courseId, null);
  }

  /* ── Modules ────────────────────────────────────────────────────────── */

  /** Modules of one course, including drafts and archived modules. */
  async listCourseModules(courseId: number, filters: AdminModuleListFilters): Promise<ModuleDto[]> {
    await this.requireCourse(courseId);
    const rows = await this.deps.repo.listModules(courseId, {
      search: filters.search,
      isPublished: filters.isPublished,
    });
    return rows.map((row) => toModuleDto(row));
  }

  /**
   * Creates a DRAFT module. Without `moduleOrder` the module is appended
   * (max + 1); an explicit order must be free in the course.
   */
  async createModule(
    actor: CurriculumActor,
    courseId: number,
    input: { title: string; description?: string; estimatedMinutes?: number; moduleOrder?: number },
  ): Promise<ModuleDto> {
    const created = await db.transaction(async (tx) => {
      await this.requireCourse(courseId, tx);

      let moduleOrder: number;
      if (input.moduleOrder !== undefined) {
        moduleOrder = input.moduleOrder;
        await this.assertModuleOrderFree(courseId, moduleOrder, tx);
      } else {
        moduleOrder = ((await this.deps.repo.maxModuleOrder(courseId, tx)) ?? 0) + 1;
      }
      if (moduleOrder > MAX_CURRICULUM_POSITION) {
        throw new ValidationError(`A course can hold at most ${MAX_CURRICULUM_POSITION} modules.`);
      }

      const moduleId = await this.deps.repo.createModule(
        {
          courseId,
          title: input.title,
          description: input.description ?? null,
          moduleOrder,
          estimatedMinutes: input.estimatedMinutes ?? 0,
        },
        tx,
      );
      await curriculumSlugService.recomputeCourse(tx, courseId);
      return { moduleId, moduleOrder };
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_MODULE, 'module', created.moduleId, {
      title: input.title,
      moduleOrder: created.moduleOrder,
    });
    return this.readModule(created.moduleId);
  }

  /** Module detail for the editor: the module and its ordered items (lesson, lab and quiz). */
  async getModule(moduleId: number): Promise<AdminModuleDetailDto> {
    const module = await this.requireModule(moduleId);
    const rows = await this.deps.repo.listItemsByModule(moduleId);
    const items: AdminModuleItemDto[] = [];
    for (const row of rows) {
      items.push(await this.toAdminItemDto(row));
    }
    return { module: toModuleDto(module), items };
  }

  /** Updates module metadata. Module order changes go through `reorderModules`. */
  async updateModule(
    actor: CurriculumActor,
    moduleId: number,
    input: Partial<{
      title: string;
      description: string | null;
      estimatedMinutes: number;
      isPublished: boolean;
    }>,
  ): Promise<ModuleDto> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('description' in input) patch.description = input.description;
    if (input.estimatedMinutes !== undefined) patch.estimatedMinutes = input.estimatedMinutes;
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

    await db.transaction(async (tx) => {
      const module = await this.requireModule(moduleId, tx);
      if (Object.keys(patch).length > 0) {
        await this.deps.repo.updateModule(moduleId, patch, tx);
      }
      if (input.isPublished !== undefined) {
        await this.deps.repo.refreshCourseCounts(module.courseId, tx);
      }
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_MODULE, 'module', moduleId, patch);
    return this.readModule(moduleId);
  }

  /** Publishes the module. A module may be published inside a draft course. */
  async publishModule(actor: CurriculumActor, moduleId: number): Promise<ModuleDto> {
    await db.transaction(async (tx) => {
      const module = await this.requireModule(moduleId, tx);
      await this.deps.repo.setModulePublished(moduleId, true, tx);
      await this.deps.repo.refreshCourseCounts(module.courseId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.PUBLISH_MODULE, 'module', moduleId, {
      isPublished: true,
    });
    return this.readModule(moduleId);
  }

  /** Archives the module and unpublishes its items and quizzes in one transaction. */
  async archiveModule(actor: CurriculumActor, moduleId: number): Promise<ModuleDto> {
    await db.transaction(async (tx) => {
      const module = await this.requireModule(moduleId, tx);
      await this.deps.repo.archiveModuleCascade(moduleId, tx);
      await this.deps.repo.refreshCourseCounts(module.courseId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ARCHIVE_MODULE, 'module', moduleId, {
      isPublished: false,
      itemsUnpublished: true,
      quizzesUnpublished: true,
    });
    return this.readModule(moduleId);
  }

  /** Sets the module order to the given full list (422 `REORDER_SET_MISMATCH` otherwise). */
  async reorderModules(
    actor: CurriculumActor,
    courseId: number,
    moduleIds: number[],
  ): Promise<ModuleDto[]> {
    await db.transaction(async (tx) => {
      await this.requireCourse(courseId, tx);
      const existing = await this.deps.repo.listModules(courseId, {}, tx);
      assertExactReorderSet(moduleIds, existing.map((row) => row.moduleId));

      await this.deps.repo.bulkUpdateModuleOrders(
        moduleIds.map((moduleId, index) => ({ moduleId, moduleOrder: index + 1 })),
        tx,
      );
      await curriculumSlugService.recomputeCourse(tx, courseId);
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REORDER_MODULES, 'academy_courses', courseId, {
      moduleIds,
    });
    const rows = await this.deps.repo.listModules(courseId);
    return rows.map((row) => toModuleDto(row));
  }

  /**
   * Hard delete. Refused while learner data exists (409 `MODULE_HAS_LEARNER_DATA`).
   * Sibling module orders are compacted and the course counts refreshed.
   */
  async deleteModule(actor: CurriculumActor, moduleId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const module = await this.requireModule(moduleId, tx);
      if (await this.deps.repo.hasModuleLearnerData(moduleId, tx)) {
        throw new ConflictError(
          'This module has learner progress and cannot be deleted. Archive it instead.',
          [{ code: ERROR_CODES.MODULE_HAS_LEARNER_DATA }],
        );
      }
      await this.deps.repo.deleteModule(moduleId, tx);
      await this.compactModuleOrders(module.courseId, tx);
      await curriculumSlugService.recomputeCourse(tx, module.courseId);
      await this.deps.repo.refreshCourseCounts(module.courseId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_MODULE, 'module', moduleId, null);
  }

  /* ── Lessons (lesson-kind items only) ───────────────────────────────── */

  /** One item of kind lesson with its module context and tags. */
  async getLesson(lessonId: number): Promise<LessonDto> {
    const lesson = await this.requireLesson(lessonId);
    return this.toLessonDtoFor(lesson);
  }

  /**
   * Updates a lesson-kind item. Lab and quiz items are refused with 422
   * `ITEM_KIND_IMMUTABLE`. Publishing requires the parent module to be published.
   */
  async updateLesson(
    actor: CurriculumActor,
    lessonId: number,
    input: Partial<{
      title: string;
      content: string | null;
      contentType: LessonContentType;
      videoUrl: string | null;
      videoDurationSeconds: number | null;
      isPublished: boolean;
      tagIds: number[];
    }>,
  ): Promise<LessonDto> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('content' in input) patch.content = input.content;
    if (input.contentType !== undefined) patch.contentType = input.contentType;
    if ('videoUrl' in input) patch.videoUrl = input.videoUrl;
    if ('videoDurationSeconds' in input) patch.videoDurationSeconds = input.videoDurationSeconds;
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

    const tagIds = input.tagIds !== undefined ? await this.resolveTagIds(input.tagIds) : undefined;

    await db.transaction(async (tx) => {
      const lesson = await this.requireLesson(lessonId, tx);
      if (lesson.contentType === 'lab' || lesson.contentType === 'quiz') {
        throw new ValidationError(
          'Lab and quiz items cannot change kind. Edit them in their own editor.',
          [{ code: ERROR_CODES.ITEM_KIND_IMMUTABLE }],
        );
      }
      const module = await this.requireModule(lesson.moduleId, tx);
      if (input.isPublished === true && !module.isPublished) {
        throw new ConflictError('Publish the parent module before publishing its items.', [
          { code: ERROR_CODES.PUBLISH_PARENT_FIRST },
        ]);
      }

      if (Object.keys(patch).length > 0) {
        await this.deps.repo.updateLesson(lessonId, patch, tx);
      }
      if (tagIds !== undefined) {
        await this.deps.repo.setLessonTags(lessonId, tagIds, tx);
      }
      if (input.isPublished !== undefined) {
        await this.deps.repo.refreshCourseCounts(module.courseId, tx);
      }
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_LESSON, 'lesson', lessonId, patch);
    return this.getLesson(lessonId);
  }

  /* ── Shared guards & helpers ────────────────────────────────────────── */

  private async requireCourse(courseId: number, tx: DbOrTx = db): Promise<CourseRow> {
    const course = await this.deps.repo.findCourseById(courseId, tx);
    if (!course) {
      throw courseNotFound();
    }
    return course;
  }

  private async requireModule(moduleId: number, tx: DbOrTx = db): Promise<ModuleRow> {
    const module = await this.deps.repo.findModuleById(moduleId, tx);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    return module;
  }

  private async requireLesson(lessonId: number, tx: DbOrTx = db): Promise<LessonRow> {
    const lesson = await this.deps.repo.findLessonById(lessonId, tx);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
    }
    return lesson;
  }

  private async readModule(moduleId: number): Promise<ModuleDto> {
    return toModuleDto(await this.requireModule(moduleId));
  }

  private async assertModuleOrderFree(
    courseId: number,
    moduleOrder: number,
    tx: DbOrTx = db,
  ): Promise<void> {
    const holder = await this.deps.repo.findModuleOrder(courseId, moduleOrder, tx);
    if (holder !== null) {
      throw new ConflictError('Another module already uses this order value.');
    }
  }

  /** Re-numbers the course's modules 1..n in their current order, skipping rows already in place. */
  private async compactModuleOrders(courseId: number, tx: DbOrTx): Promise<void> {
    const rows = await this.deps.repo.listModules(courseId, {}, tx);
    const entries = rows
      .map((row, index) => ({ moduleId: row.moduleId, moduleOrder: index + 1, current: row.moduleOrder }))
      .filter((entry) => entry.current !== entry.moduleOrder)
      .map(({ moduleId, moduleOrder }) => ({ moduleId, moduleOrder }));
    await this.deps.repo.bulkUpdateModuleOrders(entries, tx);
  }

  /** Tag ids must all exist and be active; duplicates are collapsed. */
  private async resolveTagIds(tagIds: number[]): Promise<number[]> {
    const unique = [...new Set(tagIds)];
    const validIds = await this.deps.repo.findTagsByIds(unique);
    if (validIds.length !== unique.length) {
      throw new NotFoundError('One or more tags were not found.');
    }
    return validIds;
  }

  private async toLessonDtoFor(row: LessonRow, tx: DbOrTx = db): Promise<LessonDto> {
    const [module, tags] = await Promise.all([
      this.requireModule(row.moduleId, tx),
      this.deps.repo.listLessonTags(row.lessonId, tx),
    ]);
    return toLessonDto(row, module, tags);
  }

  /** Admin item view: learner-safe fields plus publish state, spec status and learner-data flag. */
  private async toAdminItemDto(row: ModuleItemRow): Promise<AdminModuleItemDto> {
    const base: ModuleItemDto = {
      itemId: row.itemId,
      moduleId: row.moduleId,
      position: row.position,
      kind: row.kind,
      title: row.title,
      slug: row.slug,
      contentType: row.contentType,
      videoDurationSeconds: row.videoDurationSeconds,
      lab: null,
      quiz: null,
    };
    return {
      ...base,
      isPublished: row.isPublished,
      lab: row.lab ? toAdminLabItem(row.lab) : null,
      quiz: row.quiz
        ? {
          quizId: row.quiz.quizId,
          questionCount: row.quiz.activeQuestionCount,
          passingScore: row.quiz.passingScore,
          timeLimitMinutes: row.quiz.timeLimitMinutes,
          isRequired: row.quiz.isRequired,
          isPublished: row.quiz.isPublished,
          activeQuestionCount: row.quiz.activeQuestionCount,
        }
        : null,
      hasLearnerData: await this.deps.repo.hasItemLearnerData(row.itemId),
    };
  }
}

export const adminCurriculumService = new AdminCurriculumService();
