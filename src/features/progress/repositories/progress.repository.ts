import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  activityLogs,
  classAssignments,
  labs,
  lessons,
  modules,
  proLabs,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  teamMembers,
  teams,
  trackContent,
  tracks,
  userProgress,
  userQuizAnswers,
  users,
} from '../../../app/database/schema';
import type { LearningActivityType, ModuleItemKind } from '../dto/progress.dto';

/** Transaction handle (same alias as the gamification repositories). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Query-capable handle: the global `db` or the transaction that holds the user lock. */
export type ProgressExecutor = typeof db | Tx;

/** Lesson-grain user_progress row (plus course/module context). */
export interface LessonProgressRow {
  progressId: number;
  userId: number;
  courseId: number | null;
  moduleId: number | null;
  lessonId: number | null;
  progressPercentage: string;
  isCompleted: boolean;
  completedAt: Date | null;
  lastAccessedAt: Date;
  timeSpentSeconds: number;
}

/** Grain identity of a user_progress row (`lessonId` null = module or course grain). */
export interface ProgressGrain {
  courseId: number;
  moduleId: number | null;
  lessonId: number | null;
}

/** A published module item (lesson, lab or quiz) of the spine, with its module/course context. */
export interface PublishedItemRow {
  itemId: number;
  moduleId: number;
  courseId: number;
  title: string;
  kind: ModuleItemKind;
  position: number;
  labId: number | null;
  quizId: number | null;
  moduleTitle: string;
  moduleOrder: number;
  courseTitle: string;
}

/** Continue-learning row: last-accessed lesson-grain row of a visible item. */
export interface ContinueLearningRow extends PublishedItemRow {
  lastAccessedAt: Date;
}

/** Published module with its visible item count (for progress aggregation). */
export interface PublishedModuleRow {
  moduleId: number;
  title: string;
  moduleOrder: number;
  itemCount: number;
}

/** Course option for staff views and quiz/lab lookups. */
export interface CourseOptionRow {
  courseId: number;
  title: string;
  lastAccessedAt: Date | null;
}

/** Quiz attempt aggregates of one learner (module item progress). */
export interface QuizAttemptStatsRow {
  isPassed: boolean;
  bestScore: number | null;
  attemptsUsedToday: number;
}

/** Class student row (team_members join users). */
export interface ClassStudentRow {
  userId: number;
  fullName: string | null;
  email: string;
  joinedAt: Date;
}

/** Quiz question joined with its answer options (admin visibility). */
export interface QuestionWithAnswersRow {
  questionId: number;
  questionText: string;
  questionType: string;
  config: Record<string, unknown> | null;
  points: number;
  explanation: string | null;
  questionOrder: number;
  answers: Array<{
    answerId: number;
    answerText: string;
    isCorrect: boolean;
    answerOrder: number;
  }>;
}

/** Attempt insert input assembled by QuizAttemptService. */
export interface AttemptAnswerInput {
  questionId: number;
  answerId: number | null;
  answerText: string | null;
  isCorrect: boolean;
  pointsEarned: number;
}

export interface AttemptInsertInput {
  userId: number;
  quizId: number;
  score: number;
  isPassed: boolean;
  attemptNumber: number;
  timeTakenSeconds: number;
  answers: AttemptAnswerInput[];
}

const PROFESSOR_ROLES = ['captain', 'co_captain'] as const;
const LAST_24_HOURS_SQL = sql`DATE_SUB(NOW(), INTERVAL 24 HOUR)`;

/**
 * Visibility rule of a module item (contracts 4.2): a published spine row whose
 * module and course are published; lab items also need an active lab with a
 * lab_id; quiz items need a published quiz. Every item count, list and
 * completion rollup goes through this predicate, so unpublished or orphaned
 * rows never count (D16).
 */
function visibleItemCondition() {
  return and(
    eq(lessons.isPublished, true),
    eq(modules.isPublished, true),
    eq(academyCourses.isPublished, true),
    or(
      inArray(lessons.contentType, ['text', 'video', 'interactive']),
      and(eq(lessons.contentType, 'lab'), isNotNull(lessons.labId), eq(labs.isActive, true)),
      and(eq(lessons.contentType, 'quiz'), isNotNull(lessons.quizId), eq(quizzes.isPublished, true)),
    ),
  );
}

const itemColumns = {
  itemId: lessons.lessonId,
  moduleId: lessons.moduleId,
  courseId: modules.courseId,
  title: lessons.title,
  contentType: lessons.contentType,
  position: lessons.lessonOrder,
  labId: lessons.labId,
  quizId: lessons.quizId,
  moduleTitle: modules.title,
  moduleOrder: modules.moduleOrder,
  courseTitle: academyCourses.title,
} as const;

