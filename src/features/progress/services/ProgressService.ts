import { redisClient } from '../../../app/cache/redis';
import { db } from '../../../app/database';
import { ConflictError, ForbiddenError, NotFoundError, ERROR_CODES } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { awardService, type AwardService, type Tx } from '../../gamification/services/award.service';
import { courseAccessService, type CourseAccessService } from '../../orgs/services/course-access.service';
import {
  membershipRepository,
  type IMembershipRepository,
} from '../../orgs/repositories/membership.repository';
import { parseLabSpec } from '../../labs/validators/lab-spec.validator';
import type {
  ActivityLogDto,
  AdminUserProgressDto,
  ContinueLearningPointerDto,
  CourseOptionDto,
  CourseProgressDto,
  LessonCompleteResultDto,
  LessonProgressDto,
  ModuleAverageDto,
  ModuleItemProgressDto,
  ModuleProgressSummary,
  OrgStudentProgressDto,
  StudentDetailProgressDto,
  StudentProgressDto,
} from '../dto/progress.dto';
import type {
  CourseOptionRow,
  LessonProgressRow,
  PublishedItemRow,
  ProgressExecutor,
  ProgressRepository,
} from '../repositories/progress.repository';
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
  award: Pick<AwardService, 'withUserLock' | 'balance'>;
  courseAccess: Pick<CourseAccessService, 'getCourseAccess'>;
  memberships: Pick<IMembershipRepository, 'getRoleInOrg'>;
  courseCacheTtlSeconds: number;
  platformProgressPermission: string;
}

function defaultDeps(): ProgressServiceDeps {
  return {
    repo: progressRepository,
    award: awardService,
    courseAccess: courseAccessService,
    memberships: membershipRepository,
    courseCacheTtlSeconds: 60,
    platformProgressPermission: 'platform.progress.read',
  };
}

/** Result of marking one lesson-grain row complete and running the rollup. */
export interface CompleteLessonRollupInput {
  userId: number;
  lessonId: number;
  timeSpentSeconds: number;
}

export interface CompleteLessonRollupResult {
  lesson: LessonProgressDto;
  /** True when no completed lesson-grain row existed before this call. */
  newlyCompletedLesson: boolean;
  moduleNewlyCompleted: boolean;
  courseNewlyCompleted: boolean;
}

/** Redis key of the cached course progress of one learner (invalidated after every completion commit). */
export function courseProgressCacheKey(userId: number, courseId: number): string {
  return `course_progress:${userId}:${courseId}`;
}

/**
 * Post-commit cache invalidation of the given courses. A Redis failure is logged
 * and never turns a committed write into an error (the cache TTL bounds staleness).
 */
export async function invalidateCourseProgressCache(userId: number, courseIds: readonly number[]): Promise<void> {
  await Promise.all(courseIds.map(async (courseId) => {
    try {
      await redisClient.del(courseProgressCacheKey(userId, courseId));
    } catch (err: unknown) {
      logger.warn({ err, userId, courseId }, 'Course progress cache invalidation failed');
    }
  }));
}

/**
 * Fire-and-forget gamification check after commit (contracts 5.3). Loaded
 * lazily: gamification imports this module, so a static import would create a
 * load-order cycle.
 */
