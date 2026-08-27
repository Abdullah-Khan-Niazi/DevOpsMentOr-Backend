import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { notificationService } from '../../../features/notifications';
import type { EventDto } from '../dto/operations.dto';
import type { IOperationsRepository } from '../repositories/operations.repository';
import { operationsRepository } from '../repositories/operations.repository';

/**
 * F8 §07 event surface (OPS-09..12).
 *
 * - Capacity enforcement: when `count(registered|attended) >= max_attendees`
 *   and `max_attendees > 0`, the row is inserted as `waitlisted`
 *   (invariant 7).
 * - Duplicate registration is blocked by the SQL unique key; the service
 *   pre-checks and returns 409 (AC-05).
 * - Successful registration dispatches an `event` notification
 *   (contract §07: "INSERT event_registrations → dispatch confirmation
 *   notification").
 */
export interface EventServiceDeps {
  repo: Pick<
    IOperationsRepository,
    | 'listEvents'
    | 'countEvents'
    | 'findEventById'
    | 'countActiveRegistrations'
    | 'findRegistration'
    | 'insertRegistration'
    | 'cancelRegistration'
  >;
  notify: Pick<typeof notificationService, 'dispatch'>;
}

function defaultDeps(): EventServiceDeps {
  return { repo: operationsRepository, notify: notificationService };
}

function toDto(row: {
  eventId: number;
  title: string;
  description: string | null;
  location: string | null;
  eventType: EventDto['eventType'];
  startTime: Date;
  endTime: Date | null;
  timezone: string | null;
  maxAttendees: number;
  isFree: boolean;
  price: string;
  registrationDeadline: Date | null;
  bannerUrl: string | null;
  isActive: boolean;
}, extra: {
  isFull: boolean;
  isRegistered: boolean;
  registrationStatus: EventDto['registrationStatus'];
}): EventDto {
  return {
    eventId: row.eventId,
    title: row.title,
    description: row.description,
    location: row.location,
    eventType: row.eventType,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime?.toISOString() ?? null,
    timezone: row.timezone,
    maxAttendees: row.maxAttendees,
    isFree: row.isFree,
    price: row.price,
    registrationDeadline: row.registrationDeadline?.toISOString() ?? null,
    bannerUrl: row.bannerUrl,
    isActive: row.isActive,
    ...extra,
  };
}

export class EventService {
  constructor(private readonly deps: EventServiceDeps = defaultDeps()) {}

  /** OPS-09: public active-event list. */
  async listEvents(
    page: number,
    limit: number,
    upcomingOnly: boolean,
    userId: number | null,
  ): Promise<{ data: EventDto[]; total: number; page: number }> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listEvents((page - 1) * limit, limit, upcomingOnly),
      this.deps.repo.countEvents(upcomingOnly),
    ]);

    const data = await Promise.all(
      rows.map(async (row) => {
        const [activeCount, registration] = await Promise.all([
          this.deps.repo.countActiveRegistrations(row.eventId),
          userId === null
            ? Promise.resolve(undefined)
            : this.deps.repo.findRegistration(row.eventId, userId),
        ]);
        const isFull = row.maxAttendees > 0 && activeCount >= row.maxAttendees;
        const status = registration?.status === 'cancelled' ? null : (registration?.status ?? null);
        return toDto(row, {
          isFull,
          isRegistered: status !== null,
          registrationStatus: status as EventDto['registrationStatus'],
        });
      }),
    );

    return { data, total, page };
  }

  /** OPS-10: single active event. */
  async getEvent(eventId: number, userId: number | null): Promise<EventDto> {
    const row = await this.deps.repo.findEventById(eventId);
    if (!row || !row.isActive) {
      throw new NotFoundError('Event not found.');
    }

    const [activeCount, registration] = await Promise.all([
      this.deps.repo.countActiveRegistrations(eventId),
      userId === null
        ? Promise.resolve(undefined)
        : this.deps.repo.findRegistration(eventId, userId),
    ]);
    const isFull = row.maxAttendees > 0 && activeCount >= row.maxAttendees;
    const status = registration?.status === 'cancelled' ? null : (registration?.status ?? null);

    return toDto(row, {
      isFull,
      isRegistered: status !== null,
      registrationStatus: status as EventDto['registrationStatus'],
    });
  }

  /** OPS-11: register (or waitlist) for an event. */
  async register(eventId: number, userId: number): Promise<{ status: 'registered' | 'waitlisted' }> {
    const event = await this.deps.repo.findEventById(eventId);
    if (!event || !event.isActive) {
      throw new NotFoundError('Event not found.');
    }

    const existing = await this.deps.repo.findRegistration(eventId, userId);
    if (existing) {
      if (existing.status === 'cancelled') {
        throw new ConflictError('Your previous registration was cancelled; please contact an organizer.');
      }
      throw new ConflictError('You are already registered for this event.');
    }

    if (event.registrationDeadline && event.registrationDeadline < new Date()) {
      throw new ValidationError('The registration deadline for this event has passed.');
    }

    const activeCount = await this.deps.repo.countActiveRegistrations(eventId);
    const isFull = event.maxAttendees > 0 && activeCount >= event.maxAttendees;
    const status = isFull ? 'waitlisted' : 'registered';

    await this.deps.repo.insertRegistration(eventId, userId, status);

    await this.deps.notify.dispatch({
      userId,
      type: 'event',
      title: isFull ? 'Event waitlisted' : 'Event registration confirmed',
      message: isFull
        ? `You have been waitlisted for "${event.title}".`
        : `You are registered for "${event.title}".`,
      linkUrl: `/events/${eventId}`,
    });

    return { status };
  }

  /** OPS-12: cancel a registration (200 when nothing to cancel). */
  async cancelRegistration(eventId: number, userId: number): Promise<void> {
    await this.deps.repo.cancelRegistration(eventId, userId);
  }
}

export const eventService = new EventService();