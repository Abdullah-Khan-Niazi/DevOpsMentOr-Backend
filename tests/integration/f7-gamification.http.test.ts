import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { gamificationRouter } from '../../src/features/gamification/routes/gamification.routes';
import { adminGamificationRouter } from '../../src/features/gamification/routes/admin-gamification.routes';

/**
 * F7 §11 HTTP integration + security matrix at the request layer.
 *
 * `authenticate` is stubbed to inject a session identity; every other
 * middleware (authorizePermissions, validateRequest, asyncHandler,
 * errorMiddleware) runs for real, and the F7 services are stubbed so no
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
    optionalAuthenticate: (req: Request, _res: Response, next: NextFunction): void => {
      if (req.headers.authorization) {
        req.user = session.user as NonNullable<Request['user']>;
      }
      next();
    },
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});

vi.mock('../../src/features/gamification/services/gamification.service', () => ({
  gamificationService: { getMyProfile: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/badge.service', () => ({
  badgeService: {
    listBadges: vi.fn(),
    getBadgeDetail: vi.fn(),
    listBadgesForAdmin: vi.fn(),
  },
}));
vi.mock('../../src/features/gamification/services/achievement.service', () => ({
  achievementService: {
    listAchievements: vi.fn(),
    listAchievementsForAdmin: vi.fn(),
  },
}));
vi.mock('../../src/features/gamification/services/points.service', () => ({
  pointsService: { getHistory: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/certificate.service', () => ({
  certificateService: { getDownloadUrl: vi.fn(), verify: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/leaderboard.service', () => ({
  leaderboardService: {
    getGlobal: vi.fn(),
    getByCountry: vi.fn(),
    getSeason: vi.fn(),
    getClass: vi.fn(),
    getOrg: vi.fn(),
  },
}));
vi.mock('../../src/features/gamification/services/season.service', () => ({
  seasonService: { listSeasons: vi.fn(), getSeasonDetail: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/admin-badge.service', () => ({
  adminBadgeService: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/admin-achievement.service', () => ({
  adminAchievementService: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/admin-season.service', () => ({
  adminSeasonService: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/admin-points.service', () => ({
  adminPointsService: { adjust: vi.fn() },
}));
vi.mock('../../src/features/gamification/services/admin-certificate.service', () => ({
  adminCertificateService: { invalidate: vi.fn() },
}));
vi.mock('../../src/features/gamification/jobs/leaderboard-computation.job', () => ({
  leaderboardComputationJob: { triggerManual: vi.fn() },
}));

import { gamificationService } from '../../src/features/gamification/services/gamification.service';
import { badgeService } from '../../src/features/gamification/services/badge.service';
import { pointsService } from '../../src/features/gamification/services/points.service';
import { certificateService } from '../../src/features/gamification/services/certificate.service';
import { leaderboardService } from '../../src/features/gamification/services/leaderboard.service';
import { seasonService } from '../../src/features/gamification/services/season.service';
import { adminBadgeService } from '../../src/features/gamification/services/admin-badge.service';
import { adminAchievementService } from '../../src/features/gamification/services/admin-achievement.service';
import { adminSeasonService } from '../../src/features/gamification/services/admin-season.service';
import { adminPointsService } from '../../src/features/gamification/services/admin-points.service';
import { adminCertificateService } from '../../src/features/gamification/services/admin-certificate.service';
import { leaderboardComputationJob } from '../../src/features/gamification/jobs/leaderboard-computation.job';
import { errorMiddleware } from '../../src/shared/middleware';

const gamificationServiceMock = vi.mocked(gamificationService);
const badgeServiceMock = vi.mocked(badgeService);
const pointsServiceMock = vi.mocked(pointsService);
const certificateServiceMock = vi.mocked(certificateService);
const leaderboardServiceMock = vi.mocked(leaderboardService);
const seasonServiceMock = vi.mocked(seasonService);
const adminBadgeServiceMock = vi.mocked(adminBadgeService);
const adminAchievementServiceMock = vi.mocked(adminAchievementService);
const adminSeasonServiceMock = vi.mocked(adminSeasonService);
const adminPointsServiceMock = vi.mocked(adminPointsService);
const adminCertificateServiceMock = vi.mocked(adminCertificateService);
const leaderboardComputationJobMock = vi.mocked(leaderboardComputationJob);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(gamificationRouter);
  app.use('/admin', adminGamificationRouter);
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

const LEARNER = ['gamification:profile:read', 'gamification:certificate:download'];
const PROFESSOR = [...LEARNER, 'gamification:class:read'];
const ORG_ADMIN = [...LEARNER, 'gamification:org:read'];
const ADMIN = ['platform.gamification.manage'];
const NONE: string[] = [];

describe('F7 §11 HTTP integration + security matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: LEARNER });
  });

  describe('GAM-01 profile (authenticated, permission-gated)', () => {
    it('returns the learner profile for an authorized user', async () => {
      gamificationServiceMock.getMyProfile.mockResolvedValue({
        points: { balance: 120, totalEarned: 320 },
        globalRank: 4,
        countryRank: 2,
        badges: [],
        achievements: [],
        certificates: [],
        currentStreakDays: 3,
      });
      const response = await request(app).get('/gamification/me').expect(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.points.balance).toBe(120);
      expect(gamificationServiceMock.getMyProfile).toHaveBeenCalledWith(7);
    });

    it('denies access without the gamification permission (403)', async () => {
      asUser({ sub: 7, permissions: NONE });
      await request(app).get('/gamification/me').expect(403);
      expect(gamificationServiceMock.getMyProfile).not.toHaveBeenCalled();
    });

    it('denies access without a session (401)', async () => {
      session.user = null;
      await request(app).get('/gamification/me').expect(401);
    });
  });

  describe('GAM-03 badge detail', () => {
    it('rejects non-numeric badge ids (422)', async () => {
      await request(app).get('/gamification/badges/abc').expect(422);
      expect(badgeServiceMock.getBadgeDetail).not.toHaveBeenCalled();
    });

    it('delegates valid requests', async () => {
      badgeServiceMock.getBadgeDetail.mockResolvedValue({ badgeId: 1, badgeName: 'First Lab' });
      const response = await request(app).get('/gamification/badges/1').expect(200);
      expect(response.body.data.badgeId).toBe(1);
    });
  });

  describe('GAM-05 points history', () => {
    it('pages the ledger history', async () => {
      pointsServiceMock.getHistory.mockResolvedValue({ items: [], total: 0 });
      const response = await request(app).get('/gamification/points/history?page=2&limit=10').expect(200);
      expect(response.body.success).toBe(true);
      expect(pointsServiceMock.getHistory).toHaveBeenCalledWith(7, 2, 10);
    });

    it('rejects non-numeric limit (422)', async () => {
      await request(app).get('/gamification/points/history?limit=abc').expect(422);
    });
  });

  describe('GAM-06/07/08 public leaderboards', () => {
    it('serves the global leaderboard without a session', async () => {
      session.user = null;
      leaderboardServiceMock.getGlobal.mockResolvedValue({
        items: [], total: 0, page: 1, limit: 25, viewerRank: null,
      });
      const response = await request(app).get('/leaderboard/global').expect(200);
      expect(response.body.success).toBe(true);
      expect(leaderboardServiceMock.getGlobal).toHaveBeenCalledWith(1, 25, null);
    });

    it('attaches the viewer rank when authenticated', async () => {
      leaderboardServiceMock.getGlobal.mockResolvedValue({
        items: [], total: 0, page: 1, limit: 25, viewerRank: 7,
      });
      await request(app)
        .get('/leaderboard/global')
        .set('Authorization', 'Bearer test-token')
        .expect(200);
      expect(leaderboardServiceMock.getGlobal).toHaveBeenCalledWith(1, 25, 7);
    });

    it('serves the country leaderboard with a validated country code', async () => {
      session.user = null;
      leaderboardServiceMock.getByCountry.mockResolvedValue({
        items: [], total: 0, page: 1, limit: 25, viewerRank: null,
      });
      await request(app).get('/leaderboard/country/US').expect(200);
      expect(leaderboardServiceMock.getByCountry).toHaveBeenCalledWith('US', 1, 25, null);
    });

    it('rejects malformed country codes (422)', async () => {
      await request(app).get('/leaderboard/country/USA!').expect(422);
    });

    it('serves the season leaderboard for a valid season id', async () => {
      session.user = null;
      leaderboardServiceMock.getSeason.mockResolvedValue({
        items: [], total: 0, page: 1, limit: 25, viewerRank: null,
      });
      await request(app).get('/leaderboard/season/3').expect(200);
      expect(leaderboardServiceMock.getSeason).toHaveBeenCalledWith(3, 1, 25, null);
    });
  });

  describe('GAM-09 class leaderboard (cohort RBAC)', () => {
    it('allows professors with class:read', async () => {
      asUser({ sub: 3, permissions: PROFESSOR, roles: ['professor'] });
      leaderboardServiceMock.getClass.mockResolvedValue({ className: 'CS-101', items: [], total: 0 });
      const response = await request(app).get('/leaderboard/class/5').expect(200);
      expect(response.body.data.className).toBe('CS-101');
    });

    it('allows org admins with org:read', async () => {
      asUser({ sub: 4, permissions: ORG_ADMIN, roles: ['org_admin'] });
      await request(app).get('/leaderboard/class/5').expect(200);
    });

    it('denies learners without cohort permissions (403)', async () => {
      await request(app).get('/leaderboard/class/5').expect(403);
      expect(leaderboardServiceMock.getClass).not.toHaveBeenCalled();
    });
  });

  describe('GAM-10 org leaderboard', () => {
    it('denies learners without org:read (403)', async () => {
      await request(app).get('/leaderboard/org/2').expect(403);
    });

    it('allows org admins with org:read', async () => {
      asUser({ sub: 4, permissions: ORG_ADMIN, roles: ['org_admin'] });
      leaderboardServiceMock.getOrg.mockResolvedValue({ items: [], total: 0 });
      await request(app).get('/leaderboard/org/2').expect(200);
    });
  });

  describe('GAM-11/12 seasons catalog (public)', () => {
    it('lists seasons without authentication', async () => {
      seasonServiceMock.listSeasons.mockResolvedValue([]);
      const response = await request(app).get('/seasons').expect(200);
      expect(response.body.success).toBe(true);
    });

    it('returns season detail for a valid id', async () => {
      seasonServiceMock.getSeasonDetail.mockResolvedValue({
        seasonId: 1, seasonName: 'S1', seasonNumber: 1, description: null, bannerUrl: null,
        startDate: '2026-01-01', endDate: '2026-03-31', isActive: true, content: [],
      });
      await request(app).get('/seasons/1').expect(200);
    });

    it('rejects non-numeric season ids (422)', async () => {
      await request(app).get('/seasons/abc').expect(422);
    });
  });

  describe('GAM-13 certificate download (owner only)', () => {
    it('delegates the download URL for the owner', async () => {
      certificateServiceMock.getDownloadUrl.mockResolvedValue({
        certificateId: 9,
        certificateNumber: 'DM-2026-abcdef12',
        courseTitle: 'DevOps',
        grade: 92.5,
        issuedAt: '2026-01-01T00:00:00.000Z',
        isValid: true,
        downloadUrl: 'https://verify.example.com/verify/DM-2026-abcdef12',
      });
      const response = await request(app).get('/certificates/9/download').expect(200);
      expect(response.body.data.downloadUrl).toContain('verify.example.com');
      expect(certificateServiceMock.getDownloadUrl).toHaveBeenCalledWith(7, 9, false);
    });

    it('denies learners without the download permission (403)', async () => {
      asUser({ sub: 7, permissions: NONE });
      await request(app).get('/certificates/9/download').expect(403);
    });
  });

  describe('GAM-14 public certificate verification', () => {
    it('verifies a certificate without any session', async () => {
      certificateServiceMock.verify.mockResolvedValue({
        certificateNumber: 'DM-2026-abcdef12',
        holderName: 'Jane Doe',
        courseTitle: 'DevOps',
        issuedAt: '2026-01-01T00:00:00.000Z',
        isValid: true,
      });
      const response = await request(app).get('/certificates/verify/DM-2026-abcdef12').expect(200);
      expect(response.body.data.isValid).toBe(true);
      expect(response.body.data).not.toHaveProperty('userId');
    });

    it('rejects certificate numbers with unexpected characters (422)', async () => {
      await request(app).get('/certificates/verify/BAD%20NUMBER!').expect(422);
    });
  });

  describe('GAM-15..23 admin surface (platform.gamification.manage)', () => {
    beforeEach(() => {
      asUser({ sub: 1, permissions: ADMIN, roles: ['platform_admin'] });
    });

    it('GAM-15 creates a badge', async () => {
      adminBadgeServiceMock.create.mockResolvedValue({ badgeId: 1, badgeName: 'First Lab', slug: 'first-lab' });
      const response = await request(app)
        .post('/admin/badges')
        .send({ badgeName: 'First Lab', slug: 'first-lab', badgeType: 'gold', pointsRequired: 50, isHidden: false })
        .expect(201);
      expect(response.body.data.badgeId).toBe(1);
    });

    it('GAM-15 rejects an invalid badgeType (422)', async () => {
      await request(app)
        .post('/admin/badges')
        .send({ badgeName: 'X', slug: 'x', badgeType: 'legendary', pointsRequired: 1, isHidden: false })
        .expect(422);
    });

    it('GAM-16 updates a badge', async () => {
      adminBadgeServiceMock.update.mockResolvedValue({ badgeId: 1, badgeName: 'Renamed', slug: 'first-lab' });
      await request(app)
        .patch('/admin/badges/1')
        .send({ badgeName: 'Renamed' })
        .expect(200);
      expect(adminBadgeServiceMock.update).toHaveBeenCalledWith(1, { badgeName: 'Renamed' });
    });

    it('GAM-17 creates an achievement', async () => {
      adminAchievementServiceMock.create.mockResolvedValue({ achievementId: 2, name: 'Streak 7' });
      const response = await request(app)
        .post('/admin/achievements')
        .send({ name: 'Streak 7', pointsAwarded: 30, triggerType: 'streak_days', triggerValue: { count: 7 }, isActive: true })
        .expect(201);
      expect(response.body.data.achievementId).toBe(2);
    });

    it('GAM-18 updates an achievement', async () => {
      adminAchievementServiceMock.update.mockResolvedValue({ achievementId: 2, name: 'Streak 14' });
      await request(app)
        .patch('/admin/achievements/2')
        .send({ triggerValue: { count: 14 } })
        .expect(200);
    });

    it('GAM-19 creates a season', async () => {
      adminSeasonServiceMock.create.mockResolvedValue({ seasonId: 1, seasonName: 'S1', seasonNumber: 1 });
      await request(app)
        .post('/admin/seasons')
        .send({ seasonName: 'S1', seasonNumber: 1, startDate: '2026-01-01', endDate: '2026-03-31', isActive: true })
        .expect(201);
    });

    it('GAM-19 rejects invalid date ranges (422)', async () => {
      await request(app)
        .post('/admin/seasons')
        .send({ seasonName: 'S1', seasonNumber: 1, startDate: '2026-01-01', endDate: 'not-a-date', isActive: true })
        .expect(422);
    });

    it('GAM-20 updates a season with content but only lab content type (AC-09)', async () => {
      adminSeasonServiceMock.update.mockResolvedValue({ seasonId: 1, seasonName: 'S1' });
      await request(app)
        .patch('/admin/seasons/1')
        .send({ content: [{ contentType: 'lab', contentId: 11, releaseOrder: 1, isReleased: true }] })
        .expect(200);
      expect(adminSeasonServiceMock.update).toHaveBeenCalledWith(1, expect.objectContaining({ content: expect.any(Array) }));
    });

    it('GAM-20 rejects unsupported content types (422)', async () => {
      await request(app)
        .patch('/admin/seasons/1')
        .send({ content: [{ contentType: 'course', contentId: 1, releaseOrder: 1, isReleased: true }] })
        .expect(422);
    });

    it('GAM-21 adjusts points', async () => {
      adminPointsServiceMock.adjust.mockResolvedValue({ historyId: 42, newBalance: 110 });
      const response = await request(app)
        .post('/admin/gamification/points/adjust')
        .send({ targetUserId: 7, pointsChange: 10, description: 'Correction' })
        .expect(201);
      expect(response.body.data.newBalance).toBe(110);
    });

    it('GAM-21 rejects a zero points change (422)', async () => {
      await request(app)
        .post('/admin/gamification/points/adjust')
        .send({ targetUserId: 7, pointsChange: 0, description: 'x' })
        .expect(422);
    });

    it('GAM-22 invalidates a certificate', async () => {
      adminCertificateServiceMock.invalidate.mockResolvedValue({ certificateId: 9, isValid: false });
      await request(app).patch('/admin/certificates/9/invalidate').expect(200);
    });

    it('GAM-23 recomputes the leaderboard', async () => {
      leaderboardComputationJobMock.triggerManual.mockResolvedValue({ processedUsers: 10, snapshotRows: 10 });
      const response = await request(app).post('/admin/leaderboard/recompute').expect(200);
      expect(response.body.data.processedUsers).toBe(10);
    });

    it('denies every admin route without platform.gamification.manage (403)', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      await request(app).post('/admin/badges').send({ badgeName: 'X', slug: 'x', badgeType: 'gold', pointsRequired: 1, isHidden: false }).expect(403);
      await request(app).post('/admin/achievements').send({ name: 'X', pointsAwarded: 1, triggerType: 'lab_completions', triggerValue: { count: 1 }, isActive: true }).expect(403);
      await request(app).post('/admin/seasons').send({ seasonName: 'X', seasonNumber: 9, startDate: '2026-01-01', endDate: '2026-03-31', isActive: false }).expect(403);
      await request(app).post('/admin/gamification/points/adjust').send({ targetUserId: 1, pointsChange: 5, description: 'x' }).expect(403);
      await request(app).patch('/admin/certificates/9/invalidate').expect(403);
      await request(app).post('/admin/leaderboard/recompute').expect(403);
    });
  });
});