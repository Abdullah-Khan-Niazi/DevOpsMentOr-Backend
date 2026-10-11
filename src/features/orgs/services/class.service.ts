import { randomUUID } from 'crypto';
import { z } from 'zod';
import { env } from '../../../app/config/env';
import { AUDIT_ACTIONS, HTTP_STATUS, ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { emailService } from '../../../shared/services/email.service';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  ClassDetailDto,
  ClassDto,
  EnrollmentAcceptedDto,
  ImportSummaryDto,
  InvitePreviewDto,
  InviteStudentsResultDto,
  OrgActor,
  RosterDto,
} from '../dto/org.dto';
import { classRepository, type IClassRepository } from '../repositories/class.repository';
import { invitationRepository, type IInvitationRepository } from '../repositories/invitation.repository';
import { orgRepository, orgScopeRepository, type IOrgRepository, type IOrgScopeRepository } from '../repositories/org.repository';
import { teamMemberRepository, type ITeamMemberRepository } from '../repositories/team-member.repository';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']);
const emailSchema = z.string().email();

export interface ClassServiceDeps {
  classes: IClassRepository;
  orgs: IOrgRepository;
  scopes: IOrgScopeRepository;
  members: ITeamMemberRepository;
  invitations: IInvitationRepository;
  email: typeof emailService;
  audit: typeof auditLogService;
}

function defaultDeps(): ClassServiceDeps {
  return {
    classes: classRepository,
    orgs: orgRepository,
    scopes: orgScopeRepository,
    members: teamMemberRepository,
    invitations: invitationRepository,
    email: emailService,
    audit: auditLogService,
  };
}

/** CLS-01..CLS-08 + ENR-01/02. Class identity comes from route params; org
 * identity from the caller's scope (never client-supplied). */
export class ClassService {
  constructor(private readonly deps: ClassServiceDeps = defaultDeps()) {}

  async createClass(
    actor: OrgActor,
    orgId: number,
    input: { className: string; description?: string; maxStudents?: number },
  ): Promise<ClassDto> {
    const slug = await this.uniqueSlug(slugify(input.className));
    const classId = await this.deps.classes.create({
      organizationId: orgId,
      teamName: input.className.trim(),
      slug,
      description: input.description ?? null,
      teamOwnerId: actor.userId,
      maxMembers: input.maxStudents ?? 50,
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_CLASS, 'team', classId, {
      className: input.className,
      slug,
    });

    return this.getClassDetail(classId);
  }

  async listClasses(orgId: number, page: number, pageSize: number) {
    return this.deps.classes.listByOrg(orgId, page, pageSize);
  }

  async getClassDetail(classId: number): Promise<ClassDetailDto> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }

