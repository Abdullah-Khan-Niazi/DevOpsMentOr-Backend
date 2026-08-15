import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { ConflictError, ForbiddenError } from '../../src/shared/errors';
import { progressRouter } from '../../src/features/progress/routes/progressRouter';
import { adminProgressRouter } from '../../src/features/progress/routes/adminProgressRouter';

/**
 * F5 §11 integration + security matrix at the HTTP layer.
 *
 * `authenticate` (F1) is stubbed to inject a session identity; every other
 * middleware (authorizePermissions, authorizeAnyPermissions, validateRequest,
 * asyncHandler, errorMiddleware) runs for real, and the progress/quiz services
 * are stubbed so no database is touched. This exercises the full
 * router → zod → permission → controller chain and asserts the response
 * contracts from §07.
 */

const session = vi.hoisted(() => ({
  user: null as null | {
    sub: string;
    permissions: string[];
    roles: string[];
  },
}));

vi.mock('../../src/shared/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/middleware')>();
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      req.user = session.user as NonNullable<Request['user']>;
      next();
    },
  };
});

vi.mock('../../src/features/progress/services/ProgressService', () => ({
  progressService: {
    startLesson: vi.fn(),
    completeLesson: vi.fn(),
    getCourseProgress: vi.fn(),
    getModulesProgress: vi.fn(),
    getContinueLearningPointer: vi.fn(),
    getActivityHistory: vi.fn(),
    getClassStudentsProgress: vi.fn(),
    getStudentDetailProgress: vi.fn(),
    getOrgStudentsProgress: vi.fn(),
    getAdminUserProgress: vi.fn(),
  },
}));

vi.mock('../../src/features/progress/services/QuizAttemptService', () => ({
  quizAttemptService: {
    getQuizMeta: vi.fn(),
    submitAttempt: vi.fn(),
    getAttemptHistory: vi.fn(),
    getQuizQuestions: vi.fn(),
  },
}));

import { progressService } from '../../src/features/progress/services/ProgressService';
import { quizAttemptService } from '../../src/features/progress/services/QuizAttemptService';
import { errorMiddleware } from '../../src/shared/middleware';
import { HTTP_STATUS } from '../../src/shared/constants';

const progressServiceMock = vi.mocked(progressService);
const quizAttemptServiceMock = vi.mocked(quizAttemptService);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/progress', progressRouter);
  app.use('/admin', adminProgressRouter);
  app.use(errorMiddleware);
  return app;
}

const app = makeApp();

function asUser(user: { sub: number; permissions: string[]; roles?: string[] }): void {
  session.user = {
    sub: String(user.sub),
    permissions: user.permissions,
    roles: user.roles ?? [],
  };
}

const SELF_RW = ['progress.self.read', 'progress.self.write'];
const CLASS_READ = [...SELF_RW, 'progress.class.read'];
const ORG_READ = [...CLASS_READ, 'progress.org.read'];
const PLATFORM_READ = ['platform.progress.read'];