export function scheduleAfterLearningEvent(userId: number): void {
  void import('../../gamification/services/gamification.service')
    .then(({ gamificationService }) => gamificationService.afterLearningEvent(userId))
    .catch((err: unknown) => {
      logger.error({ err, userId }, 'Post-commit gamification check failed');
    });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentage(completed: number, total: number): number {
  return total > 0 ? round2((completed / total) * 100) : 0;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Pick the selected course of a staff or learner view. `requested` must be one
 * of `options` (else 404 COURSE_NOT_FOUND); when absent the fallback is the
 * first option, or null when there is none.
 */
function pickCourse(options: CourseOptionRow[], requested: number | undefined): number | null {
  if (requested === undefined) {
    return options[0]?.courseId ?? null;
  }
  if (!options.some((option) => option.courseId === requested)) {
    throw new NotFoundError('Course not found.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
  }
  return requested;
}

function toCourseOptions(rows: CourseOptionRow[]): CourseOptionDto[] {
  return rows.map((row) => ({ courseId: row.courseId, title: row.title }));
}

/**
 * F5 progress engine. Progress is course scoped: every number is computed over
 * the published module items (lesson, lab and quiz kinds) of one course. Once-only
 * writes run under `awardService.withUserLock` (check-then-insert, contracts 0.3);
 * the Redis course cache is invalidated after commit.
 */
export class ProgressService {
  constructor(private readonly deps: ProgressServiceDeps = defaultDeps()) {}

  /* ── Learner writes ─────────────────────────────────────────────────── */

  /** F5-API-01: idempotent item start (all kinds) under the user lock. */
  async startLesson(userId: number, lessonId: number, roles: string[] = []): Promise<LessonProgressDto> {
    const item = await this.requireVisibleItem(lessonId);
    await this.assertContentAccess(userId, roles, item.courseId);
    return this.deps.award.withUserLock(userId, async (tx) => {
      const current = await this.requireVisibleItem(lessonId, tx);
      const { row, created } = await this.deps.repo.touchLessonProgress(tx, userId, {
        courseId: current.courseId,
        moduleId: current.moduleId,
        lessonId,
      });
      if (created) {
        await activityLogService.recordEvent(userId, 'LESSON_STARTED', {
          lessonId,
          moduleId: current.moduleId,
          courseId: current.courseId,
        }, tx);
      }
      return this.toLessonProgressDto(row);
    });
  }

  /**
   * F5-API-02: mark an item complete under the user lock. Lab items need a
   * LAB_COMPLETED event, quiz items a passed attempt; the item must be started.
   * No ledger award here: module/course XP comes from achievements (C3).
   */
  async completeLesson(
    userId: number,
    lessonId: number,
    timeSpentSeconds: number,
    roles: string[] = [],
  ): Promise<LessonCompleteResultDto> {
    const item = await this.requireVisibleItem(lessonId);
    await this.assertContentAccess(userId, roles, item.courseId);
    const result = await this.deps.award.withUserLock(userId, async (tx) => {
      const current = await this.requireVisibleItem(lessonId, tx);
      const started = await this.deps.repo.findLessonProgress(userId, lessonId, tx);
      if (!started) {
        throw new ConflictError('Lesson has not been started.', [{ code: ERROR_CODES.LESSON_NOT_STARTED }]);
      }
      await this.assertItemCompletionGate(tx, userId, current);
      const rollup = await this.completeLessonWithRollups(tx, { userId, lessonId, timeSpentSeconds });
      const balance = await this.deps.award.balance(tx, userId);
      return {
        lesson: rollup.lesson,
        newlyCompleted: rollup.newlyCompletedLesson,
        moduleNewlyCompleted: rollup.moduleNewlyCompleted,
        courseNewlyCompleted: rollup.courseNewlyCompleted,
        xp: { delta: 0, balance },
      };
    });
    await invalidateCourseProgressCache(userId, [item.courseId]);
    if (result.newlyCompleted || result.moduleNewlyCompleted || result.courseNewlyCompleted) {
      this.scheduleAfterLearningEvent(userId);
    }
    return result;
  }

  /**
   * Completion engine. Runs inside the caller's transaction (the user lock is
   * held by the caller, never taken here). Marks the lesson-grain row complete and
   * rolls up module and course grain rows when every published item is done.
   * "Newly" means no completed grain row existed before this call (D16); the
   * MODULE_COMPLETED / COURSE_COMPLETED events are written only then.
   */
  async completeLessonWithRollups(tx: ProgressExecutor, input: CompleteLessonRollupInput): Promise<CompleteLessonRollupResult> {
    const item = await this.requireVisibleItem(input.lessonId, tx);
    const { repo } = this.deps;
    const { userId, lessonId } = input;
    const { row, wasCompleted } = await repo.markLessonCompleted(tx, userId, {
      courseId: item.courseId,
      moduleId: item.moduleId,
      lessonId,
      timeSpentSeconds: input.timeSpentSeconds,
    });
    const newlyCompletedLesson = !wasCompleted;
    let moduleNewlyCompleted = false;
    let courseNewlyCompleted = false;

    if (newlyCompletedLesson) {
      await activityLogService.recordEvent(userId, 'LESSON_COMPLETED', {
        lessonId,
        moduleId: item.moduleId,
        courseId: item.courseId,
        timeSpentSeconds: input.timeSpentSeconds,
      }, tx);

      const [moduleTotal, moduleDone] = await Promise.all([
        repo.countPublishedItemsByModule(item.moduleId, tx),
        repo.countCompletedItemsByModule(userId, item.courseId, tx).then((counts) => counts.get(item.moduleId) ?? 0),
      ]);
      if (moduleTotal > 0 && moduleDone >= moduleTotal) {
        moduleNewlyCompleted = await repo.markGrainCompleted(tx, userId, {
          courseId: item.courseId,
          moduleId: item.moduleId,
          lessonId: null,
        });
      }

      const [courseTotal, courseDone] = await Promise.all([
        repo.countPublishedItemsByCourse(item.courseId, tx),
        repo.countCompletedItemsByCourse(userId, item.courseId, tx),
      ]);
      if (courseTotal > 0 && courseDone >= courseTotal) {
        courseNewlyCompleted = await repo.markGrainCompleted(tx, userId, {
          courseId: item.courseId,
          moduleId: null,
          lessonId: null,
        });
      }

      if (moduleNewlyCompleted) {
        await activityLogService.recordEvent(userId, 'MODULE_COMPLETED', {
          moduleId: item.moduleId,
          courseId: item.courseId,
        }, tx);
      }
      if (courseNewlyCompleted) {
        await activityLogService.recordEvent(userId, 'COURSE_COMPLETED', { courseId: item.courseId }, tx);
        const completedTracks = await repo.listNewlyCompletedTracksForCourse(tx, userId, item.courseId);
        for (const track of completedTracks) {
          await activityLogService.recordEvent(userId, 'TRACK_COMPLETED', {
            trackId: track.trackId,
            title: track.trackName,
            completedAt: new Date().toISOString(),
          }, tx);
        }
      }
    }

    return {
      lesson: this.toLessonProgressDto(row),
      newlyCompletedLesson,
      moduleNewlyCompleted,
      courseNewlyCompleted,
    };
  }

  /* ── Learner reads (course scoped) ──────────────────────────────────── */

  /** Started published courses with their progress (learner course list). */
  async listCoursesProgress(userId: number): Promise<CourseProgressDto[]> {
    const started = await this.deps.repo.listStartedCourses(userId);
    return Promise.all(started.map((course) => this.computeCourseProgress(userId, course.courseId, course.title)));
  }

  /** F5-API-03: live course progress % (Redis-cached 60s per learner and course). */
  async getCourseProgress(userId: number, courseId?: number): Promise<CourseProgressDto> {
    if (courseId === undefined) {
      throw new NotFoundError('Use a course id.');
    }
    const course = await this.requirePublishedCourse(courseId);
    const cacheKey = courseProgressCacheKey(userId, courseId);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as CourseProgressDto;
      }
    } catch (err: unknown) {
      logger.warn({ err, userId, courseId }, 'Course progress cache read failed');
    }
    const dto = await this.computeCourseProgress(userId, course.courseId, course.title);
    try {
      await redisClient.set(cacheKey, JSON.stringify(dto), 'EX', this.deps.courseCacheTtlSeconds);
    } catch (err: unknown) {
      logger.warn({ err, userId, courseId }, 'Course progress cache write failed');
    }
    return dto;
  }

  /** F5-API-04: per-module progress summaries of one course. */
  async getCourseModulesProgress(userId: number, courseId: number): Promise<ModuleProgressSummary[]> {
    await this.requirePublishedCourse(courseId);
    return this.computeModulesProgress(userId, courseId);
  }

  /** Published items of one module with the learner's progress per item (GET /progress/modules/:moduleId/items). */
  async getModuleItemsProgress(userId: number, moduleId: number): Promise<ModuleItemProgressDto[]> {
    const module = await this.deps.repo.findPublishedModule(moduleId);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    const { repo } = this.deps;
    const items = await repo.listPublishedItemsByModule(moduleId);
    const lessonIds = items.map((item) => item.itemId);
    const labIds = items.flatMap((item) => (item.kind === 'lab' && item.labId !== null ? [item.labId] : []));
    const quizIds = items.flatMap((item) => (item.kind === 'quiz' && item.quizId !== null ? [item.quizId] : []));
    const [progressRows, passedSteps, specValues, quizStats] = await Promise.all([
      repo.listLessonProgressByLessonIds(userId, lessonIds),
      repo.countPassedLabSteps(userId, labIds),
      repo.listLabSpecValues(labIds),
      repo.quizAttemptStats(userId, quizIds),
    ]);

    return items.map((item): ModuleItemProgressDto => {
      const row = progressRows.get(item.itemId);
      const base = {
        itemId: item.itemId,
        kind: item.kind,
        isStarted: row !== undefined,
        isCompleted: row?.isCompleted ?? false,
        completedAt: row?.completedAt?.toISOString() ?? null,
      };
      if (item.kind === 'lab') {
        return {
          ...base,
          lab: {
            passedSteps: item.labId !== null ? passedSteps.get(item.labId) ?? 0 : 0,
            totalSteps: item.labId !== null ? this.countLabSteps(specValues.get(item.labId)) : 0,
          },
        };
      }
      if (item.kind === 'quiz') {
        const stats = item.quizId !== null ? quizStats.get(item.quizId) : undefined;
        return {
          ...base,
          quiz: {
            isPassed: stats?.isPassed ?? false,
            bestScore: stats?.bestScore ?? null,
            attemptsUsedToday: stats?.attemptsUsedToday ?? 0,
          },
        };
      }
      return base;
    });
  }

  /** F5-API-05: last-accessed item pointer with its kind (FE routes by kind). */
  async getContinueLearning(userId: number): Promise<ContinueLearningPointerDto | null> {
    const row = await this.deps.repo.getContinueLearningRow(userId);
    if (!row) {
      return null;
    }
    const [total, completed] = await Promise.all([
      this.deps.repo.countPublishedItemsByCourse(row.courseId),
      this.deps.repo.countCompletedItemsByCourse(userId, row.courseId),
    ]);
    return {
      lessonId: row.itemId,
      moduleId: row.moduleId,
      courseId: row.courseId,
      lessonTitle: row.title,
      moduleTitle: row.moduleTitle,
      progressPct: percentage(completed, total),
      lastAccessedAt: row.lastAccessedAt.toISOString(),
      kind: row.kind,
      labId: row.kind === 'lab' ? row.labId : null,
      quizId: row.kind === 'quiz' ? row.quizId : null,
    };
  }

  /** F5-API-06: recent activity feed. */
  async getActivityHistory(userId: number, limit: number): Promise<ActivityLogDto[]> {
    return activityLogService.getActivityHistory(userId, limit);
  }

  /* ── Staff reads (membership and assignment scoped) ─────────────────── */

  /** F5-API-09: professor / org-admin class roster with progress aggregates for one assigned course. */
  async getClassStudentsProgress(
    classId: number,
    actor: ProgressActor,
    courseId?: number,
  ): Promise<{
    className: string;
    students: StudentProgressDto[];
    moduleAverages: ModuleAverageDto[];
    courseOptions: CourseOptionDto[];
  }> {
    const cls = await this.requireClassStaff(classId, actor);
    const options = await this.deps.repo.listClassAssignedCourses(classId);
    const selected = pickCourse(options, courseId);
    const students = await this.deps.repo.listClassStudents(classId);
    const studentUserIds = students.map((student) => student.userId);
    const [studentList, modules, completedByModule] = await Promise.all([
      this.buildStudentProgressList(studentUserIds, selected),
      selected !== null ? this.deps.repo.listPublishedModulesByCourse(selected) : Promise.resolve([]),
      selected !== null
        ? this.deps.repo.countCompletedItemsByModuleForUsers(studentUserIds, selected)
        : Promise.resolve(new Map<number, number>()),
    ]);
    const studentCount = Math.max(1, studentUserIds.length);
    const moduleAverages = modules.map((module) => {
      const completed = completedByModule.get(module.moduleId) ?? 0;
      return {
        moduleId: module.moduleId,
        moduleTitle: module.title,
        totalLessons: module.itemCount,
        averageProgressPercentage: module.itemCount > 0
          ? round2((completed / (studentCount * module.itemCount)) * 100)
          : 0,
      };
    });
    return {
      className: cls.className ?? 'Class',
      students: studentList,
      moduleAverages,
      courseOptions: toCourseOptions(options),
    };
  }

  /** F5-API-10: professor / org-admin drill-down into one student of the class. */
  async getStudentDetailProgress(
    classId: number,
    studentUserId: number,
    actor: ProgressActor,
    courseId?: number,
  ): Promise<StudentDetailProgressDto> {
    await this.requireClassStaff(classId, actor);
    const student = await this.deps.repo.findUser(studentUserId);
    if (!student || !(await this.deps.repo.isClassMember(classId, studentUserId))) {
      throw new NotFoundError('Student not found in this class.');
    }
    const [assigned, started] = await Promise.all([
      this.deps.repo.listClassAssignedCourses(classId),
      this.deps.repo.listStartedCourses(studentUserId),
    ]);
    const options = [...assigned, ...started.filter((course) => !assigned.some((item) => item.courseId === course.courseId))];
    const selected = pickCourse(options, courseId);
    const [course, modules, activity] = await Promise.all([
      selected !== null ? this.computeCourseProgress(studentUserId, selected) : Promise.resolve(null),
      selected !== null ? this.computeModulesProgress(studentUserId, selected) : Promise.resolve([]),
      activityLogService.getActivityHistory(studentUserId, 20),
    ]);
    return {
      student: { userId: student.userId, fullName: student.fullName, email: student.email },
      course,
      modules,
      activity,
      courseOptions: toCourseOptions(options),
    };
  }

  /** F5-API-11: organization aggregate over all org students for one course (org admin only). */
  async getOrgStudentsProgress(orgId: number, actor: ProgressActor, courseId?: number): Promise<OrgStudentProgressDto[]> {
    const role = await this.deps.memberships.getRoleInOrg(actor.userId, orgId);
    if (role !== 'org_admin' && !this.isPlatformAdmin(actor)) {
      throw new ForbiddenError('Organization-wide progress requires organization admin access.');
    }
    const students = await this.deps.repo.listOrgStudents(orgId);
    if (students.length === 0) {
      return [];
    }
    let selected: number | null;
    if (courseId !== undefined) {
      await this.requirePublishedCourse(courseId);
      selected = courseId;
    } else {
      selected = await this.deps.repo.findFirstAssignedCourseForOrg(orgId);
    }
    const base = await this.buildStudentProgressList(students.map((student) => student.userId), selected);
    const byUserId = new Map(base.map((student) => [student.userId, student]));
    return students.map((student) => ({
      ...byUserId.get(student.userId)!,
      className: student.className,
    }));
  }

  /** F5-API-12: platform admin full progress read for any user. */
  async getAdminUserProgress(userId: number, courseId?: number): Promise<AdminUserProgressDto> {
    const user = await this.deps.repo.findUser(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }
    const started = await this.deps.repo.listStartedCourses(userId);
    const selected = pickCourse(started, courseId);
    const [course, modules, quizAttempts, activity] = await Promise.all([
      selected !== null ? this.computeCourseProgress(userId, selected) : Promise.resolve(null),
      selected !== null ? this.computeModulesProgress(userId, selected) : Promise.resolve([]),
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
      courseOptions: toCourseOptions(started),
    };
  }

  /* ── Internal helpers ───────────────────────────────────────────────── */

  /** Visible item (published spine row, module and course published) or 404 LESSON_NOT_FOUND. */
  private async requireVisibleItem(lessonId: number, executor: ProgressExecutor = db): Promise<PublishedItemRow> {
    const item = await this.deps.repo.findPublishedItem(lessonId, executor);
    if (!item) {
      throw new NotFoundError('Lesson not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
    }
    return item;
  }

  private async requirePublishedCourse(courseId: number): Promise<{ courseId: number; title: string }> {
    const course = await this.deps.repo.findPublishedCourse(courseId);
    if (!course) {
      throw new NotFoundError('Course not found.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
    }
    return course;
  }

  /** Content writes: 403 COURSE_ACCESS_DENIED with errors[0] = { code, reason, message } when not entitled. */
  private async assertContentAccess(userId: number, roles: string[], courseId: number): Promise<void> {
    const access = await this.deps.courseAccess.getCourseAccess(
      { userId, ipAddress: null, userAgent: null, roles },
      courseId,
    );
    if (!access.canAccess) {
      const message = access.message ?? 'You do not have access to this course. Ask your organization admin for access.';
      throw new ForbiddenError(message, [{
        code: ERROR_CODES.COURSE_ACCESS_DENIED,
        reason: access.reason,
        message,
      }]);
    }
  }

  /** Lab items need a LAB_COMPLETED event, quiz items a passed attempt (409 otherwise). */
  private async assertItemCompletionGate(tx: Tx, userId: number, item: PublishedItemRow): Promise<void> {
    if (item.kind === 'lab' && item.labId !== null) {
      const done = await this.deps.repo.hasLabCompletedEvent(userId, item.labId, tx);
      if (!done) {
        throw new ConflictError('Complete the lab before marking this item complete.', [{ code: ERROR_CODES.LAB_NOT_COMPLETED }]);
      }
    }
    if (item.kind === 'quiz' && item.quizId !== null) {
      const passed = await this.deps.repo.hasPassedQuizAttempt(userId, item.quizId, tx);
      if (!passed) {
        throw new ConflictError('Pass the quiz before marking this item complete.', [{ code: ERROR_CODES.QUIZ_NOT_PASSED }]);
      }
    }
  }

  /** Staff gate: professor of the class, org admin of its organization, class owner or platform admin. */
  private async requireClassStaff(
    classId: number,
    actor: ProgressActor,
  ): Promise<{ organizationId: number | null; className: string; teamOwnerId: number }> {
    const cls = await this.deps.repo.findClass(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    const isProfessor = await this.deps.repo.isProfessorOfClass(classId, actor.userId);
    const isOrgScope = cls.organizationId !== null
      && (await this.deps.memberships.getRoleInOrg(actor.userId, cls.organizationId)) === 'org_admin';
    const isOwner = typeof cls.teamOwnerId === 'number' && cls.teamOwnerId === actor.userId;
    if (!isProfessor && !isOrgScope && !isOwner && !this.isPlatformAdmin(actor)) {
      throw new ForbiddenError('You do not have access to this class.');
    }
    return cls;
  }

  private scheduleAfterLearningEvent(userId: number): void {
    scheduleAfterLearningEvent(userId);
  }

  private async computeCourseProgress(userId: number, courseId: number, title?: string): Promise<CourseProgressDto> {
    const [course, totalItems, completedItems] = await Promise.all([
      title === undefined ? this.deps.repo.findPublishedCourse(courseId) : Promise.resolve({ courseId, title }),
      this.deps.repo.countPublishedItemsByCourse(courseId),
      this.deps.repo.countCompletedItemsByCourse(userId, courseId),
    ]);
    return {
      courseId,
      courseTitle: course?.title ?? title ?? '',
      totalLessons: totalItems,
      completedLessonCount: completedItems,
      progressPercentage: percentage(completedItems, totalItems),
      isCompleted: totalItems > 0 && completedItems >= totalItems,
    };
  }

  private async computeModulesProgress(userId: number, courseId: number): Promise<ModuleProgressSummary[]> {
    const [modules, completedByModule] = await Promise.all([
      this.deps.repo.listPublishedModulesByCourse(courseId),
      this.deps.repo.countCompletedItemsByModule(userId, courseId),
    ]);
    return modules.map((module) => {
      const completed = completedByModule.get(module.moduleId) ?? 0;
      return {
        moduleId: module.moduleId,
        moduleTitle: module.title,
        moduleOrder: module.moduleOrder,
        totalLessons: module.itemCount,
        completedLessons: completed,
        progressPercentage: percentage(completed, module.itemCount),
        isCompleted: module.itemCount > 0 && completed >= module.itemCount,
      };
    });
  }

  /** Student rows for staff tables. `courseId` null = no course selected (zero progress). */
  private async buildStudentProgressList(userIds: number[], courseId: number | null): Promise<StudentProgressDto[]> {
    if (userIds.length === 0) {
      return [];
    }
    const [completedItems, completedModules, lastActive, streaks, labs, totalItems] = await Promise.all([
      courseId !== null ? this.deps.repo.countCompletedItemsForUsers(userIds, courseId) : Promise.resolve(new Map<number, number>()),
      courseId !== null ? this.deps.repo.countCompletedModulesForUsers(userIds, courseId) : Promise.resolve(new Map<number, number>()),
      this.deps.repo.lastAccessForUsers(userIds),
      this.deps.repo.listUsersActivityDates(userIds),
      this.deps.repo.countLabCompletedEvents(userIds),
      courseId !== null ? this.deps.repo.countPublishedItemsByCourse(courseId) : Promise.resolve(0),
    ]);
    const users = new Map<number, { fullName: string | null; email: string }>();
    for (const userId of userIds) {
      const user = await this.deps.repo.findUser(userId);
      if (user) {
        users.set(userId, { fullName: user.fullName, email: user.email });
      }
    }
    return userIds.map((userId) => {
      const completed = completedItems.get(userId) ?? 0;
      return {
        userId,
        fullName: users.get(userId)?.fullName ?? null,
        email: users.get(userId)?.email ?? '',
        progressPercentage: percentage(completed, totalItems),
        completedLessonCount: completed,
        totalLessons: totalItems,
        completedModuleCount: completedModules.get(userId) ?? 0,
        labsCompleted: labs.get(userId) ?? 0,
        lastActiveAt: lastActive.get(userId)?.toISOString() ?? null,
        currentStreakDays: this.computeStreak(streaks.get(userId) ?? []),
      };
    });
  }

  /** Number of steps of a stored lab spec (0 when not runnable). */
  private countLabSteps(raw: unknown): number {
    const parsed = parseLabSpec(raw);
    return parsed.kind === 'v2' ? parsed.spec.steps.length : 0;
  }

  private isPlatformAdmin(actor: ProgressActor): boolean {
    return (
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('admin') ||
      actor.permissions.includes(this.deps.platformProgressPermission) ||
      actor.permissions.includes('platform.organizations.manage') ||
      actor.permissions.includes('platform.admin.access')
    );
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
