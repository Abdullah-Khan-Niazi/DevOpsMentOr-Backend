export { notificationsRouter } from './routes/notifications.routes';
export { adminNotificationsRouter } from './routes/admin-notifications.routes';
export { notificationService } from './services/notification.service';
export { announcementService } from './services/announcement.service';
export { adminAnnouncementService } from './services/admin-announcement.service';
export { emailAdapter } from './adapters/email.adapter';
export type {
  NotificationType,
  NotificationDispatchPayload,
  NotificationDto,
  NotificationListDto,
  NotificationPreferenceDto,
  AnnouncementDto,
  AdminAnnouncementDto,
} from './dto/notifications.dto';