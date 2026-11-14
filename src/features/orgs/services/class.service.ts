import { createHash, randomInt, randomUUID } from 'crypto';
import { z } from 'zod';
import { redisClient } from '../../../app/cache/redis';
import { env } from '../../../app/config/env';
import { AUDIT_ACTIONS, HTTP_STATUS, ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { emailService } from '../../../shared/services/email.service';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  ClassDetailDto,
  ClassDto,
  ClassJoinCodeDto,
  ClassJoinCodeRecordDto,
  ClassJoinResultDto,
  EnrollmentAcceptedDto,
  ImportSummaryDto,
  InvitePreviewDto,
  InviteStudentsResultDto,
  OrgActor,
  RosterDto,
} from '../dto/org.dto';
import { classRepository, type ClassWithCounts, type IClassRepository } from '../repositories/class.repository';
import { invitationRepository, type IInvitationRepository } from '../repositories/invitation.repository';
import { orgRepository, orgScopeRepository, type IOrgRepository, type IOrgScopeRepository } from '../repositories/org.repository';
import { teamMemberRepository, type ITeamMemberRepository } from '../repositories/team-member.repository';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']);
const emailSchema = z.string().email();
const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLASS_CODE_LENGTH = 8;

function randomClassCode(): string {
  let code = '';
  for (let i = 0; i < CLASS_CODE_LENGTH; i += 1) {
    code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  }
  return code;
}

/** Audit-safe identifier for a join code. Raw codes grant enrollment, so they
 * are never persisted in audit logs where an operator could replay them. */
export function classCodeFingerprint(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 12);
}

function classCodeKey(code: string): string {
  return `${ORG_CONSTANTS.CLASS_CODE_PREFIX}${code}`;
}

