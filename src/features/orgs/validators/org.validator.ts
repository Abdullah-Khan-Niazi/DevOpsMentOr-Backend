import { z } from 'zod';

const slugPattern = /^[a-z0-9-]+$/;
const hostnamePattern =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;

/** ORG-01 payload */
export const createOrgSchema = z
  .object({
    name: z.string().min(2, 'Organization name must be at least 2 characters.').max(255),
    slug: z
      .string()
      .min(2, 'Slug must be at least 2 characters.')
      .max(255)
      .regex(slugPattern, 'Slug may only contain lowercase letters, digits and hyphens.'),
    description: z.string().max(2000).optional().nullable(),
    logoUrl: z.string().url('Logo URL must be a valid URL.').optional().nullable(),
    website: z.string().url('Website must be a valid URL.').max(255).optional().nullable(),
    industry: z.string().max(100).optional().nullable(),
    billingEmail: z.string().email('Billing email must be a valid email.').max(255).optional().nullable(),
  })
  .strip();

/** ORG-04 payload */
export const updateOrgSchema = z
  .object({
    name: z.string().min(2).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    logoUrl: z.string().url().max(255).optional().nullable(),
    website: z.string().url().max(255).optional().nullable(),
    industry: z.string().max(100).optional().nullable(),
    billingEmail: z.string().email().max(255).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** ORG-05 payload */
export const assignOrgAdminSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
  })
  .strip();

/** ORG-08 payload */
export const emailDomainSchema = z
  .object({
    domain: z
      .string()
      .min(3, 'Domain must be a valid hostname.')
      .max(253)
      .regex(hostnamePattern, 'Domain must be a valid hostname.')
      .transform((value) => value.trim().toLowerCase()),
  })
  .strip();

/** ORG-09 payload */
export const inviteProfessorSchema = z
  .object({
    email: z.string().email('Invalid professor email.').transform((value) => value.trim().toLowerCase()),
  })
  .strip();

/** CLS-01 payload */
export const createClassSchema = z
  .object({
    className: z.string().min(2, 'Class name must be at least 2 characters.').max(100),
    description: z.string().max(2000).optional().nullable(),
    maxStudents: z.coerce.number().int().min(1, 'Capacity must be at least 1.').max(1000).optional(),
  })
  .strip();

/** CLS-04 payload */
export const updateClassSchema = z
  .object({
    className: z.string().min(2).max(100).optional(),
    description: z.string().max(2000).optional().nullable(),
    maxStudents: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** CLS-05 payload */
export const assignProfessorSchema = z
  .object({
    professorUserId: z.coerce.number().int().positive(),
  })
  .strip();

/** Direct student enrollment payload */
export const enrollStudentSchema = z
  .object({
    studentUserId: z.coerce.number().int().positive(),
  })
  .strip();

/** CLS-07 payload */
export const inviteStudentsSchema = z
  .object({
    emails: z
      .array(z.string().email('Invalid student email.').transform((value) => value.trim().toLowerCase()))
      .min(1, 'Provide at least one email.')
      .max(50, 'At most 50 emails per invite call.'),
  })
  .strip();

/** ENR-01 query / ENR-02 payload */
export const inviteTokenSchema = z
  .object({
    token: z.string().min(1).max(255),
  })
  .strip();

/** ORG-02 query */
export const adminOrgListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(100).optional(),
  })
  .strip();

/** GET /org/classes query */
export const orgListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();

/** GET /org/classes/:classId/students query (CLS-06) */
export const rosterQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    includeInactive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strip();

/** Route params */
export const orgIdParamSchema = z
  .object({
    orgId: z.coerce.number().int().positive(),
  })
  .strip();

export const classIdParamSchema = z
  .object({
    classId: z.coerce.number().int().positive(),
  })
  .strip();

export const orgAndClassParamSchema = z
  .object({
    orgId: z.coerce.number().int().positive(),
    classId: z.coerce.number().int().positive(),
  })
  .strip();

export const classAndStudentParamSchema = z
  .object({
    classId: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive(),
  })
  .strip();

export const classAndInvitationParamSchema = z
  .object({
    classId: z.coerce.number().int().positive(),
    invitationId: z.coerce.number().int().positive(),
  })
  .strip();