import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import { adminCurriculumRoutes } from '../../../src/features/curriculum/routes/admin-curriculum.routes';
import { curriculumRoutes } from '../../../src/features/curriculum/routes/curriculum.routes';

/**
 * Admin curriculum HTTP matrix. `authenticate` is stubbed to inject a session;
 * authorizePermissions, validateRequest, asyncHandler and errorMiddleware run
 * for real, and the services are stubbed (no database, Redis or network).
 */

const session = vi.hoisted(() => ({
  user: null as null | { sub: string; permissions: string[]; roles: string[] },
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

vi.mock('../../../src/features/curriculum/services/AdminCurriculumService', () => ({
  adminCurriculumService: {
    listTags: vi.fn(), listDifficulties: vi.fn(), listCategories: vi.fn(), listCourses: vi.fn(),
    createCourse: vi.fn(), getCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(), deleteCourse: vi.fn(),
    listCourseModules: vi.fn(), createModule: vi.fn(), reorderModules: vi.fn(), getModule: vi.fn(),
    updateModule: vi.fn(), publishModule: vi.fn(), archiveModule: vi.fn(), deleteModule: vi.fn(),
    getLesson: vi.fn(), updateLesson: vi.fn(),
  },
}));
vi.mock('../../../src/features/curriculum/services/ModuleItemService', () => ({
  moduleItemService: {
    createItem: vi.fn(), reorderItems: vi.fn(), updateItemTitle: vi.fn(), publishItem: vi.fn(), deleteItem: vi.fn(),
  },
}));
vi.mock('../../../src/features/curriculum/services/QuizService', () => ({
  quizService: {
    getQuiz: vi.fn(), updateQuiz: vi.fn(), deleteQuiz: vi.fn(), createQuestion: vi.fn(),
    reorderQuestions: vi.fn(), updateQuestion: vi.fn(), deleteQuestion: vi.fn(),
  },
}));
vi.mock('../../../src/features/curriculum/services/CurriculumService', () => ({
  curriculumService: {
    listCourses: vi.fn(), getCourseDetail: vi.fn(), listCourseModules: vi.fn(),
    getModule: vi.fn(), listModuleItems: vi.fn(), getLesson: vi.fn(),
  },
}));

import { adminCurriculumService } from '../../../src/features/curriculum/services/AdminCurriculumService';
import { moduleItemService } from '../../../src/features/curriculum/services/ModuleItemService';
import { quizService } from '../../../src/features/curriculum/services/QuizService';
import { errorMiddleware } from '../../../src/shared/middleware';

const adminSvc = vi.mocked(adminCurriculumService);
const itemSvc = vi.mocked(moduleItemService);
const quizSvc = vi.mocked(quizService);

const app = express();
app.use(express.json());
app.use('/curriculum', curriculumRoutes);
app.use('/admin', adminCurriculumRoutes);
app.use(errorMiddleware);

const asUser = (permissions: string[]): void => {
  session.user = { sub: '9', permissions, roles: [] };
};
const READ = ['platform.curriculum.read'];
const MANAGE = ['platform.curriculum.read', 'platform.curriculum.manage'];
const LEARNER = ['curriculum.read'];

type Route = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; manage: boolean };
const routes: Route[] = [
  { method: 'get', path: '/admin/curriculum/tags', manage: false },
  { method: 'get', path: '/admin/curriculum/difficulties', manage: false },
  { method: 'get', path: '/admin/curriculum/categories', manage: false },
  { method: 'get', path: '/admin/curriculum/courses', manage: false },
  { method: 'post', path: '/admin/curriculum/courses', manage: true },
  { method: 'get', path: '/admin/curriculum/courses/1', manage: false },
  { method: 'patch', path: '/admin/curriculum/courses/1', manage: true },
  { method: 'patch', path: '/admin/curriculum/courses/1/archive', manage: true },
  { method: 'delete', path: '/admin/curriculum/courses/1', manage: true },
  { method: 'get', path: '/admin/curriculum/courses/1/modules', manage: false },
  { method: 'post', path: '/admin/curriculum/courses/1/modules', manage: true },
  { method: 'patch', path: '/admin/curriculum/courses/1/modules/reorder', manage: true },
  { method: 'get', path: '/admin/curriculum/modules/2', manage: false },
  { method: 'patch', path: '/admin/curriculum/modules/2', manage: true },
  { method: 'patch', path: '/admin/curriculum/modules/2/publish', manage: true },
  { method: 'patch', path: '/admin/curriculum/modules/2/archive', manage: true },
  { method: 'delete', path: '/admin/curriculum/modules/2', manage: true },
  { method: 'post', path: '/admin/curriculum/modules/2/items', manage: true },
  { method: 'patch', path: '/admin/curriculum/modules/2/items/reorder', manage: true },
  { method: 'patch', path: '/admin/curriculum/items/3', manage: true },
  { method: 'patch', path: '/admin/curriculum/items/3/publish', manage: true },
  { method: 'delete', path: '/admin/curriculum/items/3', manage: true },
  { method: 'get', path: '/admin/curriculum/lessons/3', manage: false },
  { method: 'patch', path: '/admin/curriculum/lessons/3', manage: true },
  { method: 'patch', path: '/admin/curriculum/lessons/3/publish', manage: true },
  { method: 'get', path: '/admin/curriculum/quizzes/4', manage: false },
  { method: 'patch', path: '/admin/curriculum/quizzes/4', manage: true },
  { method: 'delete', path: '/admin/curriculum/quizzes/4', manage: true },
  { method: 'post', path: '/admin/curriculum/quizzes/4/questions', manage: true },
  { method: 'patch', path: '/admin/curriculum/quizzes/4/questions/reorder', manage: true },
  { method: 'patch', path: '/admin/curriculum/questions/5', manage: true },
  { method: 'delete', path: '/admin/curriculum/questions/5', manage: true },
];

describe('admin curriculum RBAC matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
  });

  it.each(routes)('401 without a session: $method $path', async ({ method, path }) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)('403 for a learner: $method $path', async ({ method, path }) => {
    asUser(LEARNER);
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(403);
  });

  it.each(routes.filter((r) => r.manage))('403 for a read-only admin on a write: $method $path', async ({ method, path }) => {
    asUser(READ);
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(403);
  });

  it('no service is reached by an unauthorized request', async () => {
    asUser(LEARNER);
    for (const { method, path } of routes) {
      await request(app)[method](path).send({});
    }
    for (const svc of [adminSvc, itemSvc, quizSvc]) {
      for (const fn of Object.values(svc)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  });

  it('200 for a platform admin on reads', async () => {
    asUser(MANAGE);
    adminSvc.listCourses.mockResolvedValue([] as never);
    adminSvc.getCourse.mockResolvedValue({ courseId: 1 } as never);
    adminSvc.getModule.mockResolvedValue({ module: {}, items: [] } as never);
    quizSvc.getQuiz.mockResolvedValue({ quizId: 4 } as never);
    for (const path of ['/admin/curriculum/courses', '/admin/curriculum/courses/1', '/admin/curriculum/modules/2', '/admin/curriculum/quizzes/4']) {
      expect((await request(app).get(path)).status).toBe(200);
    }
  });

  it('201 on course create and the body reaches the service', async () => {
    asUser(MANAGE);
    adminSvc.createCourse.mockResolvedValue({ courseId: 16, slug: 'C16' } as never);
    const res = await request(app).post('/admin/curriculum/courses').send({ title: 'Kubernetes', difficultyId: 2, isPremium: true });
    expect(res.status).toBe(201);
    expect(adminSvc.createCourse).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9 }),
      { title: 'Kubernetes', difficultyId: 2, isPremium: true },
    );
  });
});

