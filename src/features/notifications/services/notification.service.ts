import { eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { users } from '../../../app/database/schema';
import type { NotificationDispatchPayload } from '../dto/notifications.dto';
import type { INotificationsRepository } from '../repositories/notifications.repository';
import { notificationsRepository } from '../repositories/notifications.repository';
import type { EmailAdapter } from '../adapters/email.adapter';
import { emailAdapter } from '../adapters/email.adapter';

/** Default recipient resolver: reads the `users` row for the dispatch. */
async function getRecipient(userId: number): Promise<{ email: string; fullName: string } | null> {
  const rows = await db
    .select({ email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { email: row.email, fullName: row.fullName ?? row.email };
}

/**
 * F8 §08 notification engine.
 *
 * `dispatch` is the exported forward-integration hook consumed by F5, F6,
 * F7 and F9 event handlers (contract §02). It respects
 * `notification_preferences` per channel (invariant 1): `in_app_enabled =
 * false` skips the INSERT, `email_enabled = false` skips the email. Missing
 * preference rows default to all channels enabled.
 */
export interface NotificationServiceDeps {
  repo: Pick<
    INotificationsRepository,
    | 'insertNotification'
    | 'getPreferences'
    | 'listPreferences'
    | 'upsertPreference'
    | 'listInbox'
    | 'countInbox'
    | 'countUnread'
    | 'findOwnNotification'
    | 'markRead'
    | 'markAllRead'
    | 'dismiss'
  >;
  email: Pick<EmailAdapter, 'dispatch'>;
  recipients: {
    /** Resolve the recipient's email + display name for transactional mail. */
    getRecipient(userId: number): Promise<{ email: string; fullName: string } | null>;
  };
}

function defaultDeps(): NotificationServiceDeps {
  return {
    repo: notificationsRepository,
    email: emailAdapter,
    recipients: { getRecipient },
  };
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps = defaultDeps()) {}

  /**
   * §02 dispatch contract. Returns whether an in-app row was inserted and
   * whether an email was dispatched (both channels are independent).
   */
  async dispatch(payload: NotificationDispatchPayload): Promise<{ inApp: boolean; email: boolean }> {
    const preference = await this.deps.repo.getPreferences(payload.userId, payload.type);
    const inAppEnabled = preference?.inAppEnabled ?? true;
    const emailEnabled = preference?.emailEnabled ?? true;

    let inApp = false;
    if (inAppEnabled) {
      await this.deps.repo.insertNotification(
        payload.userId,
        payload.type,
        payload.title,
        payload.message,
        payload.linkUrl ?? null,
        payload.iconUrl ?? null,
      );
      inApp = true;
    }

    let email = false;
    if (emailEnabled) {
      const recipient = await this.getRecipientForDispatch(payload.userId);
      if (recipient) {
        email = await this.deps.email.dispatch('notification_generic', recipient.email, recipient.fullName, {
          message: payload.message,
        });
      }
    }

    return { inApp, email };
  }

  /** OPS-01: paginated inbox with the unread bell count. */
  async listInbox(
    userId: number,
    page: number,
    limit: number,
    unreadOnly: boolean,
  ): Promise<{ data: unknown[]; unreadCount: number; total: number; page: number }> {
    const [rows, total, unreadCount] = await Promise.all([
      this.deps.repo.listInbox(userId, (page - 1) * limit, limit, unreadOnly),
      this.deps.repo.countInbox(userId, unreadOnly),
      this.deps.repo.countUnread(userId),
    ]);

    return {
      data: rows.map((row) => ({
        notificationId: row.notificationId,
        type: row.type,
        title: row.title,
        message: row.message,
        linkUrl: row.linkUrl,
        iconUrl: row.iconUrl,
        isRead: row.isRead,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
      total,
      page,
    };
  }

  /** OPS-02: mark a single owned notification read (404 when not owned). */
  async markRead(userId: number, notificationId: number): Promise<boolean> {
    return (await this.deps.repo.markRead(userId, notificationId)) > 0;
  }

  /** OPS-03: mark all owned notifications read; returns the affected count. */
  async markAllRead(userId: number): Promise<number> {
    return this.deps.repo.markAllRead(userId);
  }

  /** OPS-04: dismiss an owned notification (404 when not owned). */
  async dismiss(userId: number, notificationId: number): Promise<boolean> {
    const owned = await this.deps.repo.findOwnNotification(userId, notificationId);
    if (!owned) {
      return false;
    }
    return (await this.deps.repo.dismiss(userId, notificationId)) > 0;
  }

  /** OPS-05: list the user's preference rows (defaults surfaced for missing types). */
  async getPreferences(userId: number): Promise<unknown[]> {
    const rows = await this.deps.repo.listPreferences(userId);
    return rows.map((row) => ({
      userId: row.userId,
      type: row.type,
      emailEnabled: row.emailEnabled,
      pushEnabled: row.pushEnabled,
      inAppEnabled: row.inAppEnabled,
    }));
  }

  /** OPS-06: upsert a channel preference for one notification type. */
  async updatePreference(
    userId: number,
    type: string,
    emailEnabled: boolean,
    pushEnabled: boolean,
    inAppEnabled: boolean,
  ): Promise<void> {
    await this.deps.repo.upsertPreference(userId, type, emailEnabled, pushEnabled, inAppEnabled);
  }

  private async getRecipientForDispatch(userId: number): Promise<{ email: string; fullName: string } | null> {
    return this.deps.recipients.getRecipient(userId);
  }
}

export const notificationService = new NotificationService();