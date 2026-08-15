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

  return router;
}
