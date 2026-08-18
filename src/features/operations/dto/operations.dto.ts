/**
 * F8 response DTOs for platform operations (events, file downloads,
 * email templates). All dates are ISO strings.
 */

/** OPS-09..12: event row (public). */
export interface EventDto {
  eventId: number;
  title: string;
  description: string | null;
  location: string | null;
  eventType: 'webinar' | 'workshop' | 'competition' | 'conference' | 'meetup';
  startTime: string;
  endTime: string | null;
  timezone: string | null;
  maxAttendees: number;
  isFree: boolean;
  price: string;
  registrationDeadline: string | null;
  bannerUrl: string | null;
  isActive: boolean;
  isFull: boolean;
  isRegistered: boolean;
  registrationStatus: 'registered' | 'waitlisted' | 'cancelled' | null;
}

/** OPS-24/25: admin event row. */
export interface AdminEventDto {
  eventId: number;
  title: string;
  description: string | null;
  location: string | null;
  eventType: 'webinar' | 'workshop' | 'competition' | 'conference' | 'meetup';
  startTime: string;
  endTime: string | null;
  timezone: string | null;
  maxAttendees: number;
  isFree: boolean;
  price: string;
  registrationDeadline: string | null;
  bannerUrl: string | null;
  isActive: boolean;
  registeredCount: number;
  waitlistedCount: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

/** OPS-26: attendee row. */
export interface EventAttendeeDto {
  registrationId: number;
  userId: number;
  fullName: string | null;
  email: string;
  status: 'registered' | 'attended' | 'cancelled' | 'waitlisted';
  attendeeName: string | null;
  attendeeEmail: string | null;
  company: string | null;
  registeredAt: string;
}

/** OPS-20: file download URL response. */
export interface FileDownloadDto {
  fileId: number;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
  expiresInSeconds: number;
}

/** OPS-43/44: admin file row. */
export interface AdminFileDto {
  fileId: number;
  fileName: string;
  filePath: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  storageType: 'local' | 's3' | 'azure' | 'gcs';
  isPublic: boolean;
  downloadsCount: number;
  uploadedBy: number;
  createdAt: string;
}

/** OPS-35..37: email template row. */
export interface EmailTemplateDto {
  templateId: number;
  templateKey: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  placeholders: string[] | null;
  isActive: boolean;
  updatedAt: string;
}

/** OPS-37: rendered preview result. */
export interface EmailTemplatePreviewDto {
  templateId: number;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
}