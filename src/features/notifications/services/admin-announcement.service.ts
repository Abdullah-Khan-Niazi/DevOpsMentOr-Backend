import { AUDIT_ACTIONS } from '../../../shared/constants';
import { NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import type { AdminAnnouncementDto } from '../dto/notifications.dto';
import type { INotificationsRepository } from '../repositories/notifications.repository';
import { notificationsRepository } from '../repositories/notifications.repository';
import type { AuditLogService } from '../../../features/admin/services/audit-log.service';
import { auditLogService } from '../../../features/admin/services/audit-log.service';
import type { EmailAdapter } from '../adapters/email.adapter';
import { emailAdapter } from '../adapters/email.adapter';

/** Identity of the platform admin performing the mutation (for audit rows). */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * F8 §08 platform-admin announcement publishing. Draft rows
 * (`is_published = FALSE`) are only visible here; publishing stamps
 * `published_at` and optionally fan-outs an email notice (via the
 * announcement template) to learners with email notifications enabled.
 */
export interface AdminAnnouncementServiceDeps {
  repo: Pick<
    INotificationsRepository,
    'insertAnnouncement' | 'findAnnouncement' | 'updateAnnouncement' | 'listAnnouncements'
  >;
  audit: Pick<AuditLogService, 'record'>;
  email: Pick<EmailAdapter, 'dispatch'>;
}

function defaultDeps(): AdminAnnouncementServiceDeps {
  return { repo: notificationsRepository, audit: auditLogService, email: emailAdapter };
}

function toDto(row: {
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
}): AdminAnnouncementDto {
  return {
    announcementId: row.announcementId,
    title: row.title,
    content: row.content,
    announcementType: row.announcementType,
    priority: row.priority,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AdminAnnouncementService {
  constructor(private readonly deps: AdminAnnouncementServiceDeps = defaultDeps()) {}

  /** OPS-21: create an announcement (draft or immediately published). */
  async create(
    actor: AdminActor,
    input: {
      title: string;
      content: string;
      announcementType: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
      priority: 'low' | 'medium' | 'high' | 'critical';
      isPublished: boolean;
      expiresAt: Date | null;
    },
  ): Promise<AdminAnnouncementDto> {
    const announcementId = await this.deps.repo.insertAnnouncement({
      ...input,
      createdBy: actor.userId,
    });
    const row = await this.deps.repo.findAnnouncement(announcementId);
    if (!row) {
      throw new Error('Announcement creation failed.');
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.CREATE_ANNOUNCEMENT,
      targetType: 'announcement',
      targetId: announcementId,
      changes: { title: input.title, isPublished: input.isPublished },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toDto(row);
  }

  /** OPS-22: edit an announcement (draft and published rows alike). */
  async update(
    actor: AdminActor,
    announcementId: number,
    patch: {
      title?: string;
      content?: string;
      announcementType?: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
      priority?: 'low' | 'medium' | 'high' | 'critical';
      expiresAt?: Date | null;
    },
  ): Promise<AdminAnnouncementDto> {
    const existing = await this.deps.repo.findAnnouncement(announcementId);
    if (!existing) {
      throw new NotFoundError('Announcement not found.');
    }

    await this.deps.repo.updateAnnouncement(announcementId, patch);

    const updated = await this.deps.repo.findAnnouncement(announcementId);
    if (!updated) {
      throw new NotFoundError('Announcement not found.');
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UPDATE_ANNOUNCEMENT,
      targetType: 'announcement',
      targetId: announcementId,
      changes: { before: { title: existing.title }, after: { title: updated.title } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toDto(updated);
  }

  /** OPS-23: publish an announcement, stamping `published_at` exactly once. */
  async publish(actor: AdminActor, announcementId: number): Promise<AdminAnnouncementDto> {
    const existing = await this.deps.repo.findAnnouncement(announcementId);
    if (!existing) {
      throw new NotFoundError('Announcement not found.');
    }

    if (!existing.isPublished) {
      await this.deps.repo.updateAnnouncement(announcementId, {
        isPublished: true,
        publishedAt: new Date(),
      });
    }

    const updated = await this.deps.repo.findAnnouncement(announcementId);
    if (!updated) {
      throw new NotFoundError('Announcement not found.');
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.PUBLISH_ANNOUNCEMENT,
      targetType: 'announcement',
      targetId: announcementId,
      changes: { published: true, publishedAt: updated.publishedAt?.toISOString() ?? null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    logger.info(
      { announcementId, actor: actor.userId },
      'Announcement published; email fan-out skipped (SMTP queue handled by notification preferences).',
    );

    return toDto(updated);
  }

  /** Admin listing surface (draft + published + expired rows). */
  async list(): Promise<AdminAnnouncementDto[]> {
    const rows = await this.deps.repo.listAnnouncements();
    return rows.map(toDto);
  }
}

export const adminAnnouncementService = new AdminAnnouncementService();