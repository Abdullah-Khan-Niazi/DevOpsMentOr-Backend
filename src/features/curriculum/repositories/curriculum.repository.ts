import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  categories,
  challengeTags,
  difficultyLevels,
  lessons,
  modules,
  quizAnswers,
  quizQuestions,
  quizzes,
  tags,
  users,
} from '../../../app/database/schema';
import type {
  ContentType,
  QuestionType,
  TagDto,
} from '../dto/curriculum.dto';

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
  prerequisites: string[] | null;
  learningObjectives: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModuleRow {
  moduleId: number;
  courseId: number;
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
  content: string | null;
  contentType: ContentType;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  lessonOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
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

/**
 * F4 data access layer. All published-content filters for non-admin reads are
 * applied at the SQL level (`WHERE is_published = TRUE`), never in JS.
 * The `challenge_tags.challenge_id` column holds `lessons.lesson_id` per the
 * §06 polymorphic adaptation.
 */
export class CurriculumRepository {
  /* ── Course ─────────────────────────────────────────────────────────── */

  async getCanonicalCourse(): Promise<CourseRow | null> {
    const rows = await db
      .select({
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
        prerequisites: academyCourses.prerequisites,
        learningObjectives: academyCourses.learningObjectives,
        createdAt: academyCourses.createdAt,
        updatedAt: academyCourses.updatedAt,
      })
      .from(academyCourses)
      .leftJoin(difficultyLevels, eq(difficultyLevels.difficultyId, academyCourses.difficultyId))
      .leftJoin(categories, eq(categories.categoryId, academyCourses.categoryId))
      .leftJoin(users, eq(users.userId, academyCourses.instructorId))
      .orderBy(asc(academyCourses.courseId))
      .limit(1);
    return rows[0] ?? null;
  }

  async createCourse(input: {
    title: string;
    slug: string;
    description: string | null;
    difficultyId: number;
    instructorId: number;
    estimatedHours: number;
    prerequisites: string[] | null;
    learningObjectives: string[] | null;
  }): Promise<number> {
    const inserted = await db.insert(academyCourses).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create the canonical course.');
    }
    return id;
  }

  async updateCourse(courseId: number, fields: Record<string, unknown>): Promise<void> {
    await db.update(academyCourses).set(fields).where(eq(academyCourses.courseId, courseId));
  }

  /** §06: denormalized published counts rewritten on every publish/unpublish. */
  async refreshCourseCounts(courseId: number): Promise<void> {
    const lessonRows = await db
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(lessons.isPublished, true)));
    const quizRows = await db
      .select({ value: count() })
      .from(quizzes)
      .innerJoin(modules, eq(modules.moduleId, quizzes.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(quizzes.isPublished, true)));

    await db
      .update(academyCourses)
      .set({
        totalLessons: lessonRows[0]?.value ?? 0,
        totalQuizzes: quizRows[0]?.value ?? 0,
      })
      .where(eq(academyCourses.courseId, courseId));
  }

  /* ── Modules ────────────────────────────────────────────────────────── */

  async findModuleById(moduleId: number): Promise<ModuleRow | null> {
    const rows = await db
      .select({
        moduleId: modules.moduleId,
        courseId: modules.courseId,
        title: modules.title,
        description: modules.description,
        moduleOrder: modules.moduleOrder,
        estimatedMinutes: modules.estimatedMinutes,
        isPublished: modules.isPublished,
        createdAt: modules.createdAt,
        updatedAt: modules.updatedAt,
        lessonCount: count(lessons.lessonId),
      })
      .from(modules)
      .leftJoin(lessons, eq(lessons.moduleId, modules.moduleId))
      .where(eq(modules.moduleId, moduleId))
      .groupBy(modules.moduleId)
      .limit(1);
    return rows[0] ?? null;
  }

  async listModulesAll(
    search: string | undefined,
    isPublished: boolean | undefined,
  ): Promise<ModuleRow[]> {
    const conditions = [
      ...(search ? [like(modules.title, `%${search}%`)] : []),
      ...(isPublished !== undefined ? [eq(modules.isPublished, isPublished)] : []),
    ];
    return db
      .select({
        moduleId: modules.moduleId,
        courseId: modules.courseId,
        title: modules.title,
        description: modules.description,
        moduleOrder: modules.moduleOrder,
        estimatedMinutes: modules.estimatedMinutes,
        isPublished: modules.isPublished,
        createdAt: modules.createdAt,
        updatedAt: modules.updatedAt,
        lessonCount: count(lessons.lessonId),
      })
      .from(modules)
      .leftJoin(lessons, eq(lessons.moduleId, modules.moduleId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(modules.moduleId)
      .orderBy(asc(modules.moduleOrder));
  }

  async listModulesPublished(): Promise<ModuleRow[]> {
    return db
      .select({
        moduleId: modules.moduleId,
        courseId: modules.courseId,
        title: modules.title,
        description: modules.description,
        moduleOrder: modules.moduleOrder,
        estimatedMinutes: modules.estimatedMinutes,
        isPublished: modules.isPublished,
        createdAt: modules.createdAt,
        updatedAt: modules.updatedAt,
        lessonCount: count(lessons.lessonId),
      })
      .from(modules)
      .leftJoin(lessons, and(eq(lessons.moduleId, modules.moduleId), eq(lessons.isPublished, true)))
      .where(eq(modules.isPublished, true))
      .groupBy(modules.moduleId)
      .orderBy(asc(modules.moduleOrder));
  }

  async createModule(input: {
    courseId: number;
    title: string;
    description: string | null;
    moduleOrder: number;
    estimatedMinutes: number;
  }): Promise<number> {
    const inserted = await db.insert(modules).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create module.');
    }
    return id;
  }

  async updateModule(moduleId: number, fields: Record<string, unknown>): Promise<void> {
    await db.update(modules).set(fields).where(eq(modules.moduleId, moduleId));
  }

  async setModulePublished(moduleId: number, isPublished: boolean): Promise<void> {
    await db.update(modules).set({ isPublished }).where(eq(modules.moduleId, moduleId));
  }

  async findModuleOrder(courseId: number, moduleOrder: number): Promise<number | null> {
    const rows = await db
      .select({ moduleId: modules.moduleId })
      .from(modules)
      .where(and(eq(modules.courseId, courseId), eq(modules.moduleOrder, moduleOrder)))
      .limit(1);
    return rows[0]?.moduleId ?? null;
  }

  async maxModuleOrder(courseId: number): Promise<number | null> {
    const rows = await db
      .select({ value: modules.moduleOrder })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(desc(modules.moduleOrder))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async countModulesByCourse(courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(modules)
      .where(eq(modules.courseId, courseId));
    return rows[0]?.value ?? 0;
  }

  /** Invariant 2: transactional bulk order update for module reorder. */
  async bulkUpdateModuleOrders(entries: Array<{ moduleId: number; moduleOrder: number }>): Promise<void> {
    await db.transaction(async (tx) => {
      for (const entry of entries) {
        await tx
          .update(modules)
          .set({ moduleOrder: entry.moduleOrder })
          .where(eq(modules.moduleId, entry.moduleId));
      }
    });
  }

  /* ── Lessons ────────────────────────────────────────────────────────── */

  async findLessonById(lessonId: number): Promise<LessonRow | null> {
    const rows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.lessonId, lessonId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listLessonsByModule(moduleId: number): Promise<LessonRow[]> {
    return db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.lessonOrder));
  }

  async listPublishedLessonsByModule(moduleId: number): Promise<LessonRow[]> {
    return db
      .select()
      .from(lessons)
      .where(and(eq(lessons.moduleId, moduleId), eq(lessons.isPublished, true)))
      .orderBy(asc(lessons.lessonOrder));
  }

  async createLesson(input: {
    moduleId: number;
    title: string;
    content: string | null;
    contentType: ContentType;
    videoUrl: string | null;
    videoDurationSeconds: number | null;
    lessonOrder: number;
  }): Promise<number> {
    const inserted = await db.insert(lessons).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create lesson.');
    }
    return id;
  }

  async updateLesson(lessonId: number, fields: Record<string, unknown>): Promise<void> {
    await db.update(lessons).set(fields).where(eq(lessons.lessonId, lessonId));
  }

  async setLessonPublished(lessonId: number, isPublished: boolean): Promise<void> {
    await db.update(lessons).set({ isPublished }).where(eq(lessons.lessonId, lessonId));
  }

  async findLessonOrder(moduleId: number, lessonOrder: number): Promise<number | null> {
    const rows = await db
      .select({ lessonId: lessons.lessonId })
      .from(lessons)
      .where(and(eq(lessons.moduleId, moduleId), eq(lessons.lessonOrder, lessonOrder)))
      .limit(1);
    return rows[0]?.lessonId ?? null;
  }

  async maxLessonOrder(moduleId: number): Promise<number | null> {
    const rows = await db
      .select({ value: lessons.lessonOrder })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(desc(lessons.lessonOrder))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  /** Invariant 3: transactional bulk order update for lesson reorder. */
  async bulkUpdateLessonOrders(
    moduleId: number,
    entries: Array<{ lessonId: number; lessonOrder: number }>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      for (const entry of entries) {
        await tx
          .update(lessons)
          .set({ lessonOrder: entry.lessonOrder })
          .where(and(eq(lessons.lessonId, entry.lessonId), eq(lessons.moduleId, moduleId)));
      }
    });
  }

  /** Invariant 5 / AC-03: archive cascade. Unpublishes a module and all of
   * its lessons and quizzes in ONE atomic transaction, so a mid-way failure
   * can never leave children published while the parent is archived. */
  async archiveModuleCascade(moduleId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(modules)
        .set({ isPublished: false })
        .where(eq(modules.moduleId, moduleId));
      await tx
        .update(lessons)
        .set({ isPublished: false })
        .where(and(eq(lessons.moduleId, moduleId), eq(lessons.isPublished, true)));
      await tx
        .update(quizzes)
        .set({ isPublished: false })
        .where(and(eq(quizzes.moduleId, moduleId), eq(quizzes.isPublished, true)));
    });
  }

  /* ── Quizzes ────────────────────────────────────────────────────────── */

  async findQuizById(quizId: number): Promise<QuizRow | null> {
    const rows = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.quizId, quizId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listQuizzesByModule(moduleId: number): Promise<QuizRow[]> {
    return db
      .select()
      .from(quizzes)
      .where(eq(quizzes.moduleId, moduleId))
      .orderBy(asc(quizzes.quizId));
  }

  async listPublishedQuizzesByModule(moduleId: number): Promise<QuizRow[]> {
    return db
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
  }): Promise<number> {
    const inserted = await db.insert(quizzes).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create quiz.');
    }
    return id;
  }

  async updateQuiz(quizId: number, fields: Record<string, unknown>): Promise<void> {
    await db.update(quizzes).set(fields).where(eq(quizzes.quizId, quizId));
  }

  async setQuizPublished(quizId: number, isPublished: boolean): Promise<void> {
    await db.update(quizzes).set({ isPublished }).where(eq(quizzes.quizId, quizId));
  }

  async countQuestionsByQuiz(quizId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.isActive, true)));
    return rows[0]?.value ?? 0;
  }

  /* ── Questions & answers ────────────────────────────────────────────── */

  async findQuestionById(questionId: number): Promise<QuestionRow | null> {
    const rows = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.questionId, questionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listQuestionsByQuiz(quizId: number, includeInactive: boolean): Promise<QuestionRow[]> {
    return db
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
    points: number;
    explanation: string | null;
    questionOrder: number;
  }): Promise<number> {
    const inserted = await db.insert(quizQuestions).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create question.');
    }
    return id;
  }

  async updateQuestion(questionId: number, fields: Record<string, unknown>): Promise<void> {
    await db.update(quizQuestions).set(fields).where(eq(quizQuestions.questionId, questionId));
  }

  async listAnswersByQuestion(questionId: number): Promise<AnswerRow[]> {
    return db
      .select()
      .from(quizAnswers)
      .where(eq(quizAnswers.questionId, questionId))
      .orderBy(asc(quizAnswers.answerOrder));
  }

  /** Answers are replaced wholesale on question update (invariant 6 re-check). */
  async replaceAnswers(
    questionId: number,
    answers: Array<{ answerText: string; isCorrect: boolean; answerOrder: number }>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(quizAnswers).where(eq(quizAnswers.questionId, questionId));
      if (answers.length > 0) {
        await tx.insert(quizAnswers).values(answers.map((answer) => ({ ...answer, questionId })));
      }
    });
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

  async listLessonTags(lessonId: number): Promise<TagDto[]> {
    return db
      .select({ tagId: tags.tagId, tagName: tags.tagName })
      .from(challengeTags)
      .innerJoin(tags, eq(tags.tagId, challengeTags.tagId))
      .where(eq(challengeTags.challengeId, lessonId))
      .orderBy(asc(tags.tagName));
  }

  async setLessonTags(lessonId: number, tagIds: number[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(challengeTags).where(eq(challengeTags.challengeId, lessonId));
      if (tagIds.length > 0) {
        await tx.insert(challengeTags).values(tagIds.map((tagId) => ({ challengeId: lessonId, tagId })));
      }
    });
  }
}

export const curriculumRepository = new CurriculumRepository();
