import { Router } from 'express';
import { authenticate } from '../../../shared/middleware';
import { asyncHandler, sendSuccess } from '../../../shared/utils';
import { countryService, skillService } from '../services/catalog.service';

/**
 * USR-13: skills catalog (authenticated).
 */
const skillRoutes = Router();

skillRoutes.get(
  '/',
  authenticate,
  asyncHandler(async (_req, res) => {
    const skills = await skillService.list();
    return sendSuccess(res, skills, 'Skills retrieved successfully.');
  }),
);

/**
 * USR-14: countries catalog (public).
 */
const countryRoutes = Router();

countryRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    const countries = await countryService.list();
    return sendSuccess(res, countries, 'Countries retrieved successfully.');
  }),
);

export { skillRoutes, countryRoutes };