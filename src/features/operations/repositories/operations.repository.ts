import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  downloads,
  emailTemplates,
  eventRegistrations,
  events,
  files,
  users,
} from '../../../app/database/schema';
import type {
  EventAttendeeDto,
} from '../dto/operations.dto';

/**
 * F8 data access for events, event registrations, files/downloads and
 * email templates.
 */

export interface EventRow {
  eventId: number;
  title: string;
  description: string | null;
  location: string | null;
  eventType: 'webinar' | 'workshop' | 'competition' | 'conference' | 'meetup';
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
}

export interface RegistrationRow {
  registrationId: number;
  eventId: number;
  userId: number;
  attendeeName: string | null;
  attendeeEmail: string | null;
  company: string | null;
  status: 'registered' | 'attended' | 'cancelled' | 'waitlisted';
  registeredAt: Date;
}

export interface FileRow {
  fileId: number;
  userId: number;
  fileName: string;
  filePath: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  fileHash: string | null;
  storageType: 'local' | 's3' | 'azure' | 'gcs';
  bucketName: string | null;
  objectKey: string | null;
  isPublic: boolean;
  uploadIp: string | null;
  downloadsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailTemplateRow {
  templateId: number;
  templateKey: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  placeholders: string[] | null;
  isActive: boolean;
  updatedAt: Date;
  createdAt: Date;
}

export interface IOperationsRepository {
  // events
  listEvents(skip: number, take: number, upcomingOnly: boolean): Promise<EventRow[]>;
  countEvents(upcomingOnly: boolean): Promise<number>;
  findEventById(eventId: number): Promise<EventRow | undefined>;
  countActiveRegistrations(eventId: number): Promise<number>;
  findRegistration(eventId: number, userId: number): Promise<RegistrationRow | undefined>;
  insertRegistration(
    eventId: number,
    userId: number,
    status: 'registered' | 'waitlisted',
  ): Promise<number>;
  cancelRegistration(eventId: number, userId: number): Promise<number>;
  insertEvent(input: {
    title: string;
    description: string | null;
    location: string | null;
    eventType: EventRow['eventType'];
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
  }): Promise<number>;
  updateEvent(eventId: number, patch: Partial<Record<string, unknown>>): Promise<void>;
  listAttendees(
    eventId: number,
    status: 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
    skip: number,
    take: number,
  ): Promise<Array<Omit<EventAttendeeDto, 'registeredAt'> & { registeredAt: Date }>>;
  countAttendees(
    eventId: number,
    status: 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
  ): Promise<number>;
  countRegistrationsByStatus(eventId: number): Promise<
    Array<{ status: 'registered' | 'attended' | 'cancelled' | 'waitlisted'; value: number }>
  >;
  // files
  findFileById(fileId: number): Promise<FileRow | undefined>;
  listFiles(skip: number, take: number): Promise<FileRow[]>;
  countFiles(): Promise<number>;
  insertDownload(userId: number, fileId: number, ipAddress: string | null, userAgent: string | null): Promise<void>;
  incrementDownloadsCount(fileId: number): Promise<void>;
  // email templates
  listEmailTemplates(): Promise<EmailTemplateRow[]>;
  findEmailTemplateById(templateId: number): Promise<EmailTemplateRow | undefined>;
  updateEmailTemplate(
    templateId: number,
    patch: { subject?: string; bodyHtml?: string; bodyText?: string; isActive?: boolean },
  ): Promise<void>;
}

export class OperationsRepository implements IOperationsRepository {
  // ---------------- events ----------------

  async listEvents(skip: number, take: number, upcomingOnly: boolean): Promise<EventRow[]> {
    return db
      .select()
      .from(events)
      .where(
        and(
          eq(events.isActive, true),
          upcomingOnly ? gte(events.startTime, sql`NOW()`) : undefined,
        ),
      )
      .orderBy(desc(events.startTime))
      .limit(take)
      .offset(skip);
  }

  async countEvents(upcomingOnly: boolean): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(events)
      .where(
        and(
          eq(events.isActive, true),
          upcomingOnly ? gte(events.startTime, sql`NOW()`) : undefined,
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async findEventById(eventId: number): Promise<EventRow | undefined> {
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.eventId, eventId))
      .limit(1);
    return rows[0];
  }

