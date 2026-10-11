import { z } from 'zod';

/** ADM-01 (F2 §07 AdminUserListQuerySchema). */
export const adminUserListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(100).optional(),
    role: z.string().max(50).optional(),
    isBanned: z.enum(['true', 'false']).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    isDeleted: z.enum(['true', 'false']).optional(),
    organizationId: z.coerce.number().int().positive().optional(),
    country: z.string().max(100).optional(),
  })
  .strip();

export const inviteUserSchema = z
  .object({
    emails: z.array(z.string().email()).min(1).max(100),
    type: z.enum(['individual_learner', 'organization']),
    organizationId: z.number().int().positive().optional(),
    role: z.enum(['individual_learner', 'org_admin', 'professor', 'org_student', 'platform_admin']).optional(),
  })
  .strip();

/** ADM-03 (F2 §07 BanUserSchema). */
export const banUserSchema = z
  .object({
    banReason: z.string().min(10).max(1000),
  })
  .strip();

/** ADM-02/03/04/05: route param `:userId`. */
export const adminUserIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

/** ADM-09: setting value update (JSON body). */
export const updateSettingSchema = z
  .object({
    settingValue: z.unknown(),
  })
  .strip();

/** ADM-07: audit log list query. */
export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    action: z.string().max(50).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strip();