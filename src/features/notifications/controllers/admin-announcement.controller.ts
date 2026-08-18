import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor } from '../services/admin-announcement.service';
import type { AdminAnnouncementService } from '../services/admin-announcement.service';
import { adminAnnouncementService } from '../services/admin-announcement.service';

/** F8 §08 HTTP handling for admin announcement publishing (OPS-21..23). */
export class AdminAnnouncementController {
  constructor(private readonly service: AdminAnnouncementService = adminAnnouncementService) {}

  private actor(req: Request): AdminActor {
    return {
      userId: Number(req.user?.sub),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  /** OPS-21: create an announcement. */
  async create(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      title: string;
      content: string;
      announcementType: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
      priority: 'low' | 'medium' | 'high' | 'critical';
      isPublished: boolean;
      expiresAt: string | null;
    };
    const announcement = await this.service.create(this.actor(req), {
      title: body.title,
      content: body.content,
      announcementType: body.announcementType,
      priority: body.priority,
      isPublished: body.isPublished,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    return sendSuccess(res, announcement, 'Announcement created successfully.', 201);
  }

  /** OPS-22: update an announcement. */
  async update(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      title?: string;
      content?: string;
      announcementType?: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
      priority?: 'low' | 'medium' | 'high' | 'critical';
      expiresAt?: string | null;
    };
    const announcement = await this.service.update(this.actor(req), Number(req.params.id), {
      title: body.title,
      content: body.content,
      announcementType: body.announcementType,
      priority: body.priority,
      expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt === null ? null : new Date(body.expiresAt),
    });
    return sendSuccess(res, announcement, 'Announcement updated successfully.');
  }

  /** OPS-23: publish an announcement. */
  async publish(req: Request, res: Response): Promise<Response> {
    const announcement = await this.service.publish(this.actor(req), Number(req.params.id));
    return sendSuccess(res, announcement, 'Announcement published successfully.');
  }

  /** Admin list surface (drafts + published + expired). */
  async list(_req: Request, res: Response): Promise<Response> {
    const announcements = await this.service.list();
    return sendSuccess(res, announcements, 'Announcements retrieved successfully.');
  }
}

export const adminAnnouncementController = new AdminAnnouncementController();