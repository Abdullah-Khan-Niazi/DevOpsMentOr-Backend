/**
 * F8 response DTOs and shared domain types. All dates are ISO strings.
 * Mirrors the contract §05 domain model and §07 endpoint response shapes.
 */

/** `notifications.type` ENUM values used in DevOps Mentor. */
export type NotificationType =
  | 'system'
  | 'achievement'
  | 'badge'
  | 'mention'
  | 'comment'
  | 'like'
  | 'follow'
  | 'team_invite'
  | 'ctf'
  | 'event'
  | 'security';

/** §02 dispatch contract consumed by F5, F6, F7 and F9 internal hooks. */
export interface NotificationDispatchPayload {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl?: string;
  iconUrl?: string;
}

/** OPS-01: in-app notification inbox row. */
export interface NotificationDto {
  notificationId: number;
  type: NotificationType;
  title: string;
  message: string | null;
  linkUrl: string | null;
  iconUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

/** OPS-01: paginated inbox payload with the bell badge count. */
export interface NotificationListDto {
  data: NotificationDto[];
  unreadCount: number;
  total: number;
  page: number;
}

/** OPS-05/06: per-user channel preference row. */
export interface NotificationPreferenceDto {
  userId: number;
  type: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
}

/** OPS-07: published announcement row (read state resolved per user). */
export interface AnnouncementDto {
  announcementId: number;
  title: string;
  content: string;
  announcementType: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
  priority: 'low' | 'medium' | 'high' | 'critical';
  publishedAt: string | null;
  expiresAt: string | null;
  isRead: boolean;
  createdAt: string;
}

/** OPS-21..23: admin announcement row (draft state included). */
export interface AdminAnnouncementDto {
  announcementId: number;
  title: string;
  content: string;
  announcementType: 'general' | 'maintenance' | 'feature' | 'security' | 'event';
  priority: 'low' | 'medium' | 'high' | 'critical';
  isPublished: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}