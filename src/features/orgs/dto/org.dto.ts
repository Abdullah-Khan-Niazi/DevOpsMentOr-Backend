/**
 * F3 response DTOs. All dates are ISO strings; org/class identifiers are
 * numbers. Mirrors the contract §07 endpoint response shapes.
 */

/** ORG-01 create response */
export interface OrgCreatedDto {
  organizationId: number;
  name: string;
  slug: string;
  createdAt: string;
}

/** ORG-02 admin list row / ORG-03 detail base fields */
export interface OrganizationDto {
  organizationId: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  industry: string | null;
  isVerified: boolean;
  billingEmail: string | null;
  createdAt: string;
}

/** ORG-03 platform admin detail */
export interface OrgAdminDetailDto extends OrganizationDto {
  adminUserId: number | null;
  adminEmail: string | null;
}

/** ORG-02 paginated list */
export interface AdminOrgListDto {
  data: OrganizationDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** ORG-06 own-org view (Org Dashboard) */
export interface MyOrgDto extends OrganizationDto {
  stats: {
    classCount: number;
    studentCount: number;
    professorCount: number;
  };
  emailDomain: string | null;
}

/** ORG-10 professor list row */
export interface ProfessorDto {
  userId: number;
  fullName: string | null;
  email: string;
  assignedClassCount: number;
}

/** CLS-02 class list row */
export interface ClassDto {
  classId: number;
  organizationId: number;
  className: string;
  slug: string;
  description: string | null;
  professorUserId: number;
  professorName: string | null;
  maxStudents: number;
  studentCount: number;
  createdAt: string;
}

/** CLS-03 class detail */
export interface ClassDetailDto extends ClassDto {}

/** CLS-06 roster row */
export interface RosterStudentDto {
  userId: number;
  fullName: string | null;
  email: string;
  enrolledAt: string;
  isActive: boolean;
}

/** Sorted roster with pagination metadata */
export interface RosterDto {
  data: RosterStudentDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Class invitation list row (class detail invitations tab) */
export interface InvitationDto {
  invitationId: number;
  inviteeEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
}

/** CLS-07 invite response */
export interface InviteStudentsResultDto {
  invited: string[];
  skipped: Array<{
    email: string;
    reason: 'domain_mismatch' | 'already_enrolled' | 'invite_pending';
  }>;
}

/** CLS-08 import response */
export interface ImportSummaryDto {
  totalRows: number;
  successCount: number;
  errors: Array<{ row: number; email: string; reason: string }>;
}

/** ENR-01 public token validation */
export interface InvitePreviewDto {
  kind: 'class' | 'professor';
  inviteeEmail: string;
  className: string | null;
  organizationName: string;
  status: string;
  expiresAt: string;
}

/** ENR-02 accept response */
export interface EnrollmentAcceptedDto {
  kind: 'class' | 'professor';
  className: string | null;
  organizationName: string;
}

/** ENR-03 student my-class */
export interface StudentClassDto {
  classId: number;
  className: string;
  organizationName: string;
  enrolledAt: string;
}

/** Org actor identity used for audit records (mirrors AdminActor). */
export interface OrgActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Org members/users view */
export interface OrgUserDto {
  userId: number;
  email: string;
  fullName: string | null;
  username: string;
  status: string;
  role: 'org_admin' | 'professor' | 'org_student';
  classes: Array<{ classId: number; className: string }>;
  enrolledAt: string;
  completedModules: number;
}

export interface OrgUserDetailDto extends OrgUserDto {
  countryCode: string | null;
  quizzesPassed: number;
  labHours: number;
}