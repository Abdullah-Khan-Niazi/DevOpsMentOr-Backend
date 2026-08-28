import type { Request, Response } from 'express';
import { NotFoundError } from '../../../shared/errors';
import { sendSuccess } from '../../../shared/utils';
import type { NotificationService } from '../services/notification.service';
import { notificationService } from '../services/notification.service';

/** F8 §08 HTTP handling for the learner notification inbox (OPS-01..06). */
export class NotificationController {
  constructor(private readonly service: NotificationService = notificationService) {}

  /** OPS-01: paginated inbox with the unread bell count. */
  async listInbox(req: Request, res: Response): Promise<Response> {
    const page = Number(req.query.page);
    const limit = Number(req.query.limit);
    const unreadOnly = req.query.unreadOnly === 'true';
    const inbox = await this.service.listInbox(
      Number(req.user?.sub),
      page,
      limit,
      unreadOnly,
    );
    return sendSuccess(res, inbox, 'Notifications retrieved successfully.');
  }

  /** OPS-02: mark one owned notification read. */
  async markRead(req: Request, res: Response): Promise<Response> {
    const updated = await this.service.markRead(Number(req.user?.sub), Number(req.params.id));
    if (!updated) {
      throw new NotFoundError('Notification not found.');
    }
    return sendSuccess(res, { notificationId: Number(req.params.id), isRead: true }, 'Notification marked as read.');
  }

  /** OPS-03: mark every owned notification read. */
  async markAllRead(req: Request, res: Response): Promise<Response> {
    const updated = await this.service.markAllRead(Number(req.user?.sub));
    return sendSuccess(res, { updated }, 'All notifications marked as read.');
  }

  /** OPS-04: dismiss an owned notification. */
  async dismiss(req: Request, res: Response): Promise<Response> {
    const dismissed = await this.service.dismiss(Number(req.user?.sub), Number(req.params.id));
    if (!dismissed) {
      throw new NotFoundError('Notification not found.');
    }
    return sendSuccess(res, { notificationId: Number(req.params.id), isDismissed: true }, 'Notification dismissed.');
  }

  /** OPS-05: list channel preferences. */
  async getPreferences(req: Request, res: Response): Promise<Response> {
    const preferences = await this.service.getPreferences(Number(req.user?.sub));
    return sendSuccess(res, preferences, 'Notification preferences retrieved successfully.');
  }

  /** OPS-06: upsert a channel preference. */
  async updatePreferences(req: Request, res: Response): Promise<Response> {
    const { type, emailEnabled, pushEnabled, inAppEnabled } = req.body as {
      type: string;
      emailEnabled: boolean;
      pushEnabled: boolean;
      inAppEnabled: boolean;
    };
    await this.service.updatePreference(
      Number(req.user?.sub),
      type,
      emailEnabled,
      pushEnabled,
      inAppEnabled,
    );
    return sendSuccess(
      res,
      { type, emailEnabled, pushEnabled, inAppEnabled },
      'Notification preferences saved.',
    );
  }
}

export const notificationController = new NotificationController();