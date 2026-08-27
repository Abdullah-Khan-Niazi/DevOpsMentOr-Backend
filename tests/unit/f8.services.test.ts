import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/shared/errors';
import { NotificationService } from '../../src/features/notifications/services/notification.service';
import { ReviewService } from '../../src/features/community/services/review.service';
import { CommentService } from '../../src/features/community/services/comment.service';
import { LikeService } from '../../src/features/community/services/like.service';
import { ReportService } from '../../src/features/community/services/report.service';
import { AdminModerationService } from '../../src/features/community/services/admin-moderation.service';
import { EventService } from '../../src/features/operations/services/event.service';
import { AnalyticsService } from '../../src/features/analytics/services/analytics.service';
import { emailAdapter } from '../../src/features/notifications/adapters/email.adapter';

const now = new Date('2026-08-16T10:00:00Z');

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 1,
    title: 'Intro to Docker',
    description: null,
    location: null,
    eventType: 'webinar' as const,
    startTime: now,
    endTime: null,
    timezone: null,
    maxAttendees: 50,
    isFree: true,
    price: '0',
    registrationDeadline: null,
    bannerUrl: null,
    isActive: true,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const recipients = {
  getRecipient: vi.fn().mockResolvedValue({ email: 'alex@example.com', fullName: 'Alex Learner' }),
};

