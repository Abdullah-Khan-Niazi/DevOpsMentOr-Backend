import { and, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  announcementReads,
  announcements,
  notificationPreferences,
  notifications,
} from '../../../app/database/schema';
import type { NotificationType } from '../dto/notifications.dto';

/**
 * F8 data access for the notification engine and announcement publishing.
 * All ownership filters are applied here with the session-derived user id
 * (never a client-supplied identifier).
 */

export interface NotificationRow {
  notificationId: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string | null;
  linkUrl: string | null;
  iconUrl: string | null;
  isRead: boolean;
  isDismissed: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface PreferenceRow {
  userId: number;
  type: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
}

export interface AnnouncementRow {
  announcementId: number;
  title: string;
  content: string;
  announcementType: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
  priority: 'low' | 'medium' | 'high' | 'critical';
  isPublished: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationsRepository {
  insertNotification(
    userId: number,
    type: NotificationType,
    title: string,
    message: string | null,
    linkUrl: string | null,
    iconUrl: string | null,
  ): Promise<number>;
  getPreferences(userId: number, type: string): Promise<PreferenceRow | undefined>;
  upsertPreference(
    userId: number,
    type: string,
    emailEnabled: boolean,
    pushEnabled: boolean,
    inAppEnabled: boolean,
  ): Promise<void>;
  listPreferences(userId: number): Promise<PreferenceRow[]>;
  listInbox(
    userId: number,
    skip: number,
    take: number,
    unreadOnly: boolean,
  ): Promise<NotificationRow[]>;
  countInbox(userId: number, unreadOnly: boolean): Promise<number>;
  countUnread(userId: number): Promise<number>;
  findOwnNotification(userId: number, notificationId: number): Promise<NotificationRow | undefined>;
  markRead(userId: number, notificationId: number): Promise<number>;
  markAllRead(userId: number): Promise<number>;
  dismiss(userId: number, notificationId: number): Promise<number>;
  insertAnnouncement(input: {
    title: string;
    content: string;
    announcementType: AnnouncementRow['announcementType'];
    priority: AnnouncementRow['priority'];
    isPublished: boolean;
    expiresAt: Date | null;
    createdBy: number;
  }): Promise<number>;
  listAnnouncements(): Promise<AnnouncementRow[]>;
  listPublished(): Promise<AnnouncementRow[]>;
  findAnnouncement(announcementId: number): Promise<AnnouncementRow | undefined>;
  updateAnnouncement(
    announcementId: number,
    patch: Partial<{
      title: string;
      content: string;
      announcementType: AnnouncementRow['announcementType'];
      priority: AnnouncementRow['priority'];
      isPublished: boolean;
      publishedAt: Date | null;
      expiresAt: Date | null;
    }>,
  ): Promise<void>;
  markAnnouncementRead(announcementId: number, userId: number): Promise<void>;
  listReadAnnouncementIds(userId: number): Promise<number[]>;
}

export class NotificationsRepository implements INotificationsRepository {
  async insertNotification(
    userId: number,
    type: NotificationType,
    title: string,
    message: string | null,
    linkUrl: string | null,
    iconUrl: string | null,
  ): Promise<number> {
    const inserted = await db.insert(notifications).values({
      userId,
      type,
      title,
      message,
      linkUrl,
      iconUrl,
    });
    const notificationId = inserted[0]?.insertId;
    if (!notificationId) {
      throw new Error('Notification insert failed.');
    }
    return notificationId;
  }

  async getPreferences(userId: number, type: string): Promise<PreferenceRow | undefined> {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, type),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertPreference(
    userId: number,
    type: string,
    emailEnabled: boolean,
    pushEnabled: boolean,
    inAppEnabled: boolean,
  ): Promise<void> {
    await db
      .insert(notificationPreferences)
      .values({ userId, type, emailEnabled, pushEnabled, inAppEnabled })
      .onDuplicateKeyUpdate({
        set: { emailEnabled, pushEnabled, inAppEnabled },
      });
  }

  async listPreferences(userId: number): Promise<PreferenceRow[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }

  async listInbox(
    userId: number,
    skip: number,
    take: number,
    unreadOnly: boolean,
  ): Promise<NotificationRow[]> {
    return db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isDismissed, false),
          unreadOnly ? eq(notifications.isRead, false) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countInbox(userId: number, unreadOnly: boolean): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isDismissed, false),
          unreadOnly ? eq(notifications.isRead, false) : undefined,
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async countUnread(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isDismissed, false),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async findOwnNotification(
    userId: number,
    notificationId: number,
  ): Promise<NotificationRow | undefined> {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.notificationId, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async markRead(userId: number, notificationId: number): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.notificationId, notificationId),
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        ),
      );
    return updated[0]?.affectedRows ?? 0;
  }

  async markAllRead(userId: number): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isDismissed, false),
        ),
      );
    return updated[0]?.affectedRows ?? 0;
  }

  async dismiss(userId: number, notificationId: number): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ isDismissed: true })
      .where(
        and(
          eq(notifications.notificationId, notificationId),
          eq(notifications.userId, userId),
        ),
      );
    return updated[0]?.affectedRows ?? 0;
  }

  async insertAnnouncement(input: {
    title: string;
    content: string;
    announcementType: AnnouncementRow['announcementType'];
    priority: AnnouncementRow['priority'];
    isPublished: boolean;
    expiresAt: Date | null;
    createdBy: number;
  }): Promise<number> {
    const inserted = await db.insert(announcements).values({
      title: input.title,
      content: input.content,
      announcementType: input.announcementType,
      priority: input.priority,
      isPublished: input.isPublished,
      publishedAt: input.isPublished ? new Date() : null,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    });
    const announcementId = inserted[0]?.insertId;
    if (!announcementId) {
      throw new Error('Announcement insert failed.');
    }
    return announcementId;
  }

  async listAnnouncements(): Promise<AnnouncementRow[]> {
    return db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));
  }

  async listPublished(): Promise<AnnouncementRow[]> {
    return db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.isPublished, true),
          or(isNull(announcements.expiresAt), gte(announcements.expiresAt, sql`NOW()`)),
        ),
      )
      .orderBy(desc(announcements.publishedAt));
  }

  async findAnnouncement(announcementId: number): Promise<AnnouncementRow | undefined> {
    const rows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.announcementId, announcementId))
      .limit(1);
    return rows[0];
  }

  async updateAnnouncement(
    announcementId: number,
    patch: Partial<{
      title: string;
      content: string;
      announcementType: AnnouncementRow['announcementType'];
      priority: AnnouncementRow['priority'];
      isPublished: boolean;
      publishedAt: Date | null;
      expiresAt: Date | null;
    }>,
  ): Promise<void> {
    await db
      .update(announcements)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(announcements.announcementId, announcementId));
  }

  async markAnnouncementRead(announcementId: number, userId: number): Promise<void> {
    await db
      .insert(announcementReads)
      .values({ announcementId, userId, readAt: new Date() })
      .onDuplicateKeyUpdate({ set: { readAt: new Date() } });
  }

  async listReadAnnouncementIds(userId: number): Promise<number[]> {
    const rows = await db
      .select({ announcementId: announcementReads.announcementId })
      .from(announcementReads)
      .where(eq(announcementReads.userId, userId));
    return rows.map((row) => row.announcementId);
  }
}

export const notificationsRepository = new NotificationsRepository();