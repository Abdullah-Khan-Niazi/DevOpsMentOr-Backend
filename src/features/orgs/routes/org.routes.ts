import { Router } from 'express';
import multer from 'multer';
import { ORG_CONSTANTS, PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizeAnyPermissions,
  authorizePermissions,
  optionalAuthenticate,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { classController, enrollmentController, orgController } from '../controllers/org.controller';
import {
  requireClassMembershipFromParams,
  requireClassStaffFromParams,
  requireOrgMembership,
  requireOrgStaff,
} from '../middleware/requireOrgMembership';
import {
  adminOrgListQuerySchema,
  assignOrgAdminSchema,
  assignProfessorSchema,
  classAndInvitationParamSchema,
  classAndStudentParamSchema,
  classIdParamSchema,
  classJoinCodeParamSchema,
  createClassSchema,
  createOrgSchema,
  emailDomainSchema,
  enrollStudentSchema,
  inviteProfessorSchema,
  inviteStudentsSchema,
  inviteTokenSchema,
  joinClassCodeSchema,
  myClassQuerySchema,
  orgAndClassParamSchema,
  orgIdParamSchema,
  orgListQuerySchema,
  rosterQuerySchema,
  updateClassSchema,
  updateOrgSchema,
} from '../validators/org.validator';
import { userIdParamSchema } from '../../users/validators/user.validator';

const orgRoutes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ORG_CONSTANTS.IMPORT_FILE_SIZE_LIMIT },
});

/** ── Platform-admin organization management (ORG-01..ORG-05) ─────────── */
orgRoutes.post(
  '/admin/organizations',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE),
  validateRequest(createOrgSchema, 'body'),
  asyncHandler((req, res) => orgController.createOrg(req, res)),
);

orgRoutes.get(
  '/admin/organizations',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_READ),
  validateRequest(adminOrgListQuerySchema, 'query'),
  asyncHandler((req, res) => orgController.listOrgs(req, res)),
);

orgRoutes.get(
  '/admin/organizations/:orgId',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_READ),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.getOrg(req, res)),
);

orgRoutes.patch(
  '/admin/organizations/:orgId',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE),
  validateRequest(orgIdParamSchema, 'params'),
  validateRequest(updateOrgSchema, 'body'),
  asyncHandler((req, res) => orgController.updateOrg(req, res)),
);

orgRoutes.delete(
  '/admin/organizations/:orgId',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.deleteOrg(req, res)),
);

orgRoutes.post(
  '/admin/organizations/:orgId/admins',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE),
  validateRequest(orgIdParamSchema, 'params'),
  validateRequest(assignOrgAdminSchema, 'body'),
  asyncHandler((req, res) => orgController.assignOrgAdmin(req, res)),
);

orgRoutes.get(
  '/admin/organizations/:orgId/classes',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_READ),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.listAdminClasses(req, res)),
);

orgRoutes.get(
  '/admin/organizations/:orgId/classes/:classId',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_READ),
  validateRequest(orgAndClassParamSchema, 'params'),
  asyncHandler((req, res) => orgController.getAdminClassDetail(req, res)),
);

orgRoutes.get(
  '/admin/organizations/:orgId/analytics',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_READ),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.getOrgAnalytics(req, res)),
);

orgRoutes.post(
  '/admin/organizations/:orgId/invite-admin',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.inviteOrgAdmin(req, res)),
);

orgRoutes.post(
  '/admin/organizations/accept-admin',
  authenticate,
  asyncHandler((req, res) => orgController.acceptOrgAdmin(req, res)),
);

/** ── Org-scoped dashboard & administration (ORG-06..ORG-10) ──────────── */
orgRoutes.post(
  '/org',
  authenticate,
  validateRequest(createOrgSchema, 'body'),
  asyncHandler((req, res) => orgController.createMyOrg(req, res)),
);

orgRoutes.get(
  '/org/me',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_READ),
  requireOrgMembership(),
  asyncHandler((req, res) => orgController.getMyOrg(req, res)),
);

orgRoutes.patch(
  '/org/me',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  validateRequest(updateOrgSchema, 'body'),
  asyncHandler((req, res) => orgController.updateMyOrg(req, res)),
);

orgRoutes.patch(
  '/org/settings/email-domain',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  validateRequest(emailDomainSchema, 'body'),
  asyncHandler((req, res) => orgController.setEmailDomain(req, res)),
);

orgRoutes.post(
  '/org/professors/invite',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_PROFESSORS_INVITE),
  requireOrgStaff(),
  validateRequest(inviteProfessorSchema, 'body'),
  asyncHandler((req, res) => orgController.inviteProfessor(req, res)),
);

orgRoutes.get(
  '/org/professors',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  asyncHandler((req, res) => orgController.listProfessors(req, res)),
);

orgRoutes.get(
  '/org/users',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  asyncHandler((req, res) => orgController.listOrgUsers(req, res)),
);

orgRoutes.get(
  '/org/users/:userId',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => orgController.getOrgUserDetail(req, res)),
);

orgRoutes.get(
  '/org/analytics',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_MANAGE),
  requireOrgStaff(),
  asyncHandler((req, res) => orgController.getMyOrgAnalytics(req, res)),
);

