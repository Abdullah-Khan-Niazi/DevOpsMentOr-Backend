import { AUDIT_ACTIONS } from '../../../shared/constants';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  ContentType,
  CourseDto,
  CurriculumActor,
  LessonDto,
  ModuleDto,
  ModuleEditorDto,
  TagDto,
} from '../dto/curriculum.dto';
import { curriculumRepository, type LessonRow, type ModuleRow } from '../repositories/curriculum.repository';
import { quizService, type QuizService } from './QuizService';
import { toCourseDto, toModuleDto } from './CurriculumService';

export interface AdminCurriculumServiceDeps {
  repo: typeof curriculumRepository;
  quiz: QuizService;
  audit: typeof auditLogService;
}

function defaultDeps(): AdminCurriculumServiceDeps {
  return { repo: curriculumRepository, quiz: quizService, audit: auditLogService };
}

/**
 * F4 §08: Platform Admin write path. Every mutation verifies the target
 * belongs to the single canonical course (§05 invariant 1), enforces the
 * ordering and publish invariants, writes one audit_logs row, and refreshes
 * the denormalized course counts (§06).
 */
export class AdminCurriculumService {
  constructor(private readonly deps: AdminCurriculumServiceDeps = defaultDeps()) {}

  /* ── Course ─────────────────────────────────────────────────────────── */

  async getCourse(): Promise<CourseDto> {
    return toCourseDto(await this.requireCanonicalCourse());
  }

  /** SCR-F4-03: lesson tag vocabulary for the editor form. */
  async getTags(): Promise<TagDto[]> {
    return this.deps.repo.listTags();
  }