type ItemSelectRow = {
  itemId: number;
  moduleId: number;
  courseId: number;
  title: string;
  contentType: 'text' | 'video' | 'interactive' | 'lab' | 'quiz';
  position: number;
  labId: number | null;
  quizId: number | null;
  moduleTitle: string;
  moduleOrder: number;
  courseTitle: string;
};

function kindOf(contentType: ItemSelectRow['contentType']): ModuleItemKind {
  if (contentType === 'lab') return 'lab';
  if (contentType === 'quiz') return 'quiz';
  return 'lesson';
}

function toItem(row: ItemSelectRow): PublishedItemRow {
  return {
    itemId: row.itemId,
    moduleId: row.moduleId,
    courseId: row.courseId,
    title: row.title,
    kind: kindOf(row.contentType),
    position: row.position,
    labId: row.labId,
    quizId: row.quizId,
    moduleTitle: row.moduleTitle,
    moduleOrder: row.moduleOrder,
    courseTitle: row.courseTitle,
  };
}

/**
 * F5 data access layer for progress. Learner isolation filters (`user_id = :userId`)
 * are applied in SQL. Writers take an optional `tx`: while `awardService.withUserLock`
 * holds the user row, every write MUST go through that tx (contracts 0.3).
 * Class and org scopes come from `team_members` / `teams` / `class_assignments`;
 * org membership is resolved by `membershipRepository` in the service layer (D15).
 */
export class ProgressRepository {
  /* ── Published item spine ───────────────────────────────────────────── */

