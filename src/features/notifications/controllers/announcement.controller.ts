import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AnnouncementService } from '../services/announcement.service';
import { announcementService } from '../services/announcement.service';

/** F8 §08 HTTP handling for the public announcement surface (OPS-07/08). */
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService = announcementService) {}

  /** OPS-07: published, non-expired announcements (public). */
  async listPublished(req: Request, res: Response): Promise<Response> {
    const userId = req.user ? Number(req.user.sub) : null;
    const announcements = await this.service.listPublished(userId);
    return sendSuccess(res, announcements, 'Announcements retrieved successfully.');
  }

  /** OPS-08: mark an announcement read (authenticated). */
  async markRead(req: Request, res: Response): Promise<Response> {
    await this.service.markRead(Number(req.params.id), Number(req.user?.sub));
    return sendSuccess(res, { announcementId: Number(req.params.id), isRead: true }, 'Announcement marked as read.');
  }
}

export const announcementController = new AnnouncementController();