/** ── Classes (CLS-01..CLS-09) ────────────────────────────────────────── */
orgRoutes.post(
  '/org/classes',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.ORG_CLASSES_MANAGE, PERMISSIONS.CLASS_MANAGE),
  requireOrgStaff(),
  validateRequest(createClassSchema, 'body'),
  asyncHandler((req, res) => classController.createClass(req, res)),
);

orgRoutes.get(
  '/org/classes',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_READ),
  requireOrgMembership(),
  validateRequest(orgListQuerySchema, 'query'),
  asyncHandler((req, res) => classController.listClasses(req, res)),
);

orgRoutes.get(
  '/org/classes/:classId',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_READ),
  validateRequest(classIdParamSchema, 'params'),
  requireClassMembershipFromParams(),
  asyncHandler((req, res) => classController.getClass(req, res)),
);

orgRoutes.patch(
  '/org/classes/:classId',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_MANAGE, PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(updateClassSchema, 'body'),
  asyncHandler((req, res) => classController.updateClass(req, res)),
);

orgRoutes.delete(
  '/org/classes/:classId',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_MANAGE, PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.deleteClass(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/professor',
  authenticate,
  authorizePermissions(PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(assignProfessorSchema, 'body'),
  asyncHandler((req, res) => classController.assignProfessor(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/join-code',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_MANAGE, PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.generateJoinCode(req, res)),
);

orgRoutes.get(
  '/org/classes/:classId/join-codes',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_MANAGE, PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.listJoinCodes(req, res)),
);

orgRoutes.delete(
  '/org/classes/:classId/join-codes/:code',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_MANAGE, PERMISSIONS.ORG_CLASSES_MANAGE),
  validateRequest(classJoinCodeParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.revokeJoinCode(req, res)),
);

orgRoutes.get(
  '/org/classes/:classId/students',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_READ, PERMISSIONS.ORG_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(rosterQuerySchema, 'query'),
  asyncHandler((req, res) => classController.getRoster(req, res)),
);

orgRoutes.patch(
  '/org/classes/:classId/students/:userId/withdraw',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_INVITE, PERMISSIONS.ORG_STUDENTS_INVITE),
  validateRequest(classAndStudentParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.withdrawStudent(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/students/enroll',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_INVITE, PERMISSIONS.ORG_STUDENTS_INVITE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(enrollStudentSchema, 'body'),
  asyncHandler((req, res) => classController.enrollStudent(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/students/invite',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_INVITE, PERMISSIONS.ORG_STUDENTS_INVITE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(inviteStudentsSchema, 'body'),
  asyncHandler((req, res) => classController.inviteStudents(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/invitations/:invitationId/resend',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_INVITE, PERMISSIONS.ORG_STUDENTS_INVITE),
  validateRequest(classAndInvitationParamSchema, 'params'),
  requireClassStaffFromParams(),
  asyncHandler((req, res) => classController.resendInvitation(req, res)),
);

orgRoutes.post(
  '/org/classes/:classId/students/import',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_INVITE, PERMISSIONS.ORG_STUDENTS_INVITE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  upload.single('file'),
  asyncHandler((req, res) => classController.importStudents(req, res)),
);

/** Class detail invitations tab (informational aggregation). */
orgRoutes.get(
  '/org/classes/:classId/invitations',
  authenticate,
  authorizeAnyPermissions(PERMISSIONS.CLASS_STUDENTS_READ, PERMISSIONS.ORG_MANAGE),
  validateRequest(classIdParamSchema, 'params'),
  requireClassStaffFromParams(),
  validateRequest(orgListQuerySchema, 'query'),
  asyncHandler((req, res) => orgController.listInvitations(req, res)),
);

/** ── Enrollment (ENR-01..ENR-03) ─────────────────────────────────────── */
orgRoutes.get(
  '/enroll/validate',
  optionalAuthenticate,
  validateRequest(inviteTokenSchema, 'query'),
  asyncHandler((req, res) => enrollmentController.previewInvitation(req, res)),
);

orgRoutes.post(
  '/enroll/accept',
  authenticate,
  validateRequest(inviteTokenSchema, 'body'),
  asyncHandler((req, res) => enrollmentController.acceptInvitation(req, res)),
);

orgRoutes.get(
  '/student/my-classes',
  authenticate,
  authorizePermissions(PERMISSIONS.ENROLLMENT_READ),
  asyncHandler((req, res) => enrollmentController.myClasses(req, res)),
);

orgRoutes.get(
  '/student/my-class',
  authenticate,
  authorizePermissions(PERMISSIONS.ENROLLMENT_READ),
  validateRequest(myClassQuerySchema, 'query'),
  asyncHandler((req, res) => enrollmentController.myClass(req, res)),
);

/** Task 3: reusable class-code self-enrollment (student accounts only). */
orgRoutes.post(
  '/student/classes/join',
  authenticate,
  validateRequest(joinClassCodeSchema, 'body'),
  asyncHandler((req, res) => classController.joinClass(req, res)),
);

export { orgRoutes };