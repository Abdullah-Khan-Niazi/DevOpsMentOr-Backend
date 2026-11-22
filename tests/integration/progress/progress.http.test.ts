import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { progressRouter } from '../../../src/features/progress/routes/progressRouter';
import { adminProgressRouter } from '../../../src/features/progress/routes/adminProgressRouter';

/**
 *  integration + security matrix at the HTTP layer.
 *
 * `authenticate` is stubbed to inject a session identity; every other
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

vi.mock('../../../src/shared/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/middleware')>();
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      req.user = session.user as NonNullable<Request['user']>;
      next();
    },
  };
});

vi.mock('../../../src/features/progress/services/ProgressService', () => ({
  progressService: {
    startLesson: vi.fn(),
    completeLesson: vi.fn(),
    listCoursesProgress: vi.fn(),
    getCourseProgress: vi.fn(),
    getCourseModulesProgress: vi.fn(),
    getModuleItemsProgress: vi.fn(),
    getContinueLearning: vi.fn(),
    getActivityHistory: vi.fn(),
    getClassStudentsProgress: vi.fn(),
    getStudentDetailProgress: vi.fn(),
    getOrgStudentsProgress: vi.fn(),
    getAdminUserProgress: vi.fn(),
  },
}));

vi.mock('../../../src/features/progress/services/QuizAttemptService', () => ({
  quizAttemptService: {
    getStatus: vi.fn(),
    start: vi.fn(),
    getAttempt: vi.fn(),
    stageTerminal: vi.fn(),
    submitAnswer: vi.fn(),
    complete: vi.fn(),
    getReview: vi.fn(),
    getAttemptHistory: vi.fn(),
  },
}));

import { progressService } from '../../../src/features/progress/services/ProgressService';
import { quizAttemptService } from '../../../src/features/progress/services/QuizAttemptService';
import { errorMiddleware } from '../../../src/shared/middleware';
import { HTTP_STATUS } from '../../../src/shared/constants';

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

describe(' HTTP integration + security matrix', () => {
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
      expect(progressServiceMock.startLesson).toHaveBeenCalledWith(42, 5, []);
      expect(progressServiceMock.startLesson).not.toHaveBeenCalledWith(999, expect.anything(), expect.anything());
    });

    it('calls the service with the session sub, never a client-supplied id', async () => {
      asUser({ sub: 42, permissions: SELF_RW });
      await request(app).post('/progress/lessons/5/start').set('Authorization', 'Bearer test');
      expect(progressServiceMock.startLesson).toHaveBeenCalledWith(42, 5, []);
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

  describe('-API-02: PATCH lesson complete returns the §07 payload', () => {
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
        .send({ timeSpentSeconds: 86401 });
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

  describe('quiz attempts (server-created, one question at a time)', () => {
    const attemptDto = { attemptId: 41, quizId: 30, status: 'in_progress', questions: [] };

    it('201 for a new attempt and 200 when resumed; the session user is the only identity', async () => {
      quizAttemptServiceMock.start.mockResolvedValueOnce({ attempt: attemptDto, resumed: false } as never);
      const created = await request(app).post('/progress/quizzes/30/attempts/start').send({});
      expect(created.status).toBe(201);
      expect(quizAttemptServiceMock.start).toHaveBeenCalledWith(7, 30, []);

      quizAttemptServiceMock.start.mockResolvedValueOnce({ attempt: attemptDto, resumed: true } as never);
      const resumed = await request(app).post('/progress/quizzes/30/attempts/start').send({});
      expect(resumed.status).toBe(200);
    });

    it('422s a non-empty start body (strict) and a non-numeric id', async () => {
      expect((await request(app).post('/progress/quizzes/30/attempts/start').send({ userId: 1 })).status).toBe(422);
      expect((await request(app).post('/progress/quizzes/abc/attempts/start').send({})).status).toBe(422);
      expect(quizAttemptServiceMock.start).not.toHaveBeenCalled();
    });

    it('409 cooldown / cap and 404 map from the service', async () => {
      quizAttemptServiceMock.start.mockRejectedValueOnce(new ConflictError('cooldown', [{ code: 'QUIZ_COOLDOWN', retryAfterSeconds: 30 }]));
      const cooldown = await request(app).post('/progress/quizzes/30/attempts/start').send({});
      expect(cooldown.status).toBe(409);
      expect(JSON.stringify(cooldown.body)).toContain('retryAfterSeconds');
      quizAttemptServiceMock.start.mockRejectedValueOnce(new NotFoundError('Quiz not found.'));
      expect((await request(app).post('/progress/quizzes/99/attempts/start').send({})).status).toBe(404);
    });

    it('403 without progress.self.write on start and without the self permissions on reads', async () => {
      asUser({ sub: 7, permissions: ['progress.self.read'] });
      expect((await request(app).post('/progress/quizzes/30/attempts/start').send({})).status).toBe(403);
      asUser({ sub: 7, permissions: [] });
      expect((await request(app).get('/progress/quizzes/30')).status).toBe(403);
    });

    it('submits one answer per request and 422s malformed responses', async () => {
      quizAttemptServiceMock.submitAnswer.mockResolvedValueOnce({ questionId: 30, isCorrect: true } as never);
      const ok = await request(app)
        .post('/progress/quiz-attempts/41/answers')
        .send({ questionId: 30, response: { type: 'choice', answerId: 11 } });
      expect(ok.status).toBe(200);
      expect(quizAttemptServiceMock.submitAnswer).toHaveBeenCalledWith(
        7, 41, { questionId: 30, response: { type: 'choice', answerId: 11 } }, [],
      );
      const bodies = [
        { questionId: 30 },
        { questionId: 30, response: { type: 'choice' } },
        { questionId: 30, response: { type: 'text', text: '' } },
        { questionId: 30, response: { type: 'multi', answerIds: [] } },
        { questionId: 30, response: { type: 'bogus' } },
        { questionId: 30, response: { type: 'choice', answerId: 1 }, userId: 9 },
      ];
      for (const body of bodies) {
        expect((await request(app).post('/progress/quiz-attempts/41/answers').send(body)).status).toBe(422);
      }
      expect(quizAttemptServiceMock.submitAnswer).toHaveBeenCalledTimes(1);
    });

    it('answer 409 on a double submit', async () => {
      quizAttemptServiceMock.submitAnswer.mockRejectedValueOnce(new ConflictError('already answered'));
      const res = await request(app)
        .post('/progress/quiz-attempts/41/answers')
        .send({ questionId: 30, response: { type: 'choice', answerId: 11 } });
      expect(res.status).toBe(409);
    });

    it('completes an attempt and gates the review with 409 QUIZ_NOT_PASSED', async () => {
      quizAttemptServiceMock.complete.mockResolvedValueOnce({ attemptId: 41, isPassed: true } as never);
      const done = await request(app).post('/progress/quiz-attempts/41/complete').send({});
      expect(done.status).toBe(200);
      expect(quizAttemptServiceMock.complete).toHaveBeenCalledWith(7, 41, []);

      quizAttemptServiceMock.getReview.mockRejectedValueOnce(new ConflictError('not passed', [{ code: 'QUIZ_NOT_PASSED' }]));
      const review = await request(app).get('/progress/quiz-attempts/41/review');
      expect(review.status).toBe(409);
      expect(JSON.stringify(review.body)).toContain('QUIZ_NOT_PASSED');
    });

    it('terminal stage needs the labs create permission and a valid region', async () => {
      quizAttemptServiceMock.stageTerminal.mockResolvedValueOnce({ staged: true } as never);
      asUser({ sub: 7, permissions: [...SELF_RW, 'labs:instance:create'] });
      const ok = await request(app).post('/progress/quiz-attempts/41/questions/30/stage').send({ region: 'EU' });
      expect(ok.status).toBe(200);
      expect(quizAttemptServiceMock.stageTerminal).toHaveBeenCalledWith(7, 41, 30, 'EU', []);
      expect((await request(app).post('/progress/quiz-attempts/41/questions/30/stage').send({ region: 'MARS' })).status).toBe(422);

      asUser({ sub: 7, permissions: SELF_RW });
      expect((await request(app).post('/progress/quiz-attempts/41/questions/30/stage').send({})).status).toBe(403);
    });

    it('the learner attempt payload passes through exactly as the service built it', async () => {
      quizAttemptServiceMock.getAttempt.mockResolvedValueOnce({ attempt: attemptDto } as never);
      const res = await request(app).get('/progress/quiz-attempts/41');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('isCorrect');
    });

    it('lists attempt history for the session user', async () => {
      quizAttemptServiceMock.getAttemptHistory.mockResolvedValueOnce([] as never);
      expect((await request(app).get('/progress/quizzes/30/attempts')).status).toBe(200);
      expect(quizAttemptServiceMock.getAttemptHistory).toHaveBeenCalledWith(7, 30);
    });
  });

  describe('course-scoped learner reads', () => {
    it('200 for courses, one course, its modules, module items and continue', async () => {
      progressServiceMock.listCoursesProgress.mockResolvedValue([] as never);
      progressServiceMock.getCourseProgress.mockResolvedValue({ courseId: 1 } as never);
      progressServiceMock.getCourseModulesProgress.mockResolvedValue([] as never);
      progressServiceMock.getModuleItemsProgress.mockResolvedValue([] as never);
      progressServiceMock.getContinueLearning.mockResolvedValue(null as never);
      for (const path of ['/progress/courses', '/progress/courses/1', '/progress/courses/1/modules', '/progress/modules/2/items', '/progress/continue']) {
        expect((await request(app).get(path)).status).toBe(200);
      }
      expect(progressServiceMock.getCourseProgress).toHaveBeenCalledWith(7, 1);
      expect(progressServiceMock.getCourseModulesProgress).toHaveBeenCalledWith(7, 1);
      expect(progressServiceMock.getModuleItemsProgress).toHaveBeenCalledWith(7, 2);
    });

    it('404 for an unpublished course and 422 for a bad id', async () => {
      progressServiceMock.getCourseProgress.mockRejectedValueOnce(new NotFoundError('Course not found.'));
      expect((await request(app).get('/progress/courses/99')).status).toBe(404);
      expect((await request(app).get('/progress/courses/abc')).status).toBe(422);
      expect((await request(app).get('/progress/courses/0/modules')).status).toBe(422);
    });

    it('401 without a session and 403 without self read', async () => {
      session.user = null;
      expect((await request(app).get('/progress/courses')).status).toBe(401);
      asUser({ sub: 7, permissions: [] });
      expect((await request(app).get('/progress/courses/1')).status).toBe(403);
    });

    it('lesson complete maps LAB_NOT_COMPLETED / QUIZ_NOT_PASSED / LESSON_NOT_STARTED to 409', async () => {
      for (const code of ['LAB_NOT_COMPLETED', 'QUIZ_NOT_PASSED', 'LESSON_NOT_STARTED']) {
        progressServiceMock.completeLesson.mockRejectedValueOnce(new ConflictError('blocked', [{ code }]));
        const res = await request(app).patch('/progress/lessons/5/complete').send({ timeSpentSeconds: 0 });
        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toContain(code);
      }
    });

    it('activity limit is validated (422 above 100)', async () => {
      progressServiceMock.getActivityHistory.mockResolvedValue([] as never);
      expect((await request(app).get('/progress/activity?limit=500')).status).toBe(422);
      expect((await request(app).get('/progress/activity?limit=10')).status).toBe(200);
      expect(progressServiceMock.getActivityHistory).toHaveBeenCalledWith(7, 10);
    });
  });

  describe('removed routes', () => {
    it.each([
      ['get', '/progress/course'],
      ['get', '/progress/modules'],
      ['get', '/progress/modules/2'],
      ['get', '/progress/quizzes/30/questions'],
      ['post', '/progress/quizzes/30/attempts'],
    ] as const)('%s %s is 404', async (method, path) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(404);
    });
  });

  describe('staff ?courseId validation', () => {
    const staffRoutes = [
      '/progress/class/99/students',
      '/progress/class/99/students/8',
      '/progress/org/5/students',
    ];

    beforeEach(() => {
      progressServiceMock.getClassStudentsProgress.mockResolvedValue({ students: [] } as never);
      progressServiceMock.getStudentDetailProgress.mockResolvedValue({} as never);
      progressServiceMock.getOrgStudentsProgress.mockResolvedValue({ students: [] } as never);
      progressServiceMock.getAdminUserProgress.mockResolvedValue({} as never);
      asUser({ sub: 7, permissions: ORG_READ });
    });

    it.each(staffRoutes)('%s 422s a non-positive or non-numeric courseId', async (path) => {
      expect((await request(app).get(`${path}?courseId=abc`)).status).toBe(422);
      expect((await request(app).get(`${path}?courseId=0`)).status).toBe(422);
      expect((await request(app).get(`${path}?courseId=-3`)).status).toBe(422);
    });

    it('passes a valid courseId to the service and leaves it undefined when absent', async () => {
      await request(app).get('/progress/class/99/students?courseId=4');
      expect(progressServiceMock.getClassStudentsProgress).toHaveBeenCalledWith(99, expect.objectContaining({ userId: 7 }), 4);
      await request(app).get('/progress/class/99/students');
      expect(progressServiceMock.getClassStudentsProgress).toHaveBeenLastCalledWith(99, expect.objectContaining({ userId: 7 }), undefined);
      await request(app).get('/progress/org/5/students?courseId=4');
      expect(progressServiceMock.getOrgStudentsProgress).toHaveBeenCalledWith(5, expect.objectContaining({ userId: 7 }), 4);
      await request(app).get('/progress/class/99/students/8?courseId=4');
      expect(progressServiceMock.getStudentDetailProgress).toHaveBeenCalledWith(99, 8, expect.objectContaining({ userId: 7 }), 4);
    });

    it('404 COURSE_NOT_FOUND from the service for a course outside the class', async () => {
      progressServiceMock.getClassStudentsProgress.mockRejectedValueOnce(new NotFoundError('Course not found.'));
      expect((await request(app).get('/progress/class/99/students?courseId=77')).status).toBe(404);
    });

    it('admin user progress validates courseId and the user id', async () => {
      asUser({ sub: 1, permissions: PLATFORM_READ });
      expect((await request(app).get('/admin/users/9/progress?courseId=abc')).status).toBe(422);
      expect((await request(app).get('/admin/users/abc/progress')).status).toBe(422);
      expect((await request(app).get('/admin/users/9/progress?courseId=3')).status).toBe(200);
      expect(progressServiceMock.getAdminUserProgress).toHaveBeenCalledWith(9, 3);
    });
  });

  describe('-API-09: class students (BOLA / scope)', () => {
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
        undefined,
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

  describe('-API-11: org students (BOLA)', () => {
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
        undefined,
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

  describe('-API-12: admin user progress (AC-07)', () => {
    it('403s at the middleware without platform.progress.read', async () => {
      asUser({ sub: 1, permissions: CLASS_READ });
      const res = await request(app)
        .get('/admin/users/9/progress')
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
        .get('/admin/users/9/progress')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(200);
      expect(res.body.data.user.userId).toBe(9);
      expect(progressServiceMock.getAdminUserProgress).toHaveBeenCalledWith(9, undefined);
    });
  });
});