  /** F4-API-08: PATCH course metadata. */
  async updateCourse(
    actor: CurriculumActor,
    input: Partial<{
      title: string;
      description: string | null;
      difficultyId: number;
      categoryId: number | null;
      coverImageUrl: string | null;
      videoTrailerUrl: string | null;
      estimatedHours: number;
      isPublished: boolean;
      prerequisites: string[] | null;
      learningObjectives: string[] | null;
    }>,
  ): Promise<CourseDto> {
    const course = await this.requireCanonicalCourse();

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('description' in input) patch.description = input.description;
    if (input.difficultyId !== undefined) patch.difficultyId = input.difficultyId;
    if ('categoryId' in input) patch.categoryId = input.categoryId;
    if ('coverImageUrl' in input) patch.coverImageUrl = input.coverImageUrl;
    if ('videoTrailerUrl' in input) patch.videoTrailerUrl = input.videoTrailerUrl;
    if (input.estimatedHours !== undefined) patch.estimatedHours = input.estimatedHours;
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;
    if ('prerequisites' in input) patch.prerequisites = input.prerequisites;
    if ('learningObjectives' in input) patch.learningObjectives = input.learningObjectives;

    if (Object.keys(patch).length > 0) {
      await this.deps.repo.updateCourse(course.courseId, patch);
    }
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_COURSE, 'academy_courses', course.courseId, patch);
    return this.getCourse();
  }

  /* ── Modules ────────────────────────────────────────────────────────── */

  /** F4-API-09: admin module list incl. DRAFT/ARCHIVED + search filter. */
  async getAllModules(search: string | undefined, isPublished: boolean | undefined): Promise<ModuleDto[]> {
    await this.requireCanonicalCourse();
    const rows = await this.deps.repo.listModulesAll(search, isPublished);
    return rows.map((row) => toModuleDto(row));
  }

  /** SCR-F4-02/03/04 payload: module + lessons + quizzes (admin view). */
  async getModuleEditorData(moduleId: number): Promise<ModuleEditorDto> {
    const module = await this.requireModuleInCanonicalCourse(moduleId);

    const lessonRows = await this.deps.repo.listLessonsByModule(moduleId);
    const lessons: LessonDto[] = [];
    for (const row of lessonRows) {
      lessons.push(await this.toLessonDto(row));
    }

    const quizzes = await this.deps.quiz.getQuizAdminDetailForModule(moduleId);

    return { ...toModuleDto(module), lessons, quizzes };
  }

  /** SCR-F4-03 payload: single lesson for the editor form. */
  async getLessonEditorData(lessonId: number): Promise<LessonDto> {
    const lesson = await this.deps.repo.findLessonById(lessonId);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.');
    }
    await this.requireModuleInCanonicalCourse(lesson.moduleId);
    return this.toLessonDto(lesson);
  }

  /** F4-API-10: create module as DRAFT (invariant 2 order uniqueness). */
  async createModule(
    actor: CurriculumActor,
    input: { title: string; description?: string; estimatedMinutes?: number; moduleOrder: number },
  ): Promise<ModuleDto> {
    const course = await this.requireCanonicalCourse();
    await this.assertModuleOrderFree(course.courseId, input.moduleOrder);

    const moduleId = await this.deps.repo.createModule({
      courseId: course.courseId,
      title: input.title,
      description: input.description ?? null,
      moduleOrder: input.moduleOrder,
      estimatedMinutes: input.estimatedMinutes ?? 0,
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_MODULE, 'module', moduleId, {
      title: input.title,
      moduleOrder: input.moduleOrder,
    });

    const row = await this.deps.repo.findModuleById(moduleId);
    if (!row) {
      throw new NotFoundError('Module not found.');
    }
    return toModuleDto(row);
  }

  /** F4-API-11: update module (order collisions rejected). */
  async updateModule(
    actor: CurriculumActor,
    moduleId: number,
    input: Partial<{
      title: string;
      description: string | null;
      estimatedMinutes: number;
      moduleOrder: number;
      isPublished: boolean;
    }>,
  ): Promise<ModuleDto> {
    const module = await this.requireModuleInCanonicalCourse(moduleId);

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('description' in input) patch.description = input.description;
    if (input.estimatedMinutes !== undefined) patch.estimatedMinutes = input.estimatedMinutes;
    if (input.moduleOrder !== undefined) {
      await this.assertModuleOrderFree(module.courseId, input.moduleOrder, moduleId);
      patch.moduleOrder = input.moduleOrder;
    }
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

    if (Object.keys(patch).length > 0) {
      await this.deps.repo.updateModule(moduleId, patch);
    }
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_MODULE, 'module', moduleId, patch);

    const row = await this.deps.repo.findModuleById(moduleId);
    if (!row) {
      throw new NotFoundError('Module not found.');
    }
    return toModuleDto(row);
  }

  /** F4-API-12: publish module. */
  async publishModule(actor: CurriculumActor, moduleId: number): Promise<ModuleDto> {
    const module = await this.requireModuleInCanonicalCourse(moduleId);
    await this.deps.repo.setModulePublished(moduleId, true);
    await this.deps.repo.refreshCourseCounts(module.courseId);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.PUBLISH_MODULE, 'module', moduleId, {
      isPublished: true,
    });
    return this.readModuleOrThrow(moduleId);
  }

  /** F4-API-13: archive module (AC-03 atomic cascade unpublish children). */
  async archiveModule(actor: CurriculumActor, moduleId: number): Promise<ModuleDto> {
    const module = await this.requireModuleInCanonicalCourse(moduleId);

    // Single transaction: module + lessons + quizzes all flip together.
    await this.deps.repo.archiveModuleCascade(moduleId);
    await this.deps.repo.refreshCourseCounts(module.courseId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ARCHIVE_MODULE, 'module', moduleId, {
      isPublished: false,
      lessonsUnpublished: true,
      quizzesUnpublished: true,
    });
    return this.readModuleOrThrow(moduleId);
  }

  /** F4-API-14: transactional bulk module reorder (invariant 2). */
  async reorderModules(
    actor: CurriculumActor,
    orders: Array<{ moduleId: number; moduleOrder: number }>,
  ): Promise<void> {
    const course = await this.requireCanonicalCourse();
    await this.validateOrders(orders, course.courseId);

    await this.deps.repo.bulkUpdateModuleOrders(orders);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REORDER_MODULES, 'module', null, {
      orders,
    });
  }

  /* ── Lessons ────────────────────────────────────────────────────────── */

  /** F4-API-15: create lesson (DRAFT; tags optional). */
  async createLesson(
    actor: CurriculumActor,
    moduleId: number,
    input: {
      title: string;
      content?: string;
      contentType: ContentType;
      videoUrl: string | null;
      videoDurationSeconds: number | null;
      lessonOrder: number;
      tagIds?: number[];
    },
  ): Promise<LessonDto> {
    const module = await this.requireModuleInCanonicalCourse(moduleId);
    await this.assertLessonOrderFree(moduleId, input.lessonOrder);

    const lessonId = await this.deps.repo.createLesson({
      moduleId,
      title: input.title,
      content: input.content ?? null,
      contentType: input.contentType,
      videoUrl: input.videoUrl,
      videoDurationSeconds: input.videoDurationSeconds,
      lessonOrder: input.lessonOrder,
    });
    await this.applyLessonTags(lessonId, input.tagIds ?? []);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_LESSON, 'lesson', lessonId, {
      moduleId,
      title: input.title,
    });
    await this.deps.repo.refreshCourseCounts(module.courseId);

    return this.readLessonOrThrow(lessonId);
  }

  /** F4-API-16: update lesson. */
  async updateLesson(
    actor: CurriculumActor,
    lessonId: number,
    input: Partial<{
      title: string;
      content: string | null;
      contentType: ContentType;
      videoUrl: string | null;
      videoDurationSeconds: number | null;
      lessonOrder: number;
      isPublished: boolean;
      tagIds?: number[];
    }>,
  ): Promise<LessonDto> {
    const lesson = await this.deps.repo.findLessonById(lessonId);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.');
    }
    await this.requireModuleInCanonicalCourse(lesson.moduleId);

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('content' in input) patch.content = input.content;
    if (input.contentType !== undefined) patch.contentType = input.contentType;
    if ('videoUrl' in input) patch.videoUrl = input.videoUrl;
    if ('videoDurationSeconds' in input) patch.videoDurationSeconds = input.videoDurationSeconds;
    if (input.lessonOrder !== undefined) {
      await this.assertLessonOrderFree(lesson.moduleId, input.lessonOrder, lessonId);
      patch.lessonOrder = input.lessonOrder;
    }
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

    if (Object.keys(patch).length > 0) {
      await this.deps.repo.updateLesson(lessonId, patch);
    }
    if (input.tagIds !== undefined) {
      await this.applyLessonTags(lessonId, input.tagIds);
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_LESSON, 'lesson', lessonId, patch);
    return this.readLessonOrThrow(lessonId);
  }

  /** F4-API-17: publish lesson only if parent module is published (§05 rule 4). */
  async publishLesson(actor: CurriculumActor, lessonId: number): Promise<LessonDto> {
    const lesson = await this.deps.repo.findLessonById(lessonId);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.');
    }
    const module = await this.requireModuleInCanonicalCourse(lesson.moduleId);
    if (!module.isPublished) {
      throw new ConflictError('Publish the parent module before publishing its lessons.');
    }

    await this.deps.repo.setLessonPublished(lessonId, true);
    await this.deps.repo.refreshCourseCounts(module.courseId);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.PUBLISH_LESSON, 'lesson', lessonId, {
      isPublished: true,
    });
    return this.readLessonOrThrow(lessonId);
  }

  /** F4-API-18: transactional bulk lesson reorder within a module. */
  async reorderLessons(
    actor: CurriculumActor,
    moduleId: number,
    orders: Array<{ lessonId: number; lessonOrder: number }>,
  ): Promise<void> {
    await this.requireModuleInCanonicalCourse(moduleId);

    const existing = await this.deps.repo.listLessonsByModule(moduleId);
    const existingIds = new Set(existing.map((lesson) => lesson.lessonId));
    const seenOrders = new Set<number>();
    for (const entry of orders) {
      if (!existingIds.has(entry.lessonId)) {
        throw new NotFoundError(`Lesson ${entry.lessonId} does not belong to this module.`);
      }
      if (seenOrders.has(entry.lessonOrder)) {
        throw new ConflictError('Duplicate lesson order values are not allowed.');
      }
      seenOrders.add(entry.lessonOrder);
    }

    await this.deps.repo.bulkUpdateLessonOrders(moduleId, orders);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REORDER_LESSONS, 'module', moduleId, {
      orders,
    });
  }

  /* ── Shared guards & helpers ────────────────────────────────────────── */

  /** §05 invariant 1: the single canonical course record. */
  private async requireCanonicalCourse() {
    const course = await this.deps.repo.getCanonicalCourse();
    if (!course) {
      throw new NotFoundError('The canonical course has not been created yet.');
    }
    return course;
  }

  private async requireModuleInCanonicalCourse(moduleId: number): Promise<ModuleRow> {
    const course = await this.requireCanonicalCourse();
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    if (module.courseId !== course.courseId) {
      throw new NotFoundError('Module not found.');
    }
    return module;
  }

  private async assertModuleOrderFree(
    courseId: number,
    moduleOrder: number,
    excludeModuleId?: number,
  ): Promise<void> {
    const holder = await this.deps.repo.findModuleOrder(courseId, moduleOrder);
    if (holder !== null && holder !== excludeModuleId) {
      throw new ConflictError('Another module already uses this order value.');
    }
  }

  private async assertLessonOrderFree(
    moduleId: number,
    lessonOrder: number,
    excludeLessonId?: number,
  ): Promise<void> {
    const holder = await this.deps.repo.findLessonOrder(moduleId, lessonOrder);
    if (holder !== null && holder !== excludeLessonId) {
      throw new ConflictError('Another lesson already uses this order value.');
    }
  }

  /** Reorder input validation: all modules in canonical course, unique orders. */
  private async validateOrders(
    orders: Array<{ moduleId: number; moduleOrder: number }>,
    courseId: number,
  ): Promise<void> {
    const seenOrders = new Set<number>();
    for (const entry of orders) {
      if (seenOrders.has(entry.moduleOrder)) {
        throw new ConflictError('Duplicate module order values are not allowed.');
      }
      seenOrders.add(entry.moduleOrder);

      const row = await this.deps.repo.findModuleById(entry.moduleId);
      if (!row || row.courseId !== courseId) {
        throw new NotFoundError(`Module ${entry.moduleId} does not belong to the canonical course.`);
      }
    }
  }

  private async applyLessonTags(lessonId: number, tagIds: number[]): Promise<void> {
    const validIds = await this.deps.repo.findTagsByIds(tagIds);
    if (validIds.length !== tagIds.length) {
      throw new NotFoundError('One or more tags were not found.');
    }
    await this.deps.repo.setLessonTags(lessonId, validIds);
  }

  private async toLessonDto(row: LessonRow): Promise<LessonDto> {
    const tags = await this.deps.repo.listLessonTags(row.lessonId);
    return {
      lessonId: row.lessonId,
      moduleId: row.moduleId,
      title: row.title,
      content: row.content,
      contentType: row.contentType,
      videoUrl: row.videoUrl,
      videoDurationSeconds: row.videoDurationSeconds,
      lessonOrder: row.lessonOrder,
      isPublished: row.isPublished,
      tags,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async readModuleOrThrow(moduleId: number): Promise<ModuleDto> {
    const row = await this.deps.repo.findModuleById(moduleId);
    if (!row) {
      throw new NotFoundError('Module not found.');
    }
    return toModuleDto(row);
  }

  private async readLessonOrThrow(lessonId: number): Promise<LessonDto> {
    const row = await this.deps.repo.findLessonById(lessonId);
    if (!row) {
      throw new NotFoundError('Lesson not found.');
    }
    return this.toLessonDto(row);
  }
}

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

export const adminCurriculumService = new AdminCurriculumService();
