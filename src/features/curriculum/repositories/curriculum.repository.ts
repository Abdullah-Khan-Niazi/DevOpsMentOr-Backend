import { and, asc, count, desc, eq, inArray, isNotNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  activityLogs,
  categories,
  certificates,
  challengeTags,
  classAssignments,
  difficultyLevels,
  labs,
  lessons,
  modules,
  proLabs,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  tags,
  trackContent,
  userProgress,
  userQuizAnswers,
  users,
} from '../../../app/database/schema';
import {
  COURSE_SLUG_RE,
  formatCourseSlug,
  formatModuleSlug,
} from '../../../shared/utils/curriculum-slug';
import type {
  ContentType,
  ModuleItemKind,
  QuestionType,
  TagDto,
} from '../dto/curriculum.dto';

/** Transaction handle (same alias as the labs repository). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The shared pool handle or a transaction handle. */
export type DbOrTx = typeof db | Tx;

/** Content types a lesson-kind item can carry (lab and quiz items are spine kinds). */
export type LessonContentType = Exclude<ContentType, 'lab' | 'quiz'>;

/** Activity types whose `details.labId` ties a learner's lab activity to a lab. */
const LAB_ACTIVITY_TYPES = ['LAB_STARTED', 'LAB_COMPLETED', 'LAB_FAILED', 'LAB_TERMINATED'];