function classCodeIndexKey(classId: number): string {
  return `${ORG_CONSTANTS.CLASS_CODE_INDEX_PREFIX}${classId}`;
}

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

    // Task 2: a professor who creates a class is its captain immediately.
    // Org/platform admins create classes on behalf of faculty and are not
    // inserted into the roster (they may later assign a professor).
    if (
      actor.roles?.includes(ROLES.PROFESSOR) &&
      !actor.roles.includes(ROLES.ORG_ADMIN) &&
      !actor.roles.includes(ROLES.PLATFORM_ADMIN)
    ) {
      try {
        await this.deps.members.upsertProfessor(classId, actor.userId, 'captain');
      } catch (err) {
        // Compensate so a failed assignment never leaves an ownerless class.
        await this.deps.classes.deleteById(classId);
        throw err;
      }
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_CLASS, 'team', classId, {
      className: input.className,
      slug,
    });

    return this.getClassDetail(classId);
  }

  /** Class lists are scoped by the caller's role: admins see the org, a
   * professor sees only owned/assigned classes, a student only enrollments. */
  async listClasses(actor: OrgActor, orgId: number, page: number, pageSize: number) {
    const roles = new Set(actor.roles ?? []);
    if (roles.has(ROLES.PLATFORM_ADMIN) || roles.has(ROLES.ORG_ADMIN)) {
      return this.deps.classes.listByOrg(orgId, page, pageSize);
    }
    if (roles.has(ROLES.PROFESSOR)) {
      return this.deps.classes.listByOrg(orgId, page, pageSize, {
        userId: actor.userId,
        scope: 'professor',
      });
    }
    return this.deps.classes.listByOrg(orgId, page, pageSize, {
      userId: actor.userId,
      scope: 'student',
    });
  }

  /** Task 3: reusable class join code stored in Redis with a hard TTL. */
  async generateJoinCode(actor: OrgActor, classId: number): Promise<ClassJoinCodeDto> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);
    await this.assertClassStaff(actor, cls);

    const ttl = ORG_CONSTANTS.CLASS_CODE_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const payload = JSON.stringify({
      classId: cls.teamId,
      organizationId: cls.organizationId,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomClassCode();
      const stored = await redisClient.set(
        classCodeKey(code),
        payload,
        'EX',
        ttl,
        'NX',
      );
      if (stored === 'OK') {
        // Index by class so staff can enumerate and revoke live codes. Redis is
        // not durable storage: a flush/restart loses codes and the index, while
        // the MySQL audit trail still records their fingerprints.
        const indexKey = classCodeIndexKey(classId);
        await redisClient.sadd(indexKey, code);
        await redisClient.expire(indexKey, ttl);
        crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_CLASS_JOIN_CODE, 'team', classId, {
          expiresAt: expiresAt.toISOString(),
          codeFingerprint: classCodeFingerprint(code),
        });
        return { code, expiresAt: expiresAt.toISOString() };
      }
    }

    throw new AppError(
      'Unable to generate a class code right now. Please try again.',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }

  /** Live class codes for staff review. Raw codes are only visible to staff
   * who already have authority over the class. */
  async listJoinCodes(actor: OrgActor, classId: number): Promise<ClassJoinCodeRecordDto[]> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);
    await this.assertClassStaff(actor, cls);
    return this.readJoinCodes(classId);
  }

  /** Revoke one live class code immediately (Redis DEL + index cleanup). */
  async revokeJoinCode(
    actor: OrgActor,
    classId: number,
    rawCode: string,
  ): Promise<{ revoked: boolean; codeFingerprint: string }> {
    const code = rawCode.trim().toUpperCase();
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);
    await this.assertClassStaff(actor, cls);

    const deleted = await redisClient.del(classCodeKey(code));
    await redisClient.srem(classCodeIndexKey(classId), code);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REVOKE_CLASS_JOIN_CODE, 'team', classId, {
      codeFingerprint: classCodeFingerprint(code),
      existed: deleted > 0,
    });

    return { revoked: deleted > 0, codeFingerprint: classCodeFingerprint(code) };
  }

  /** Delete a class and every dependent enrollment/invitation/code. Students
   * who lose their last active class also lose the now-meaningless org role
   * and scope pointer; stale JWTs cannot re-enter because all guards re-check
   * roster/scope state in SQL. */
  async deleteClass(
    actor: OrgActor,
    classId: number,
  ): Promise<{
    classId: number;
    className: string;
    studentCount: number;
    revokedCodeCount: number;
  }> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);
    await this.assertClassStaff(actor, cls);

    const studentIds = await this.deps.members.listActiveStudentIds(classId);
    const codes = await this.readJoinCodes(classId);

    // `team_members` and `team_invitations` cascade from `teams`.
    await this.deps.classes.deleteById(classId);
    await this.revokeAllJoinCodes(classId, codes.map((entry) => entry.code));

    let scopeClearedCount = 0;
    for (const userId of studentIds) {
      const remaining = await this.deps.members.findActiveStudentClass(userId);
      if (!remaining) {
        await this.deps.scopes.clearOrgId(userId);
        await this.deps.orgs.removeRole(userId, ROLES.ORG_STUDENT);
        scopeClearedCount += 1;
      } else if (remaining.organizationId !== null) {
        // Repair the scope if the learner still has a class elsewhere. This
        // cannot grant a new tenant: the remaining row is server-side state.
        await this.deps.scopes.setOrgId(userId, remaining.organizationId);
      }
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_CLASS, 'team', classId, {
      className: cls.teamName,
      slug: cls.slug,
      organizationId: cls.organizationId,
      studentCount: studentIds.length,
      scopeClearedCount,
      revokedCodes: codes.map((entry) => classCodeFingerprint(entry.code)),
    });

    return {
      classId,
      className: cls.teamName,
      studentCount: studentIds.length,
      revokedCodeCount: codes.length,
    };
  }

  /** Task 3: self-enrollment with a reusable code. Staff accounts are barred
   * from consuming student codes, and an existing scope can never be moved. */
  async joinClassWithCode(actor: OrgActor, rawCode: string): Promise<ClassJoinResultDto> {
    const code = rawCode.trim().toUpperCase();

    const attemptsKey = `${ORG_CONSTANTS.CLASS_CODE_ATTEMPT_PREFIX}${actor.userId}`;
    const attempts = await redisClient.incr(attemptsKey);
    if (attempts === 1) {
      await redisClient.expire(attemptsKey, ORG_CONSTANTS.CLASS_CODE_ATTEMPT_WINDOW_SECONDS);
    }
    if (attempts > ORG_CONSTANTS.CLASS_CODE_MAX_ATTEMPTS) {
      throw new AppError(
        'TOO_MANY_REQUESTS: too many class code attempts. Try again later.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
      );
    }

    const raw = await redisClient.get(classCodeKey(code));
    if (!raw) {
      throw new NotFoundError('CLASS_CODE_INVALID: this class code is invalid or has expired.');
    }

    let payload: { classId: number; organizationId?: number };
    try {
      payload = JSON.parse(raw) as { classId: number; organizationId?: number };
    } catch {
      throw new NotFoundError('CLASS_CODE_INVALID: this class code is invalid or has expired.');
    }

    const cls = await this.deps.classes.findById(payload.classId);
    if (!cls) {
      throw new NotFoundError('The class linked to this code no longer exists.');
    }
    const classOrgId = await this.requireLiveClassOrg(cls.organizationId);

    // Codes are bound to the class's organization at issue time. If the class
    // was ever moved (or the code was tampered with), reject rather than
    // granting scope to the wrong tenant.
    if (payload.organizationId !== undefined && payload.organizationId !== classOrgId) {
      throw new NotFoundError('CLASS_CODE_INVALID: this class code is invalid or has expired.');
    }

    if (actor.roles?.includes(ROLES.PLATFORM_ADMIN)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: platform administrators cannot join a class as students.');
    }
    if (await this.deps.orgs.hasRole(actor.userId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: organization admins cannot join a class as students.');
    }
    if (await this.deps.orgs.hasRole(actor.userId, ROLES.PROFESSOR)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: professors cannot join a class as students.');
    }

    const currentScope = await this.deps.scopes.getOrgId(actor.userId);
    if (currentScope !== null && currentScope !== classOrgId) {
      throw new ConflictError(
        'ORG_SCOPE_CONFLICT: your account is already linked to another organization.',
      );
    }

    const alreadyEnrolled = await this.deps.members.isActiveMember(cls.teamId, actor.userId);
    if (!alreadyEnrolled) {
      if (cls.maxMembers && cls.studentCount >= cls.maxMembers) {
        throw new ConflictError(
          `CLASS_FULL: the cohort has reached its maximum capacity of ${cls.maxMembers} students.`,
        );
      }
      await this.deps.members.insertStudent(cls.teamId, actor.userId);
    }

    // Repair stale state: an active roster row without the student role or
    // org scope would leave the user unable to use the student workspace.
    if (!(await this.deps.orgs.hasRole(actor.userId, ROLES.ORG_STUDENT))) {
      const roleId = await this.deps.orgs.findRoleId(ROLES.ORG_STUDENT);
      if (roleId) {
        await this.deps.orgs.assignRole(actor.userId, roleId);
      }
    }
    await this.deps.scopes.setOrgId(actor.userId, classOrgId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REDEEM_CLASS_JOIN_CODE, 'team', cls.teamId, {
      alreadyEnrolled,
      codeFingerprint: classCodeFingerprint(code),
    });

    return {
      classId: cls.teamId,
      className: cls.teamName,
      organizationName: (await this.orgName(classOrgId)) ?? '',
      alreadyEnrolled,
    };
  }

  async getClassDetail(classId: number): Promise<ClassDetailDto> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);

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
    await this.requireLiveClassOrg(cls.organizationId);
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

    // Reassignment must not leave the previous professor active on the
    // roster. Deactivate every other faculty row before promoting the target.
    await this.deps.members.deactivateOtherProfessors(classId, professorUserId);
    await this.deps.members.upsertProfessor(classId, professorUserId, 'captain');
    await this.deps.classes.setOwner(classId, professorUserId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ASSIGN_PROFESSOR, 'team', classId, {
      professorUserId,
      email: professor.email,
    });

    return this.getClassDetail(classId);
  }

  async enrollStudent(actor: OrgActor, classId: number, studentUserId: number): Promise<void> {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    await this.requireLiveClassOrg(cls.organizationId);
    const student = await this.deps.orgs.findUserById(studentUserId);
    if (!student) {
      throw new NotFoundError('Student user not found.');
    }

    const studentOrgId = await this.deps.scopes.getOrgId(studentUserId);
    if (studentOrgId !== cls.organizationId) {
      throw new ForbiddenError('The student does not belong to this organization.');
    }
    if (await this.deps.orgs.hasRole(studentUserId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('An organization admin cannot be enrolled as a student.');
    }
    if (await this.deps.orgs.hasRole(studentUserId, ROLES.PROFESSOR)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: professors cannot be enrolled as students.');
    }
    if (cls.maxMembers && cls.studentCount >= cls.maxMembers) {
      throw new ConflictError(`Cohort has reached its maximum capacity of ${cls.maxMembers} students.`);
    }
    if (await this.deps.members.isActiveMember(classId, studentUserId)) {
      throw new ConflictError('Student is already actively enrolled in this cohort.');
    }

    await this.deps.members.insertStudent(classId, studentUserId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.INVITE_STUDENTS, 'team', classId, {
      studentUserId,
      email: student.email,
      directEnrollment: true,
    });
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
    await this.requireLiveClassOrg(cls.organizationId);
    if (!(await this.deps.members.isActiveMember(classId, userId))) {
      if (!(await this.deps.orgs.findUserById(userId))) {
        throw new NotFoundError('Student user not found.');
      }
      throw new ConflictError('This user is not an active student of the class.');
    }

    await this.deps.members.withdraw(classId, userId);

    // If this was the student's last active class in the org, drop the now
    // meaningless student role and org scope pointer. Otherwise keep the scope
    // aligned with a still-active class rather than a deleted enrollment.
    const remainingClasses = await this.deps.members.listActiveStudentClasses(userId);
    const scopeCleared = remainingClasses.length === 0;
    if (scopeCleared) {
      await this.deps.scopes.clearOrgId(userId);
      await this.deps.orgs.removeRole(userId, ROLES.ORG_STUDENT);
    } else if (remainingClasses[0]?.organizationId != null) {
      await this.deps.scopes.setOrgId(userId, remainingClasses[0].organizationId);
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.WITHDRAW_STUDENT, 'team', classId, {
      userId,
      scopeCleared,
    });
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
      const orgId = await this.requireLiveClassOrg(cls.organizationId);
      className = cls.teamName;
      organizationName = (await this.orgName(orgId)) ?? '';
    } else {
      const orgId = await this.deps.scopes.getOrgId(invitation.inviterId);
      if (!orgId || !(await this.deps.orgs.findById(orgId))) {
        throw new NotFoundError('The inviting organization no longer exists.');
      }
      organizationName = (await this.orgName(orgId)) ?? '';
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
    const classOrgId = await this.requireLiveClassOrg(cls.organizationId);

    // Security: `user_settings.org_id` is the single source of org scope and
    // roles are global. Accepting an invite for another org must never move
    // the scope while retaining org-level permissions (cross-tenant takeover).
    const currentScope = await this.deps.scopes.getOrgId(userId);
    if (currentScope !== null && currentScope !== classOrgId) {
      throw new ConflictError(
        'ORG_SCOPE_CONFLICT: your account is already linked to another organization.',
      );
    }
    if (await this.deps.orgs.hasRole(userId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: organization admins cannot accept a student invitation.');
    }
    if (await this.deps.orgs.hasRole(userId, ROLES.PROFESSOR)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: professors cannot accept a student invitation.');
    }

    const isAlreadyMember = await this.deps.members.isActiveMember(invitation.teamId, userId);
    if (!isAlreadyMember && cls.maxMembers && cls.studentCount >= cls.maxMembers) {
      throw new ConflictError(`CLASS_FULL: the cohort has reached its maximum capacity of ${cls.maxMembers} students.`);
    }
    if (!isAlreadyMember) {
      await this.deps.members.insertStudent(invitation.teamId, userId);
    }
    await this.deps.invitations.markAccepted(invitation.invitationId, userId);

    // Grant the student role + org scope so ENR-03 (/student/my-class) is
    // immediately reachable after acceptance (F3 §04 RBAC matrix).
    if (!(await this.deps.orgs.hasRole(userId, ROLES.ORG_STUDENT))) {
      const roleId = await this.deps.orgs.findRoleId(ROLES.ORG_STUDENT);
      if (roleId) {
        await this.deps.orgs.assignRole(userId, roleId);
      }
    }
    await this.deps.scopes.setOrgId(userId, classOrgId);

    return {
      kind: 'class',
      className: cls.teamName,
      organizationName: (await this.orgName(classOrgId)) ?? '',
    };
  }

  /** Professor accept: grants the F3 `professor` role + org scope (not org_admin). */
  private async acceptProfessorInvitation(userId: number, inviterId: number, invitationId: number): Promise<EnrollmentAcceptedDto> {
    const orgId = await this.deps.scopes.getOrgId(inviterId);
    if (!orgId) {
      throw new ConflictError('The inviting organization could not be resolved.');
    }
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('The inviting organization no longer exists.');
    }
    // The org is resolved from the inviter's scope, so the inviter must still
    // be an active org admin; otherwise a stale invite could mint professors.
    if (!(await this.deps.orgs.hasRole(inviterId, ROLES.ORG_ADMIN))) {
      throw new ConflictError('The inviting administrator is no longer active.');
    }

    const currentScope = await this.deps.scopes.getOrgId(userId);
    if (currentScope !== null && currentScope !== orgId) {
      throw new ConflictError(
        'ORG_SCOPE_CONFLICT: your account is already linked to another organization.',
      );
    }
    if (await this.deps.orgs.hasRole(userId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: organization admins cannot accept a professor invitation.');
    }
    if (await this.deps.orgs.hasRole(userId, ROLES.ORG_STUDENT)) {
      throw new ConflictError('STAFF_ROLE_CONFLICT: students cannot accept a professor invitation.');
    }

    await this.deps.invitations.markAccepted(invitationId, userId);

    if (!(await this.deps.orgs.hasRole(userId, ROLES.PROFESSOR))) {
      const roleId = await this.deps.orgs.findRoleId(ROLES.PROFESSOR);
      await this.deps.orgs.assignRole(userId, roleId);
    }
    await this.deps.scopes.setOrgId(userId, orgId);

    return { kind: 'professor', className: null, organizationName: org.name };
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
    await this.requireLiveClassOrg(cls.organizationId);
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

  private async readJoinCodes(classId: number): Promise<ClassJoinCodeRecordDto[]> {
    const indexKey = classCodeIndexKey(classId);
    const codes = await redisClient.smembers(indexKey);
    const records: ClassJoinCodeRecordDto[] = [];

    for (const code of codes) {
      const raw = await redisClient.get(classCodeKey(code));
      if (!raw) {
        await redisClient.srem(indexKey, code);
        continue;
      }
      const ttl = await redisClient.ttl(classCodeKey(code));
      if (ttl <= 0) {
        // Expired (or somehow persistence-free) codes must not be advertised.
        await redisClient.srem(indexKey, code);
        continue;
      }

      let payload: { createdBy?: number; createdAt?: string } = {};
      try {
        payload = JSON.parse(raw) as { createdBy?: number; createdAt?: string };
      } catch {
        await redisClient.del(classCodeKey(code));
        await redisClient.srem(indexKey, code);
        continue;
      }

      records.push({
        code,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        createdBy: typeof payload.createdBy === 'number' ? payload.createdBy : null,
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null,
      });
    }

    return records.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  private async revokeAllJoinCodes(classId: number, codes: string[]): Promise<void> {
    for (const code of codes) {
      await redisClient.del(classCodeKey(code));
    }
    await redisClient.del(classCodeIndexKey(classId));
  }

  /**
   * Staff access is re-verified server-side even though route middleware also
   * checks it: org scope must match the class's live org, and the caller must
   * be a platform admin, that org's admin, the owner, or an active professor.
   */
  private async assertClassStaff(actor: OrgActor, cls: ClassWithCounts): Promise<void> {
    const roles = new Set(actor.roles ?? []);
    if (roles.has(ROLES.PLATFORM_ADMIN)) {
      return;
    }
    if (cls.organizationId === null) {
      throw new ForbiddenError('This class is not attached to a live organization.');
    }

    const scopedOrgId = await this.deps.scopes.getOrgId(actor.userId);
    if (scopedOrgId === null || scopedOrgId !== cls.organizationId) {
      throw new ForbiddenError('This class belongs to a different organization.');
    }

    const isOrgAdmin = roles.has(ROLES.ORG_ADMIN);
    const isOwner = cls.teamOwnerId === actor.userId;
    const isProfessor = await this.deps.members.isProfessorOf(cls.teamId, actor.userId);
    if (!isOrgAdmin && !isOwner && !isProfessor) {
      throw new ForbiddenError('You do not have staff access to this class.');
    }
  }

  /**
   * A class must always belong to a live organization. Orphaned classes can
   * survive an organization deletion at the database layer, and must never be
   * used to grant scope, membership, or class metadata.
   */
  private async requireLiveClassOrg(orgId: number | null): Promise<number> {
    if (orgId === null) {
      throw new NotFoundError('The organization linked to this class no longer exists.');
    }
    if (!(await this.deps.orgs.findById(orgId))) {
      throw new NotFoundError('The organization linked to this class no longer exists.');
    }
    return orgId;
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