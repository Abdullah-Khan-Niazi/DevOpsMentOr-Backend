import { NotFoundError } from '../../../shared/errors';
import type { AnnouncementDto } from '../dto/notifications.dto';
import type { INotificationsRepository } from '../repositories/notifications.repository';
import { notificationsRepository } from '../repositories/notifications.repository';

/**
 * F8 §08 learner announcement surface. Publishes only `is_published = TRUE`
 * rows that have not expired (`expires_at IS NULL OR expires_at > NOW()`,
 * AC-13). Read state is resolved per user through `announcement_reads`.
 */
export interface AnnouncementServiceDeps {
  repo: Pick<
    INotificationsRepository,
    'listPublished' | 'findAnnouncement' | 'markAnnouncementRead' | 'listReadAnnouncementIds'
  >;
}

function defaultDeps(): AnnouncementServiceDeps {
  return { repo: notificationsRepository };
}

export class AnnouncementService {
  constructor(private readonly deps: AnnouncementServiceDeps = defaultDeps()) {}

  /** OPS-07: published + non-expired announcements with per-user read state. */
  async listPublished(userId: number | null): Promise<AnnouncementDto[]> {
    const [rows, readIds] = await Promise.all([
      this.deps.repo.listPublished(),
      userId === null ? Promise.resolve([]) : this.deps.repo.listReadAnnouncementIds(userId),
    ]);
    const read = new Set(readIds);

    return rows.map((row) => ({
      announcementId: row.announcementId,
      title: row.title,
      content: row.content,
      announcementType: row.announcementType,
      priority: row.priority,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      isRead: read.has(row.announcementId),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** OPS-08: mark an announcement read. Published row must exist (404 otherwise). */
  async markRead(announcementId: number, userId: number): Promise<void> {
    const existing = await this.deps.repo.findAnnouncement(announcementId);
    if (!existing || !existing.isPublished) {
      throw new NotFoundError('Announcement not found.');
    }
    await this.deps.repo.markAnnouncementRead(announcementId, userId);
  }
}

export const announcementService = new AnnouncementService();