describe('F8 unit tests: business rules (AC-01..AC-14)', () => {
  describe('NotificationService.dispatch (AC-01)', () => {
    it('skips the INSERT when in_app_enabled=false but still dispatches email', async () => {
      const repo = {
        getPreferences: vi.fn().mockResolvedValue({
          userId: 7, type: 'event', emailEnabled: true, pushEnabled: true, inAppEnabled: false,
        }),
        insertNotification: vi.fn(),
        listPreferences: vi.fn(),
        upsertPreference: vi.fn(),
      };
      const email = { dispatch: vi.fn().mockResolvedValue(true) };
      const service = new NotificationService({ repo: repo as never, email: email as never, recipients });

      const result = await service.dispatch({
        userId: 7,
        type: 'event',
        title: 'Event',
        message: 'You are registered.',
      });

      expect(repo.insertNotification).not.toHaveBeenCalled();
      expect(email.dispatch).toHaveBeenCalledWith('notification_generic', expect.any(String), expect.any(String), {
        message: 'You are registered.',
      });
      expect(result).toEqual({ inApp: false, email: true });
    });

    it('skips email when email_enabled=false but still inserts the row', async () => {
      const repo = {
        getPreferences: vi.fn().mockResolvedValue({
          userId: 7, type: 'event', emailEnabled: false, pushEnabled: true, inAppEnabled: true,
        }),
        insertNotification: vi.fn().mockResolvedValue(42),
        listPreferences: vi.fn(),
        upsertPreference: vi.fn(),
      };
      const email = { dispatch: vi.fn() };
      const service = new NotificationService({ repo: repo as never, email: email as never, recipients });

      const result = await service.dispatch({
        userId: 7,
        type: 'event',
        title: 'Event',
        message: 'Registered.',
      });

      expect(repo.insertNotification).toHaveBeenCalledWith(7, 'event', 'Event', 'Registered.', null, null);
      expect(email.dispatch).not.toHaveBeenCalled();
      expect(result).toEqual({ inApp: true, email: false });
    });

    it('defaults to all channels enabled when no preference row exists', async () => {
      const repo = {
        getPreferences: vi.fn().mockResolvedValue(undefined),
        insertNotification: vi.fn().mockResolvedValue(42),
        listPreferences: vi.fn(),
        upsertPreference: vi.fn(),
      };
      const email = { dispatch: vi.fn().mockResolvedValue(true) };
      const service = new NotificationService({ repo: repo as never, email: email as never, recipients });

      const result = await service.dispatch({
        userId: 7,
        type: 'system',
        title: 'Hello',
        message: 'Welcome.',
      });

      expect(repo.insertNotification).toHaveBeenCalled();
      expect(email.dispatch).toHaveBeenCalled();
      expect(result).toEqual({ inApp: true, email: true });
    });
  });

  describe('ReviewService.create (AC-02, AC-03)', () => {
    it('inserts a review pending approval on first submission', async () => {
      const repo = {
        countUserReviews: vi.fn().mockResolvedValue(0),
        insertReview: vi.fn().mockResolvedValue(11),
        courseExists: vi.fn().mockResolvedValue(true),
        labExists: vi.fn(),
      };
      const service = new ReviewService({ repo: repo as never });

      const review = await service.create(7, {
        targetType: 'course',
        targetId: 3,
        rating: 4,
        title: 'Great course',
        content: 'Loved it.',
      });

      expect(repo.countUserReviews).toHaveBeenCalledWith(7, 'course', 3);
      expect(repo.insertReview).toHaveBeenCalledWith({
        userId: 7,
        targetType: 'course',
        targetId: 3,
        rating: 4,
        title: 'Great course',
        content: 'Loved it.',
      });
      expect(review.isApproved).toBe(false);
    });

    it('returns 409 for a duplicate review on the same target', async () => {
      const repo = {
        countUserReviews: vi.fn().mockResolvedValue(1),
        insertReview: vi.fn(),
        courseExists: vi.fn().mockResolvedValue(true),
        labExists: vi.fn(),
      };
      const service = new ReviewService({ repo: repo as never });

      await expect(
        service.create(7, { targetType: 'course', targetId: 3, rating: 5 }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repo.insertReview).not.toHaveBeenCalled();
    });

    it('returns 404 when the target does not exist', async () => {
      const repo = {
        countUserReviews: vi.fn().mockResolvedValue(0),
        insertReview: vi.fn(),
        courseExists: vi.fn().mockResolvedValue(false),
        labExists: vi.fn(),
      };
      const service = new ReviewService({ repo: repo as never });

      await expect(
        service.create(7, { targetType: 'course', targetId: 999, rating: 5, title: 't' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('AdminModerationService.approveReview (AC-04)', () => {
    it('approves a course review and denormalizes academy_courses.average_rating', async () => {
      const repo = {
        findReviewById: vi.fn().mockResolvedValue({
          reviewId: 11,
          userId: 7,
          targetType: 'course',
          targetId: 3,
          rating: 4,
          title: 'Great',
          content: null,
          isApproved: false,
          helpfulCount: 0,
          createdAt: now,
          authorFullName: 'Alex',
          authorAvatarUrl: null,
        }),
        setReviewApproved: vi.fn(),
        deleteReview: vi.fn(),
        computeTargetRating: vi.fn().mockResolvedValue({ average: 4.2, total: 6 }),
        updateCourseRating: vi.fn(),
        setCommentPinned: vi.fn(),
        setCommentHidden: vi.fn(),
        findCommentById: vi.fn(),
        listAllComments: vi.fn(),
        countAllComments: vi.fn(),
        listReports: vi.fn(),
        countReports: vi.fn(),
        countReportsByStatus: vi.fn(),
        findReportById: vi.fn(),
        setReportStatus: vi.fn(),
        listAllReviews: vi.fn(),
        countAllReviews: vi.fn(),
      };
      const audit = { record: vi.fn() };
      const service = new AdminModerationService({ repo: repo as never, audit: audit as never });
      const actor = { userId: 1, ipAddress: null, userAgent: null };

      await service.approveReview(actor, 11);

      expect(repo.setReviewApproved).toHaveBeenCalledWith(11, true);
      expect(repo.computeTargetRating).toHaveBeenCalledWith('course', 3);
      expect(repo.updateCourseRating).toHaveBeenCalledWith(3, 4.2, 6);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approve_review', targetId: 11 }),
      );
    });

    it('lists comments for moderation with ISO dates and author summaries', async () => {
      const repo = {
        findReviewById: vi.fn(),
        setReviewApproved: vi.fn(),
        deleteReview: vi.fn(),
        computeTargetRating: vi.fn(),
        updateCourseRating: vi.fn(),
        setCommentPinned: vi.fn(),
        setCommentHidden: vi.fn(),
        findCommentById: vi.fn(),
        listAllComments: vi.fn().mockResolvedValue([
          {
            commentId: 4,
            userId: 7,
            parentCommentId: null,
            targetType: 'course',
            targetId: 3,
            content: 'Nice content',
            isPinned: false,
            isHidden: false,
            likesCount: 2,
            createdAt: now,
            authorFullName: 'Alex',
            authorAvatarUrl: null,
          },
        ]),
        countAllComments: vi.fn().mockResolvedValue(1),
        listReports: vi.fn(),
        countReports: vi.fn(),
        countReportsByStatus: vi.fn(),
        findReportById: vi.fn(),
        setReportStatus: vi.fn(),
        listAllReviews: vi.fn(),
        countAllReviews: vi.fn(),
      };
      const audit = { record: vi.fn() };
      const service = new AdminModerationService({ repo: repo as never, audit: audit as never });

      const result = await service.listComments(1, 20);

      expect(repo.listAllComments).toHaveBeenCalledWith(0, 20);
      expect(result).toEqual({
        data: [
          {
            commentId: 4,
            parentCommentId: null,
            targetType: 'course',
            targetId: 3,
            content: 'Nice content',
            isPinned: false,
            isHidden: false,
            likesCount: 2,
            createdAt: now.toISOString(),
            author: { userId: 7, fullName: 'Alex', avatarUrl: null },
          },
        ],
        total: 1,
        page: 1,
      });
    });

    it('approving a lab review recomputes and logs, never writing a missing column', async () => {
      const repo = {
        findReviewById: vi.fn().mockResolvedValue({
          reviewId: 12,
          userId: 7,
          targetType: 'lab',
          targetId: 5,
          rating: 5,
          title: 'Solid lab',
          content: null,
          isApproved: false,
          helpfulCount: 0,
          createdAt: now,
          authorFullName: 'Alex',
          authorAvatarUrl: null,
        }),
        setReviewApproved: vi.fn(),
        deleteReview: vi.fn(),
        computeTargetRating: vi.fn().mockResolvedValue({ average: 5, total: 2 }),
        updateCourseRating: vi.fn(),
        setCommentPinned: vi.fn(),
        setCommentHidden: vi.fn(),
        findCommentById: vi.fn(),
        listAllComments: vi.fn(),
        countAllComments: vi.fn(),
        listReports: vi.fn(),
        countReports: vi.fn(),
        countReportsByStatus: vi.fn(),
        findReportById: vi.fn(),
        setReportStatus: vi.fn(),
        listAllReviews: vi.fn(),
        countAllReviews: vi.fn(),
      };
      const audit = { record: vi.fn() };
      const service = new AdminModerationService({ repo: repo as never, audit: audit as never });
      const actor = { userId: 1, ipAddress: null, userAgent: null };

      await service.approveReview(actor, 12);

      expect(repo.computeTargetRating).toHaveBeenCalledWith('lab', 5);
      expect(repo.updateCourseRating).not.toHaveBeenCalled();
    });
  });

  describe('CommentService.create (AC-10, parent validation)', () => {
    it('rejects a parent comment from a different target', async () => {
      const repo = {
        findCommentById: vi.fn().mockResolvedValue({
          commentId: 9,
          userId: 3,
          parentCommentId: null,
          targetType: 'course',
          targetId: 1,
          content: 'other',
          isPinned: false,
          isHidden: false,
          likesCount: 0,
          createdAt: now,
          authorFullName: 'Bob',
          authorAvatarUrl: null,
        }),
        insertComment: vi.fn(),
        courseExists: vi.fn().mockResolvedValue(true),
        labExists: vi.fn().mockResolvedValue(true),
        listComments: vi.fn(),
        countComments: vi.fn(),
        deleteOwnComment: vi.fn(),
      };
      const service = new CommentService({ repo: repo as never });

      await expect(
        service.create(7, {
          targetType: 'lab',
          targetId: 2,
          parentCommentId: 9,
          content: 'reply',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(repo.insertComment).not.toHaveBeenCalled();
    });

    it('rejects a reply to a non-existent parent', async () => {
      const repo = {
        findCommentById: vi.fn().mockResolvedValue(undefined),
        insertComment: vi.fn(),
        courseExists: vi.fn().mockResolvedValue(true),
        labExists: vi.fn(),
        listComments: vi.fn(),
        countComments: vi.fn(),
        deleteOwnComment: vi.fn(),
      };
      const service = new CommentService({ repo: repo as never });

      await expect(
        service.create(7, {
          targetType: 'course',
          targetId: 1,
          parentCommentId: 999,
          content: 'reply',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('LikeService (invariant 6)', () => {
    it('inserts on first like and bumps the comment counter', async () => {
      const repo = {
        findLike: vi.fn().mockResolvedValue(false),
        insertLike: vi.fn().mockResolvedValue(1),
        deleteLike: vi.fn(),
        findCommentById: vi.fn().mockResolvedValue({
          commentId: 9,
          userId: 3,
          parentCommentId: null,
          targetType: 'course',
          targetId: 1,
          content: 'x',
          isPinned: false,
          isHidden: false,
          likesCount: 3,
          createdAt: now,
          authorFullName: 'Bob',
          authorAvatarUrl: null,
        }),
        findReviewById: vi.fn(),
        adjustCommentLikesCount: vi.fn(),
      };
      const service = new LikeService({ repo: repo as never });

      const result = await service.like(7, { targetType: 'comment', targetId: 9, likeType: 'like' });

      expect(repo.insertLike).toHaveBeenCalledWith({
        userId: 7,
        targetType: 'comment',
        targetId: 9,
        likeType: 'like',
      });
      expect(repo.adjustCommentLikesCount).toHaveBeenCalledWith(9, 1);
      expect(result.liked).toBe(true);
      expect(result.likesCount).toBe(3);
    });

    it('returns 409 on a duplicate like', async () => {
      const repo = {
        findLike: vi.fn().mockResolvedValue(true),
        insertLike: vi.fn(),
        deleteLike: vi.fn(),
        findCommentById: vi.fn().mockResolvedValue({ commentId: 9 }),
        findReviewById: vi.fn(),
        adjustCommentLikesCount: vi.fn(),
      };
      const service = new LikeService({ repo: repo as never });

      await expect(
        service.like(7, { targetType: 'comment', targetId: 9, likeType: 'like' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repo.insertLike).not.toHaveBeenCalled();
    });

    it('deletes the like on unlike', async () => {
      const repo = {
        findLike: vi.fn(),
        insertLike: vi.fn(),
        deleteLike: vi.fn().mockResolvedValue(1),
        findCommentById: vi.fn().mockResolvedValue({
          commentId: 9,
          userId: 3,
          parentCommentId: null,
          targetType: 'course',
          targetId: 1,
          content: 'x',
          isPinned: false,
          isHidden: false,
          likesCount: 2,
          createdAt: now,
          authorFullName: 'Bob',
          authorAvatarUrl: null,
        }),
        findReviewById: vi.fn(),
        adjustCommentLikesCount: vi.fn(),
      };
      const service = new LikeService({ repo: repo as never });

      const result = await service.unlike(7, 'comment', 9);

      expect(repo.deleteLike).toHaveBeenCalledWith(7, 'comment', 9);
      expect(repo.adjustCommentLikesCount).toHaveBeenCalledWith(9, -1);
      expect(result.liked).toBe(false);
    });
  });

  describe('ReportService.create (AC-09, IDOR)', () => {
    it('rejects self-reports', async () => {
      const repo = {
        userExists: vi.fn().mockResolvedValue(true),
        findCommentById: vi.fn(),
        findReviewById: vi.fn(),
        courseExists: vi.fn(),
        labExists: vi.fn(),
        insertReport: vi.fn(),
      };
      const service = new ReportService({ repo: repo as never });

      await expect(
        service.create(7, {
          targetType: 'user',
          targetId: 7,
          reportedUserId: 7,
          reportReason: 'spam',
          description: null,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(repo.insertReport).not.toHaveBeenCalled();
    });

    it('files a report against a valid course', async () => {
      const repo = {
        userExists: vi.fn(),
        findCommentById: vi.fn(),
        findReviewById: vi.fn(),
        courseExists: vi.fn().mockResolvedValue(true),
        labExists: vi.fn(),
        insertReport: vi.fn().mockResolvedValue(21),
      };
      const service = new ReportService({ repo: repo as never });

      const report = await service.create(7, {
        targetType: 'course',
        targetId: 3,
        reportedUserId: null,
        reportReason: 'outdated content',
        description: 'The lesson references a removed CLI flag.',
      });

      expect(repo.insertReport).toHaveBeenCalledWith({
        reporterUserId: 7,
        reportedUserId: null,
        targetType: 'course',
        targetId: 3,
        reportReason: 'outdated content',
        description: 'The lesson references a removed CLI flag.',
      });
      expect(report.status).toBe('pending');
    });
  });

  describe('EventService.register (AC-05, invariant 7)', () => {
    it('registers when under capacity', async () => {
      const repo = {
        findEventById: vi.fn().mockResolvedValue(eventRow({ maxAttendees: 50 })),
        findRegistration: vi.fn().mockResolvedValue(undefined),
        countActiveRegistrations: vi.fn().mockResolvedValue(10),
        insertRegistration: vi.fn().mockResolvedValue(1),
        cancelRegistration: vi.fn(),
        listEvents: vi.fn(),
        countEvents: vi.fn(),
      };
      const notify = { dispatch: vi.fn().mockResolvedValue({ inApp: true, email: false }) };
      const service = new EventService({ repo: repo as never, notify: notify as never });

      const result = await service.register(1, 7);

      expect(repo.insertRegistration).toHaveBeenCalledWith(1, 7, 'registered');
      expect(result.status).toBe('registered');
      expect(notify.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, type: 'event' }),
      );
    });

    it('waitlists when the event is at capacity', async () => {
      const repo = {
        findEventById: vi.fn().mockResolvedValue(eventRow({ maxAttendees: 50 })),
        findRegistration: vi.fn().mockResolvedValue(undefined),
        countActiveRegistrations: vi.fn().mockResolvedValue(50),
        insertRegistration: vi.fn().mockResolvedValue(1),
        cancelRegistration: vi.fn(),
        listEvents: vi.fn(),
        countEvents: vi.fn(),
      };
      const notify = { dispatch: vi.fn() };
      const service = new EventService({ repo: repo as never, notify: notify as never });

      const result = await service.register(1, 7);

      expect(repo.insertRegistration).toHaveBeenCalledWith(1, 7, 'waitlisted');
      expect(result.status).toBe('waitlisted');
    });

    it('returns 409 on a duplicate registration', async () => {
      const repo = {
        findEventById: vi.fn().mockResolvedValue(eventRow()),
        findRegistration: vi.fn().mockResolvedValue({
          registrationId: 3,
          eventId: 1,
          userId: 7,
          attendeeName: null,
          attendeeEmail: null,
          company: null,
          status: 'registered',
          registeredAt: now,
        }),
        countActiveRegistrations: vi.fn(),
        insertRegistration: vi.fn(),
        cancelRegistration: vi.fn(),
        listEvents: vi.fn(),
        countEvents: vi.fn(),
      };
      const notify = { dispatch: vi.fn() };
      const service = new EventService({ repo: repo as never, notify: notify as never });

      await expect(service.register(1, 7)).rejects.toBeInstanceOf(ConflictError);
      expect(repo.insertRegistration).not.toHaveBeenCalled();
    });
  });

  describe('AnalyticsService.getOverview (AC-08, invariant 11)', () => {
    it('returns only aggregated integers with no user_id fields', async () => {
      const repo = {
        countActiveUsers7d: vi.fn().mockResolvedValue(120),
        countNewSignups30d: vi.fn().mockResolvedValue(45),
        countCourseCompletions30d: vi.fn().mockResolvedValue(18),
        sumPointsAwarded7d: vi.fn().mockResolvedValue(9300),
        countActiveSubscriptions: vi.fn().mockResolvedValue(12),
        countNotificationsSent7d: vi.fn().mockResolvedValue(340),
        countPendingReports: vi.fn().mockResolvedValue(3),
        countNewReviews7d: vi.fn().mockResolvedValue(27),
        getActivityTrend: vi.fn(),
      };
      const service = new AnalyticsService({ repo: repo as never });

      const overview = await service.getOverview();

      expect(overview).toEqual({
        activeUsers7d: 120,
        newSignups30d: 45,
        courseCompletions30d: 18,
        pointsAwarded7d: 9300,
        activeSubscriptions: 12,
        notificationsSent7d: 340,
        pendingReports: 3,
        newReviews7d: 27,
      });
      expect(JSON.stringify(overview)).not.toMatch(/user_id|userId/);
    });
  });

  describe('EmailAdapter.render', () => {
    it('substitutes declared placeholders and leaves unknown tokens intact', () => {
      const adapter = emailAdapter;
      const rendered = adapter.render(
        { subject: 'Hi {{userName}}', bodyHtml: '<p>{{message}}</p>', bodyText: '{{message}}' },
        { userName: 'Alex', message: 'Welcome' },
      );

      expect(rendered.subject).toBe('Hi Alex');
      expect(rendered.html).toBe('<p>Welcome</p>');
      expect(rendered.text).toBe('Welcome');
    });

    it('leaves unmatched tokens untouched so previews never crash', () => {
      const adapter = emailAdapter;
      const rendered = adapter.render(
        { subject: '{{missing}}', bodyHtml: '<p>{{missing}}</p>', bodyText: null },
        {},
      );

      expect(rendered.subject).toBe('{{missing}}');
      expect(rendered.text).toBeNull();
    });
  });
});