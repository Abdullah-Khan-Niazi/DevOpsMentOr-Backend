import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { ConflictError, ForbiddenError } from '../../src/shared/errors';
import { labsRouter } from '../../src/features/labs/routes/labsRouter';
import { adminLabsRouter } from '../../src/features/labs/routes/adminLabsRouter';

/**
 * F6 §11 HTTP integration + security matrix at the request layer.
 *
 * `authenticate` is stubbed to inject a session identity; every other
 * middleware (authorizePermissions, rateLimit, validateRequest, asyncHandler,
 * errorMiddleware) runs for real, and the F6 services are stubbed so no
 * database, Redis, or external API is touched.
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
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});

vi.mock('../../src/features/labs/services/LabService', () => ({
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

vi.mock('../../src/features/labs/services/VpnService', () => ({
  vpnService: {
    getOrCreateAssignment: vi.fn(),
    getOvpnConfigForDownload: vi.fn(),
  },
}));

vi.mock('../../src/features/labs/services/AssertionService', () => ({
  assertionService: {
    runChecks: vi.fn(),
  },
}));

vi.mock('../../src/features/labs/services/SherlockService', () => ({
  sherlockService: {
    submitAnswers: vi.fn(),
  },
}));

vi.mock('../../src/features/labs/services/AiMentorService', () => ({
  aiMentorService: {
    sendMessage: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
  },
}));

vi.mock('../../src/features/labs/services/TrackService', () => ({
  trackService: {
    listTracks: vi.fn(),
    getTrackDetail: vi.fn(),
    getTrackProgress: vi.fn(),
  },
}));

vi.mock('../../src/features/labs/services/AdminLabService', () => ({
  adminLabService: {
    createLab: vi.fn(),
    updateLab: vi.fn(),
    publishLab: vi.fn(),
    createTrack: vi.fn(),
    updateTrack: vi.fn(),
    listInstancesAdmin: vi.fn(),
    terminateInstanceAdmin: vi.fn(),
  },
}));

import { labService } from '../../src/features/labs/services/LabService';
import { vpnService } from '../../src/features/labs/services/VpnService';
import { assertionService } from '../../src/features/labs/services/AssertionService';
import { sherlockService } from '../../src/features/labs/services/SherlockService';
import { aiMentorService } from '../../src/features/labs/services/AiMentorService';
import { adminLabService } from '../../src/features/labs/services/AdminLabService';
import { errorMiddleware } from '../../src/shared/middleware';

const labServiceMock = vi.mocked(labService);
const vpnServiceMock = vi.mocked(vpnService);
const assertionServiceMock = vi.mocked(assertionService);
const sherlockServiceMock = vi.mocked(sherlockService);
const aiMentorServiceMock = vi.mocked(aiMentorService);
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

describe('F6 §11 HTTP integration + security matrix', () => {
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
      expect(labServiceMock.provisionInstance).toHaveBeenCalledWith(7, 1, 'US');
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

  describe('LAB-08 assertion checks', () => {
    it('returns assertion results only as PASS/FAIL + hints', async () => {
      assertionServiceMock.runChecks.mockResolvedValue({
        instanceId: 42,
        assertions: [
          { name: 'cp1', passed: true, message: null },
          { name: 'cp2', passed: false, message: 'Your pods are not running.' },
        ],
        allPassed: false,
        completedAt: null,
      } as never);
      const res = await request(app).post('/labs/instances/42/assert');
      expect(res.status).toBe(200);
      expect(res.body.data.assertions).toHaveLength(2);
      expect(JSON.stringify(res.body)).not.toContain('exitCode');
      expect(JSON.stringify(res.body)).not.toContain('stdout');
    });

    it('maps a non-running instance to 409', async () => {
      assertionServiceMock.runChecks.mockRejectedValue(
        new ConflictError('instance must be running'),
      );
      const res = await request(app).post('/labs/instances/42/assert');
      expect(res.status).toBe(409);
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