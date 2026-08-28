import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor, AdminEventService } from '../services/admin-event.service';
import { adminEventService } from '../services/admin-event.service';

/** F8 §07 admin event HTTP handlers (OPS-24..26). */
export class AdminEventController {
  constructor(private readonly service: AdminEventService = adminEventService) {}

  private actor(req: Request): AdminActor {
    return {
      userId: Number(req.user?.sub),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  /** OPS-24: create an event. */
  async create(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      title: string;
      description?: string;
      location?: string;
      eventType: 'webinar' | 'workshop' | 'competition' | 'conference' | 'meetup';
      startTime: string;
      endTime?: string;
      timezone?: string;
      maxAttendees?: number;
      isFree?: boolean;
      price?: number;
      registrationDeadline?: string;
      bannerUrl?: string;
      isActive?: boolean;
    };
    const event = await this.service.create(this.actor(req), {
      title: body.title,
      description: body.description ?? null,
      location: body.location ?? null,
      eventType: body.eventType,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : null,
      timezone: body.timezone ?? null,
      maxAttendees: body.maxAttendees ?? 0,
      isFree: body.isFree ?? true,
      price: body.price ?? 0,
      registrationDeadline: body.registrationDeadline ? new Date(body.registrationDeadline) : null,
      bannerUrl: body.bannerUrl ?? null,
      isActive: body.isActive ?? true,
    });
    return sendSuccess(res, event, 'Event created successfully.', 201);
  }

  /** OPS-25: update an event. */
  async update(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      title?: string;
      description?: string | null;
      location?: string | null;
      eventType?: 'webinar' | 'workshop' | 'competition' | 'conference' | 'meetup';
      startTime?: string;
      endTime?: string | null;
      timezone?: string | null;
      maxAttendees?: number;
      isFree?: boolean;
      price?: number;
      registrationDeadline?: string | null;
      bannerUrl?: string | null;
      isActive?: boolean;
    };
    const event = await this.service.update(this.actor(req), Number(req.params.eventId), {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.location !== undefined && { location: body.location }),
      ...(body.eventType !== undefined && { eventType: body.eventType }),
      ...(body.startTime !== undefined && { startTime: new Date(body.startTime) }),
      ...(body.endTime !== undefined && { endTime: body.endTime === null ? null : new Date(body.endTime) }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.maxAttendees !== undefined && { maxAttendees: body.maxAttendees }),
      ...(body.isFree !== undefined && { isFree: body.isFree }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.registrationDeadline !== undefined && {
        registrationDeadline: body.registrationDeadline === null ? null : new Date(body.registrationDeadline),
      }),
      ...(body.bannerUrl !== undefined && { bannerUrl: body.bannerUrl }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    });
    return sendSuccess(res, event, 'Event updated successfully.');
  }

  /** OPS-26: attendee list. */
  async listAttendees(req: Request, res: Response): Promise<Response> {
    const result = await this.service.listAttendees(
      Number(req.params.eventId),
      req.query.status as 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
      Number(req.query.page),
      Number(req.query.limit),
    );
    return sendSuccess(res, result, 'Attendees retrieved successfully.');
  }
}

export const adminEventController = new AdminEventController();