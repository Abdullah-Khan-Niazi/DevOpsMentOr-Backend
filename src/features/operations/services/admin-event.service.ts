import { AUDIT_ACTIONS } from '../../../shared/constants';
import { NotFoundError } from '../../../shared/errors';
import type {
  AdminEventDto,
  EventAttendeeDto,
} from '../dto/operations.dto';
import type { IOperationsRepository } from '../repositories/operations.repository';
import { operationsRepository } from '../repositories/operations.repository';
import type { AuditLogService } from '../../../features/admin/services/audit-log.service';
import { auditLogService } from '../../../features/admin/services/audit-log.service';

/** Identity of the platform admin performing a mutation (for audit rows). */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * F8 §07 admin event management (OPS-24..26). Every mutation writes an
 * `audit_logs` row.
 */
export interface AdminEventServiceDeps {
  repo: Pick<
    IOperationsRepository,
    | 'insertEvent'
    | 'findEventById'
    | 'updateEvent'
    | 'listAttendees'
    | 'countAttendees'
    | 'countRegistrationsByStatus'
  >;
  audit: Pick<AuditLogService, 'record'>;
}

function defaultDeps(): AdminEventServiceDeps {
  return { repo: operationsRepository, audit: auditLogService };
}

export class AdminEventService {
  constructor(private readonly deps: AdminEventServiceDeps = defaultDeps()) {}

  /** OPS-24: create an event. */
  async create(
    actor: AdminActor,
    input: {
      title: string;
      description: string | null;
      location: string | null;
      eventType: AdminEventDto['eventType'];
      startTime: Date;
      endTime: Date | null;
      timezone: string | null;
      maxAttendees: number;
      isFree: boolean;
      price: number;
      registrationDeadline: Date | null;
      bannerUrl: string | null;
      isActive: boolean;
    },
  ): Promise<AdminEventDto> {
    const eventId = await this.deps.repo.insertEvent({
      ...input,
      price: input.price.toFixed(2),
      createdBy: actor.userId,
    });

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.CREATE_EVENT,
      targetType: 'event',
      targetId: eventId,
      changes: { title: input.title, isActive: input.isActive },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const row = await this.deps.repo.findEventById(eventId);
    if (!row) {
      throw new NotFoundError('Event not found.');
    }
    return this.toDto(row, actor.userId, { registered: 0, waitlisted: 0 });
  }

  /** OPS-25: update an event. */
  async update(
    actor: AdminActor,
    eventId: number,
    patch: Partial<{
      title: string;
      description: string | null;
      location: string | null;
      eventType: AdminEventDto['eventType'];
      startTime: Date;
      endTime: Date | null;
      timezone: string | null;
      maxAttendees: number;
      isFree: boolean;
      price: number;
      registrationDeadline: Date | null;
      bannerUrl: string | null;
      isActive: boolean;
    }>,
  ): Promise<AdminEventDto> {
    const existing = await this.deps.repo.findEventById(eventId);
    if (!existing) {
      throw new NotFoundError('Event not found.');
    }

    await this.deps.repo.updateEvent(eventId, {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.location !== undefined && { location: patch.location }),
      ...(patch.eventType !== undefined && { eventType: patch.eventType }),
      ...(patch.startTime !== undefined && { startTime: patch.startTime }),
      ...(patch.endTime !== undefined && { endTime: patch.endTime }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.maxAttendees !== undefined && { maxAttendees: patch.maxAttendees }),
      ...(patch.isFree !== undefined && { isFree: patch.isFree }),
      ...(patch.price !== undefined && { price: patch.price.toFixed(2) }),
      ...(patch.registrationDeadline !== undefined && {
        registrationDeadline: patch.registrationDeadline,
      }),
      ...(patch.bannerUrl !== undefined && { bannerUrl: patch.bannerUrl }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    });

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UPDATE_EVENT,
      targetType: 'event',
      targetId: eventId,
      changes: { before: { title: existing.title }, after: { title: patch.title ?? existing.title } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = await this.deps.repo.findEventById(eventId);
    if (!updated) {
      throw new NotFoundError('Event not found.');
    }
    const counts = await this.registrationCounts(eventId);
    return this.toDto(updated, actor.userId, counts);
  }

  /** OPS-26: attendee list with a status filter. */
  async listAttendees(
    eventId: number,
    status: 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
    page: number,
    limit: number,
  ): Promise<{ data: EventAttendeeDto[]; total: number; page: number }> {
    const existing = await this.deps.repo.findEventById(eventId);
    if (!existing) {
      throw new NotFoundError('Event not found.');
    }

    const [data, total] = await Promise.all([
      this.deps.repo.listAttendees(eventId, status, (page - 1) * limit, limit),
      this.deps.repo.countAttendees(eventId, status),
    ]);

    return {
      data: data.map((row) => ({ ...row, registeredAt: row.registeredAt.toISOString() })),
      total,
      page,
    };
  }

  private async registrationCounts(eventId: number): Promise<{ registered: number; waitlisted: number }> {
    const rows = await this.deps.repo.countRegistrationsByStatus(eventId);
    const counts = { registered: 0, waitlisted: 0 };
    for (const row of rows) {
      if (row.status === 'registered' || row.status === 'attended') {
        counts.registered += row.value;
      } else if (row.status === 'waitlisted') {
        counts.waitlisted += row.value;
      }
    }
    return counts;
  }

  private toDto(
    row: {
      eventId: number;
      title: string;
      description: string | null;
      location: string | null;
      eventType: AdminEventDto['eventType'];
      startTime: Date;
      endTime: Date | null;
      timezone: string | null;
      maxAttendees: number;
      isFree: boolean;
      price: string;
      registrationDeadline: Date | null;
      bannerUrl: string | null;
      isActive: boolean;
      createdBy: number;
      createdAt: Date;
      updatedAt: Date;
    },
    _createdBy: number,
    counts: { registered: number; waitlisted: number },
  ): AdminEventDto {
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
      registeredCount: counts.registered,
      waitlistedCount: counts.waitlisted,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const adminEventService = new AdminEventService();