  async countActiveRegistrations(eventId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          sql`${eventRegistrations.status} IN ('registered', 'attended')`,
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async findRegistration(eventId: number, userId: number): Promise<RegistrationRow | undefined> {
    const rows = await db
      .select()
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insertRegistration(
    eventId: number,
    userId: number,
    status: 'registered' | 'waitlisted',
  ): Promise<number> {
    const inserted = await db.insert(eventRegistrations).values({
      eventId,
      userId,
      status,
    });
    const registrationId = inserted[0]?.insertId;
    if (!registrationId) {
      throw new Error('Registration insert failed.');
    }
    return registrationId;
  }

  async cancelRegistration(eventId: number, userId: number): Promise<number> {
    const updated = await db
      .update(eventRegistrations)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.userId, userId),
          sql`${eventRegistrations.status} IN ('registered', 'waitlisted')`,
        ),
      );
    return updated[0]?.affectedRows ?? 0;
  }

  async insertEvent(input: {
    title: string;
    description: string | null;
    location: string | null;
    eventType: EventRow['eventType'];
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
  }): Promise<number> {
    const inserted = await db.insert(events).values(input);
    const eventId = inserted[0]?.insertId;
    if (!eventId) {
      throw new Error('Event insert failed.');
    }
    return eventId;
  }

  async updateEvent(eventId: number, patch: Partial<Record<string, unknown>>): Promise<void> {
    await db
      .update(events)
      .set(patch)
      .where(eq(events.eventId, eventId));
  }

  async listAttendees(
    eventId: number,
    status: 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
    skip: number,
    take: number,
  ): Promise<Array<Omit<EventAttendeeDto, 'registeredAt'> & { registeredAt: Date }>> {
    return db
      .select({
        registrationId: eventRegistrations.registrationId,
        userId: eventRegistrations.userId,
        fullName: users.fullName,
        email: users.email,
        status: eventRegistrations.status,
        attendeeName: eventRegistrations.attendeeName,
        attendeeEmail: eventRegistrations.attendeeEmail,
        company: eventRegistrations.company,
        registeredAt: eventRegistrations.registeredAt,
      })
      .from(eventRegistrations)
      .innerJoin(users, eq(users.userId, eventRegistrations.userId))
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          status ? eq(eventRegistrations.status, status) : undefined,
        ),
      )
      .orderBy(desc(eventRegistrations.registeredAt))
      .limit(take)
      .offset(skip);
  }

  async countAttendees(
    eventId: number,
    status: 'registered' | 'attended' | 'cancelled' | 'waitlisted' | undefined,
  ): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          status ? eq(eventRegistrations.status, status) : undefined,
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async countRegistrationsByStatus(eventId: number): Promise<
    Array<{ status: 'registered' | 'attended' | 'cancelled' | 'waitlisted'; value: number }>
  > {
    return db
      .select({
        status: eventRegistrations.status,
        value: count(),
      })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.eventId, eventId))
      .groupBy(eventRegistrations.status);
  }

  // ---------------- files ----------------

  async findFileById(fileId: number): Promise<FileRow | undefined> {
    const rows = await db
      .select()
      .from(files)
      .where(eq(files.fileId, fileId))
      .limit(1);
    return rows[0];
  }

  async listFiles(skip: number, take: number): Promise<FileRow[]> {
    return db
      .select()
      .from(files)
      .orderBy(desc(files.createdAt))
      .limit(take)
      .offset(skip);
  }

  async countFiles(): Promise<number> {
    const rows = await db.select({ value: count() }).from(files);
    return rows[0]?.value ?? 0;
  }

  async insertDownload(
    userId: number,
    fileId: number,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await db.insert(downloads).values({
      userId,
      fileId,
      ipAddress,
      userAgent,
    });
  }

  async incrementDownloadsCount(fileId: number): Promise<void> {
    await db
      .update(files)
      .set({ downloadsCount: sql`${files.downloadsCount} + 1` })
      .where(eq(files.fileId, fileId));
  }

  // ---------------- email templates ----------------

  async listEmailTemplates(): Promise<EmailTemplateRow[]> {
    return db
      .select()
      .from(emailTemplates)
      .orderBy(desc(emailTemplates.updatedAt));
  }

  async findEmailTemplateById(templateId: number): Promise<EmailTemplateRow | undefined> {
    const rows = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.templateId, templateId))
      .limit(1);
    return rows[0];
  }

  async updateEmailTemplate(
    templateId: number,
    patch: { subject?: string; bodyHtml?: string; bodyText?: string; isActive?: boolean },
  ): Promise<void> {
    await db
      .update(emailTemplates)
      .set(patch)
      .where(eq(emailTemplates.templateId, templateId));
  }
}

export const operationsRepository = new OperationsRepository();