import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { notificationsRouter } from '../../src/features/notifications/routes/notifications.routes';
import { adminNotificationsRouter } from '../../src/features/notifications/routes/admin-notifications.routes';
import { communityRouter } from '../../src/features/community/routes/community.routes';
import { adminModerationRouter } from '../../src/features/community/routes/admin-moderation.routes';
import { operationsRouter } from '../../src/features/operations/routes/operations.routes';
import { adminOperationsRouter } from '../../src/features/operations/routes/admin-operations.routes';
import { adminAnalyticsRouter } from '../../src/features/analytics/routes/analytics.routes';

/**
 * F8 §11 HTTP integration + security matrix at the request layer.
 *
 * `authenticate`/`optionalAuthenticate` are stubbed to inject a session
 * identity; authorizePermissions, validateRequest, asyncHandler and
 * errorMiddleware run for real; all F8 services are stubbed so no database,
 * Redis, or external API is touched.
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
  const { UnauthorizedError } = await import('../../src/shared/errors');
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      if (!session.user) {
        next(new UnauthorizedError('Access token is required.'));
        return;
      }
      req.user = session.user as NonNullable<Request['user']>;
      next();
    },
    optionalAuthenticate: (req: Request, _res: Response, next: NextFunction): void => {
      if (req.headers.authorization && session.user) {
        req.user = session.user as NonNullable<Request['user']>;
      }
      next();
    },
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});

vi.mock('../../src/features/notifications/services/notification.service', () => ({
  notificationService: {
    listInbox: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    getPreferences: vi.fn(),
    updatePreference: vi.fn(),
  },
}));
vi.mock('../../src/features/notifications/services/announcement.service', () => ({
  announcementService: {
    listPublished: vi.fn(),
    markRead: vi.fn(),
  },
}));
vi.mock('../../src/features/notifications/services/admin-announcement.service', () => ({
  adminAnnouncementService: {
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    list: vi.fn(),
  },
}));
vi.mock('../../src/features/community/services/review.service', () => ({
  reviewService: {
    listApproved: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock('../../src/features/community/services/comment.service', () => ({
  commentService: {
    list: vi.fn(),
    create: vi.fn(),
    deleteOwn: vi.fn(),
  },
}));
vi.mock('../../src/features/community/services/like.service', () => ({
  likeService: {
    like: vi.fn(),
    unlike: vi.fn(),
  },
}));
vi.mock('../../src/features/community/services/report.service', () => ({
  reportService: {
    create: vi.fn(),
  },
}));
vi.mock('../../src/features/community/services/admin-moderation.service', () => ({
  adminModerationService: {
    listReviews: vi.fn(),
    approveReview: vi.fn(),
    deleteReview: vi.fn(),
    listComments: vi.fn(),
    pinComment: vi.fn(),
    hideComment: vi.fn(),
    listQueue: vi.fn(),
    resolveReport: vi.fn(),
    dismissReport: vi.fn(),
  },
}));
vi.mock('../../src/features/operations/services/event.service', () => ({
  eventService: {
    listEvents: vi.fn(),
    getEvent: vi.fn(),
    register: vi.fn(),
    cancelRegistration: vi.fn(),
  },
}));
vi.mock('../../src/features/operations/services/admin-event.service', () => ({
  adminEventService: {
    create: vi.fn(),
    update: vi.fn(),
    listAttendees: vi.fn(),
  },
}));
vi.mock('../../src/features/operations/services/file.service', () => ({
  fileService: {
    getDownloadUrl: vi.fn(),
    upload: vi.fn(),
    list: vi.fn(),
    signUrl: vi.fn(),
    verifySignature: vi.fn(),
    serve: vi.fn(),
  },
  handleFileServe: vi.fn().mockImplementation(async (_req: Request, res: Response) => {
    res.status(200).send(Buffer.from('file-bytes'));
  }),
}));
vi.mock('../../src/features/operations/controllers/file.controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/operations/controllers/file.controller')>();
  return {
    ...actual,
    singlePlatformFileUpload: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});
vi.mock('../../src/features/operations/services/email-template.service', () => ({
  emailTemplateService: {
    list: vi.fn(),
    update: vi.fn(),
    preview: vi.fn(),
  },
}));
vi.mock('../../src/features/analytics/services/analytics.service', () => ({
  analyticsService: {
    getOverview: vi.fn(),
    getActivityTrend: vi.fn(),
  },
}));

import { notificationService } from '../../src/features/notifications/services/notification.service';
import { announcementService } from '../../src/features/notifications/services/announcement.service';
import { adminAnnouncementService } from '../../src/features/notifications/services/admin-announcement.service';
import { reviewService } from '../../src/features/community/services/review.service';
import { commentService } from '../../src/features/community/services/comment.service';
import { likeService } from '../../src/features/community/services/like.service';
import { reportService } from '../../src/features/community/services/report.service';
import { adminModerationService } from '../../src/features/community/services/admin-moderation.service';
import { eventService } from '../../src/features/operations/services/event.service';
import { adminEventService } from '../../src/features/operations/services/admin-event.service';
import { emailTemplateService } from '../../src/features/operations/services/email-template.service';
import { analyticsService } from '../../src/features/analytics/services/analytics.service';
import { errorMiddleware } from '../../src/shared/middleware';

const notificationServiceMock = vi.mocked(notificationService);
const announcementServiceMock = vi.mocked(announcementService);
const adminAnnouncementServiceMock = vi.mocked(adminAnnouncementService);
const reviewServiceMock = vi.mocked(reviewService);
const commentServiceMock = vi.mocked(commentService);
const likeServiceMock = vi.mocked(likeService);
const reportServiceMock = vi.mocked(reportService);
const adminModerationServiceMock = vi.mocked(adminModerationService);
const eventServiceMock = vi.mocked(eventService);
const adminEventServiceMock = vi.mocked(adminEventService);
const emailTemplateServiceMock = vi.mocked(emailTemplateService);
const analyticsServiceMock = vi.mocked(analyticsService);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationsRouter);
  app.use('/admin', adminNotificationsRouter);
  app.use(communityRouter);
  app.use('/admin', adminModerationRouter);
  app.use(operationsRouter);
  app.use('/admin', adminOperationsRouter);
  app.use('/admin', adminAnalyticsRouter);
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
  'notifications:inbox:read',
  'notifications:preferences:write',
  'content:review:create',
  'content:comment:create',
  'content:like:create',
  'content:report:create',
  'events:register',
];
const MODERATOR = ['platform.content.moderate'];
const ADMIN = ['platform.admin.access', 'platform.analytics.read'];
const NONE: string[] = [];

describe('F8 §11 HTTP integration + security matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: LEARNER });
  });

  describe('OPS-01..06 notification inbox (AC-14 IDOR)', () => {
    it('returns the inbox for an authorized user', async () => {
      notificationServiceMock.listInbox.mockResolvedValue({
        data: [],
        unreadCount: 0,
        total: 0,
        page: 1,
      });
      const response = await request(app).get('/notifications').expect(200);
      expect(response.body.success).toBe(true);
      expect(notificationServiceMock.listInbox).toHaveBeenCalledWith(7, 1, 20, false);
    });

    it('denies access without the inbox permission (403)', async () => {
      asUser({ sub: 7, permissions: NONE });
      await request(app).get('/notifications').expect(403);
      expect(notificationServiceMock.listInbox).not.toHaveBeenCalled();
    });

    it('denies access without a session (401)', async () => {
      session.user = null;
      await request(app).get('/notifications').expect(401);
    });

    it('rejects a non-numeric notification id (422)', async () => {
      await request(app).patch('/notifications/abc/read').expect(422);
      expect(notificationServiceMock.markRead).not.toHaveBeenCalled();
    });

    it('scopes mark-read to the session user', async () => {
      notificationServiceMock.markRead.mockResolvedValue(true);
      await request(app).patch('/notifications/5/read').expect(200);
      expect(notificationServiceMock.markRead).toHaveBeenCalledWith(7, 5);
    });

    it('returns 404 when the notification is not owned', async () => {
      notificationServiceMock.markRead.mockResolvedValue(false);
      await request(app).patch('/notifications/999/read').expect(404);
    });

    it('updates channel preferences', async () => {
      notificationServiceMock.updatePreference.mockResolvedValue(undefined);
      await request(app)
        .put('/notifications/preferences')
        .send({ type: 'event', emailEnabled: true, pushEnabled: false, inAppEnabled: true })
        .expect(200);
      expect(notificationServiceMock.updatePreference).toHaveBeenCalledWith(7, 'event', true, false, true);
    });
  });

  describe('OPS-07/08 announcements (public, AC-13)', () => {
    it('lists published announcements for anonymous visitors', async () => {
      announcementServiceMock.listPublished.mockResolvedValue([]);
      const response = await request(app).get('/announcements').expect(200);
      expect(response.body.success).toBe(true);
      expect(announcementServiceMock.listPublished).toHaveBeenCalledWith(null);
    });

    it('requires a session to mark an announcement read', async () => {
      session.user = null;
      await request(app).post('/announcements/3/read').expect(401);
    });
  });

  describe('OPS-21..23 admin announcements', () => {
    it('creates an announcement as a moderator', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminAnnouncementServiceMock.create.mockResolvedValue({
        announcementId: 1,
        title: 'Maintenance',
        content: 'Downtime tonight.',
        announcementType: 'maintenance',
        priority: 'high',
        isPublished: false,
        publishedAt: null,
        expiresAt: null,
        createdBy: 1,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      });
      const response = await request(app)
        .post('/admin/announcements')
        .send({ title: 'Maintenance', content: 'Downtime tonight.', announcementType: 'maintenance' })
        .expect(201);
      expect(response.body.data.announcementId).toBe(1);
    });

    it('denies learners (403)', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      await request(app)
        .post('/admin/announcements')
        .send({ title: 'x', content: 'y', announcementType: 'general' })
        .expect(403);
      expect(adminAnnouncementServiceMock.create).not.toHaveBeenCalled();
    });

    it('publishes an announcement (OPS-23)', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminAnnouncementServiceMock.publish.mockResolvedValue({
        announcementId: 2,
        title: 't',
        content: 'c',
        announcementType: 'general',
        priority: 'medium',
        isPublished: true,
        publishedAt: '2026-08-16T00:00:00.000Z',
        expiresAt: null,
        createdBy: 1,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      });
      await request(app).patch('/admin/announcements/2/publish').expect(200);
      expect(adminAnnouncementServiceMock.publish).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        2,
      );
    });
  });

  describe('OPS-13/14 reviews (AC-02, AC-03, AC-09)', () => {
    it('submits a review pending approval (201)', async () => {
      reviewServiceMock.create.mockResolvedValue({
        reviewId: 11,
        targetType: 'course',
        targetId: 3,
        rating: 4,
        title: 'Great',
        content: null,
        isApproved: false,
        helpfulCount: 0,
        createdAt: '2026-08-16T00:00:00.000Z',
        author: { userId: 7, fullName: null, avatarUrl: null },
      });
      const response = await request(app)
        .post('/reviews')
        .send({ targetType: 'course', targetId: 3, rating: 4, title: 'Great' })
        .expect(201);
      expect(response.body.data.isApproved).toBe(false);
      expect(reviewServiceMock.create).toHaveBeenCalledWith(7, {
        targetType: 'course',
        targetId: 3,
        rating: 4,
        title: 'Great',
      });
    });

    it('rejects a cybersecurity-domain target_type (422, AC-09)', async () => {
      await request(app)
        .post('/reviews')
        .send({ targetType: 'machine', targetId: 3, rating: 5 })
        .expect(422);
      expect(reviewServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects out-of-range ratings (422)', async () => {
      await request(app)
        .post('/reviews')
        .send({ targetType: 'course', targetId: 3, rating: 6 })
        .expect(422);
    });

    it('lists approved reviews publicly', async () => {
      reviewServiceMock.listApproved.mockResolvedValue({ data: [], total: 0, page: 1 });
      await request(app).get('/reviews?targetType=course&targetId=3').expect(200);
      expect(reviewServiceMock.listApproved).toHaveBeenCalledWith('course', 3, 1, 20);
    });
  });

  describe('OPS-15..17 comments (AC-10)', () => {
    it('rejects the unused forum target_type (422, AC-10)', async () => {
      await request(app)
        .post('/comments')
        .send({ targetType: 'forum', targetId: 1, content: 'hi' })
        .expect(422);
      expect(commentServiceMock.create).not.toHaveBeenCalled();
    });

    it('creates a comment on a course', async () => {
      commentServiceMock.create.mockResolvedValue({
        commentId: 9,
        parentCommentId: null,
        targetType: 'course',
        targetId: 1,
        content: 'Nice walkthrough.',
        isPinned: false,
        isHidden: false,
        likesCount: 0,
        createdAt: '2026-08-16T00:00:00.000Z',
        author: { userId: 7, fullName: null, avatarUrl: null },
      });
      const response = await request(app)
        .post('/comments')
        .send({ targetType: 'course', targetId: 1, content: 'Nice walkthrough.' })
        .expect(201);
      expect(response.body.data.commentId).toBe(9);
    });

    it('deletes only the session users own comment', async () => {
      commentServiceMock.deleteOwn.mockResolvedValue(undefined);
      await request(app).delete('/comments/9').expect(200);
      expect(commentServiceMock.deleteOwn).toHaveBeenCalledWith(7, 9);
    });
  });

  describe('OPS-18 likes', () => {
    it('likes content once', async () => {
      likeServiceMock.like.mockResolvedValue({ targetType: 'comment', targetId: 9, liked: true, likesCount: 1 });
      await request(app)
        .post('/likes')
        .send({ targetType: 'comment', targetId: 9 })
        .expect(201);
      expect(likeServiceMock.like).toHaveBeenCalledWith(7, { targetType: 'comment', targetId: 9, likeType: 'like' });
    });

    it('unlikes via DELETE on the same key', async () => {
      likeServiceMock.unlike.mockResolvedValue({ targetType: 'comment', targetId: 9, liked: false, likesCount: 0 });
      await request(app).delete('/likes/comment/9').expect(200);
      expect(likeServiceMock.unlike).toHaveBeenCalledWith(7, 'comment', 9);
    });
  });

  describe('OPS-19 reports (AC-09)', () => {
    it('files a report', async () => {
      reportServiceMock.create.mockResolvedValue({
        reportId: 21,
        targetType: 'course',
        targetId: 3,
        reportReason: 'outdated content',
        status: 'pending',
        createdAt: '2026-08-16T00:00:00.000Z',
      });
      const response = await request(app)
        .post('/reports')
        .send({ targetType: 'course', targetId: 3, reportReason: 'outdated content' })
        .expect(201);
      expect(response.body.data.status).toBe('pending');
    });

    it('rejects machine/writeup/challenge report targets (422, AC-09)', async () => {
      for (const targetType of ['machine', 'writeup', 'challenge']) {
        await request(app)
          .post('/reports')
          .send({ targetType, targetId: 3, reportReason: 'spam' })
          .expect(422);
      }
      expect(reportServiceMock.create).not.toHaveBeenCalled();
    });
  });

  describe('OPS-27..34 admin moderation', () => {
    it('lists the review queue for a moderator', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminModerationServiceMock.listReviews.mockResolvedValue({ data: [], total: 0, page: 1 });
      await request(app).get('/admin/reviews?status=pending').expect(200);
      expect(adminModerationServiceMock.listReviews).toHaveBeenCalledWith('pending', 1, 20);
    });

    it('approves a review as a moderator', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminModerationServiceMock.approveReview.mockResolvedValue({ reviewId: 11, isApproved: true });
      await request(app).patch('/admin/reviews/11/approve').expect(200);
      expect(adminModerationServiceMock.approveReview).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        11,
      );
    });

    it('denies learners the moderation queue (403)', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      await request(app).get('/admin/reports').expect(403);
      expect(adminModerationServiceMock.listQueue).not.toHaveBeenCalled();
    });

    it('resolves a report', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminModerationServiceMock.resolveReport.mockResolvedValue({
        reportId: 21,
        targetType: 'course',
        targetId: 3,
        reportReason: 'spam',
        description: null,
        status: 'resolved',
        createdAt: '2026-08-16T00:00:00.000Z',
        resolvedAt: '2026-08-16T00:00:00.000Z',
        reporter: { userId: 7, fullName: 'Alex' },
      });
      await request(app).patch('/admin/reports/21/resolve').expect(200);
      expect(adminModerationServiceMock.resolveReport).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        21,
      );
    });

    it('lists comments for moderation (additive browse surface)', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminModerationServiceMock.listComments.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
      });
      await request(app).get('/admin/comments?page=1').expect(200);
      expect(adminModerationServiceMock.listComments).toHaveBeenCalledWith(1, 20);
    });

    it('pins and hides a comment as a moderator', async () => {
      asUser({ sub: 1, permissions: MODERATOR });
      adminModerationServiceMock.pinComment.mockResolvedValue({ commentId: 4, isPinned: true });
      adminModerationServiceMock.hideComment.mockResolvedValue({ commentId: 4, isHidden: true });
      await request(app).patch('/admin/comments/4/pin').expect(200);
      await request(app).patch('/admin/comments/4/hide').expect(200);
      expect(adminModerationServiceMock.pinComment).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        4,
      );
      expect(adminModerationServiceMock.hideComment).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        4,
      );
    });

    it('denies learners the comment moderation surface (403)', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      await request(app).get('/admin/comments').expect(403);
      await request(app).patch('/admin/comments/4/pin').expect(403);
      expect(adminModerationServiceMock.listComments).not.toHaveBeenCalled();
    });
  });

  describe('OPS-09..12 events (AC-05)', () => {
    it('registers for an event', async () => {
      eventServiceMock.register.mockResolvedValue({ status: 'registered' });
      const response = await request(app).post('/events/1/register').expect(201);
      expect(response.body.data.status).toBe('registered');
      expect(eventServiceMock.register).toHaveBeenCalledWith(1, 7);
    });

    it('reports waitlisted at capacity', async () => {
      eventServiceMock.register.mockResolvedValue({ status: 'waitlisted' });
      const response = await request(app).post('/events/1/register').expect(201);
      expect(response.body.data.status).toBe('waitlisted');
    });

    it('denies unauthenticated registration (401)', async () => {
      session.user = null;
      await request(app).post('/events/1/register').expect(401);
    });

    it('rejects non-numeric event ids (422)', async () => {
      await request(app).post('/events/abc/register').expect(422);
      expect(eventServiceMock.register).not.toHaveBeenCalled();
    });

    it('lists events publicly', async () => {
      eventServiceMock.listEvents.mockResolvedValue({ data: [], total: 0, page: 1 });
      await request(app).get('/events').expect(200);
      expect(eventServiceMock.listEvents).toHaveBeenCalledWith(1, 20, true, null);
    });
  });

  describe('OPS-20 file download', () => {
    it('returns a signed URL for an authenticated user', async () => {
      const { fileService: fileServiceMock } = vi.mocked(await import('../../src/features/operations/services/file.service'));
      fileServiceMock.getDownloadUrl.mockResolvedValue({
        fileId: 1,
        fileName: 'syllabus.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        downloadUrl: '/api/v1/files/1/serve?expires=1&sig=abc',
        expiresInSeconds: 900,
      });
      const response = await request(app).get('/files/1/download').expect(200);
      expect(response.body.data.downloadUrl).toContain('/serve');
    });

    it('denies unauthenticated downloads (401)', async () => {
      session.user = null;
      await request(app).get('/files/1/download').expect(401);
    });
  });

  describe('OPS-24..26 admin events', () => {
    it('creates an event as admin', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminEventServiceMock.create.mockResolvedValue({ eventId: 1, title: 'Webinar' });
      await request(app)
        .post('/admin/events')
        .send({ title: 'Webinar', eventType: 'webinar', startTime: '2026-09-01T10:00:00Z' })
        .expect(201);
      expect(adminEventServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        expect.objectContaining({ title: 'Webinar' }),
      );
    });

    it('lists attendees', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminEventServiceMock.listAttendees.mockResolvedValue({ data: [], total: 0, page: 1 });
      await request(app).get('/admin/events/1/attendees').expect(200);
      expect(adminEventServiceMock.listAttendees).toHaveBeenCalledWith(1, undefined, 1, 20);
    });
  });

  describe('OPS-35..37 email templates', () => {
    it('lists templates as admin', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      emailTemplateServiceMock.list.mockResolvedValue([]);
      await request(app).get('/admin/email-templates').expect(200);
    });

    it('previews a template', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      emailTemplateServiceMock.preview.mockResolvedValue({
        templateId: 1,
        subject: 'Hi Alex',
        bodyHtml: '<p>Hi</p>',
        bodyText: 'Hi',
      });
      await request(app).post('/admin/email-templates/1/preview').expect(200);
      expect(emailTemplateServiceMock.preview).toHaveBeenCalledWith(1);
    });
  });

  describe('OPS-41/42 analytics (AC-08, invariant 11)', () => {
    it('returns an anonymized overview for admins', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      analyticsServiceMock.getOverview.mockResolvedValue({
        activeUsers7d: 120,
        newSignups30d: 45,
        courseCompletions30d: 18,
        pointsAwarded7d: 9300,
        activeSubscriptions: 12,
        notificationsSent7d: 340,
        pendingReports: 3,
        newReviews7d: 27,
      });
      const response = await request(app).get('/admin/analytics/overview').expect(200);
      expect(JSON.stringify(response.body.data)).not.toMatch(/user_id|userId/);
    });

    it('denies learners (403)', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      await request(app).get('/admin/analytics/overview').expect(403);
      expect(analyticsServiceMock.getOverview).not.toHaveBeenCalled();
    });

    it('returns a bounded activity trend', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      analyticsServiceMock.getActivityTrend.mockResolvedValue({ days: 14, data: [] });
      await request(app).get('/admin/analytics/activity?days=14').expect(200);
      expect(analyticsServiceMock.getActivityTrend).toHaveBeenCalledWith(14);
    });
  });

  describe('AC-12: audit logs are write-only', () => {
    it('returns 404 for any audit log UPDATE/DELETE attempt', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      await request(app).patch('/admin/audit-logs/1').expect(404);
      await request(app).delete('/admin/audit-logs/1').expect(404);
    });
  });
});