/** Course row enriched with display names for the admin/learner read paths. */
export interface CourseRow {
  courseId: number;
  title: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  difficultyName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  instructorId: number;
  instructorName: string | null;
  coverImageUrl: string | null;
  videoTrailerUrl: string | null;
  estimatedHours: number;
  totalLessons: number;
  totalQuizzes: number;
  isPublished: boolean;
  isPremium: boolean;
  prerequisites: string[] | null;
  learningObjectives: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Admin course list row: course plus item/module counts and track memberships. */
export interface AdminCourseRow extends CourseRow {
  moduleCount: number;
  itemCount: number;
  trackIds: number[];
}

export interface ModuleRow {
  moduleId: number;
  courseId: number;
  /** Parent course slug (`Cxx`); the module slug is derived from it. */
  courseSlug: string;
  /** Derived `CxxMxx`, or null when the course slug is not `Cxx`. */
  slug: string | null;
  title: string;
  description: string | null;
  moduleOrder: number;
  estimatedMinutes: number;
  isPublished: boolean;
  lessonCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LessonRow {
  lessonId: number;
  moduleId: number;
  title: string;
  slug: string | null;
  content: string | null;
  contentType: ContentType;
  labId: number | null;
  quizId: number | null;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  lessonOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Lab attached to a lab item. `flagValues` is the raw stored spec: the service
 * parses it and must never serialize it. */
export interface ModuleItemLabRef {
  labId: number;
  slug: string;
  labName: string;
  difficultyName: string | null;
  estimatedHours: number;
  isPremium: boolean;
  isActive: boolean;
  flagValues: unknown;
}

/** Quiz attached to a quiz item. */
export interface ModuleItemQuizRef {
  quizId: number;
  title: string;
  passingScore: number;
  timeLimitMinutes: number | null;
  isRequired: boolean;
  isPublished: boolean;
  activeQuestionCount: number;
}

/** One ordered module item (a `lessons` spine row joined with its lab or quiz). */
export interface ModuleItemRow {
  itemId: number;
  moduleId: number;
  position: number;
  kind: ModuleItemKind;
  title: string;
  slug: string | null;
  contentType: ContentType;
  videoDurationSeconds: number | null;
  isPublished: boolean;
  labId: number | null;
  quizId: number | null;
  lab: ModuleItemLabRef | null;
  quiz: ModuleItemQuizRef | null;
}

export interface QuizRow {
  quizId: number;
  moduleId: number;
  title: string;
  description: string | null;
  passingScore: number;
  timeLimitMinutes: number | null;
  isRequired: boolean;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionRow {
  questionId: number;
  quizId: number;
  questionText: string;
  questionType: QuestionType;
  config: Record<string, unknown> | null;
  points: number;
  explanation: string | null;
  questionOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnswerRow {
  answerId: number;
  questionId: number;
  answerText: string;
  isCorrect: boolean;
  answerOrder: number;
}

/** Module slug when the course slug and module order can form one, else null. */
function moduleSlugFor(courseSlug: string, moduleOrder: number): string | null {
  if (!COURSE_SLUG_RE.test(courseSlug) || moduleOrder < 1 || moduleOrder > 99) {
    return null;
  }
  return formatModuleSlug(courseSlug, moduleOrder);
}

function kindOf(contentType: ContentType): ModuleItemKind {
  if (contentType === 'lab') return 'lab';
  if (contentType === 'quiz') return 'quiz';
  return 'lesson';
}

/** Course columns shared by every course read (joined taxonomy and instructor labels). */
const courseSelect = {
  courseId: academyCourses.courseId,
  title: academyCourses.title,
  slug: academyCourses.slug,
  description: academyCourses.description,
  difficultyId: academyCourses.difficultyId,
  difficultyName: difficultyLevels.name,
  categoryId: academyCourses.categoryId,
  categoryName: categories.name,
  instructorId: academyCourses.instructorId,
  instructorName: users.fullName,
  coverImageUrl: academyCourses.coverImageUrl,
  videoTrailerUrl: academyCourses.videoTrailerUrl,
  estimatedHours: academyCourses.estimatedHours,
  totalLessons: academyCourses.totalLessons,
  totalQuizzes: academyCourses.totalQuizzes,
  isPublished: academyCourses.isPublished,
  isPremium: academyCourses.isPremium,
  prerequisites: academyCourses.prerequisites,
  learningObjectives: academyCourses.learningObjectives,
  createdAt: academyCourses.createdAt,
  updatedAt: academyCourses.updatedAt,
};

/** Item columns: the spine row plus its lab and quiz summaries. */
const itemSelect = {
  itemId: lessons.lessonId,
  moduleId: lessons.moduleId,
  position: lessons.lessonOrder,
  title: lessons.title,
  slug: lessons.slug,
  contentType: lessons.contentType,
  videoDurationSeconds: lessons.videoDurationSeconds,
  isPublished: lessons.isPublished,
  labId: lessons.labId,
  quizId: lessons.quizId,
  labSlug: labs.slug,
  labName: labs.labName,
  labIsActive: labs.isActive,
  labIsPremium: labs.isPremium,
  labEstimatedHours: labs.estimatedHours,
  labDifficultyName: difficultyLevels.name,
  labFlagValues: proLabs.flagValues,
  quizTitle: quizzes.title,
  quizPassingScore: quizzes.passingScore,
  quizTimeLimitMinutes: quizzes.timeLimitMinutes,
  quizIsRequired: quizzes.isRequired,
  quizIsPublished: quizzes.isPublished,
};

/**
 * Learner-visible item condition. Requires the `labs` and `quizzes` joins that
 * `itemSelect` queries add: a published spine row, a lab item whose lab exists
 * and is active, and a quiz item whose quiz is published.
 */
const visibleItemCondition = and(
  eq(lessons.isPublished, true),
  or(ne(lessons.contentType, 'lab'), and(isNotNull(lessons.labId), eq(labs.isActive, true))),
  or(ne(lessons.contentType, 'quiz'), eq(quizzes.isPublished, true)),
);

/**
 * F4 data access layer. Every course-scoped read takes the course id explicitly
 * (D17). Published-content filters for non-admin reads are applied in SQL. Writes
 * take an optional transaction handle so services can compose them atomically.
 * The `challenge_tags.challenge_id` column holds `lessons.lesson_id` (§06).
 */
export class CurriculumRepository {
  /* ── Course ─────────────────────────────────────────────────────────── */

  /** Published course catalog (multi-course support, chaos sprint). */
  async listPublishedCourses(): Promise<CourseRow[]> {
    const rows = await db
      .select()
      .from(academyCourses)
      .where(eq(academyCourses.isPublished, true))
      .orderBy(asc(academyCourses.courseId));
    // Catalog rows carry no joined taxonomy/instructor labels; DTO mapping
    // renders them as nulls rather than issuing N+1 lookups.
    return rows.map((row) => ({
      ...row,
      difficultyName: null,
      categoryName: null,
      instructorName: null,
    }));
  }

  /** Difficulty taxonomy for admin pickers. */
  async listDifficultyLevels(): Promise<Array<{ difficultyId: number; name: string }>> {
    return db
      .select({
        difficultyId: difficultyLevels.difficultyId,
        name: difficultyLevels.name,
      })
      .from(difficultyLevels)
      .orderBy(asc(difficultyLevels.levelValue));
  }

  /** Category taxonomy for admin pickers. */
  async listCategories(): Promise<Array<{ categoryId: number; name: string; slug: string }>> {
    return db
      .select({
        categoryId: categories.categoryId,
        name: categories.name,
        slug: categories.slug,
      })
      .from(categories)
      .orderBy(asc(categories.name));
  }

  /** Single course with joined taxonomy/instructor labels (admin editor). */
  async findCourseById(courseId: number, tx: DbOrTx = db): Promise<CourseRow | null> {
    const rows = await tx
      .select(courseSelect)
      .from(academyCourses)
      .leftJoin(difficultyLevels, eq(difficultyLevels.difficultyId, academyCourses.difficultyId))
      .leftJoin(categories, eq(categories.categoryId, academyCourses.categoryId))
      .leftJoin(users, eq(users.userId, academyCourses.instructorId))
      .where(eq(academyCourses.courseId, courseId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Course by its `Cxx` slug (slug uniqueness checks, deep links). */
  async findCourseBySlug(slug: string, tx: DbOrTx = db): Promise<CourseRow | null> {
    const rows = await tx
      .select(courseSelect)
      .from(academyCourses)
      .leftJoin(difficultyLevels, eq(difficultyLevels.difficultyId, academyCourses.difficultyId))
      .leftJoin(categories, eq(categories.categoryId, academyCourses.categoryId))
      .leftJoin(users, eq(users.userId, academyCourses.instructorId))
      .where(eq(academyCourses.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Admin course list with module/item counts and track memberships (D17 read model). */
  async listCoursesForAdmin(
    filters: { search?: string; status?: 'all' | 'published' | 'draft' },
    tx: DbOrTx = db,
  ): Promise<AdminCourseRow[]> {
    const conditions: SQL[] = [];
    if (filters.search) {
      conditions.push(like(academyCourses.title, `%${filters.search}%`));
    }
    if (filters.status === 'published') {
      conditions.push(eq(academyCourses.isPublished, true));
    } else if (filters.status === 'draft') {
      conditions.push(eq(academyCourses.isPublished, false));
    }

    const rows = await tx
      .select(courseSelect)
      .from(academyCourses)
      .leftJoin(difficultyLevels, eq(difficultyLevels.difficultyId, academyCourses.difficultyId))
      .leftJoin(categories, eq(categories.categoryId, academyCourses.categoryId))
      .leftJoin(users, eq(users.userId, academyCourses.instructorId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(academyCourses.courseId));
    if (rows.length === 0) {
      return [];
    }

    const courseIds = rows.map((row) => row.courseId);
    const moduleCounts = await tx
      .select({ courseId: modules.courseId, value: count() })
      .from(modules)
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId);
    const itemCounts = await tx
      .select({ courseId: modules.courseId, value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId);
    const trackRows = await tx
      .select({ courseId: trackContent.contentId, trackId: trackContent.trackId })
      .from(trackContent)
      .where(and(eq(trackContent.contentType, 'course'), inArray(trackContent.contentId, courseIds)));

    const moduleCountByCourse = new Map(moduleCounts.map((row) => [row.courseId, row.value]));
    const itemCountByCourse = new Map(itemCounts.map((row) => [row.courseId, row.value]));
    const trackIdsByCourse = new Map<number, number[]>();
    for (const row of trackRows) {
      const list = trackIdsByCourse.get(row.courseId) ?? [];
      list.push(row.trackId);
      trackIdsByCourse.set(row.courseId, list);
    }

    return rows.map((row) => ({
      ...row,
      moduleCount: moduleCountByCourse.get(row.courseId) ?? 0,
      itemCount: itemCountByCourse.get(row.courseId) ?? 0,
      trackIds: trackIdsByCourse.get(row.courseId) ?? [],
    }));
  }

  /** Lowest unused course slug `C01`..`C99`, or null when all 99 are taken. */
  async nextAvailableCourseSlug(tx: DbOrTx = db): Promise<string | null> {
    const rows = await tx.select({ slug: academyCourses.slug }).from(academyCourses);
    const taken = new Set(rows.map((row) => row.slug));
    for (let n = 1; n <= 99; n += 1) {
      const slug = formatCourseSlug(n);
      if (!taken.has(slug)) {
        return slug;
      }
    }
    return null;
  }

  async createCourse(input: {
    title: string;
    slug: string;
    description: string | null;
    difficultyId: number;
    categoryId?: number | null;
    instructorId: number;
    estimatedHours: number;
    isPublished?: boolean;
    isPremium?: boolean;
    prerequisites: string[] | null;
    learningObjectives: string[] | null;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(academyCourses).values({
      ...input,
      categoryId: input.categoryId ?? null,
      isPublished: input.isPublished ?? false,
      isPremium: input.isPremium ?? false,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create course.');
    }
    return id;
  }

  async updateCourse(courseId: number, fields: Record<string, unknown>, tx: DbOrTx = db): Promise<void> {
    await tx.update(academyCourses).set(fields).where(eq(academyCourses.courseId, courseId));
  }

  /** Hard delete of the course row. Modules, items, certificates and assignments cascade by FK. */
  async deleteCourse(courseId: number, tx: DbOrTx = db): Promise<void> {
    await tx.delete(academyCourses).where(eq(academyCourses.courseId, courseId));
  }

  /** `track_content` has no FK to courses: course detach rows are removed explicitly. */
  async deleteCourseTrackContent(courseId: number, tx: DbOrTx = db): Promise<void> {
    await tx
      .delete(trackContent)
      .where(and(eq(trackContent.contentType, 'course'), eq(trackContent.contentId, courseId)));
  }

  async countCourseAssignments(courseId: number, tx: DbOrTx = db): Promise<number> {
    const rows = await tx
      .select({ value: count() })
      .from(classAssignments)
      .where(eq(classAssignments.courseId, courseId));
    return rows[0]?.value ?? 0;
  }

  /**
   * §06: denormalized published counts rewritten on every publish/unpublish.
   * `total_lessons` = published non-quiz items, `total_quizzes` = published quiz items.
   */
  async refreshCourseCounts(courseId: number, tx: DbOrTx = db): Promise<void> {
    const lessonRows = await tx
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(lessons.isPublished, true), ne(lessons.contentType, 'quiz')));
    const quizRows = await tx
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(lessons.isPublished, true), eq(lessons.contentType, 'quiz')));

    await tx
      .update(academyCourses)
      .set({
        totalLessons: lessonRows[0]?.value ?? 0,
        totalQuizzes: quizRows[0]?.value ?? 0,
      })
      .where(eq(academyCourses.courseId, courseId));
  }

  /* ── Modules ────────────────────────────────────────────────────────── */

  /** Shared module read: course slug joined in, item count from the spine. */
  private async selectModules(
    executor: DbOrTx,
    where: SQL | undefined,
    itemVisibility: 'all' | 'published',
  ): Promise<ModuleRow[]> {
    const rows = await executor
      .select({
        moduleId: modules.moduleId,
        courseId: modules.courseId,
        courseSlug: academyCourses.slug,
        title: modules.title,
        description: modules.description,
        moduleOrder: modules.moduleOrder,
        estimatedMinutes: modules.estimatedMinutes,
        isPublished: modules.isPublished,
        createdAt: modules.createdAt,
        updatedAt: modules.updatedAt,
      })
      .from(modules)
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .where(where)
      .orderBy(asc(modules.courseId), asc(modules.moduleOrder));
    if (rows.length === 0) {
      return [];
    }

    const countRows = await executor
      .select({ moduleId: lessons.moduleId, value: count() })
      .from(lessons)
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(
        inArray(lessons.moduleId, rows.map((row) => row.moduleId)),
        itemVisibility === 'published' ? visibleItemCondition : undefined,
      ))
      .groupBy(lessons.moduleId);
    const countByModule = new Map(countRows.map((row) => [row.moduleId, row.value]));

    return rows.map((row) => ({
      ...row,
      slug: moduleSlugFor(row.courseSlug, row.moduleOrder),
      lessonCount: countByModule.get(row.moduleId) ?? 0,
    }));
  }

  /**
   * Row-locks a module (`SELECT ... FOR UPDATE`) so item writes of one module
   * serialize. Returns false when the module does not exist. Call first inside
   * the transaction, then re-read whatever the write depends on.
   */
  async lockModule(moduleId: number, tx: Tx): Promise<boolean> {
    const rows = await tx
      .select({ moduleId: modules.moduleId })
      .from(modules)
      .where(eq(modules.moduleId, moduleId))
      .limit(1)
      .for('update');
    return rows.length > 0;
  }

  async findModuleById(moduleId: number, tx: DbOrTx = db): Promise<ModuleRow | null> {
    const rows = await this.selectModules(tx, eq(modules.moduleId, moduleId), 'all');
    return rows[0] ?? null;
  }

  /**
   * Modules of one course (D17). `publishedOnly` filters modules to published
   * ones and counts only learner-visible items; `isPublished` filters the admin
   * list by state; `search` matches the title.
   */
  async listModules(
    courseId: number,
    options: { publishedOnly?: boolean; isPublished?: boolean; search?: string } = {},
    tx: DbOrTx = db,
  ): Promise<ModuleRow[]> {
    const conditions: SQL[] = [eq(modules.courseId, courseId)];
    if (options.publishedOnly) {
      conditions.push(eq(modules.isPublished, true));
    } else if (options.isPublished !== undefined) {
      conditions.push(eq(modules.isPublished, options.isPublished));
    }
    if (options.search) {
      conditions.push(like(modules.title, `%${options.search}%`));
    }
    return this.selectModules(tx, and(...conditions), options.publishedOnly ? 'published' : 'all');
  }

  /** @deprecated Not course scoped (D17). Use `listModules(courseId, ...)`. Removed in wave 4. */
  async listModulesAll(
    search: string | undefined,
    isPublished: boolean | undefined,
  ): Promise<ModuleRow[]> {
    const conditions: SQL[] = [
      ...(search ? [like(modules.title, `%${search}%`)] : []),
      ...(isPublished !== undefined ? [eq(modules.isPublished, isPublished)] : []),
    ];
    return this.selectModules(db, conditions.length > 0 ? and(...conditions) : undefined, 'all');
  }

  /** @deprecated Not course scoped (D17). Use `listModules(courseId, { publishedOnly: true })`. Removed in wave 4. */
  async listModulesPublished(): Promise<ModuleRow[]> {
    return this.selectModules(db, eq(modules.isPublished, true), 'published');
  }

  async createModule(input: {
    courseId: number;
    title: string;
    description: string | null;
    moduleOrder: number;
    estimatedMinutes: number;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(modules).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create module.');
    }
    return id;
  }

  async updateModule(moduleId: number, fields: Record<string, unknown>, tx: DbOrTx = db): Promise<void> {
    await tx.update(modules).set(fields).where(eq(modules.moduleId, moduleId));
  }

  async setModulePublished(moduleId: number, isPublished: boolean, tx: DbOrTx = db): Promise<void> {
    await tx.update(modules).set({ isPublished }).where(eq(modules.moduleId, moduleId));
  }

  /** Hard delete. Items, quizzes and progress cascade by FK; the service checks learner data first. */
  async deleteModule(moduleId: number, tx: DbOrTx = db): Promise<void> {
    await tx.delete(modules).where(eq(modules.moduleId, moduleId));
  }

  async findModuleOrder(courseId: number, moduleOrder: number, tx: DbOrTx = db): Promise<number | null> {
    const rows = await tx
      .select({ moduleId: modules.moduleId })
      .from(modules)
      .where(and(eq(modules.courseId, courseId), eq(modules.moduleOrder, moduleOrder)))
      .limit(1);
    return rows[0]?.moduleId ?? null;
  }

  async maxModuleOrder(courseId: number, tx: DbOrTx = db): Promise<number | null> {
    const rows = await tx
      .select({ value: modules.moduleOrder })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(desc(modules.moduleOrder))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async countModulesByCourse(courseId: number, tx: DbOrTx = db): Promise<number> {
    const rows = await tx
      .select({ value: count() })
      .from(modules)
      .where(eq(modules.courseId, courseId));
    return rows[0]?.value ?? 0;
  }

  /** Transactional bulk order update for module reorder (`module_order`). */
  async bulkUpdateModuleOrders(
    entries: Array<{ moduleId: number; moduleOrder: number }>,
    tx?: DbOrTx,
  ): Promise<void> {
    await inTransaction(tx, async (executor) => {
      for (const entry of entries) {
        await executor
          .update(modules)
          .set({ moduleOrder: entry.moduleOrder })
          .where(eq(modules.moduleId, entry.moduleId));
      }
    });
  }

  /* ── Module items (lessons spine: lesson, lab and quiz kinds) ──────── */

  /** Item rows joined with lab and quiz summaries. Caller supplies the filter. */
  private async selectItems(executor: DbOrTx, where: SQL | undefined): Promise<ModuleItemRow[]> {
    const rows = await executor
      .select(itemSelect)
      .from(lessons)
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(proLabs, eq(proLabs.labId, labs.labId))
      .leftJoin(difficultyLevels, eq(difficultyLevels.difficultyId, labs.difficultyId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(where)
      .orderBy(asc(lessons.lessonOrder));
    if (rows.length === 0) {
      return [];
    }

    const quizIds = rows
      .map((row) => row.quizId)
      .filter((quizId): quizId is number => quizId !== null);
    const questionCounts = quizIds.length === 0
      ? []
      : await executor
        .select({ quizId: quizQuestions.quizId, value: count() })
        .from(quizQuestions)
        .where(and(inArray(quizQuestions.quizId, quizIds), eq(quizQuestions.isActive, true)))
        .groupBy(quizQuestions.quizId);
    const countByQuiz = new Map(questionCounts.map((row) => [row.quizId, row.value]));

    return rows.map((row) => ({
      itemId: row.itemId,
      moduleId: row.moduleId,
      position: row.position,
      kind: kindOf(row.contentType),
      title: row.title,
      slug: row.slug,
      contentType: row.contentType,
      videoDurationSeconds: row.videoDurationSeconds,
      isPublished: row.isPublished,
      labId: row.labId,
      quizId: row.quizId,
      lab: row.labId !== null && row.labSlug !== null && row.labName !== null
        ? {
          labId: row.labId,
          slug: row.labSlug,
          labName: row.labName,
          difficultyName: row.labDifficultyName,
          estimatedHours: row.labEstimatedHours ?? 0,
          isPremium: row.labIsPremium ?? false,
          isActive: row.labIsActive ?? false,
          flagValues: row.labFlagValues,
        }
        : null,
      quiz: row.quizId !== null && row.quizTitle !== null
        ? {
          quizId: row.quizId,
          title: row.quizTitle,
          passingScore: row.quizPassingScore ?? 0,
          timeLimitMinutes: row.quizTimeLimitMinutes,
          isRequired: row.quizIsRequired ?? true,
          isPublished: row.quizIsPublished ?? false,
          activeQuestionCount: countByQuiz.get(row.quizId) ?? 0,
        }
        : null,
    }));
  }

  /**
   * Items of one module in order. `publishedOnly` applies the learner rules:
   * published spine row, lab item with an active lab, quiz item with a published
   * quiz. Lab items whose lab was deleted are omitted from the learner list.
   */
  async listItemsByModule(
    moduleId: number,
    options: { publishedOnly?: boolean } = {},
    tx: DbOrTx = db,
  ): Promise<ModuleItemRow[]> {
    return this.selectItems(
      tx,
      and(eq(lessons.moduleId, moduleId), options.publishedOnly ? visibleItemCondition : undefined),
    );
  }

  async findItemById(itemId: number, tx: DbOrTx = db): Promise<ModuleItemRow | null> {
    const rows = await this.selectItems(tx, eq(lessons.lessonId, itemId));
    return rows[0] ?? null;
  }

  async findLessonById(lessonId: number, tx: DbOrTx = db): Promise<LessonRow | null> {
    const rows = await tx
      .select()
      .from(lessons)
      .where(eq(lessons.lessonId, lessonId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listLessonsByModule(moduleId: number, tx: DbOrTx = db): Promise<LessonRow[]> {
    return tx
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.lessonOrder));
  }

  async listPublishedLessonsByModule(moduleId: number, tx: DbOrTx = db): Promise<LessonRow[]> {
    return tx
      .select()
      .from(lessons)
      .where(and(eq(lessons.moduleId, moduleId), eq(lessons.isPublished, true)))
      .orderBy(asc(lessons.lessonOrder));
  }

  /** Lesson-kind item. Slug stays NULL: the course slug service assigns it (C§11.1). */
  async createLesson(input: {
    moduleId: number;
    title: string;
    content: string | null;
    contentType: LessonContentType;
    videoUrl: string | null;
    videoDurationSeconds: number | null;
    lessonOrder: number;
    isPublished?: boolean;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(lessons).values({
      moduleId: input.moduleId,
      title: input.title,
      slug: null,
      content: input.content,
      contentType: input.contentType,
      labId: null,
      quizId: null,
      videoUrl: input.videoUrl,
      videoDurationSeconds: input.videoDurationSeconds,
      lessonOrder: input.lessonOrder,
      isPublished: input.isPublished ?? false,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create lesson.');
    }
    return id;
  }

  /** Lab item referencing a lab definition. A lab may appear in several modules. */
  async createLabItem(input: {
    moduleId: number;
    labId: number;
    title: string;
    lessonOrder: number;
    isPublished?: boolean;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(lessons).values({
      moduleId: input.moduleId,
      title: input.title,
      slug: null,
      content: null,
      contentType: 'lab',
      labId: input.labId,
      quizId: null,
      videoUrl: null,
      videoDurationSeconds: null,
      lessonOrder: input.lessonOrder,
      isPublished: input.isPublished ?? false,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create lab item.');
    }
    return id;
  }

  /** Quiz and its spine row in one transaction. Both start unpublished. */
  async createQuizItem(input: {
    moduleId: number;
    lessonOrder: number;
    quiz: {
      title: string;
      description: string | null;
      passingScore: number;
      timeLimitMinutes: number | null;
      isRequired: boolean;
    };
  }, tx?: DbOrTx): Promise<{ itemId: number; quizId: number }> {
    return inTransaction(tx, async (executor) => {
      const quizId = await this.createQuiz({
        moduleId: input.moduleId,
        ...input.quiz,
        isPublished: false,
      }, executor);
      const inserted = await executor.insert(lessons).values({
        moduleId: input.moduleId,
        title: input.quiz.title,
        slug: null,
        content: null,
        contentType: 'quiz',
        labId: null,
        quizId,
        videoUrl: null,
        videoDurationSeconds: null,
        lessonOrder: input.lessonOrder,
        isPublished: false,
      });
      const itemId = inserted[0]?.insertId;
      if (!itemId) {
        throw new Error('Failed to create quiz item.');
      }
      return { itemId, quizId };
    });
  }

  /** Lesson fields and item title (for quiz items the service mirrors the title to `quizzes`). */
  async updateLesson(lessonId: number, fields: Record<string, unknown>, tx: DbOrTx = db): Promise<void> {
    await tx.update(lessons).set(fields).where(eq(lessons.lessonId, lessonId));
  }

  async setLessonPublished(lessonId: number, isPublished: boolean, tx: DbOrTx = db): Promise<void> {
    await tx.update(lessons).set({ isPublished }).where(eq(lessons.lessonId, lessonId));
  }

  /** Deletes the spine row only. Quiz and lab rows are untouched (quiz deletes go through `deleteQuiz`). */
  async deleteLesson(lessonId: number, tx: DbOrTx = db): Promise<void> {
    await tx.delete(lessons).where(eq(lessons.lessonId, lessonId));
  }

  async findLessonOrder(moduleId: number, lessonOrder: number, tx: DbOrTx = db): Promise<number | null> {
    const rows = await tx
      .select({ lessonId: lessons.lessonId })
      .from(lessons)
      .where(and(eq(lessons.moduleId, moduleId), eq(lessons.lessonOrder, lessonOrder)))
      .limit(1);
    return rows[0]?.lessonId ?? null;
  }

  async maxLessonOrder(moduleId: number, tx: DbOrTx = db): Promise<number | null> {
    const rows = await tx
      .select({ value: lessons.lessonOrder })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(desc(lessons.lessonOrder))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  /** Transactional bulk order update for item reorder (`lesson_order`). */
  async bulkUpdateLessonOrders(
    moduleId: number,
    entries: Array<{ lessonId: number; lessonOrder: number }>,
    tx?: DbOrTx,
  ): Promise<void> {
    await inTransaction(tx, async (executor) => {
      for (const entry of entries) {
        await executor
          .update(lessons)
          .set({ lessonOrder: entry.lessonOrder })
          .where(and(eq(lessons.lessonId, entry.lessonId), eq(lessons.moduleId, moduleId)));
      }
    });
  }

  /**
   * Archive cascade: unpublishes a module and all of its items and quizzes in
   * one transaction, so a mid-way failure never leaves children published under
   * an archived parent.
   */
  async archiveModuleCascade(moduleId: number, tx?: DbOrTx): Promise<void> {
    await inTransaction(tx, async (executor) => {
      await executor
        .update(modules)
        .set({ isPublished: false })
        .where(eq(modules.moduleId, moduleId));
      await executor
        .update(lessons)
        .set({ isPublished: false })
        .where(and(eq(lessons.moduleId, moduleId), eq(lessons.isPublished, true)));
      await executor
        .update(quizzes)
        .set({ isPublished: false })
        .where(and(eq(quizzes.moduleId, moduleId), eq(quizzes.isPublished, true)));
    });
  }

  /* ── Quizzes ────────────────────────────────────────────────────────── */

  async findQuizById(quizId: number, tx: DbOrTx = db): Promise<QuizRow | null> {
    const rows = await tx
      .select()
      .from(quizzes)
      .where(eq(quizzes.quizId, quizId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listQuizzesByModule(moduleId: number, tx: DbOrTx = db): Promise<QuizRow[]> {
    return tx
      .select()
      .from(quizzes)
      .where(eq(quizzes.moduleId, moduleId))
      .orderBy(asc(quizzes.quizId));
  }

  async listPublishedQuizzesByModule(moduleId: number, tx: DbOrTx = db): Promise<QuizRow[]> {
    return tx
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.moduleId, moduleId), eq(quizzes.isPublished, true)))
      .orderBy(asc(quizzes.quizId));
  }

  async createQuiz(input: {
    moduleId: number;
    title: string;
    description: string | null;
    passingScore: number;
    timeLimitMinutes: number | null;
    isRequired: boolean;
    isPublished: boolean;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(quizzes).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create quiz.');
    }
    return id;
  }

  async updateQuiz(quizId: number, fields: Record<string, unknown>, tx: DbOrTx = db): Promise<void> {
    await tx.update(quizzes).set(fields).where(eq(quizzes.quizId, quizId));
  }

  async setQuizPublished(quizId: number, isPublished: boolean, tx: DbOrTx = db): Promise<void> {
    await tx.update(quizzes).set({ isPublished }).where(eq(quizzes.quizId, quizId));
  }

  /** Hard delete. The spine row, questions and answers cascade by FK. */
  async deleteQuiz(quizId: number, tx: DbOrTx = db): Promise<void> {
    await tx.delete(quizzes).where(eq(quizzes.quizId, quizId));
  }

  async countQuestionsByQuiz(quizId: number, tx: DbOrTx = db): Promise<number> {
    const rows = await tx
      .select({ value: count() })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.isActive, true)));
    return rows[0]?.value ?? 0;
  }

  /* ── Questions & answers ────────────────────────────────────────────── */

  async findQuestionById(questionId: number, tx: DbOrTx = db): Promise<QuestionRow | null> {
    const rows = await tx
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.questionId, questionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listQuestionsByQuiz(
    quizId: number,
    includeInactive: boolean,
    tx: DbOrTx = db,
  ): Promise<QuestionRow[]> {
    return tx
      .select()
      .from(quizQuestions)
      .where(
        includeInactive
          ? eq(quizQuestions.quizId, quizId)
          : and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.isActive, true)),
      )
      .orderBy(asc(quizQuestions.questionOrder));
  }

  async createQuestion(input: {
    quizId: number;
    questionText: string;
    questionType: QuestionType;
    config?: Record<string, unknown> | null;
    points: number;
    explanation: string | null;
    questionOrder: number;
  }, tx: DbOrTx = db): Promise<number> {
    const inserted = await tx.insert(quizQuestions).values({
      ...input,
      config: input.config ?? null,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create question.');
    }
    return id;
  }

  async updateQuestion(questionId: number, fields: Record<string, unknown>, tx: DbOrTx = db): Promise<void> {
    await tx.update(quizQuestions).set(fields).where(eq(quizQuestions.questionId, questionId));
  }

  /** Hard delete. Answers cascade; the service checks `hasQuestionLearnerData` first. */
  async deleteQuestion(questionId: number, tx: DbOrTx = db): Promise<void> {
    await tx.delete(quizQuestions).where(eq(quizQuestions.questionId, questionId));
  }

  /** Transactional bulk order update for question reorder (`question_order`). */
  async bulkUpdateQuestionOrders(
    quizId: number,
    entries: Array<{ questionId: number; questionOrder: number }>,
    tx?: DbOrTx,
  ): Promise<void> {
    await inTransaction(tx, async (executor) => {
      for (const entry of entries) {
        await executor
          .update(quizQuestions)
          .set({ questionOrder: entry.questionOrder })
          .where(and(eq(quizQuestions.questionId, entry.questionId), eq(quizQuestions.quizId, quizId)));
      }
    });
  }

  async listAnswersByQuestion(questionId: number, tx: DbOrTx = db): Promise<AnswerRow[]> {
    return tx
      .select()
      .from(quizAnswers)
      .where(eq(quizAnswers.questionId, questionId))
      .orderBy(asc(quizAnswers.answerOrder));
  }

  /** Answers are replaced wholesale on question update (invariant 6 re-check). */
  async replaceAnswers(
    questionId: number,
    answers: Array<{ answerText: string; isCorrect: boolean; answerOrder: number }>,
    tx?: DbOrTx,
  ): Promise<void> {
    await inTransaction(tx, async (executor) => {
      await executor.delete(quizAnswers).where(eq(quizAnswers.questionId, questionId));
      if (answers.length > 0) {
        await executor.insert(quizAnswers).values(answers.map((answer) => ({ ...answer, questionId })));
      }
    });
  }

  /* ── Learner data (hard delete guards, contracts §6) ───────────────── */

  /**
   * True when any learner-owned row is in scope: `user_progress` for the given
   * course, modules, items, `certificates` for the course, `quiz_attempts` for the
   * quizzes, or `LAB_*` activity for the labs.
   */
  private async learnerDataExists(
    executor: DbOrTx,
    scope: {
      courseId?: number;
      moduleIds: number[];
      lessonIds: number[];
      quizIds: number[];
      labIds: number[];
    },
  ): Promise<boolean> {
    const progressConditions: SQL[] = [];
    if (scope.courseId !== undefined) {
      progressConditions.push(eq(userProgress.courseId, scope.courseId));
    }
    if (scope.moduleIds.length > 0) {
      progressConditions.push(inArray(userProgress.moduleId, scope.moduleIds));
    }
    if (scope.lessonIds.length > 0) {
      progressConditions.push(inArray(userProgress.lessonId, scope.lessonIds));
    }
    if (progressConditions.length > 0) {
      const rows = await executor
        .select({ value: userProgress.progressId })
        .from(userProgress)
        .where(or(...progressConditions))
        .limit(1);
      if (rows.length > 0) return true;
    }

    if (scope.courseId !== undefined) {
      const rows = await executor
        .select({ value: certificates.certificateId })
        .from(certificates)
        .where(eq(certificates.courseId, scope.courseId))
        .limit(1);
      if (rows.length > 0) return true;
    }

    if (scope.quizIds.length > 0) {
      const rows = await executor
        .select({ value: quizAttempts.attemptId })
        .from(quizAttempts)
        .where(inArray(quizAttempts.quizId, scope.quizIds))
        .limit(1);
      if (rows.length > 0) return true;
    }

    if (scope.labIds.length > 0) {
      const labIdList = sql.join(scope.labIds.map((labId) => sql`${labId}`), sql`, `);
      const rows = await executor
        .select({ value: activityLogs.logId })
        .from(activityLogs)
        .where(and(
          inArray(activityLogs.activityType, LAB_ACTIVITY_TYPES),
          sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.labId')) AS UNSIGNED) IN (${labIdList})`,
        ))
        .limit(1);
      if (rows.length > 0) return true;
    }

    return false;
  }

  /** Lesson, lab and quiz ids of the items in the given modules. */
  private async itemRefs(
    executor: DbOrTx,
    moduleIds: number[],
  ): Promise<{ lessonIds: number[]; labIds: number[]; quizIds: number[] }> {
    if (moduleIds.length === 0) {
      return { lessonIds: [], labIds: [], quizIds: [] };
    }
    const rows = await executor
      .select({ lessonId: lessons.lessonId, labId: lessons.labId, quizId: lessons.quizId })
      .from(lessons)
      .where(inArray(lessons.moduleId, moduleIds));
    return {
      lessonIds: rows.map((row) => row.lessonId),
      labIds: [...new Set(rows.map((row) => row.labId).filter((id): id is number => id !== null))],
      quizIds: [...new Set(rows.map((row) => row.quizId).filter((id): id is number => id !== null))],
    };
  }

  async hasCourseLearnerData(courseId: number, tx: DbOrTx = db): Promise<boolean> {
    const moduleRows = await tx
      .select({ moduleId: modules.moduleId })
      .from(modules)
      .where(eq(modules.courseId, courseId));
    const moduleIds = moduleRows.map((row) => row.moduleId);
    const refs = await this.itemRefs(tx, moduleIds);
    return this.learnerDataExists(tx, { courseId, moduleIds, ...refs });
  }

  async hasModuleLearnerData(moduleId: number, tx: DbOrTx = db): Promise<boolean> {
    const refs = await this.itemRefs(tx, [moduleId]);
    return this.learnerDataExists(tx, { moduleIds: [moduleId], ...refs });
  }

  /** Any learner row for the item. Quiz items count any `quiz_attempts` row (contracts §6.1). */
  async hasItemLearnerData(itemId: number, tx: DbOrTx = db): Promise<boolean> {
    const item = await this.findItemById(itemId, tx);
    return this.learnerDataExists(tx, {
      moduleIds: [],
      lessonIds: [itemId],
      quizIds: item?.quizId !== null && item?.quizId !== undefined ? [item.quizId] : [],
      labIds: item?.labId !== null && item?.labId !== undefined ? [item.labId] : [],
    });
  }

  async hasQuizLearnerData(quizId: number, tx: DbOrTx = db): Promise<boolean> {
    const spineRows = await tx
      .select({ lessonId: lessons.lessonId })
      .from(lessons)
      .where(eq(lessons.quizId, quizId));
    return this.learnerDataExists(tx, {
      moduleIds: [],
      lessonIds: spineRows.map((row) => row.lessonId),
      quizIds: [quizId],
      labIds: [],
    });
  }

  async hasQuestionLearnerData(questionId: number, tx: DbOrTx = db): Promise<boolean> {
    const rows = await tx
      .select({ value: userQuizAnswers.userAnswerId })
      .from(userQuizAnswers)
      .where(eq(userQuizAnswers.questionId, questionId))
      .limit(1);
    return rows.length > 0;
  }

  /* ── Tags (polymorphic via challenge_tags) ──────────────────────────── */

  async listTags(): Promise<TagDto[]> {
    const rows = await db
      .select({ tagId: tags.tagId, tagName: tags.tagName })
      .from(tags)
      .where(eq(tags.isActive, true))
      .orderBy(asc(tags.tagName));
    return rows;
  }

  async findTagsByIds(tagIds: number[]): Promise<number[]> {
    if (tagIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({ tagId: tags.tagId })
      .from(tags)
      .where(and(eq(tags.isActive, true), inArray(tags.tagId, tagIds)));
    return rows.map((row) => row.tagId);
  }

  async listLessonTags(lessonId: number, tx: DbOrTx = db): Promise<TagDto[]> {
    return tx
      .select({ tagId: tags.tagId, tagName: tags.tagName })
      .from(challengeTags)
      .innerJoin(tags, eq(tags.tagId, challengeTags.tagId))
      .where(eq(challengeTags.challengeId, lessonId))
      .orderBy(asc(tags.tagName));
  }

  async setLessonTags(lessonId: number, tagIds: number[], tx?: DbOrTx): Promise<void> {
    await inTransaction(tx, async (executor) => {
      await executor.delete(challengeTags).where(eq(challengeTags.challengeId, lessonId));
      if (tagIds.length > 0) {
        await executor.insert(challengeTags).values(tagIds.map((tagId) => ({ challengeId: lessonId, tagId })));
      }
    });
  }
}

/** Runs `work` on the caller's transaction, or opens one when none is given. */
async function inTransaction<T>(
  tx: DbOrTx | undefined,
  work: (executor: DbOrTx) => Promise<T>,
): Promise<T> {
  if (tx) {
    return work(tx);
  }
  return db.transaction((inner) => work(inner));
}

export const curriculumRepository = new CurriculumRepository();