  /** One visible module item by lesson id (null when unpublished, orphaned or unknown). */
  async findPublishedItem(lessonId: number, executor: ProgressExecutor = db): Promise<PublishedItemRow | null> {
    const rows = await executor
      .select(itemColumns)
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(lessons.lessonId, lessonId), visibleItemCondition()))
      .limit(1);
    return rows[0] ? toItem(rows[0]) : null;
  }

  /** Visible items of one module, in spine order. */
  async listPublishedItemsByModule(moduleId: number, executor: ProgressExecutor = db): Promise<PublishedItemRow[]> {
    const rows = await executor
      .select(itemColumns)
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(lessons.moduleId, moduleId), visibleItemCondition()))
      .orderBy(asc(lessons.lessonOrder));
    return rows.map(toItem);
  }

  /** Visible lesson-spine rows that point at a lab (lab completion rollup). */
  async listPublishedItemsByLab(labId: number, executor: ProgressExecutor = db): Promise<PublishedItemRow[]> {
    const rows = await executor
      .select(itemColumns)
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(lessons.labId, labId), visibleItemCondition()))
      .orderBy(asc(lessons.lessonId));
    return rows.map(toItem);
  }

  /** Visible lesson-spine rows that point at a quiz (quiz pass rollup). */
  async listPublishedItemsByQuiz(quizId: number, executor: ProgressExecutor = db): Promise<PublishedItemRow[]> {
    const rows = await executor
      .select(itemColumns)
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(lessons.quizId, quizId), visibleItemCondition()))
      .orderBy(asc(lessons.lessonId));
    return rows.map(toItem);
  }

  /** Visible item count of one course (all kinds). */
  async countPublishedItemsByCourse(courseId: number, executor: ProgressExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(modules.courseId, courseId), visibleItemCondition()));
    return rows[0]?.value ?? 0;
  }

  /** Visible item count of one module (all kinds). */
  async countPublishedItemsByModule(moduleId: number, executor: ProgressExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(lessons.moduleId, moduleId), visibleItemCondition()));
    return rows[0]?.value ?? 0;
  }

  /** Published module of a published course (null otherwise). */
  async findPublishedModule(
    moduleId: number,
  ): Promise<{ moduleId: number; courseId: number; title: string; moduleOrder: number; courseTitle: string } | null> {
    const rows = await db
      .select({
        moduleId: modules.moduleId,
        courseId: modules.courseId,
        title: modules.title,
        moduleOrder: modules.moduleOrder,
        courseTitle: academyCourses.title,
      })
      .from(modules)
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .where(and(eq(modules.moduleId, moduleId), eq(modules.isPublished, true), eq(academyCourses.isPublished, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Published course id/title (null when unpublished or unknown). */
  async findPublishedCourse(
    courseId: number,
    executor: ProgressExecutor = db,
  ): Promise<{ courseId: number; title: string } | null> {
    const rows = await executor
      .select({ courseId: academyCourses.courseId, title: academyCourses.title })
      .from(academyCourses)
      .where(and(eq(academyCourses.courseId, courseId), eq(academyCourses.isPublished, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Published modules of a course with their visible item counts, in module order. */
  async listPublishedModulesByCourse(courseId: number, executor: ProgressExecutor = db): Promise<PublishedModuleRow[]> {
    const [moduleRows, countRows] = await Promise.all([
      executor
        .select({ moduleId: modules.moduleId, title: modules.title, moduleOrder: modules.moduleOrder })
        .from(modules)
        .where(and(eq(modules.courseId, courseId), eq(modules.isPublished, true)))
        .orderBy(asc(modules.moduleOrder)),
      executor
        .select({ moduleId: lessons.moduleId, value: count() })
        .from(lessons)
        .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
        .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
        .leftJoin(labs, eq(labs.labId, lessons.labId))
        .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
        .where(and(eq(modules.courseId, courseId), visibleItemCondition()))
        .groupBy(lessons.moduleId),
    ]);
    const counts = new Map(countRows.map((row) => [row.moduleId, row.value]));
    return moduleRows.map((row) => ({
      moduleId: row.moduleId,
      title: row.title,
      moduleOrder: row.moduleOrder,
      itemCount: counts.get(row.moduleId) ?? 0,
    }));
  }

  /** Distinct course ids of the given lesson-spine rows (post-commit cache invalidation). */
  async listCourseIdsOfLessons(lessonIds: number[]): Promise<number[]> {
    if (lessonIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({ courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(inArray(lessons.lessonId, lessonIds));
    return [...new Set(rows.map((row) => row.courseId))];
  }

  /* ── Learner progress rows ──────────────────────────────────────────── */

  async findLessonProgress(
    userId: number,
    lessonId: number,
    executor: ProgressExecutor = db,
  ): Promise<LessonProgressRow | null> {
    const rows = await executor
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, lessonId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Lesson-grain rows of a user for a set of lesson ids, keyed by lesson id. */
  async listLessonProgressByLessonIds(
    userId: number,
    lessonIds: number[],
    executor: ProgressExecutor = db,
  ): Promise<Map<number, LessonProgressRow>> {
    if (lessonIds.length === 0) {
      return new Map();
    }
    const rows = await executor
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), inArray(userProgress.lessonId, lessonIds)));
    return new Map(rows.map((row) => [row.lessonId as number, row]));
  }

  /**
   * Idempotent lesson start under the user lock: refresh `last_accessed_at` of
   * the existing row (created = false) or insert an IN_PROGRESS row. The caller
   * MUST hold the user lock (tx from withUserLock).
   */
  async touchLessonProgress(
    tx: ProgressExecutor,
    userId: number,
    input: { courseId: number; moduleId: number; lessonId: number },
  ): Promise<{ row: LessonProgressRow; created: boolean }> {
    const existing = await tx
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, input.lessonId)))
      .limit(1)
      .for('update');
    if (existing[0]) {
      const updatedAt = new Date();
      await tx
        .update(userProgress)
        .set({ lastAccessedAt: updatedAt })
        .where(eq(userProgress.progressId, existing[0].progressId));
      return { row: { ...existing[0], lastAccessedAt: updatedAt }, created: false };
    }
    const inserted = await tx.insert(userProgress).values({
      userId,
      courseId: input.courseId,
      moduleId: input.moduleId,
      lessonId: input.lessonId,
      progressPercentage: '0',
      isCompleted: false,
    });
    const rows = await tx
      .select()
      .from(userProgress)
      .where(eq(userProgress.progressId, inserted[0].insertId))
      .limit(1);
    return { row: rows[0], created: true };
  }

  /**
   * Marks the lesson-grain row complete (inserting it when missing) and adds
   * the time spent. `wasCompleted` reports the state before this call. The
   * caller MUST hold the user lock.
   */
  async markLessonCompleted(
    tx: ProgressExecutor,
    userId: number,
    input: { courseId: number; moduleId: number; lessonId: number; timeSpentSeconds: number },
  ): Promise<{ row: LessonProgressRow; wasCompleted: boolean }> {
    const now = new Date();
    const existing = await tx
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, input.lessonId)))
      .limit(1)
      .for('update');
    if (existing[0]) {
      const completedAt = existing[0].completedAt ?? now;
      const timeSpentSeconds = existing[0].timeSpentSeconds + input.timeSpentSeconds;
      await tx
        .update(userProgress)
        .set({
          progressPercentage: '100',
          isCompleted: true,
          completedAt,
          lastAccessedAt: now,
          timeSpentSeconds,
        })
        .where(eq(userProgress.progressId, existing[0].progressId));
      return {
        row: {
          ...existing[0],
          progressPercentage: '100',
          isCompleted: true,
          completedAt,
          lastAccessedAt: now,
          timeSpentSeconds,
        },
        wasCompleted: existing[0].isCompleted,
      };
    }
    const inserted = await tx.insert(userProgress).values({
      userId,
      courseId: input.courseId,
      moduleId: input.moduleId,
      lessonId: input.lessonId,
      progressPercentage: '100',
      isCompleted: true,
      completedAt: now,
      lastAccessedAt: now,
      timeSpentSeconds: input.timeSpentSeconds,
    });
    const rows = await tx
      .select()
      .from(userProgress)
      .where(eq(userProgress.progressId, inserted[0].insertId))
      .limit(1);
    return { row: rows[0], wasCompleted: false };
  }

  /** Grain row (course, module or lesson grain) of a user. */
  async findGrainRow(
    userId: number,
    grain: ProgressGrain,
    executor: ProgressExecutor = db,
  ): Promise<LessonProgressRow | null> {
    const rows = await executor
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), grainCondition(grain)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Marks a module or course grain row complete (check-then-insert under the
   * user lock). Returns true when the grain was not completed before this call.
   */
  async markGrainCompleted(tx: ProgressExecutor, userId: number, grain: ProgressGrain): Promise<boolean> {
    const existing = await tx
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), grainCondition(grain)))
      .limit(1)
      .for('update');
    if (existing[0]) {
      if (existing[0].isCompleted) {
        return false;
      }
      await tx
        .update(userProgress)
        .set({ isCompleted: true, progressPercentage: '100', completedAt: new Date() })
        .where(eq(userProgress.progressId, existing[0].progressId));
      return true;
    }
    await tx.insert(userProgress).values({
      userId,
      courseId: grain.courseId,
      moduleId: grain.moduleId,
      lessonId: grain.lessonId,
      progressPercentage: '100',
      isCompleted: true,
      completedAt: new Date(),
    });
    return true;
  }

  /**
   * Active tracks that list `courseId` as a required course, whose every required
   * course the user has completed (course-grain row), and for which no
   * TRACK_COMPLETED event exists yet. Runs inside the caller's transaction (user lock held).
   */
  async listNewlyCompletedTracksForCourse(
    tx: ProgressExecutor,
    userId: number,
    courseId: number,
  ): Promise<Array<{ trackId: number; trackName: string }>> {
    const candidates = await tx
      .select({ trackId: tracks.trackId, trackName: tracks.trackName })
      .from(trackContent)
      .innerJoin(tracks, eq(tracks.trackId, trackContent.trackId))
      .where(
        and(
          eq(trackContent.contentType, 'course'),
          eq(trackContent.contentId, courseId),
          eq(trackContent.required, true),
          eq(tracks.isActive, true),
        ),
      );
    const completedTracks: Array<{ trackId: number; trackName: string }> = [];
    for (const track of candidates) {
      const required = await tx
        .select({ courseId: trackContent.contentId })
        .from(trackContent)
        .where(
          and(
            eq(trackContent.trackId, track.trackId),
            eq(trackContent.contentType, 'course'),
            eq(trackContent.required, true),
          ),
        );
      const requiredIds = required.map((row) => row.courseId);
      const done = await tx
        .select({ courseId: userProgress.courseId })
        .from(userProgress)
        .where(
          and(
            eq(userProgress.userId, userId),
            inArray(userProgress.courseId, requiredIds),
            isNull(userProgress.moduleId),
            isNull(userProgress.lessonId),
            eq(userProgress.isCompleted, true),
          ),
        );
      if (new Set(done.map((row) => row.courseId)).size < new Set(requiredIds).size) {
        continue;
      }
      const existing = await tx
        .select({ id: activityLogs.logId })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.userId, userId),
            eq(activityLogs.activityType, 'TRACK_COMPLETED'),
            sql`json_extract(${activityLogs.details}, '$.trackId') = ${track.trackId}`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        completedTracks.push(track);
      }
    }
    return completedTracks;
  }

  /** Completed visible items of one course for one user (all kinds). */
  async countCompletedItemsByCourse(
    userId: number,
    courseId: number,
    executor: ProgressExecutor = db,
  ): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(
        eq(userProgress.userId, userId),
        eq(modules.courseId, courseId),
        eq(userProgress.isCompleted, true),
        visibleItemCondition(),
      ));
    return rows[0]?.value ?? 0;
  }

  /** Completed visible items per module for one user, keyed by module id. */
  async countCompletedItemsByModule(
    userId: number,
    courseId: number,
    executor: ProgressExecutor = db,
  ): Promise<Map<number, number>> {
    const rows = await executor
      .select({ moduleId: lessons.moduleId, value: count() })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(
        eq(userProgress.userId, userId),
        eq(modules.courseId, courseId),
        eq(userProgress.isCompleted, true),
        visibleItemCondition(),
      ))
      .groupBy(lessons.moduleId);
    return new Map(rows.map((row) => [row.moduleId, row.value]));
  }

  /** Completed visible items per module across many users (class averages). */
  async countCompletedItemsByModuleForUsers(userIds: number[], courseId: number): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ moduleId: lessons.moduleId, value: count() })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(
        inArray(userProgress.userId, userIds),
        eq(modules.courseId, courseId),
        eq(userProgress.isCompleted, true),
        visibleItemCondition(),
      ))
      .groupBy(lessons.moduleId);
    return new Map(rows.map((row) => [row.moduleId, row.value]));
  }

  /** Completed module-grain rows of published modules of a course for one user. */
  async countCompletedModules(userId: number, courseId: number, executor: ProgressExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(userProgress)
      .innerJoin(modules, eq(modules.moduleId, userProgress.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .where(and(
        eq(userProgress.userId, userId),
        eq(modules.courseId, courseId),
        eq(modules.isPublished, true),
        eq(academyCourses.isPublished, true),
        isNull(userProgress.lessonId),
        isNotNull(userProgress.moduleId),
        eq(userProgress.isCompleted, true),
      ));
    return rows[0]?.value ?? 0;
  }

  /** Completed module-grain rows per user across many users (class/org tables). */
  async countCompletedModulesForUsers(userIds: number[], courseId: number): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ userId: userProgress.userId, value: count() })
      .from(userProgress)
      .innerJoin(modules, eq(modules.moduleId, userProgress.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .where(and(
        inArray(userProgress.userId, userIds),
        eq(modules.courseId, courseId),
        eq(modules.isPublished, true),
        eq(academyCourses.isPublished, true),
        isNull(userProgress.lessonId),
        isNotNull(userProgress.moduleId),
        eq(userProgress.isCompleted, true),
      ))
      .groupBy(userProgress.userId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  /** Completed visible items per user across many users (class/org tables). */
  async countCompletedItemsForUsers(userIds: number[], courseId: number): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ userId: userProgress.userId, value: count() })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(
        inArray(userProgress.userId, userIds),
        eq(modules.courseId, courseId),
        eq(userProgress.isCompleted, true),
        visibleItemCondition(),
      ))
      .groupBy(userProgress.userId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  /** Last access per user across many users (class/org tables). */
  async lastAccessForUsers(userIds: number[]): Promise<Map<number, Date>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ userId: userProgress.userId, value: max(userProgress.lastAccessedAt) })
      .from(userProgress)
      .where(inArray(userProgress.userId, userIds))
      .groupBy(userProgress.userId);
    const lastActive = new Map<number, Date>();
    for (const row of rows) {
      if (row.value) {
        lastActive.set(row.userId, row.value);
      }
    }
    return lastActive;
  }

  /** Courses a user has started (any progress row), published only, most recent first. */
  async listStartedCourses(userId: number, executor: ProgressExecutor = db): Promise<CourseOptionRow[]> {
    const rows = await executor
      .select({
        courseId: academyCourses.courseId,
        title: academyCourses.title,
        lastAccessedAt: max(userProgress.lastAccessedAt),
      })
      .from(userProgress)
      .innerJoin(academyCourses, eq(academyCourses.courseId, userProgress.courseId))
      .where(and(eq(userProgress.userId, userId), eq(academyCourses.isPublished, true)))
      .groupBy(academyCourses.courseId, academyCourses.title)
      .orderBy(desc(max(userProgress.lastAccessedAt)));
    return rows.map((row) => ({ courseId: row.courseId, title: row.title, lastAccessedAt: row.lastAccessedAt ?? null }));
  }

  /* ── Continue-learning ──────────────────────────────────────────────── */

  /** Most recently accessed lesson-grain row of a visible item. */
  async getContinueLearningRow(userId: number, executor: ProgressExecutor = db): Promise<ContinueLearningRow | null> {
    const rows = await executor
      .select({
        ...itemColumns,
        lastAccessedAt: userProgress.lastAccessedAt,
      })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
      .leftJoin(labs, eq(labs.labId, lessons.labId))
      .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
      .where(and(eq(userProgress.userId, userId), isNotNull(userProgress.lessonId), visibleItemCondition()))
      .orderBy(desc(userProgress.lastAccessedAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { ...toItem(row), lastAccessedAt: row.lastAccessedAt };
  }

  /* ── Activity ───────────────────────────────────────────────────────── */

  async recordActivity(
    userId: number,
    activityType: LearningActivityType,
    details: Record<string, unknown> | null,
    executor: ProgressExecutor = db,
  ): Promise<void> {
    await executor.insert(activityLogs).values({ userId, activityType, details });
  }

  async listActivity(userId: number, limit: number): Promise<Array<{
    logId: number;
    activityType: string;
    details: Record<string, unknown> | null;
    createdAt: Date;
  }>> {
    return db
      .select({ logId: activityLogs.logId, activityType: activityLogs.activityType, details: activityLogs.details, createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async listUserActivityDates(userId: number, sinceDays = 400): Promise<string[]> {
    const rows = await db
      .select({ day: sql<string>`DATE_FORMAT(${activityLogs.createdAt}, '%Y-%m-%d')` })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        sql`${activityLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sinceDays} DAY)`,
      ))
      .groupBy(sql.raw('DATE_FORMAT(created_at, \'%Y-%m-%d\')'));
    return rows.map((row) => row.day);
  }

  async listUsersActivityDates(userIds: number[], sinceDays = 400): Promise<Map<number, string[]>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({
        userId: activityLogs.userId,
        day: sql<string>`DATE_FORMAT(${activityLogs.createdAt}, '%Y-%m-%d')`,
      })
      .from(activityLogs)
      .where(and(
        inArray(activityLogs.userId, userIds),
        sql`${activityLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sinceDays} DAY)`,
      ))
      .groupBy(activityLogs.userId, sql.raw('DATE_FORMAT(created_at, \'%Y-%m-%d\')'));
    const grouped = new Map<number, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.userId) ?? [];
      list.push(row.day);
      grouped.set(row.userId, list);
    }
    return grouped;
  }

  async countLabCompletedEvents(userIds: number[]): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ userId: activityLogs.userId, value: count() })
      .from(activityLogs)
      .where(and(inArray(activityLogs.userId, userIds), eq(activityLogs.activityType, 'LAB_COMPLETED')))
      .groupBy(activityLogs.userId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  async countLabCompletedEventsForUser(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(activityLogs)
      .where(and(eq(activityLogs.userId, userId), eq(activityLogs.activityType, 'LAB_COMPLETED')));
    return rows[0]?.value ?? 0;
  }

  /** True when the learner has a LAB_COMPLETED event for this lab (lab completion gate). */
  async hasLabCompletedEvent(userId: number, labId: number, executor: ProgressExecutor = db): Promise<boolean> {
    const rows = await executor
      .select({ logId: activityLogs.logId })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        eq(activityLogs.activityType, 'LAB_COMPLETED'),
        sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.labId')) AS SIGNED) = ${labId}`,
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** Distinct passed steps per lab for one learner (LAB_STEP_PASSED events). */
  async countPassedLabSteps(userId: number, labIds: number[]): Promise<Map<number, number>> {
    if (labIds.length === 0) {
      return new Map();
    }
    const labIdExpr = sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.labId')) AS SIGNED)`;
    const rows = await db
      .select({
        labId: sql<number>`${labIdExpr}`,
        value: sql<number>`COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.stepId')))`,
      })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        eq(activityLogs.activityType, 'LAB_STEP_PASSED'),
        sql`${labIdExpr} IN (${sql.join(labIds.map((id) => sql`${id}`), sql`, `)})`,
      ))
      .groupBy(sql`${labIdExpr}`);
    return new Map(rows.map((row) => [Number(row.labId), Number(row.value)]));
  }

  async lastActivityDate(userId: number): Promise<Date | null> {
    const rows = await db
      .select({ value: max(activityLogs.createdAt) })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId));
    return rows[0]?.value ?? null;
  }

  /* ── Quiz attempts ──────────────────────────────────────────────────── */

  async countQuizAttempts(userId: number, quizId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId)));
    return rows[0]?.value ?? 0;
  }

  async countPassedQuizAttempts(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.isPassed, true)));
    return rows[0]?.value ?? 0;
  }

  /** Pass state, best completed score and attempts started in the last 24 h, per quiz. */
  async quizAttemptStats(
    userId: number,
    quizIds: number[],
    executor: ProgressExecutor = db,
  ): Promise<Map<number, QuizAttemptStatsRow>> {
    if (quizIds.length === 0) {
      return new Map();
    }
    const rows = await executor
      .select({
        quizId: quizAttempts.quizId,
        passed: sql<number>`CAST(MAX(${quizAttempts.isPassed}) AS SIGNED)`,
        bestScore: sql<number | null>`MAX(CASE WHEN ${quizAttempts.completedAt} IS NOT NULL THEN ${quizAttempts.score} END)`,
        attemptsUsedToday: sql<number>`CAST(SUM(CASE WHEN ${quizAttempts.startedAt} >= ${LAST_24_HOURS_SQL} THEN 1 ELSE 0 END) AS SIGNED)`,
      })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, userId), inArray(quizAttempts.quizId, quizIds)))
      .groupBy(quizAttempts.quizId);
    return new Map(rows.map((row) => [row.quizId, {
      isPassed: Number(row.passed) === 1,
      bestScore: row.bestScore === null || row.bestScore === undefined ? null : Number(row.bestScore),
      attemptsUsedToday: Number(row.attemptsUsedToday),
    }]));
  }

  /** Attempts of this learner on this quiz started in the last 24 h (daily cap). */
  async countAttemptsStartedSince(
    userId: number,
    quizId: number,
    executor: ProgressExecutor = db,
  ): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(quizAttempts)
      .where(and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.quizId, quizId),
        sql`${quizAttempts.startedAt} >= ${LAST_24_HOURS_SQL}`,
      ));
    return rows[0]?.value ?? 0;
  }

  /** True when the learner has a passed attempt for this quiz. */
  async hasPassedQuizAttempt(userId: number, quizId: number, executor: ProgressExecutor = db): Promise<boolean> {
    const rows = await executor
      .select({ attemptId: quizAttempts.attemptId })
      .from(quizAttempts)
      .where(and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.quizId, quizId),
        eq(quizAttempts.isPassed, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** Atomic attempt + answer persistence. Runs in `tx` when given (caller holds the user lock), else in its own transaction. */
  async insertAttemptWithAnswers(input: AttemptInsertInput, tx?: ProgressExecutor): Promise<number> {
    const run = async (handle: ProgressExecutor): Promise<number> => {
      const now = new Date();
      const inserted = await handle.insert(quizAttempts).values({
        userId: input.userId,
        quizId: input.quizId,
        score: input.score,
        isPassed: input.isPassed,
        attemptNumber: input.attemptNumber,
        startedAt: now,
        completedAt: now,
        timeTakenSeconds: input.timeTakenSeconds,
      });
      const attemptId = inserted[0].insertId;
      if (input.answers.length > 0) {
        await handle.insert(userQuizAnswers).values(
          input.answers.map((answer) => ({
            attemptId,
            questionId: answer.questionId,
            answerId: answer.answerId,
            answerText: answer.answerText,
            isCorrect: answer.isCorrect,
            pointsEarned: answer.pointsEarned,
          })),
        );
      }
      return attemptId;
    };
    return tx ? run(tx) : db.transaction(run);
  }

  async listQuizAttemptsByQuiz(userId: number, quizId: number): Promise<Array<{
    attemptId: number;
    score: number;
    isPassed: boolean;
    attemptNumber: number;
    startedAt: Date;
    completedAt: Date | null;
    timeTakenSeconds: number | null;
  }>> {
    return db
      .select({
        attemptId: quizAttempts.attemptId,
        score: quizAttempts.score,
        isPassed: quizAttempts.isPassed,
        attemptNumber: quizAttempts.attemptNumber,
        startedAt: quizAttempts.startedAt,
        completedAt: quizAttempts.completedAt,
        timeTakenSeconds: quizAttempts.timeTakenSeconds,
      })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId)))
      .orderBy(desc(quizAttempts.attemptId));
  }

  async listQuizAttempts(userId: number): Promise<Array<{
    attemptId: number;
    quizId: number;
    score: number;
    isPassed: boolean;
    attemptNumber: number;
    startedAt: Date;
    completedAt: Date | null;
    timeTakenSeconds: number | null;
  }>> {
    return db
      .select({
        attemptId: quizAttempts.attemptId,
        quizId: quizAttempts.quizId,
        score: quizAttempts.score,
        isPassed: quizAttempts.isPassed,
        attemptNumber: quizAttempts.attemptNumber,
        startedAt: quizAttempts.startedAt,
        completedAt: quizAttempts.completedAt,
        timeTakenSeconds: quizAttempts.timeTakenSeconds,
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.userId, userId))
      .orderBy(desc(quizAttempts.attemptId));
  }

  /** Learner-safe quiz metadata for the quiz shell (SCR-F5-02 header). */
  async findQuizMeta(quizId: number): Promise<{
    quizId: number;
    moduleId: number;
    title: string;
    passingScore: number;
    timeLimitMinutes: number | null;
  } | null> {
    const rows = await db
      .select({
        quizId: quizzes.quizId,
        moduleId: quizzes.moduleId,
        title: quizzes.title,
        passingScore: quizzes.passingScore,
        timeLimitMinutes: quizzes.timeLimitMinutes,
      })
      .from(quizzes)
      .where(and(eq(quizzes.quizId, quizId), eq(quizzes.isPublished, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active quiz questions with their answer options (used for scoring). */
  async listQuizQuestionsWithAnswers(quizId: number): Promise<QuestionWithAnswersRow[]> {
    const questionRows = await db
      .select({
        questionId: quizQuestions.questionId,
        questionText: quizQuestions.questionText,
        questionType: quizQuestions.questionType,
        config: quizQuestions.config,
        points: quizQuestions.points,
        explanation: quizQuestions.explanation,
        questionOrder: quizQuestions.questionOrder,
      })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.isActive, true)))
      .orderBy(asc(quizQuestions.questionOrder));

    const rows: QuestionWithAnswersRow[] = [];
    for (const question of questionRows) {
      const answers = await db
        .select({
          answerId: quizAnswers.answerId,
          answerText: quizAnswers.answerText,
          isCorrect: quizAnswers.isCorrect,
          answerOrder: quizAnswers.answerOrder,
        })
        .from(quizAnswers)
        .where(eq(quizAnswers.questionId, question.questionId))
        .orderBy(asc(quizAnswers.answerOrder));
      rows.push({ ...question, answers });
    }
    return rows;
  }

  /** Raw `pro_labs.flag_values` per lab (the service parses the v2 spec for step counts). */
  async listLabSpecValues(labIds: number[]): Promise<Map<number, unknown>> {
    if (labIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ labId: proLabs.labId, flagValues: proLabs.flagValues })
      .from(proLabs)
      .where(inArray(proLabs.labId, labIds));
    return new Map(rows.map((row) => [row.labId, row.flagValues]));
  }

  /* ── Class / org / admin scoping ────────────────────────────────────── */

  async isProfessorOfClass(classId: number, userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.userId, userId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async findClass(classId: number): Promise<{ organizationId: number | null; className: string; teamOwnerId: number } | null> {
    const rows = await db
      .select({ organizationId: teams.organizationId, className: teams.teamName, teamOwnerId: teams.teamOwnerId })
      .from(teams)
      .where(eq(teams.teamId, classId))
      .limit(1);
    return rows[0] ?? null;
  }

  async isClassMember(classId: number, userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async listClassStudents(classId: number): Promise<ClassStudentRow[]> {
    return db
      .select({
        userId: teamMembers.userId,
        fullName: users.fullName,
        email: users.email,
        joinedAt: teamMembers.joinedAt,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.userId, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.role, 'member'), eq(teamMembers.isActive, true)))
      .orderBy(asc(users.fullName));
  }

  async listOrgStudents(orgId: number): Promise<Array<ClassStudentRow & { className: string | null }>> {
    return db
      .selectDistinct({
        userId: teamMembers.userId,
        fullName: users.fullName,
        email: users.email,
        joinedAt: teamMembers.joinedAt,
        className: teams.teamName,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .innerJoin(users, eq(users.userId, teamMembers.userId))
      .where(and(eq(teams.organizationId, orgId), eq(teamMembers.role, 'member'), eq(teamMembers.isActive, true)))
      .orderBy(asc(users.fullName));
  }

  /** Published courses assigned to a class, in assignment order (staff course selector). */
  async listClassAssignedCourses(classId: number): Promise<CourseOptionRow[]> {
    const rows = await db
      .select({ courseId: academyCourses.courseId, title: academyCourses.title })
      .from(classAssignments)
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .where(and(eq(classAssignments.teamId, classId), eq(academyCourses.isPublished, true)))
      .orderBy(asc(classAssignments.assignmentId));
    return rows.map((row) => ({ courseId: row.courseId, title: row.title, lastAccessedAt: null }));
  }

  /** First published course assigned to any class of an organization (org default course). */
  async findFirstAssignedCourseForOrg(orgId: number): Promise<number | null> {
    const rows = await db
      .select({ courseId: classAssignments.courseId })
      .from(classAssignments)
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .where(and(eq(teams.organizationId, orgId), eq(academyCourses.isPublished, true)))
      .orderBy(asc(classAssignments.assignmentId))
      .limit(1);
    return rows[0]?.courseId ?? null;
  }

  async findUser(userId: number): Promise<{
    userId: number;
    username: string;
    email: string;
    fullName: string | null;
  } | null> {
    const rows = await db
      .select({ userId: users.userId, username: users.username, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }
}

/** Grain predicate: course grain = module and lesson null, module grain = lesson null, lesson grain = lesson set. */
function grainCondition(grain: ProgressGrain) {
  return and(
    eq(userProgress.courseId, grain.courseId),
    grain.lessonId === null ? isNull(userProgress.lessonId) : eq(userProgress.lessonId, grain.lessonId),
    grain.moduleId === null ? isNull(userProgress.moduleId) : eq(userProgress.moduleId, grain.moduleId),
  );
}

export const progressRepository = new ProgressRepository();
