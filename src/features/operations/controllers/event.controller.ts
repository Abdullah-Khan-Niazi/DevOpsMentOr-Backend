import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { EventService } from '../services/event.service';
import { eventService } from '../services/event.service';

/** F8 §07 learner event HTTP handlers (OPS-09..12). */
export class EventController {
  constructor(private readonly service: EventService = eventService) {}

  /** OPS-09: public active-event list (public). */
  async listEvents(req: Request, res: Response): Promise<Response> {
    const result = await this.service.listEvents(
      Number(req.query.page),
      Number(req.query.limit),
      req.query.upcomingOnly !== 'false',
      req.user ? Number(req.user.sub) : null,
    );
    return sendSuccess(res, result, 'Events retrieved successfully.');
  }

  /** OPS-10: single active event (public). */
  async getEvent(req: Request, res: Response): Promise<Response> {
    const event = await this.service.getEvent(
      Number(req.params.eventId),
      req.user ? Number(req.user.sub) : null,
    );
    return sendSuccess(res, event, 'Event retrieved successfully.');
  }

  /** OPS-11: register (or waitlist) for an event. */
  async register(req: Request, res: Response): Promise<Response> {
    const result = await this.service.register(Number(req.params.eventId), Number(req.user?.sub));
    return sendSuccess(
      res,
      result,
      result.status === 'waitlisted' ? 'You have been waitlisted for this event.' : 'Registration confirmed.',
      201,
    );
  }

  /** OPS-12: cancel a registration. */
  async cancelRegistration(req: Request, res: Response): Promise<Response> {
    await this.service.cancelRegistration(Number(req.params.eventId), Number(req.user?.sub));
    return sendSuccess(res, { eventId: Number(req.params.eventId) }, 'Registration cancelled.');
  }
}

export const eventController = new EventController();