import { Router } from 'express';
import { authRoutes } from '../features/auth';
import { countryRoutes, platformRoutes, skillRoutes, userRoutes } from '../features/users';
import { roleRoutes } from '../features/roles';
import { permissionRoutes } from '../features/permissions';
import { reportRoutes } from '../features/reports';
import { dashboardRoutes } from '../features/dashboard';
import { adminRoutes } from '../features/admin';
import { orgRoutes } from '../features/orgs';
import { adminCurriculumRoutes, curriculumRoutes } from '../features/curriculum';
import { adminProgressRouter, progressRouter } from '../features/progress';
import { adminLabsRouter, labsRouter } from '../features/labs';
import { adminGamificationRouter, gamificationRouter } from '../features/gamification';
import { adminNotificationsRouter, notificationsRouter } from '../features/notifications';
import { adminModerationRouter, communityRouter } from '../features/community';
import { adminOperationsRouter, operationsRouter } from '../features/operations';
import { adminAnalyticsRouter } from '../features/analytics';

export function registerRoutes(): Router {
  const router = Router();

  router.use('/auth', authRoutes);
  router.use('/users', userRoutes);
  router.use('/skills', skillRoutes);
  router.use('/countries', countryRoutes);
  router.use('/platform', platformRoutes);
  router.use('/admin', adminRoutes);
  router.use('/roles', roleRoutes);
  router.use('/permissions', permissionRoutes);
  router.use('/reports', reportRoutes);
  router.use('/dashboard', dashboardRoutes);
  router.use('/', orgRoutes);
  router.use('/curriculum', curriculumRoutes);
  router.use('/admin', adminCurriculumRoutes);
  router.use('/progress', progressRouter);
  router.use('/admin', adminProgressRouter);
  router.use(labsRouter);
  router.use('/admin', adminLabsRouter);
  router.use(gamificationRouter);
  router.use('/admin', adminGamificationRouter);
  router.use(notificationsRouter);
  router.use('/admin', adminNotificationsRouter);
  router.use(communityRouter);
  router.use('/admin', adminModerationRouter);
  router.use(operationsRouter);
  router.use('/admin', adminOperationsRouter);
  router.use('/admin', adminAnalyticsRouter);

  return router;
}