describe('F5 §11 HTTP integration + security matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: CLASS_READ });
  });

  describe('Security: session identity is the only accepted userId (IDOR)', () => {
    it('ignores a client-supplied userId in the body and uses the session sub', async () => {
      asUser({ sub: 42, permissions: SELF_RW });
      const res = await request(app)
        .post('/progress/lessons/5/start')
        .set('Authorization', 'Bearer test')
        .send({ userId: 999 });
      expect(res.status).toBe(200);
      expect(progressServiceMock.startLesson).toHaveBeenCalledWith(42, 5);
      expect(progressServiceMock.startLesson).not.toHaveBeenCalledWith(999, expect.anything());
    });

    it('calls the service with the session sub, never a client-supplied id', async () => {
      asUser({ sub: 42, permissions: SELF_RW });
      await request(app).post('/progress/lessons/5/start').set('Authorization', 'Bearer test');
      expect(progressServiceMock.startLesson).toHaveBeenCalledWith(42, 5);
    });

    it('403s at the middleware when progress.self.write is missing', async () => {
      asUser({ sub: 7, permissions: ['progress.self.read'] });
      const res = await request(app)
        .patch('/progress/lessons/5/complete')
        .set('Authorization', 'Bearer test')
        .send({ timeSpentSeconds: 60 });
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(progressServiceMock.completeLesson).not.toHaveBeenCalled();
    });
  });

  describe('F5-API-02: PATCH lesson complete returns the §07 payload', () => {
    it('200 with lessonProgress, moduleProgress and courseProgress', async () => {
      progressServiceMock.completeLesson.mockResolvedValueOnce({
        lessonProgress: {
          progressId: 1,
          lessonId: 5,
          moduleId: 2,
          courseId: 1,
          progressPercentage: 100,
          isCompleted: true,
          completedAt: '2026-08-16T00:00:00.000Z',
          lastAccessedAt: '2026-08-16T00:00:00.000Z',
          timeSpentSeconds: 120,
        },
        moduleProgress: {
          moduleId: 2,
          moduleTitle: 'Docker Fundamentals',
          moduleOrder: 1,
          totalLessons: 4,
          completedLessons: 4,
          progressPercentage: 100,
          isCompleted: true,
        },
        courseProgress: {
          courseId: 1,
          courseTitle: 'DevOps Mentor',
          totalLessons: 10,
          completedLessonCount: 4,
          progressPercentage: 40,
          isCompleted: false,
        },
      });
      const res = await request(app)
        .patch('/progress/lessons/5/complete')
        .set('Authorization', 'Bearer test')
        .send({ timeSpentSeconds: 60 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        lessonProgress: expect.objectContaining({ lessonId: 5, isCompleted: true }),
        moduleProgress: expect.objectContaining({ moduleId: 2, progressPercentage: 100 }),
        courseProgress: expect.objectContaining({ progressPercentage: 40 }),
      });
    });

    it('422s for an out-of-range timeSpentSeconds', async () => {
      const res = await request(app)
        .patch('/progress/lessons/5/complete')
        .set('Authorization', 'Bearer test')
        .send({ timeSpentSeconds: 7200 });
      expect(res.status).toBe(422);
      expect(progressServiceMock.completeLesson).not.toHaveBeenCalled();
    });

    it('409 when the lesson was never started', async () => {
      progressServiceMock.completeLesson.mockRejectedValueOnce(
        new ConflictError('Lesson has not been started.'),
      );
      const res = await request(app)
        .patch('/progress/lessons/5/complete')
        .set('Authorization', 'Bearer test')
        .send({ timeSpentSeconds: 30 });
      expect(res.status).toBe(HTTP_STATUS.CONFLICT);
    });
  });

  describe('F5-API-07: POST quiz attempt returns the §07 payload', () => {
    it('201 with attemptId, score, isPassed, attemptNumber, counts and breakdown', async () => {
      quizAttemptServiceMock.submitAttempt.mockResolvedValueOnce({
        attemptId: 41,
        score: 100,
        isPassed: true,
        attemptNumber: 1,
        correctCount: 1,
        totalQuestions: 1,
        breakdown: [{ questionId: 30, isCorrect: true, pointsEarned: 10, explanation: 'Good.' }],
      });
      const res = await request(app)
        .post('/progress/quizzes/30/attempts')
        .set('Authorization', 'Bearer test')
        .send({ answers: [{ questionId: 30, answerId: 11 }], timeTakenSeconds: 300 });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          attemptId: 41,
          score: 100,
          isPassed: true,
          attemptNumber: 1,
          correctCount: 1,
          totalQuestions: 1,
          breakdown: expect.arrayContaining([expect.objectContaining({ questionId: 30 })]),
        }),
      );
      expect(quizAttemptServiceMock.submitAttempt).toHaveBeenCalledWith(
        7,
        30,
        expect.objectContaining({ answers: [{ questionId: 30, answerId: 11 }] }),
      );
    });

    it('422s for an empty answers array', async () => {
      const res = await request(app)
        .post('/progress/quizzes/30/attempts')
        .set('Authorization', 'Bearer test')
        .send({ answers: [], timeTakenSeconds: 300 });
      expect(res.status).toBe(422);
      expect(quizAttemptServiceMock.submitAttempt).not.toHaveBeenCalled();
    });

    it('422s for a strict-body violation (unknown key)', async () => {
      const res = await request(app)
        .post('/progress/quizzes/30/attempts')
        .set('Authorization', 'Bearer test')
        .send({ answers: [{ questionId: 30, answerId: 11 }], timeTakenSeconds: 300, quizId: 999 });
      expect(res.status).toBe(422);
    });
  });

  describe('F5-API-09: class students (BOLA / scope)', () => {
    it('403s at the middleware without progress.class.read', async () => {
      asUser({ sub: 7, permissions: SELF_RW });
      const res = await request(app)
        .get('/progress/class/99/students')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(progressServiceMock.getClassStudentsProgress).not.toHaveBeenCalled();
    });

    it('403 when the professor is not assigned to the class', async () => {
      progressServiceMock.getClassStudentsProgress.mockRejectedValueOnce(
        new ForbiddenError('You do not have access to this class.'),
      );
      const res = await request(app)
        .get('/progress/class/99/students')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(progressServiceMock.getClassStudentsProgress).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ userId: 7 }),
      );
    });

    it('200 with students and moduleAverages for an assigned class', async () => {
      progressServiceMock.getClassStudentsProgress.mockResolvedValueOnce({
        className: 'DevOps A',
        students: [
          {
            userId: 8,
            fullName: 'Student One',
            email: 'student@example.com',
            progressPercentage: 50,
            completedLessonCount: 5,
            totalLessons: 10,
            completedModuleCount: 0,
            labsCompleted: 2,
            lastActiveAt: '2026-08-15T00:00:00.000Z',
            currentStreakDays: 3,
          },
        ],
        moduleAverages: [
          { moduleId: 1, moduleTitle: 'Docker Fundamentals', totalLessons: 4, averageProgressPercentage: 50 },
        ],
      });
      const res = await request(app)
        .get('/progress/class/99/students')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          className: 'DevOps A',
          students: expect.arrayContaining([expect.objectContaining({ userId: 8 })]),
          moduleAverages: expect.arrayContaining([
            expect.objectContaining({ moduleId: 1, averageProgressPercentage: 50 }),
          ]),
        }),
      );
    });
  });

  describe('F5-API-11: org students (BOLA)', () => {
    it('403 when the caller does not belong to the requested org', async () => {
      asUser({ sub: 7, permissions: ORG_READ });
      progressServiceMock.getOrgStudentsProgress.mockRejectedValueOnce(
        new ForbiddenError('You do not have access to this organization.'),
      );
      const res = await request(app)
        .get('/progress/org/5/students')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(progressServiceMock.getOrgStudentsProgress).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ userId: 7 }),
      );
    });

    it('403s at the middleware without progress.org.read', async () => {
      asUser({ sub: 7, permissions: CLASS_READ });
      const res = await request(app)
        .get('/progress/org/5/students')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    });
  });

  describe('F5-API-12: admin user progress (AC-07)', () => {
    it('403s at the middleware without platform.progress.read', async () => {
      asUser({ sub: 1, permissions: CLASS_READ });
      const res = await request(app)
        .get('/admin/progress/9')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    });

    it('200 with the full progress view for a platform admin', async () => {
      asUser({ sub: 1, permissions: PLATFORM_READ });
      progressServiceMock.getAdminUserProgress.mockResolvedValueOnce({
        user: { userId: 9, username: 'learner', email: 'learner@example.com', fullName: 'Learner' },
        course: null,
        modules: [],
        quizAttempts: [],
        activity: [],
      });
      const res = await request(app)
        .get('/admin/progress/9')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(200);
      expect(res.body.data.user.userId).toBe(9);
      expect(progressServiceMock.getAdminUserProgress).toHaveBeenCalledWith(9);
    });
  });
});