describe('admin curriculum validation and error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser(MANAGE);
  });

  it('422 for an invalid course slug and unknown body keys', async () => {
    expect((await request(app).post('/admin/curriculum/courses').send({ title: 'Kubernetes', difficultyId: 2, slug: 'course-3' })).status).toBe(422);
    expect((await request(app).post('/admin/curriculum/courses').send({ title: 'Kubernetes', difficultyId: 2, bogus: true })).status).toBe(422);
    expect(adminSvc.createCourse).not.toHaveBeenCalled();
  });

  it('422 for a non-numeric id and for an empty PATCH', async () => {
    expect((await request(app).get('/admin/curriculum/courses/abc')).status).toBe(422);
    expect((await request(app).patch('/admin/curriculum/courses/1').send({})).status).toBe(422);
  });

  it('maps SLUG_TAKEN, COURSE_EMPTY and 404 from the service', async () => {
    adminSvc.createCourse.mockRejectedValue(new ConflictError('taken', [{ code: 'SLUG_TAKEN' }]));
    const taken = await request(app).post('/admin/curriculum/courses').send({ title: 'Kubernetes', difficultyId: 2 });
    expect(taken.status).toBe(409);
    expect(JSON.stringify(taken.body)).toContain('SLUG_TAKEN');

    adminSvc.updateCourse.mockRejectedValue(new ConflictError('empty', [{ code: 'COURSE_EMPTY' }]));
    expect((await request(app).patch('/admin/curriculum/courses/1').send({ isPublished: true })).status).toBe(409);

    adminSvc.getCourse.mockRejectedValue(new NotFoundError('Course not found.'));
    expect((await request(app).get('/admin/curriculum/courses/99')).status).toBe(404);
  });

  it('validates the item create discriminated union', async () => {
    itemSvc.createItem.mockResolvedValue({ itemId: 3 } as never);
    expect((await request(app).post('/admin/curriculum/modules/2/items').send({ kind: 'lab', labId: 5 })).status).toBe(201);
    expect((await request(app).post('/admin/curriculum/modules/2/items').send({ kind: 'quiz', title: 'Quiz' })).status).toBe(201);
    expect((await request(app).post('/admin/curriculum/modules/2/items').send({ kind: 'lab' })).status).toBe(422);
    expect((await request(app).post('/admin/curriculum/modules/2/items').send({ kind: 'poll', title: 'x' })).status).toBe(422);
  });

  it('item publish needs a boolean and maps LAB_NOT_READY to 409', async () => {
    expect((await request(app).patch('/admin/curriculum/items/3/publish').send({})).status).toBe(422);
    itemSvc.publishItem.mockRejectedValue(new ConflictError('not ready', [{ code: 'LAB_NOT_READY' }]));
    expect((await request(app).patch('/admin/curriculum/items/3/publish').send({ isPublished: true })).status).toBe(409);
  });

  it('question create applies per-type rules at the request layer (422)', async () => {
    const bad = await request(app).post('/admin/curriculum/quizzes/4/questions').send({
      questionText: 'Pick one', questionType: 'multiple_choice',
      answers: [{ answerText: 'a', isCorrect: true, answerOrder: 1 }, { answerText: 'b', isCorrect: true, answerOrder: 2 }],
    });
    expect(bad.status).toBe(422);
    expect(quizSvc.createQuestion).not.toHaveBeenCalled();

    quizSvc.createQuestion.mockResolvedValue({ question: { questionId: 5 }, warnings: ['careful'] } as never);
    const ok = await request(app).post('/admin/curriculum/quizzes/4/questions').send({
      questionText: 'Pick one', questionType: 'multiple_choice',
      answers: [{ answerText: 'a', isCorrect: true, answerOrder: 1 }, { answerText: 'b', isCorrect: false, answerOrder: 2 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.warnings).toEqual(['careful']);
    expect(quizSvc.createQuestion).toHaveBeenCalledWith(
      expect.anything(), 4,
      expect.objectContaining({ config: expect.objectContaining({ wrongPenalty: 2, guessPenalty: 0 }) }),
    );
  });
});

describe('route order and removed routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser(MANAGE);
  });

  it('reorder literals are not captured by their /:id siblings', async () => {
    itemSvc.reorderItems.mockResolvedValue([] as never);
    adminSvc.reorderModules.mockResolvedValue([] as never);
    quizSvc.reorderQuestions.mockResolvedValue([] as never);
    expect((await request(app).patch('/admin/curriculum/modules/2/items/reorder').send({ itemIds: [2, 1] })).status).toBe(200);
    expect(itemSvc.reorderItems).toHaveBeenCalledWith(expect.anything(), 2, [2, 1]);
    expect(itemSvc.updateItemTitle).not.toHaveBeenCalled();
    expect((await request(app).patch('/admin/curriculum/courses/1/modules/reorder').send({ moduleIds: [2, 1] })).status).toBe(200);
    expect(adminSvc.updateCourse).not.toHaveBeenCalled();
    expect((await request(app).patch('/admin/curriculum/quizzes/4/questions/reorder').send({ questionIds: [2, 1] })).status).toBe(200);
    expect(quizSvc.updateQuestion).not.toHaveBeenCalled();
  });

  it('reorder bodies must be unique non-empty id lists (422)', async () => {
    expect((await request(app).patch('/admin/curriculum/modules/2/items/reorder').send({ itemIds: [] })).status).toBe(422);
    expect((await request(app).patch('/admin/curriculum/modules/2/items/reorder').send({ itemIds: [1, 1] })).status).toBe(422);
    expect((await request(app).patch('/admin/curriculum/modules/2/items/reorder').send({ lessonIds: [1, 2] })).status).toBe(422);
  });

  it.each([
    ['get', '/admin/curriculum/course'],
    ['patch', '/admin/curriculum/course'],
    ['post', '/admin/curriculum/lessons'],
    ['post', '/admin/curriculum/modules/2/lessons'],
    ['post', '/admin/curriculum/modules/2/quizzes'],
    ['patch', '/admin/curriculum/modules/2/lessons/reorder'],
  ] as const)('removed canonical or pre-spine route %s %s is 404', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(404);
  });
});

describe('removed learner canonical route', () => {
  it('GET /curriculum/course is 404 for a learner', async () => {
    asUser(LEARNER);
    expect((await request(app).get('/curriculum/course')).status).toBe(404);
  });
});