    const professor = await this.deps.orgs.findUserById(cls.teamOwnerId);
    return {
      classId: cls.teamId,
      organizationId: cls.organizationId ?? 0,
      className: cls.teamName,
      slug: cls.slug,
      description: cls.description,
      professorUserId: cls.teamOwnerId,
      professorName: professor?.fullName ?? null,
      maxStudents: cls.maxMembers,
      studentCount: cls.studentCount,
      createdAt: cls.createdAt.toISOString(),
    };
  }

  async listInvitations(classId: number, page: number, pageSize: number) {
    if (!(await this.deps.classes.findById(classId))) {
      throw new NotFoundError('Class not found.');
    }
    return this.deps.invitations.listByClass(classId, page, pageSize);
  }

  async updateClass(
    actor: OrgActor,
    classId: number,
    input: { className?: string; description?: string | null; maxStudents?: number },
  ): Promise<ClassDetailDto> {
    if (!(await this.deps.classes.findById(classId))) {
      throw new NotFoundError('Class not found.');
    }
    await this.deps.classes.update(classId, input);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_CLASS, 'team', classId, input);
    return this.getClassDetail(classId);
  }

  /** CLS-05: promote a professor of the class's org to primary professor. */
  async assignProfessor(actor: OrgActor, classId: number, professorUserId: number): Promise<ClassDetailDto> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    const professor = await this.deps.orgs.findUserById(professorUserId);
    if (!professor) {
      throw new NotFoundError('Professor user not found.');
    }

    const professorOrgId = await this.deps.scopes.getOrgId(professorUserId);
    if (professorOrgId !== cls.organizationId) {
      throw new ForbiddenError('The professor does not belong to this organization.');
    }
    if (await this.deps.orgs.hasRole(professorUserId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('An organization admin cannot be assigned as a class professor.');
    }

    await this.deps.members.upsertProfessor(classId, professorUserId, 'captain');
    await this.deps.classes.setOwner(classId, professorUserId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ASSIGN_PROFESSOR, 'team', classId, {
      professorUserId,
      email: professor.email,
    });

    return this.getClassDetail(classId);
  }

  async getClassRoster(classId: number, page: number, pageSize: number, includeInactive: boolean): Promise<RosterDto> {
    if (!(await this.deps.classes.findById(classId))) {
      throw new NotFoundError('Class not found.');
    }
    const roster = await this.deps.members.roster(classId, page, pageSize, includeInactive);
    return {
      data: roster.data.map((row) => ({
        userId: row.userId,
        fullName: row.fullName,
        email: row.email,
        enrolledAt: row.enrolledAt.toISOString(),
        isActive: row.isActive,
      })),
      total: roster.total,
      page: roster.page,
      pageSize: roster.pageSize,
      totalPages: roster.totalPages,
    };
  }

  async withdrawStudent(actor: OrgActor, classId: number, userId: number): Promise<void> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    if (!(await this.deps.members.isActiveMember(classId, userId))) {
      if (!(await this.deps.orgs.findUserById(userId))) {
        throw new NotFoundError('Student user not found.');
      }
      throw new ConflictError('This user is not an active student of the class.');
    }

    await this.deps.members.withdraw(classId, userId);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.WITHDRAW_STUDENT, 'team', classId, { userId });
  }

  /** CLS-07. */
  async inviteStudents(actor: OrgActor, classId: number, emails: string[]): Promise<InviteStudentsResultDto> {
    return this.inviteEmails(actor, classId, emails);
  }

  async resendInvitation(
    actor: OrgActor,
    classId: number,
    invitationId: number,
  ): Promise<{ success: boolean; email: string }> {
    const invitation = await this.deps.invitations.findById(invitationId);
    if (!invitation || invitation.teamId !== classId) {
      throw new NotFoundError('Invitation not found.');
    }
    if (invitation.status !== 'pending') {
      throw new ConflictError('Only pending invitations can be resent.');
    }

    const newToken = randomUUID();
    const newExpiresAt = new Date(Date.now() + ORG_CONSTANTS.INVITE_TTL_SECONDS * 1000);
    await this.deps.invitations.updateInvitation(invitationId, {
      token: newToken,
      expiresAt: newExpiresAt,
    });

    await this.deps.email.sendInvitationEmail(
      invitation.inviteeEmail,
      buildInviteUrl(newToken),
      newToken,
    );

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.INVITE_STUDENTS, 'team', classId, {
      resend: true,
      invitationId,
      email: invitation.inviteeEmail,
    });

    return { success: true, email: invitation.inviteeEmail };
  }

  /** CLS-08: fixed 200-row cap (excess rejects the entire upload), error report. */
  async importStudents(actor: OrgActor, classId: number, file: Express.Multer.File): Promise<ImportSummaryDto> {
    if (!file || !file.buffer) {
      throw new BadRequestError('CSV file is required (field name: file).');
    }
    if (file.size > ORG_CONSTANTS.IMPORT_FILE_SIZE_LIMIT) {
      throw new BadRequestError('CSV file exceeds the 1 MB import limit.');
    }
    const isCsv = file.originalname.toLowerCase().endsWith('.csv') || CSV_MIME_TYPES.has(file.mimetype);
    if (!isCsv) {
      throw new AppError('Only CSV files are accepted.', HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE);
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    let lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    // Drop a header row (e.g. the downloadable `Email` template) before the
    // 200-row limit applies, so a header does not count toward the row cap or
    // surface a spurious invalid_email error.
    const firstCell = lines[0]?.split(',')[0]?.trim().toLowerCase() ?? '';
    if (firstCell === 'email') {
      lines = lines.slice(1);
    }

    if (lines.length > ORG_CONSTANTS.IMPORT_ROW_LIMIT) {
      throw new BadRequestError(
        `IMPORT_LIMIT_EXCEEDED: at most ${ORG_CONSTANTS.IMPORT_ROW_LIMIT} rows per import.`,
      );
    }

    const emails: string[] = [];
    const errors: Array<{ row: number; email: string; reason: string }> = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const rowNumber = i + 1;
      const email = lines[i].split(',')[0]?.trim().toLowerCase() ?? '';
      if (!emailSchema.safeParse(email).success) {
        errors.push({ row: rowNumber, email, reason: 'invalid_email' });
        continue;
      }
      if (seen.has(email)) {
        continue;
      }
      seen.add(email);
      emails.push(email);
    }

    const result = await this.inviteEmails(actor, classId, emails);
    for (const skipped of result.skipped) {
      errors.push({ row: 0, email: skipped.email, reason: skipped.reason });
    }

    return {
      totalRows: lines.length,
      successCount: result.invited.length,
      errors,
    };
  }

  /** ENR-01: public token validation (no org/class identity trusted). */
  async previewInvitation(token: string): Promise<InvitePreviewDto> {
    const invitation = await this.deps.invitations.findByToken(token);
    if (!invitation) {
      throw new NotFoundError('Invitation not found.');
    }

    const expired = invitation.expiresAt.getTime() < Date.now();
    const sentinelTeamId = await this.deps.invitations.ensureSentinelTeam();
    const kind = invitation.teamId === sentinelTeamId ? 'professor' : 'class';

    let className: string | null = null;
    let organizationName = '';
    if (kind === 'class') {
      const cls = await this.deps.classes.findById(invitation.teamId);
      if (!cls) {
        throw new NotFoundError('Invitation references a class that no longer exists.');
      }
      className = cls.teamName;
      organizationName = (await this.orgName(cls.organizationId)) ?? '';
    } else {
      const orgId = await this.deps.scopes.getOrgId(invitation.inviterId);
      organizationName = (await this.orgName(orgId ?? null)) ?? '';
    }

    return {
      kind,
      inviteeEmail: invitation.inviteeEmail,
      className,
      organizationName,
      status: expired ? 'expired' : invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** ENR-02. Expired/used tokens return 400 with contract error codes. */
  async acceptInvitation(userId: number, token: string): Promise<EnrollmentAcceptedDto> {
    const invitation = await this.deps.invitations.findByToken(token);
    if (!invitation) {
      throw new NotFoundError('Invitation not found.');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestError('INVITE_ALREADY_USED: this invitation has already been used.');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError('INVITE_EXPIRED: this invitation has expired.');
    }

    const caller = await this.deps.orgs.findUserById(userId);
    if (!caller) {
      throw new NotFoundError('User not found.');
    }
    if (caller.email.trim().toLowerCase() !== invitation.inviteeEmail.toLowerCase()) {
      throw new ForbiddenError('This invitation was issued to a different email address.');
    }

    const sentinelTeamId = await this.deps.invitations.ensureSentinelTeam();
    if (invitation.teamId === sentinelTeamId) {
      return this.acceptProfessorInvitation(userId, invitation.inviterId, invitation.invitationId);
    }

    const cls = await this.deps.classes.findById(invitation.teamId);
    if (!cls) {
      throw new NotFoundError('The inviting class no longer exists.');
    }

    const isAlreadyMember = await this.deps.members.isActiveMember(invitation.teamId, userId);
    if (!isAlreadyMember) {
      await this.deps.members.insertStudent(invitation.teamId, userId);
    }
    await this.deps.invitations.markAccepted(invitation.invitationId, userId);

    // Grant the student role + org scope so ENR-03 (/student/my-class) is
    // immediately reachable after acceptance (F3 §04 RBAC matrix).
    if (cls.organizationId && !(await this.deps.orgs.hasRole(userId, ROLES.ORG_STUDENT))) {
      const roleId = await this.deps.orgs.findRoleId(ROLES.ORG_STUDENT);
      if (roleId) {
        await this.deps.orgs.assignRole(userId, roleId);
      }
    }
    if (cls.organizationId) {
      await this.deps.scopes.setOrgId(userId, cls.organizationId);
    }

    return {
      kind: 'class',
      className: cls.teamName,
      organizationName: (await this.orgName(cls.organizationId)) ?? '',
    };
  }

  /** Professor accept: grants the F3 `professor` role + org scope (not org_admin). */
  private async acceptProfessorInvitation(userId: number, inviterId: number, invitationId: number): Promise<EnrollmentAcceptedDto> {
    const orgId = await this.deps.scopes.getOrgId(inviterId);
    if (!orgId) {
      throw new ConflictError('The inviting organization could not be resolved.');
    }

    await this.deps.invitations.markAccepted(invitationId, userId);

    if (!(await this.deps.orgs.hasRole(userId, ROLES.PROFESSOR))) {
      const roleId = await this.deps.orgs.findRoleId(ROLES.PROFESSOR);
      await this.deps.orgs.assignRole(userId, roleId);
    }
    await this.deps.scopes.setOrgId(userId, orgId);

    const org = await this.deps.orgs.findById(orgId);
    return { kind: 'professor', className: null, organizationName: org?.name ?? '' };
  }

  private async inviteEmails(
    actor: OrgActor,
    classId: number,
    emails: string[],
  ): Promise<InviteStudentsResultDto> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    const orgId = cls.organizationId;
    const emailDomain = orgId ? await this.deps.orgs.getEmailDomain(orgId) : null;

    const invited: string[] = [];
    const skipped: InviteStudentsResultDto['skipped'] = [];
    const rows: Array<{ teamId: number; inviterId: number; inviteeEmail: string; token: string; expiresAt: Date }> = [];

    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (!emailSchema.safeParse(email).success) {
        skipped.push({ email, reason: 'domain_mismatch' });
        continue;
      }

      if (emailDomain) {
        const [, domain] = email.split('@') as [string, string];
        if (domain !== emailDomain) {
          skipped.push({ email, reason: 'domain_mismatch' });
          continue;
        }
      }

      const user = await this.deps.orgs.findUserByEmail(email);
      if (user && (await this.deps.members.isActiveMember(classId, user.userId))) {
        skipped.push({ email, reason: 'already_enrolled' });
        continue;
      }

      const pending = await this.deps.invitations.findPendingByClassAndEmail(classId, email);
      if (pending) {
        skipped.push({ email, reason: 'invite_pending' });
        continue;
      }

      rows.push({
        teamId: classId,
        inviterId: actor.userId,
        inviteeEmail: email,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + ORG_CONSTANTS.INVITE_TTL_SECONDS * 1000),
      });
      invited.push(email);
    }

    await this.deps.invitations.insertMany(rows);
    for (const row of rows) {
      await this.deps.email.sendInvitationEmail(row.inviteeEmail, buildInviteUrl(row.token), row.token);
    }

    if (invited.length > 0) {
      crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.INVITE_STUDENTS, 'team', classId, {
        count: invited.length,
        emails: invited,
      });
    }

    return { invited, skipped };
  }

  private async orgName(orgId: number | null): Promise<string | null> {
    if (!orgId) {
      return null;
    }
    const org = await this.deps.orgs.findById(orgId);
    return org ? org.name : null;
  }

  private async uniqueSlug(base: string): Promise<string> {
    const candidate = base || 'class';
    if (!(await this.deps.classes.findBySlug(candidate))) {
      return candidate;
    }
    return `${candidate}-${randomUUID().slice(0, 8)}`;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildInviteUrl(token: string): string {
  const base = env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5173';
  return `${base}/enroll/accept?token=${token}`;
}

function crashAudit(
  audit: typeof auditLogService,
  actor: OrgActor,
  action: string,
  targetType: string,
  targetId: number | null,
  changes: Record<string, unknown> | null,
): void {
  void audit
    .record({
      adminUserId: actor.userId,
      action,
      targetType,
      targetId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    })
    .catch(() => undefined);
}

export const classService = new ClassService();