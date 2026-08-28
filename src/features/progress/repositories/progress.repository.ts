import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  activityLogs,
  lessons,
  modules,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  teamMembers,
  teams,
  userProgress,
  userQuizAnswers,
  users,
  userSettings,
} from '../../../app/database/schema';
import { ORG_CONSTANTS } from '../../../shared/constants';
import type { LearningActivityType } from '../dto/progress.dto';

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

/** Continue-learning row joined to lesson/module titles. */
export interface ContinueLearningRow {
  lessonId: number;
  moduleId: number;
  courseId: number;
  lessonTitle: string;
  moduleTitle: string;
  lastAccessedAt: Date;
}

/** Module with published lesson count (for progress aggregation). */
export interface PublishedModuleRow {
  moduleId: number;
  title: string;
  moduleOrder: number;
  lessonCount: number;
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

/** Query-capable handle shared by `db` and transaction clients. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * F5 data access layer. All learner isolation filters (`user_id = :userId`)
 * are applied at the SQL level, never in JS. Class and org scopes are resolved
 * from `team_members` / `teams` / `user_settings` on the backend; the client
 * never supplies them.
 */
export class ProgressRepository {
  /* ── Lesson / module / course progress ──────────────────────────────── */

  async findLessonProgress(userId: number, lessonId: number): Promise<LessonProgressRow | null> {
    const rows = await db
      .select()
      .from(userProgress)
      .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, lessonId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Idempotent lesson start: insert an IN_PROGRESS row or touch the existing
   * one. `last_accessed_at` is refreshed on every call (invariant 1). */
  async touchLessonProgress(
    userId: number,
    input: { courseId: number; moduleId: number; lessonId: number },
  ): Promise<{ row: LessonProgressRow; created: boolean }> {
    return db.transaction(async (tx) => {
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
    });
  }

  /**
   * Transactional lesson completion + module/course rollup cascade (§05
   * invariants 3 and 4). The lesson row is marked complete with accumulated
   * time; when ALL published lessons of the module are done the module-grain
   * row is upserted, and likewise the course-grain row when every published
   * lesson of the course is done.
   */
  async completeLessonWithRollups(
    input: { userId: number; courseId: number; moduleId: number; lessonId: number; timeSpentSeconds: number },
  ): Promise<{ lesson: LessonProgressRow; moduleCompleted: boolean; courseCompleted: boolean }> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const existing = await tx
        .select()
        .from(userProgress)
        .where(and(eq(userProgress.userId, input.userId), eq(userProgress.lessonId, input.lessonId)))
        .limit(1)
        .for('update');

      let lessonRow: LessonProgressRow;
      const timeSpentSeconds = (existing[0]?.timeSpentSeconds ?? 0) + input.timeSpentSeconds;
      if (existing[0]) {
        const completedAt = existing[0].completedAt ?? now;
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
        lessonRow = {
          ...existing[0],
          progressPercentage: '100',
          isCompleted: true,
          completedAt,
          lastAccessedAt: now,
          timeSpentSeconds,
        };
      } else {
        const inserted = await tx.insert(userProgress).values({
          userId: input.userId,
          courseId: input.courseId,
          moduleId: input.moduleId,
          lessonId: input.lessonId,
          progressPercentage: '100',
          isCompleted: true,
          completedAt: now,
          lastAccessedAt: now,
          timeSpentSeconds,
        });
        const rows = await tx
          .select()
          .from(userProgress)
          .where(eq(userProgress.progressId, inserted[0].insertId))
          .limit(1);
        lessonRow = rows[0];
      }

      const moduleTotal = await tx
        .select({ value: count() })
        .from(lessons)
        .where(and(eq(lessons.moduleId, input.moduleId), eq(lessons.isPublished, true)));
      const moduleDone = await tx
        .select({ value: count() })
        .from(userProgress)
        .where(and(
          eq(userProgress.userId, input.userId),
          eq(userProgress.moduleId, input.moduleId),
          isNotNull(userProgress.lessonId),
          eq(userProgress.isCompleted, true),
        ));

      let moduleCompleted = false;
      if ((moduleTotal[0]?.value ?? 0) > 0 && moduleDone[0]?.value === moduleTotal[0]?.value) {
        moduleCompleted = true;
        await this.upsertGrainRow(tx, input.userId, {
          courseId: input.courseId,
          moduleId: input.moduleId,
          lessonId: null,
        });
      }

      const courseTotal = await tx
        .select({ value: count() })
        .from(lessons)
        .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
        .where(and(eq(modules.courseId, input.courseId), eq(lessons.isPublished, true)));
      const courseDone = await tx
        .select({ value: count() })
        .from(userProgress)
        .where(and(
          eq(userProgress.userId, input.userId),
          eq(userProgress.courseId, input.courseId),
          isNotNull(userProgress.lessonId),
          eq(userProgress.isCompleted, true),
        ));

      let courseCompleted = false;
      if ((courseTotal[0]?.value ?? 0) > 0 && courseDone[0]?.value === courseTotal[0]?.value) {
        courseCompleted = true;
        await this.upsertGrainRow(tx, input.userId, {
          courseId: input.courseId,
          moduleId: null,
          lessonId: null,
        });
      }

      return { lesson: lessonRow, moduleCompleted, courseCompleted };
    });
  }

  private async upsertGrainRow(
    tx: Tx,
    userId: number,
    grain: { courseId: number; moduleId: number | null; lessonId: number | null },
  ): Promise<void> {
    const conditions = [
      eq(userProgress.userId, userId),
      eq(userProgress.courseId, grain.courseId),
      grain.lessonId === null ? isNull(userProgress.lessonId) : eq(userProgress.lessonId, grain.lessonId!),
      grain.moduleId === null
        ? isNull(userProgress.moduleId)
        : eq(userProgress.moduleId, grain.moduleId),
    ];
    const existing = await tx.select().from(userProgress).where(and(...conditions)).limit(1).for('update');
    if (existing[0]) {
      await tx
        .update(userProgress)
        .set({ isCompleted: true, progressPercentage: '100', completedAt: existing[0].completedAt ?? new Date() })
        .where(eq(userProgress.progressId, existing[0].progressId));
      return;
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
  }

  async findGrainRow(
    userId: number,
    grain: { courseId: number; moduleId: number | null; lessonId: number | null },
  ): Promise<LessonProgressRow | null> {
    const conditions = [
      eq(userProgress.userId, userId),
      eq(userProgress.courseId, grain.courseId),
      grain.lessonId === null ? isNull(userProgress.lessonId) : eq(userProgress.lessonId, grain.lessonId!),
      grain.moduleId === null
        ? isNull(userProgress.moduleId)
        : eq(userProgress.moduleId, grain.moduleId),
    ];
    const rows = await db.select().from(userProgress).where(and(...conditions)).limit(1);
    return rows[0] ?? null;
  }

  /* ── Published content reference counts (F5 §06 virtual entities) ───── */

  async countPublishedLessonsByCourse(courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(lessons.isPublished, true)));
    return rows[0]?.value ?? 0;
  }

  async listPublishedModulesByCourse(courseId: number): Promise<PublishedModuleRow[]> {
    return db
      .select({
        moduleId: modules.moduleId,
        title: modules.title,
        moduleOrder: modules.moduleOrder,
        lessonCount: count(lessons.lessonId),
      })
      .from(modules)
      .leftJoin(lessons, and(eq(lessons.moduleId, modules.moduleId), eq(lessons.isPublished, true)))
      .where(and(eq(modules.courseId, courseId), eq(modules.isPublished, true)))
      .groupBy(modules.moduleId)
      .orderBy(asc(modules.moduleOrder));
  }

  async countCompletedLessons(userId: number, courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userProgress)
      .where(and(
        eq(userProgress.userId, userId),
        eq(userProgress.courseId, courseId),
        isNotNull(userProgress.lessonId),
        eq(userProgress.isCompleted, true),
      ));
    return rows[0]?.value ?? 0;
  }

  /** Completed lesson counts grouped per module (learner's own view). */
  async countCompletedLessonsByModule(userId: number, courseId: number): Promise<Map<number, number>> {
    const rows = await db
      .select({ moduleId: userProgress.moduleId, value: count() })
      .from(userProgress)
      .where(and(
        eq(userProgress.userId, userId),
        eq(userProgress.courseId, courseId),
        isNotNull(userProgress.moduleId),
        isNotNull(userProgress.lessonId),
        eq(userProgress.isCompleted, true),
      ))
      .groupBy(userProgress.moduleId);
    return new Map(rows.map((row) => [row.moduleId as number, row.value]));
  }

  async countCompletedModules(userId: number, courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userProgress)
      .where(and(
        eq(userProgress.userId, userId),
        eq(userProgress.courseId, courseId),
        isNull(userProgress.lessonId),
        isNotNull(userProgress.moduleId),
        eq(userProgress.isCompleted, true),
      ));
    return rows[0]?.value ?? 0;
  }

  /** Completed lesson rows per module across many users (class averages). */
  async countCompletedLessonsByModuleForUsers(
    userIds: number[],
    courseId: number,
  ): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ moduleId: userProgress.moduleId, value: count() })
      .from(userProgress)
      .where(and(
        inArray(userProgress.userId, userIds),
        eq(userProgress.courseId, courseId),
        isNotNull(userProgress.moduleId),
        isNotNull(userProgress.lessonId),
        eq(userProgress.isCompleted, true),
      ))
      .groupBy(userProgress.moduleId);
    return new Map(rows.map((row) => [row.moduleId as number, row.value]));
  }

  /* ── Continue-learning + activity ───────────────────────────────────── */

  async getContinueLearningRow(userId: number): Promise<ContinueLearningRow | null> {
    const rows = await db
      .select({
        lessonId: userProgress.lessonId,
        moduleId: userProgress.moduleId,
        courseId: userProgress.courseId,
        lastAccessedAt: userProgress.lastAccessedAt,
        lessonTitle: lessons.title,
        moduleTitle: modules.title,
      })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.lessonId, userProgress.lessonId))
      .innerJoin(modules, eq(modules.moduleId, userProgress.moduleId))
      .where(and(eq(userProgress.userId, userId), isNotNull(userProgress.lessonId)))
      .orderBy(desc(userProgress.lastAccessedAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      lessonId: row.lessonId as number,
      moduleId: row.moduleId as number,
      courseId: row.courseId as number,
      lessonTitle: row.lessonTitle,
      moduleTitle: row.moduleTitle,
      lastAccessedAt: row.lastAccessedAt,
    };
  }

  async recordActivity(
    userId: number,
    activityType: LearningActivityType,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    await db.insert(activityLogs).values({ userId, activityType, details });
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

  /** Atomic attempt + answer persistence (invariant 5 runs before this). */
  async insertAttemptWithAnswers(input: AttemptInsertInput): Promise<number> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const inserted = await tx.insert(quizAttempts).values({
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
        await tx.insert(userQuizAnswers).values(
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
    });
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
  async listQuizQuestionsWithAnswers(quizId: number): Promise<QuestionWithAnswersRow[]> {    const questionRows = await db
      .select({
        questionId: quizQuestions.questionId,
        questionText: quizQuestions.questionText,
        questionType: quizQuestions.questionType,
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

  async findClass(classId: number): Promise<{ organizationId: number | null; className: string } | null> {
    const rows = await db
      .select({ organizationId: teams.organizationId, className: teams.teamName })
      .from(teams)
      .where(eq(teams.teamId, classId))
      .limit(1);
    return rows[0] ?? null;
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

  async getOrgId(userId: number): Promise<number | null> {
    const rows = await db
      .select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(and(
        eq(userSettings.userId, userId),
        eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
      ))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

  /** Per-student aggregate raw data for class/org tables. */
  async getStudentsAggregates(userIds: number[], courseId: number): Promise<{
    completedLessons: Map<number, number>;
    completedModules: Map<number, number>;
    lastActive: Map<number, Date>;
  }> {
    const empty = { completedLessons: new Map<number, number>(), completedModules: new Map<number, number>(), lastActive: new Map<number, Date>() };
    if (userIds.length === 0) {
      return empty;
    }
    const [lessonRows, moduleRows, activeRows] = await Promise.all([
      db
        .select({ userId: userProgress.userId, value: count() })
        .from(userProgress)
        .where(and(
          inArray(userProgress.userId, userIds),
          eq(userProgress.courseId, courseId),
          isNotNull(userProgress.lessonId),
          eq(userProgress.isCompleted, true),
        ))
        .groupBy(userProgress.userId),
      db
        .select({ userId: userProgress.userId, value: count() })
        .from(userProgress)
        .where(and(
          inArray(userProgress.userId, userIds),
          eq(userProgress.courseId, courseId),
          isNull(userProgress.lessonId),
          isNotNull(userProgress.moduleId),
          eq(userProgress.isCompleted, true),
        ))
        .groupBy(userProgress.userId),
      db
        .select({ userId: userProgress.userId, value: max(userProgress.lastAccessedAt) })
        .from(userProgress)
        .where(inArray(userProgress.userId, userIds))
        .groupBy(userProgress.userId),
    ]);
    const lastActive = new Map<number, Date>();
    for (const row of activeRows) {
      if (row.value) {
        lastActive.set(row.userId, row.value);
      }
    }
    return {
      completedLessons: new Map(lessonRows.map((row) => [row.userId, row.value])),
      completedModules: new Map(moduleRows.map((row) => [row.userId, row.value])),
      lastActive,
    };
  }
}

export const progressRepository = new ProgressRepository();
