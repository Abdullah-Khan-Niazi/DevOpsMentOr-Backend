import { redisClient, cacheKeys } from '../../../app/cache/redis';
import { curriculumService } from '../../curriculum/services/CurriculumService';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type {
  ActivityLogDto,
  AdminUserProgressDto,
  ContinueLearningPointerDto,
  CourseProgressDto,
  LearnerProgressSnapshot,
  LessonProgressDto,
  ModuleAverageDto,
  ModuleProgressSummary,
  OrgStudentProgressDto,
  StudentDetailProgressDto,
  StudentProgressDto,
} from '../dto/progress.dto';
import type { LessonProgressRow, ProgressRepository } from '../repositories/progress.repository';
import { progressRepository } from '../repositories/progress.repository';
import { activityLogService } from './ActivityLogService';

/** Session-derived caller (never client-supplied identifiers). */
export interface ProgressActor {
  userId: number;
  permissions: string[];
  roles: string[];
}

export interface ProgressServiceDeps {
  repo: ProgressRepository;
  courseCacheTtlSeconds: number;
  platformProgressPermission: string;
}

function defaultDeps(): ProgressServiceDeps {
  return {
    repo: progressRepository,
    courseCacheTtlSeconds: 60,
    platformProgressPermission: 'platform.progress.read',
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * F5 core progress engine: lesson start/complete upserts, module/course
 * rollup cascade, live percentage derivation, continue-learning pointer,
 * streak computation, and scoped professor/org/admin read paths.
 */
export class ProgressService {
  constructor(private readonly deps: ProgressServiceDeps = defaultDeps()) {}

  /** F5-API-01: idempotent lesson start (invariant 1). */
  async startLesson(userId: number, lessonId: number): Promise<LessonProgressDto> {
    const lesson = await curriculumService.getLessonById(lessonId);
    if (!lesson || !lesson.isPublished) {
      throw new NotFoundError('Lesson not found.');
    }
    const module = await curriculumService.getModuleById(lesson.moduleId);
    if (!module || !module.isPublished) {
      throw new NotFoundError('Lesson not found.');
    }
    const { row, created } = await this.deps.repo.touchLessonProgress(userId, {
      courseId: module.courseId,
      moduleId: lesson.moduleId,
      lessonId,
    });
    if (created) {
      await activityLogService.recordEvent(userId, 'LESSON_STARTED', {
        lessonId,
        moduleId: lesson.moduleId,
        courseId: module.courseId,
      });
    }
    return this.toLessonProgressDto(row);
  }

  /** F5-API-02: mark lesson complete + module/course rollup cascade. */
  async completeLesson(
    userId: number,
    lessonId: number,
    timeSpentSeconds: number,
  ): Promise<{
    lessonProgress: LessonProgressDto;
    moduleProgress: ModuleProgressSummary;
    courseProgress: CourseProgressDto;
  }> {
    const lesson = await curriculumService.getLessonById(lessonId);
    if (!lesson || !lesson.isPublished) {
      throw new NotFoundError('Lesson not found.');
    }
    const module = await curriculumService.getModuleById(lesson.moduleId);
    if (!module || !module.isPublished) {
      throw new NotFoundError('Lesson not found.');
    }
    const existing = await this.deps.repo.findLessonProgress(userId, lessonId);
    if (!existing) {
      throw new ConflictError('Lesson has not been started.');
    }

    const { lesson: row, moduleCompleted, courseCompleted } = await this.deps.repo.completeLessonWithRollups({
      userId,
      courseId: module.courseId,
      moduleId: lesson.moduleId,
      lessonId,
      timeSpentSeconds,
    });

    await activityLogService.recordEvent(userId, 'LESSON_COMPLETED', {
      lessonId,
      moduleId: lesson.moduleId,
      courseId: module.courseId,
      timeSpentSeconds,
    });
    if (moduleCompleted) {
      await activityLogService.recordEvent(userId, 'MODULE_COMPLETED', {
        moduleId: lesson.moduleId,
        courseId: module.courseId,
      });
    }
    if (courseCompleted) {
      await activityLogService.recordEvent(userId, 'COURSE_COMPLETED', {
        courseId: module.courseId,
      });
    }

    await redisClient.del(cacheKeys.courseProgress(userId));

    const [moduleProgress, courseProgress] = await Promise.all([
      this.getModuleProgress(userId, module.courseId, lesson.moduleId),
      this.getCourseProgress(userId),
    ]);
    return { lessonProgress: this.toLessonProgressDto(row), moduleProgress, courseProgress };
  }

  /** F5-API-03: live course progress % (Redis-cached 60s). */
  async getCourseProgress(userId: number): Promise<CourseProgressDto> {
    const snapshot = await curriculumService.getCourseSnapshot();
    const cached = await redisClient.get(cacheKeys.courseProgress(userId));
    if (cached) {
      return JSON.parse(cached) as CourseProgressDto;
    }

    const [totalLessons, completedLessonCount] = await Promise.all([
      this.deps.repo.countPublishedLessonsByCourse(snapshot.courseId),
      this.deps.repo.countCompletedLessons(userId, snapshot.courseId),
    ]);
    const dto: CourseProgressDto = {
      courseId: snapshot.courseId,
      courseTitle: snapshot.title,
      totalLessons,
      completedLessonCount,
      progressPercentage: totalLessons > 0 ? round2((completedLessonCount / totalLessons) * 100) : 0,
      isCompleted: totalLessons > 0 && completedLessonCount >= totalLessons,
    };
    await redisClient.set(
      cacheKeys.courseProgress(userId),
      JSON.stringify(dto),
      'EX',
      this.deps.courseCacheTtlSeconds,
    );
    return dto;
  }

  /** F5-API-04: per-module progress summaries (invariant 3 formula). */
  async getModulesProgress(userId: number): Promise<ModuleProgressSummary[]> {
    const snapshot = await curriculumService.getCourseSnapshot();
    return this.computeModulesProgress(userId, snapshot.courseId);
  }

  /** F5-API-05 + §02 forward hook: last-accessed lesson pointer (AC-09 null when none). */
  async getContinueLearningPointer(userId: number): Promise<ContinueLearningPointerDto | null> {
    const row = await this.deps.repo.getContinueLearningRow(userId);
    if (!row) {
      return null;
    }
    const [totalLessons, completedLessonCount] = await Promise.all([
      this.deps.repo.countPublishedLessonsByCourse(row.courseId),
      this.deps.repo.countCompletedLessons(userId, row.courseId),
    ]);
    return {
      lessonId: row.lessonId,
      moduleId: row.moduleId,
      courseId: row.courseId,
      lessonTitle: row.lessonTitle,
      moduleTitle: row.moduleTitle,
      progressPct: totalLessons > 0 ? round2((completedLessonCount / totalLessons) * 100) : 0,
      lastAccessedAt: row.lastAccessedAt.toISOString(),
    };
  }

  /** F5-API-06: recent activity feed. */
  async getActivityHistory(userId: number, limit: number): Promise<ActivityLogDto[]> {
    return activityLogService.getActivityHistory(userId, limit);
  }

  /** §02 forward hook for F7 achievements / F8 analytics. */
  async getLearnerProgressSnapshot(userId: number): Promise<LearnerProgressSnapshot> {
    let courseProgressPct = 0;
    let completedLessonCount = 0;
    let completedModuleCount = 0;
    const snapshot = await curriculumService.getCourseSnapshot().catch(() => null);
    if (snapshot) {
      const [completed, completedModules, total] = await Promise.all([
        this.deps.repo.countCompletedLessons(userId, snapshot.courseId),
        this.deps.repo.countCompletedModules(userId, snapshot.courseId),
        this.deps.repo.countPublishedLessonsByCourse(snapshot.courseId),
      ]);
      completedLessonCount = completed;
      completedModuleCount = completedModules;
      courseProgressPct = total > 0 ? round2((completed / total) * 100) : 0;
    }
    const [quizPassCount, completedLabCount, lastActivityAt, activityDays] = await Promise.all([
      this.deps.repo.countPassedQuizAttempts(userId),
      this.deps.repo.countLabCompletedEventsForUser(userId),
      this.deps.repo.lastActivityDate(userId),
      this.deps.repo.listUserActivityDates(userId),
    ]);
    return {
      userId,
      courseProgressPct,
      completedLessonCount,
      completedModuleCount,
      completedLabCount,
      quizPassCount,
      lastActivityAt,
      currentStreakDays: this.computeStreak(activityDays),
    };
  }

  /** F5-API-09: professor class roster with progress aggregates. */
  async getClassStudentsProgress(
    classId: number,
    actor: ProgressActor,
  ): Promise<{ className: string; students: StudentProgressDto[]; moduleAverages: ModuleAverageDto[] }> {
    if (!(await this.deps.repo.isProfessorOfClass(classId, actor.userId)) && !this.isPlatformAdmin(actor)) {
      throw new ForbiddenError('You do not have access to this class.');
    }
    const cls = await this.deps.repo.findClass(classId);
    const className = cls?.className ?? 'Class';
    const snapshot = await curriculumService.getCourseSnapshot();
    const students = await this.deps.repo.listClassStudents(classId);
    const studentUserIds = students.map((student) => student.userId);
    const [studentList, modules, completedByModule] = await Promise.all([
      this.buildStudentProgressList(studentUserIds, snapshot.courseId),
      this.deps.repo.listPublishedModulesByCourse(snapshot.courseId),
      this.deps.repo.countCompletedLessonsByModuleForUsers(studentUserIds, snapshot.courseId),
    ]);
    const studentCount = Math.max(1, studentUserIds.length);
    const moduleAverages = modules.map((module) => {
      const completed = completedByModule.get(module.moduleId) ?? 0;
      const average = module.lessonCount > 0
        ? round2((completed / (studentCount * module.lessonCount)) * 100)
        : 0;
      return {
        moduleId: module.moduleId,
        moduleTitle: module.title,
        totalLessons: module.lessonCount,
        averageProgressPercentage: average,
      };
    });
    return { className, students: studentList, moduleAverages };
  }

  /** F5-API-10: professor / org-admin drill-down into one student. */
  async getStudentDetailProgress(
    classId: number,
    studentUserId: number,
    actor: ProgressActor,
  ): Promise<StudentDetailProgressDto> {
    const cls = await this.deps.repo.findClass(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    const callerOrgId = await this.deps.repo.getOrgId(actor.userId);
    const isProfessor = await this.deps.repo.isProfessorOfClass(classId, actor.userId);
    const isOrgScope = callerOrgId !== null && callerOrgId === cls.organizationId;
    if (!isProfessor && !isOrgScope && !this.isPlatformAdmin(actor)) {
      throw new ForbiddenError('You do not have access to this class.');
    }
    const student = await this.deps.repo.findUser(studentUserId);
    if (!student) {
      throw new NotFoundError('Student not found.');
    }
    const snapshot = await curriculumService.getCourseSnapshot();
    const [course, modules, activity] = await Promise.all([
      this.computeCourseProgress(studentUserId),
      this.computeModulesProgress(studentUserId, snapshot.courseId),
      activityLogService.getActivityHistory(studentUserId, 20),
    ]);
    return {
      student: { userId: student.userId, fullName: student.fullName, email: student.email },
      course,
      modules,
      activity,
    };
  }

  /** F5-API-11: org-admin aggregate over all org students. */
  async getOrgStudentsProgress(orgId: number, actor: ProgressActor): Promise<OrgStudentProgressDto[]> {
    const callerOrgId = await this.deps.repo.getOrgId(actor.userId);
    if (callerOrgId !== orgId && !this.isPlatformAdmin(actor)) {
      throw new ForbiddenError('You do not have access to this organization.');
    }
    const students = await this.deps.repo.listOrgStudents(orgId);
    if (students.length === 0) {
      return [];
    }
    const snapshot = await curriculumService.getCourseSnapshot();
    const base = await this.buildStudentProgressList(
      students.map((student) => student.userId),
      snapshot.courseId,
    );
    const byUserId = new Map(base.map((student) => [student.userId, student]));
    return students.map((student) => ({
      ...byUserId.get(student.userId)!,
      className: student.className,
    }));
  }

  /** F5-API-12: platform admin full progress read for any user. */
  async getAdminUserProgress(userId: number): Promise<AdminUserProgressDto> {
    const user = await this.deps.repo.findUser(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }
    const snapshot = await curriculumService.getCourseSnapshot().catch(() => null);
    const [course, modules, quizAttempts, activity] = await Promise.all([
      snapshot ? this.computeCourseProgress(userId) : Promise.resolve(null),
      snapshot ? this.computeModulesProgress(userId, snapshot.courseId) : Promise.resolve([]),
      this.deps.repo.listQuizAttempts(userId),
      activityLogService.getActivityHistory(userId, 20),
    ]);
    return {
      user: { userId: user.userId, username: user.username, email: user.email, fullName: user.fullName },
      course,
      modules,
      quizAttempts: quizAttempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        quizId: attempt.quizId,
        score: attempt.score,
        isPassed: attempt.isPassed,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() ?? null,
        timeTakenSeconds: attempt.timeTakenSeconds,
      })),
      activity,
    };
  }

  /* ── Internal helpers ───────────────────────────────────────────────── */

  private async computeCourseProgress(userId: number): Promise<CourseProgressDto | null> {
    const snapshot = await curriculumService.getCourseSnapshot().catch(() => null);
    if (!snapshot) {
      return null;
    }
    const [totalLessons, completedLessonCount] = await Promise.all([
      this.deps.repo.countPublishedLessonsByCourse(snapshot.courseId),
      this.deps.repo.countCompletedLessons(userId, snapshot.courseId),
    ]);
    return {
      courseId: snapshot.courseId,
      courseTitle: snapshot.title,
      totalLessons,
      completedLessonCount,
      progressPercentage: totalLessons > 0 ? round2((completedLessonCount / totalLessons) * 100) : 0,
      isCompleted: totalLessons > 0 && completedLessonCount >= totalLessons,
    };
  }

  private async getModuleProgress(
    userId: number,
    courseId: number,
    moduleId: number,
  ): Promise<ModuleProgressSummary> {
    const summary = await this.computeModulesProgress(userId, courseId);
    const found = summary.find((item) => item.moduleId === moduleId);
    if (!found) {
      throw new NotFoundError('Module not found.');
    }
    return found;
  }

  private async computeModulesProgress(
    userId: number,
    courseId: number,
  ): Promise<ModuleProgressSummary[]> {
    const [modules, completedByModule] = await Promise.all([
      this.deps.repo.listPublishedModulesByCourse(courseId),
      this.deps.repo.countCompletedLessonsByModule(userId, courseId),
    ]);
    return modules.map((module) => {
      const completedLessons = completedByModule.get(module.moduleId) ?? 0;
      const totalLessons = module.lessonCount;
      return {
        moduleId: module.moduleId,
        moduleTitle: module.title,
        moduleOrder: module.moduleOrder,
        totalLessons,
        completedLessons,
        progressPercentage: totalLessons > 0 ? round2((completedLessons / totalLessons) * 100) : 0,
        isCompleted: totalLessons > 0 && completedLessons >= totalLessons,
      };
    });
  }

  private async buildStudentProgressList(userIds: number[], courseId: number): Promise<StudentProgressDto[]> {
    const [aggregates, streaks, labs, totalLessons] = await Promise.all([
      this.deps.repo.getStudentsAggregates(userIds, courseId),
      this.deps.repo.listUsersActivityDates(userIds),
      this.deps.repo.countLabCompletedEvents(userIds),
      this.deps.repo.countPublishedLessonsByCourse(courseId),
    ]);
    const users = new Map<number, { fullName: string | null; email: string }>();
    for (const userId of userIds) {
      const user = await this.deps.repo.findUser(userId);
      if (user) {
        users.set(userId, { fullName: user.fullName, email: user.email });
      }
    }
    return userIds.map((userId) => {
      const completedLessonCount = aggregates.completedLessons.get(userId) ?? 0;
      return {
        userId,
        fullName: users.get(userId)?.fullName ?? null,
        email: users.get(userId)?.email ?? '',
        progressPercentage: totalLessons > 0 ? round2((completedLessonCount / totalLessons) * 100) : 0,
        completedLessonCount,
        totalLessons,
        completedModuleCount: aggregates.completedModules.get(userId) ?? 0,
        labsCompleted: labs.get(userId) ?? 0,
        lastActiveAt: aggregates.lastActive.get(userId)?.toISOString() ?? null,
        currentStreakDays: this.computeStreak(streaks.get(userId) ?? []),
      };
    });
  }

  private isPlatformAdmin(actor: ProgressActor): boolean {
    return actor.roles.includes('platform_admin') || actor.permissions.includes(this.deps.platformProgressPermission);
  }

  private toLessonProgressDto(row: LessonProgressRow): LessonProgressDto {
    return {
      progressId: row.progressId,
      lessonId: row.lessonId as number,
      moduleId: row.moduleId as number,
      courseId: row.courseId as number,
      progressPercentage: Number(row.progressPercentage),
      isCompleted: row.isCompleted,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      lastAccessedAt: row.lastAccessedAt.toISOString(),
      timeSpentSeconds: row.timeSpentSeconds,
    };
  }

  /** Invariant 9: consecutive-day count ending today (or yesterday). */
  computeStreak(activityDays: string[], today: Date = new Date()): number {
    if (activityDays.length === 0) {
      return 0;
    }
    const set = new Set(activityDays);
    const todayKey = dateKey(today);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const yesterdayKey = dateKey(yesterday);
    const startKey = set.has(todayKey) ? todayKey : set.has(yesterdayKey) ? yesterdayKey : null;
    if (!startKey) {
      return 0;
    }
    let streak = 0;
    const cursor = new Date(`${startKey}T00:00:00.000Z`);
    while (set.has(dateKey(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }
}

export const progressService = new ProgressService();
