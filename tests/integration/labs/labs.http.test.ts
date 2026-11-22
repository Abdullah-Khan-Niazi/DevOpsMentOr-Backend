import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../src/shared/errors';
import { labsRouter } from '../../../src/features/labs/routes/labsRouter';
import { adminLabsRouter } from '../../../src/features/labs/routes/adminLabsRouter';

/**
 *  HTTP integration + security matrix at the request layer.
 *
 * `authenticate` is stubbed to inject a session identity; every other
 * middleware (authorizePermissions, rateLimit, validateRequest, asyncHandler,
 * errorMiddleware) runs for real, and the services are stubbed so no
 * database, Redis, or external API is touched.
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
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});

vi.mock('../../../src/features/labs/services/LabService', () => ({
  labService: {
    listLabs: vi.fn(),
    getLabDetail: vi.fn(),
    provisionInstance: vi.fn(),
    getActiveInstance: vi.fn(),
    stopInstance: vi.fn(),
    terminateInstance: vi.fn(),
    extendInstance: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/VpnService', () => ({
  vpnService: {
    getOrCreateAssignment: vi.fn(),
    getOvpnConfigForDownload: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/SherlockService', () => ({
  sherlockService: {
    submitAnswers: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/AiMentorService', () => ({
  aiMentorService: {
    sendMessage: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/TrackService', () => ({
  trackService: {
    listTracks: vi.fn(),
    getDefaultTrack: vi.fn(),
    getTrackDetail: vi.fn(),
    getTrackProgress: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/LabStepService', () => ({
  labStepService: {
    getState: vi.fn(),
    stage: vi.fn(),
    check: vi.fn(),
    revealHint: vi.fn(),
  },
}));

vi.mock('../../../src/features/labs/services/WalkthroughService', () => ({
  walkthroughService: { getWalkthrough: vi.fn() },
}));

vi.mock('../../../src/features/labs/services/SlidesService', () => ({
  slidesService: { getSlides: vi.fn() },
}));

vi.mock('../../../src/features/labs/services/AdminLabService', () => ({
  adminLabService: {
    listLabsAdmin: vi.fn(),
    catalog: vi.fn(),
    importFromCatalog: vi.fn(),
    validateSpec: vi.fn(),
    createLab: vi.fn(),
    getLab: vi.fn(),
    updateLab: vi.fn(),
    saveSpec: vi.fn(),
    publishLab: vi.fn(),
    deleteLab: vi.fn(),
    testCheck: vi.fn(),
    listTracksAdmin: vi.fn(),
    createTrack: vi.fn(),
    getTrack: vi.fn(),
    updateTrack: vi.fn(),
    attachTrackContent: vi.fn(),
    updateTrackContent: vi.fn(),
    detachTrackContent: vi.fn(),
    reorderTrackContent: vi.fn(),
    listInstancesAdmin: vi.fn(),
    terminateInstanceAdmin: vi.fn(),
  },
}));

import { labService } from '../../../src/features/labs/services/LabService';
import { vpnService } from '../../../src/features/labs/services/VpnService';
import { sherlockService } from '../../../src/features/labs/services/SherlockService';
import { aiMentorService } from '../../../src/features/labs/services/AiMentorService';
import { labStepService } from '../../../src/features/labs/services/LabStepService';
import { walkthroughService } from '../../../src/features/labs/services/WalkthroughService';
import { trackService } from '../../../src/features/labs/services/TrackService';
import { adminLabService } from '../../../src/features/labs/services/AdminLabService';
import { errorMiddleware } from '../../../src/shared/middleware';

const labServiceMock = vi.mocked(labService);
const vpnServiceMock = vi.mocked(vpnService);
const sherlockServiceMock = vi.mocked(sherlockService);
const aiMentorServiceMock = vi.mocked(aiMentorService);
const stepServiceMock = vi.mocked(labStepService);
const walkthroughMock = vi.mocked(walkthroughService);
const trackServiceMock = vi.mocked(trackService);
const adminLabServiceMock = vi.mocked(adminLabService);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(labsRouter);
  app.use('/admin', adminLabsRouter);
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

const LEARNER = [
  'labs:instance:create',
  'labs:instance:read',
  'labs:instance:delete',
  'labs:ai-mentor:use',
];
const ADMIN = ['platform.labs.manage'];
const OPS = ['platform.labs.admin'];

describe(' HTTP integration + security matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: LEARNER });
  });

  describe('LAB-03 provision', () => {
    it('returns 201 with rootPassword for a valid provision', async () => {
      labServiceMock.provisionInstance.mockResolvedValue({
        instanceId: 42,
        labId: 1,
        status: 'running',
        hostname: 'box.example.com',
        assignedIp: '10.0.0.42',
        sshPort: 22,
        rootPassword: 's3cret',
        terminalWsUrl: 'wss://terminal/42',
        expiresAt: '2026-02-01T14:00:00Z',
        vpnAssignment: { ovpnConfigUrl: null },
      } as never);
      const res = await request(app).post('/labs/1/instances').send({ region: 'US' });
      expect(res.status).toBe(201);
      expect(res.body.data.instance.rootPassword).toBe('s3cret');
      expect(labServiceMock.provisionInstance).toHaveBeenCalledWith(7, 1, 'US', { allowInactive: false });
    });

    it('rejects a provision attempt without the create permission (403)', async () => {
      asUser({ sub: 7, permissions: ['labs:instance:read'] });
      const res = await request(app).post('/labs/1/instances').send({});
      expect(res.status).toBe(403);
      expect(labServiceMock.provisionInstance).not.toHaveBeenCalled();
    });

    it('rejects an unknown region with 422', async () => {
      const res = await request(app).post('/labs/1/instances').send({ region: 'MARS' });
      expect(res.status).toBe(422);
    });

    it('maps a duplicate-instance conflict to 409', async () => {
      labServiceMock.provisionInstance.mockRejectedValue(
        new ConflictError('INSTANCE_ALREADY_ACTIVE'),
      );
      const res = await request(app).post('/labs/1/instances').send({});
      expect(res.status).toBe(409);
    });

    it('maps an entitlement denial to 403', async () => {
      labServiceMock.provisionInstance.mockRejectedValue(
        new ForbiddenError('premium subscription required'),
      );
      const res = await request(app).post('/labs/1/instances').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('LAB-04 active instance + rootPassword single-use (AC-02)', () => {
    it('returns the active instance WITHOUT rootPassword', async () => {
      labServiceMock.getActiveInstance.mockResolvedValue({
        instanceId: 42,
        labId: 1,
        labName: 'Docker',
        slug: 'docker',
        status: 'running',
        hostname: 'box',
        assignedIp: '10.0.0.42',
        sshPort: 22,
        ramGb: 4,
        cpuCores: 4,
        diskGb: 30,
        startedAt: '2026-02-01T10:00:00Z',
        expiresAt: '2026-02-01T12:00:00Z',
        terminalWsUrl: 'wss://terminal/42',
      } as never);
      const res = await request(app).get('/labs/instances/active');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('rootPassword');
      expect(res.body.data.instance.instanceId).toBe(42);
    });
  });

  describe('LAB-09 sherlock submission (AC-03)', () => {
    it('never leaks sherlocks.answers', async () => {
      sherlockServiceMock.submitAnswers.mockResolvedValue({
        labId: 2,
        results: [
          { questionId: 'q1', passed: true },
          { questionId: 'q2', passed: false },
        ],
        isPassed: false,
        score: 50,
      } as never);
      const res = await request(app)
        .post('/labs/2/sherlock/submit')
        .send({ answers: [{ questionId: 'q1', answer: '8080' }] });
      expect(res.status).toBe(200);
      expect(res.body.data.results[0].passed).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('correctAnswer');
      expect(JSON.stringify(res.body)).not.toContain('"answers"');
    });

    it('rejects empty answers with 422', async () => {
      const res = await request(app).post('/labs/2/sherlock/submit').send({ answers: [] });
      expect(res.status).toBe(422);
    });
  });

  describe('LAB-10 VPN config', () => {
    it('returns the signed config URL', async () => {
      vpnServiceMock.getOrCreateAssignment.mockResolvedValue({
        assignmentId: 5,
        vpnId: 1,
        serverName: 'us-east-1',
        serverLocation: 'Virginia',
        region: 'US',
        ovpnConfigUrl: 'https://api/labs/vpn/ovpn/5?exp=1&sig=abc',
        assignedAt: '2026-02-01T10:00:00Z',
        expiresAt: null,
      } as never);
      const res = await request(app).get('/labs/vpn/config?region=US');
      expect(res.status).toBe(200);
      expect(res.body.data.config.ovpnConfigUrl).toContain('sig=');
    });
  });

  describe('LAB-11 AI Mentor', () => {
    it('streams SSE tokens', async () => {
      aiMentorServiceMock.sendMessage.mockReturnValue(
        (async function* () {
          yield 'hel';
          yield 'lo';
        })(),
      );
      const res = await request(app)
        .post('/labs/ai-mentor/message')
        .send({ message: 'hello', lessonId: 20 });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('"delta":"hel"');
      expect(res.text).toContain('"done":true');
    });

    it('requires the ai-mentor permission', async () => {
      asUser({ sub: 7, permissions: ['labs:instance:read'] });
      const res = await request(app)
        .post('/labs/ai-mentor/message')
        .send({ message: 'hello', lessonId: 20 });
      expect(res.status).toBe(403);
    });
  });

  describe('LAB-16 admin lab creation', () => {
    it('accepts a valid pro_lab payload', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminLabServiceMock.createLab.mockResolvedValue({
        labId: 1,
        labName: 'Docker',
        slug: 'docker',
        description: null,
        difficultyId: 1,
        difficultyName: 'Beginner',
        categoryId: null,
        categoryName: null,
        labType: 'pro_lab',
        isActive: true,
        isPremium: false,
        estimatedHours: 4,
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-02-01T10:00:00Z',
      } as never);
      const res = await request(app).post('/admin/labs').send({
        labName: 'Docker Deep Dive',
        slug: 'docker-deep-dive',
        difficultyId: 1,
        labType: 'pro_lab',
        proLabConfig: { totalMachines: 2, requiredRootCount: 1 },
      });
      expect(res.status).toBe(201);
    });

    it('rejects a sherlock lab without sherlockConfig (422)', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      const res = await request(app).post('/admin/labs').send({
        labName: 'Forensics',
        slug: 'forensics',
        difficultyId: 1,
        labType: 'sherlock',
      });
      expect(res.status).toBe(422);
      expect(adminLabServiceMock.createLab).not.toHaveBeenCalled();
    });

    it('rejects non-admins (403)', async () => {
      const res = await request(app).post('/admin/labs').send({
        labName: 'Docker',
        slug: 'docker',
        difficultyId: 1,
        labType: 'vip_lab',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('LAB-22 admin instance termination (AC-10)', () => {
    it('lets a platform admin terminate any instance', async () => {
      asUser({ sub: 1, permissions: OPS });
      adminLabServiceMock.terminateInstanceAdmin.mockResolvedValue({
        instanceId: 42,
        status: 'terminated',
      } as never);
      const res = await request(app).delete('/admin/lab-instances/42').send({ reason: 'abuse' });
      expect(res.status).toBe(200);
      expect(adminLabServiceMock.terminateInstanceAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        42,
        'abuse',
      );
    });

    it('rejects a learner without the admin permission', async () => {
      const res = await request(app).delete('/admin/lab-instances/42').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('route params & zod coercion', () => {
    it('rejects non-numeric instance ids with 422', async () => {
      const res = await request(app).delete('/labs/instances/abc');
      expect(res.status).toBe(422);
    });
  });
});
describe('lab step routes matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: LEARNER });
  });

  const stepRoutes = [
    { method: 'get', path: '/labs/1/steps', body: undefined },
    { method: 'post', path: '/labs/instances/42/steps/s1/stage', body: {} },
    { method: 'post', path: '/labs/instances/42/steps/s1/check', body: {} },
    { method: 'post', path: '/labs/1/steps/s1/hints/0/reveal', body: {} },
    { method: 'get', path: '/labs/1/walkthrough', body: undefined },
  ] as const;

  it.each(stepRoutes)('401 without a session: $method $path', async ({ method, path, body }) => {
    session.user = null;
    const res = await request(app)[method](path).send(body);
    expect(res.status).toBe(401);
  });

  it.each(stepRoutes)('403 without the instance read permission: $method $path', async ({ method, path, body }) => {
    asUser({ sub: 7, permissions: ['labs:ai-mentor:use'] });
    const res = await request(app)[method](path).send(body);
    expect(res.status).toBe(403);
    expect(stepServiceMock.getState).not.toHaveBeenCalled();
    expect(stepServiceMock.check).not.toHaveBeenCalled();
    expect(stepServiceMock.revealHint).not.toHaveBeenCalled();
  });

  it('GET /labs/:labId/steps returns the state with the session user and 404/409 from the service', async () => {
    stepServiceMock.getState.mockResolvedValue({ labId: 1, steps: [] } as never);
    const ok = await request(app).get('/labs/1/steps');
    expect(ok.status).toBe(200);
    expect(stepServiceMock.getState).toHaveBeenCalledWith(7, 1);

    stepServiceMock.getState.mockRejectedValueOnce(new NotFoundError('Lab not found.', [{ code: 'LAB_NOT_FOUND' }]));
    expect((await request(app).get('/labs/99/steps')).status).toBe(404);
    stepServiceMock.getState.mockRejectedValueOnce(new ConflictError('not ready', [{ code: 'LAB_NOT_READY' }]));
    expect((await request(app).get('/labs/1/steps')).status).toBe(409);
    expect((await request(app).get('/labs/abc/steps')).status).toBe(422);
  });

  it('stage: 200 with the instance and step from the URL, 409 STEP_LOCKED / STEP_STAGE_IN_PROGRESS, 422 for a bad step id or body', async () => {
    stepServiceMock.stage.mockResolvedValue({ stepId: 's1', instanceId: 42, setupRan: true } as never);
    expect((await request(app).post('/labs/instances/42/steps/s1/stage').send({})).status).toBe(200);
    expect(stepServiceMock.stage).toHaveBeenCalledWith(7, 42, 's1');

    for (const code of ['STEP_LOCKED', 'STEP_STAGE_IN_PROGRESS', 'INSTANCE_NOT_RUNNING']) {
      stepServiceMock.stage.mockRejectedValueOnce(new ConflictError('conflict', [{ code }]));
      const res = await request(app).post('/labs/instances/42/steps/s1/stage').send({});
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain(code);
    }
    stepServiceMock.stage.mockRejectedValueOnce(new NotFoundError('Instance not found.'));
    expect((await request(app).post('/labs/instances/43/steps/s1/stage').send({})).status).toBe(404);

    stepServiceMock.stage.mockClear();
    expect((await request(app).post('/labs/instances/42/steps/Bad%20Id/stage').send({})).status).toBe(422);
    expect((await request(app).post('/labs/instances/42/steps/s1/stage').send({ x: 1 })).status).toBe(422);
    expect((await request(app).post('/labs/instances/0/steps/s1/stage').send({})).status).toBe(422);
    expect(stepServiceMock.stage).not.toHaveBeenCalled();
  });

  it('check: passes the answer through, rejects extra keys and over-long answers (422), maps 409 and 503', async () => {
    stepServiceMock.check.mockResolvedValue({ stepId: 's3', passed: true } as never);
    expect((await request(app).post('/labs/instances/42/steps/s3/check').send({ answer: 'nginx' })).status).toBe(200);
    expect(stepServiceMock.check).toHaveBeenCalledWith(7, 42, 's3', 'nginx');
    expect((await request(app).post('/labs/instances/42/steps/s1/check').send({})).status).toBe(200);
    expect(stepServiceMock.check).toHaveBeenLastCalledWith(7, 42, 's1', undefined);

    expect((await request(app).post('/labs/instances/42/steps/s3/check').send({ answer: 'a', stepId: 'x' })).status).toBe(422);
    expect((await request(app).post('/labs/instances/42/steps/s3/check').send({ answer: 'x'.repeat(501) })).status).toBe(422);

    stepServiceMock.check.mockRejectedValueOnce(new ConflictError('stage first', [{ code: 'STEP_NOT_STAGED' }]));
    expect((await request(app).post('/labs/instances/42/steps/s2/check').send({})).status).toBe(409);
    stepServiceMock.check.mockRejectedValueOnce(new AppError('unreachable', 503, [{ code: 'LAB_ENV_UNREACHABLE' }]));
    expect((await request(app).post('/labs/instances/42/steps/s1/check').send({})).status).toBe(503);
  });

  it('hint reveal: validates the index range, maps 404 HINT_NOT_FOUND and 409 HINT_OUT_OF_ORDER', async () => {
    stepServiceMock.revealHint.mockResolvedValue({ stepId: 's1', hintIndex: 0, text: 'T' } as never);
    expect((await request(app).post('/labs/1/steps/s1/hints/0/reveal').send({})).status).toBe(200);
    expect(stepServiceMock.revealHint).toHaveBeenCalledWith(7, 1, 's1', 0);
    expect((await request(app).post('/labs/1/steps/s1/hints/5/reveal').send({})).status).toBe(422);
    expect((await request(app).post('/labs/1/steps/s1/hints/-1/reveal').send({})).status).toBe(422);
    expect((await request(app).post('/labs/1/steps/s1/hints/0/reveal').send({ penalty: 0 })).status).toBe(422);

    stepServiceMock.revealHint.mockRejectedValueOnce(new NotFoundError('Hint not found.', [{ code: 'HINT_NOT_FOUND' }]));
    expect((await request(app).post('/labs/1/steps/s1/hints/4/reveal').send({})).status).toBe(404);
    stepServiceMock.revealHint.mockRejectedValueOnce(new ConflictError('order', [{ code: 'HINT_OUT_OF_ORDER' }]));
    expect((await request(app).post('/labs/1/steps/s1/hints/1/reveal').send({})).status).toBe(409);
  });

  it('walkthrough: 200 for an entitled learner, 403/404/409 mapped from the service', async () => {
    walkthroughMock.getWalkthrough.mockResolvedValue({ labId: 1, steps: [] } as never);
    expect((await request(app).get('/labs/1/walkthrough')).status).toBe(200);
    expect(walkthroughMock.getWalkthrough).toHaveBeenCalledWith(7, 1);
    walkthroughMock.getWalkthrough.mockRejectedValueOnce(new ForbiddenError('Complete the lab first.'));
    expect((await request(app).get('/labs/1/walkthrough')).status).toBe(403);
    walkthroughMock.getWalkthrough.mockRejectedValueOnce(new NotFoundError('Lab not found.'));
    expect((await request(app).get('/labs/9/walkthrough')).status).toBe(404);
    walkthroughMock.getWalkthrough.mockRejectedValueOnce(new ConflictError('not available'));
    expect((await request(app).get('/labs/1/walkthrough')).status).toBe(409);
  });

  it('passes the service DTO through untouched: no check, setup, accepted answers or unrevealed hint text appear', async () => {
    stepServiceMock.getState.mockResolvedValue({
      labId: 1,
      steps: [{ stepId: 's1', status: 'current', instructions: 'Do it', hints: { total: 2, revealed: [{ hintIndex: 0, text: 'visible' }], nextHintIndex: 1, cost: 5 } }],
    } as never);
    const res = await request(app).get('/labs/1/steps');
    const json = JSON.stringify(res.body);
    for (const forbidden of ['"check"', '"setup"', '"accepted"', '"answer"', 'unrevealed']) {
      expect(json).not.toContain(forbidden);
    }
    expect(json).toContain('visible');
  });

  it('the removed assertion route is 404 for both methods', async () => {
    expect((await request(app).post('/labs/instances/42/assert')).status).toBe(404);
    expect((await request(app).get('/labs/instances/42/assert')).status).toBe(404);
  });

  it('track progress is a read: 200 for a signed-in learner, 401 anonymous, 404 unknown track', async () => {
    trackServiceMock.getTrackProgress.mockResolvedValue({ trackId: 1, isCompleted: false } as never);
    expect((await request(app).get('/tracks/1/progress')).status).toBe(200);
    expect(trackServiceMock.getTrackProgress).toHaveBeenCalledWith(7, 1);
    trackServiceMock.getTrackProgress.mockRejectedValueOnce(new NotFoundError('Track not found.'));
    expect((await request(app).get('/tracks/99/progress')).status).toBe(404);
    session.user = null;
    expect((await request(app).get('/tracks/1/progress')).status).toBe(401);
  });
});

describe('admin labs and tracks matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 1, permissions: ADMIN });
  });

  const manageRoutes = [
    { method: 'get', path: '/admin/labs' },
    { method: 'get', path: '/admin/labs/catalog' },
    { method: 'post', path: '/admin/labs/import' },
    { method: 'post', path: '/admin/labs/spec/validate' },
    { method: 'post', path: '/admin/labs' },
    { method: 'get', path: '/admin/labs/1' },
    { method: 'patch', path: '/admin/labs/1' },
    { method: 'put', path: '/admin/labs/1/spec' },
    { method: 'patch', path: '/admin/labs/1/publish' },
    { method: 'delete', path: '/admin/labs/1' },
    { method: 'post', path: '/admin/labs/1/test-check' },
    { method: 'get', path: '/admin/tracks' },
    { method: 'post', path: '/admin/tracks' },
    { method: 'get', path: '/admin/tracks/1' },
    { method: 'patch', path: '/admin/tracks/1' },
    { method: 'post', path: '/admin/tracks/1/content' },
    { method: 'patch', path: '/admin/tracks/1/content/reorder' },
    { method: 'patch', path: '/admin/tracks/1/content/4' },
    { method: 'delete', path: '/admin/tracks/1/content/4' },
  ] as const;

  it.each(manageRoutes)('401 anonymous and 403 learner: $method $path', async ({ method, path }) => {
    session.user = null;
    expect((await request(app)[method](path).send({})).status).toBe(401);
    asUser({ sub: 7, permissions: LEARNER });
    expect((await request(app)[method](path).send({})).status).toBe(403);
  });

  it('the instance monitor needs platform.labs.admin, not manage', async () => {
    expect((await request(app).get('/admin/lab-instances')).status).toBe(403);
    expect((await request(app).delete('/admin/lab-instances/42').send({})).status).toBe(403);
  });

  it('catalog: 200 with the query parsed, 422 for a bad unusedOnly', async () => {
    adminLabServiceMock.catalog.mockResolvedValue([] as never);
    expect((await request(app).get('/admin/labs/catalog?unusedOnly=true')).status).toBe(200);
    expect(adminLabServiceMock.catalog).toHaveBeenCalledWith(true);
    expect((await request(app).get('/admin/labs/catalog?unusedOnly=maybe')).status).toBe(422);
  });

  it('import: only CxxMxxLxx slugs, strict body; 404/409/503 map from the service', async () => {
    adminLabServiceMock.importFromCatalog.mockResolvedValue({ lab: { labId: 1 }, created: true } as never);
    expect((await request(app).post('/admin/labs/import').send({ slug: 'C01M01L01' })).status).toBeLessThan(300);
    for (const body of [{ slug: 'docker' }, { slug: 'C01M01L01', activate: true }, {}]) {
      expect((await request(app).post('/admin/labs/import').send(body)).status).toBe(422);
    }
    adminLabServiceMock.importFromCatalog.mockRejectedValueOnce(new NotFoundError('not in catalog', [{ code: 'CATALOG_LAB_NOT_FOUND' }]));
    expect((await request(app).post('/admin/labs/import').send({ slug: 'C01M01L09' })).status).toBe(404);
    adminLabServiceMock.importFromCatalog.mockRejectedValueOnce(new AppError('down', 503, [{ code: 'CATALOG_UNAVAILABLE' }]));
    expect((await request(app).post('/admin/labs/import').send({ slug: 'C01M01L01' })).status).toBe(503);
  });

  it('spec validate never 422s on a bad spec; spec save does', async () => {
    adminLabServiceMock.validateSpec.mockReturnValue({ valid: false, issues: [{ path: 'steps', message: 'bad' }], warnings: [] } as never);
    const res = await request(app).post('/admin/labs/spec/validate').send({ spec: { junk: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect((await request(app).put('/admin/labs/1/spec').send({ spec: { version: 2 } })).status).toBe(422);
    expect(adminLabServiceMock.saveSpec).not.toHaveBeenCalled();
  });

  it('publish: 409 LAB_NOT_READY and CATALOG_LAB_NOT_FOUND, 503 CATALOG_UNAVAILABLE', async () => {
    adminLabServiceMock.publishLab.mockResolvedValue({ labId: 1, isActive: true } as never);
    expect((await request(app).patch('/admin/labs/1/publish').send({ isActive: true })).status).toBe(200);
    expect((await request(app).patch('/admin/labs/1/publish').send({})).status).toBe(422);
    for (const code of ['LAB_NOT_READY', 'CATALOG_LAB_NOT_FOUND']) {
      adminLabServiceMock.publishLab.mockRejectedValueOnce(new ConflictError('gate', [{ code }]));
      expect((await request(app).patch('/admin/labs/1/publish').send({ isActive: true })).status).toBe(409);
    }
    adminLabServiceMock.publishLab.mockRejectedValueOnce(new AppError('down', 503, [{ code: 'CATALOG_UNAVAILABLE' }]));
    expect((await request(app).patch('/admin/labs/1/publish').send({ isActive: true })).status).toBe(503);
  });

  it('delete: 409 LAB_IN_USE / LAB_HAS_LEARNER_DATA and 404', async () => {
    for (const code of ['LAB_IN_USE', 'LAB_HAS_LEARNER_DATA']) {
      adminLabServiceMock.deleteLab.mockRejectedValueOnce(new ConflictError('guard', [{ code }]));
      expect((await request(app).delete('/admin/labs/1')).status).toBe(409);
    }
    adminLabServiceMock.deleteLab.mockRejectedValueOnce(new NotFoundError('Lab not found.'));
    expect((await request(app).delete('/admin/labs/9')).status).toBe(404);
  });

  it('test-check body needs exactly one of stepId or check and passes labs-admin through', async () => {
    adminLabServiceMock.testCheck.mockResolvedValue({ result: { passed: true } } as never);
    expect((await request(app).post('/admin/labs/1/test-check').send({ instanceId: 8, stepId: 's1' })).status).toBe(200);
    for (const body of [{ instanceId: 8 }, { instanceId: 8, stepId: 's1', check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } } }, { stepId: 's1' }]) {
      expect((await request(app).post('/admin/labs/1/test-check').send(body)).status).toBe(422);
    }
    expect(adminLabServiceMock.testCheck).toHaveBeenCalledTimes(1);
    expect(adminLabServiceMock.testCheck.mock.calls[0][3]).toBe(false);
  });

  it('tracks: create is strict (content and totalLabs rejected), SINGLE_TRACK_ONLY maps to 409', async () => {
    const body = { trackName: 'DevOps', slug: 'devops', difficultyId: 1 };
    adminLabServiceMock.createTrack.mockResolvedValue({ trackId: 1 } as never);
    expect((await request(app).post('/admin/tracks').send(body)).status).toBe(201);
    expect((await request(app).post('/admin/tracks').send({ ...body, totalLabs: 3 })).status).toBe(422);
    expect((await request(app).post('/admin/tracks').send({ trackName: 'DevOps', slug: 'devops' })).status).toBe(422);
    adminLabServiceMock.createTrack.mockRejectedValueOnce(new ConflictError('one', [{ code: 'SINGLE_TRACK_ONLY' }]));
    expect((await request(app).post('/admin/tracks').send(body)).status).toBe(409);
  });

  it('track content: attach/patch/reorder validation, route order and 404/409/422 from the service', async () => {
    adminLabServiceMock.attachTrackContent.mockResolvedValue({ trackId: 1 } as never);
    adminLabServiceMock.reorderTrackContent.mockResolvedValue({ trackId: 1 } as never);
    expect((await request(app).post('/admin/tracks/1/content').send({ courseId: 4 })).status).toBeLessThan(300);
    expect(adminLabServiceMock.attachTrackContent).toHaveBeenCalledWith(expect.anything(), 1, { courseId: 4, required: true });
    expect((await request(app).post('/admin/tracks/1/content').send({ courseId: 4, contentType: 'lab' })).status).toBe(422);

    // literal reorder is not captured by /content/:courseId
    expect((await request(app).patch('/admin/tracks/1/content/reorder').send({ courseIds: [2, 1] })).status).toBe(200);
    expect(adminLabServiceMock.reorderTrackContent).toHaveBeenCalledWith(expect.anything(), 1, [2, 1]);
    expect(adminLabServiceMock.updateTrackContent).not.toHaveBeenCalled();
    expect((await request(app).patch('/admin/tracks/1/content/reorder').send({ courseIds: [1, 1] })).status).toBe(422);

    expect((await request(app).patch('/admin/tracks/1/content/4').send({})).status).toBe(422);
    adminLabServiceMock.attachTrackContent.mockRejectedValueOnce(new ConflictError('dup', [{ code: 'TRACK_CONTENT_EXISTS' }]));
    expect((await request(app).post('/admin/tracks/1/content').send({ courseId: 4 })).status).toBe(409);
    adminLabServiceMock.detachTrackContent.mockRejectedValueOnce(new NotFoundError('nope', [{ code: 'TRACK_CONTENT_NOT_FOUND' }]));
    expect((await request(app).delete('/admin/tracks/1/content/4')).status).toBe(404);
    adminLabServiceMock.reorderTrackContent.mockRejectedValueOnce(new ValidationError('mismatch', [{ code: 'REORDER_SET_MISMATCH' }]));
    expect((await request(app).patch('/admin/tracks/1/content/reorder').send({ courseIds: [9] })).status).toBe(422);
  });

  it('curriculum admins (platform.curriculum.manage) may write tracks but not labs', async () => {
    asUser({ sub: 2, permissions: ['platform.curriculum.manage'] });
    adminLabServiceMock.listTracksAdmin.mockResolvedValue([] as never);
    expect((await request(app).get('/admin/tracks')).status).toBe(403);
    adminLabServiceMock.createTrack.mockResolvedValue({ trackId: 1 } as never);
    expect((await request(app).post('/admin/tracks').send({ trackName: 'DevOps', slug: 'devops', difficultyId: 1 })).status).toBe(201);
    expect((await request(app).get('/admin/labs')).status).toBe(403);
  });
});
