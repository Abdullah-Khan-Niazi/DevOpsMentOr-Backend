import { randomUUID } from 'crypto';
import { AUDIT_ACTIONS, ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { emailService } from '../../../shared/services/email.service';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  AdminOrgListDto,
  InvitationDto,
  MyOrgDto,
  OrgAdminDetailDto,
  OrgActor,
  OrgCreatedDto,
  OrganizationDto,
  ProfessorDto,
} from '../dto/org.dto';
import { classRepository } from '../repositories/class.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import { orgRepository, orgScopeRepository } from '../repositories/org.repository';
import { teamMemberRepository } from '../repositories/team-member.repository';

export interface OrgServiceDeps {
  orgs: typeof orgRepository;
  scopes: typeof orgScopeRepository;
  classes: typeof classRepository;
  members: typeof teamMemberRepository;
  invitations: typeof invitationRepository;
  email: typeof emailService;
  audit: typeof auditLogService;
}

function defaultDeps(): OrgServiceDeps {
  return {
    orgs: orgRepository,
    scopes: orgScopeRepository,
    classes: classRepository,
    members: teamMemberRepository,
    invitations: invitationRepository,
    email: emailService,
    audit: auditLogService,
  };
}

export type CreateOrgInput = {
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  website?: string;
  industry?: string;
  billingEmail?: string;
};

/** ORG-01..ORG-10 + ENR-03. All org identity is resolved server-side from
 * the caller's scope; endpoints never trust client-supplied org ids. */
export class OrgService {
  constructor(private readonly deps: OrgServiceDeps = defaultDeps()) {}

  async createOrg(actor: OrgActor, input: CreateOrgInput): Promise<OrgCreatedDto> {
    const slug = input.slug.trim().toLowerCase();
    const existing = await this.deps.orgs.findBySlug(slug);
    if (existing) {
      throw new ConflictError('An organization with this slug already exists.');
    }

    const organizationId = await this.deps.orgs.create({
      name: input.name,
      slug,
      description: input.description ?? null,
      logoUrl: input.logoUrl ?? null,
      website: input.website ?? null,
      industry: input.industry ?? null,
      billingEmail: input.billingEmail ?? null,
      isVerified: false,
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_ORG, 'organization', organizationId, {
      name: input.name,
      slug,
    });

    const created = await this.deps.orgs.findById(organizationId);
    return {
      organizationId,
      name: created?.name ?? input.name,
      slug,
      createdAt: (created?.createdAt ?? new Date()).toISOString(),
    };
  }

  async listOrgsAdmin(page: number, pageSize: number, search: string | undefined): Promise<AdminOrgListDto> {
    return this.deps.orgs.listAdmin(page, pageSize, search);
  }

  async getOrgAdminDetail(orgId: number): Promise<OrgAdminDetailDto> {
    const detail = await this.deps.orgs.getAdminDetail(orgId);
    if (!detail) {
      throw new NotFoundError('Organization not found.');
    }
    return detail;
  }

  async updateOrg(
    actor: OrgActor,
    orgId: number,
    input: Partial<
      Pick<OrganizationDto, 'name' | 'description' | 'logoUrl' | 'website' | 'industry' | 'billingEmail'>
    >,
  ): Promise<OrganizationDto> {
    if (!(await this.deps.orgs.findById(orgId))) {
      throw new NotFoundError('Organization not found.');
    }
    await this.deps.orgs.update(orgId, input);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_ORG, 'organization', orgId, input);

    const updated = await this.deps.orgs.findById(orgId);
    if (!updated) {
      throw new NotFoundError('Organization not found.');
    }
    return toOrganizationDto(updated);
  }

  /** ORG-07: own-org detail edit by org admin (scoped, never client-supplied). */
  async updateMyOrg(
    actor: OrgActor,
    userId: number,
    input: Partial<
      Pick<OrganizationDto, 'name' | 'description' | 'logoUrl' | 'website' | 'industry' | 'billingEmail'>
    >,
  ): Promise<OrganizationDto> {
    const orgId = await this.resolveScopedOrg(userId);
    return this.updateOrg(actor, orgId, input);
  }

  /** ORG-05: grants F3 `org_admin`, scoping the user to this organization. */
  async assignOrgAdmin(actor: OrgActor, orgId: number, userId: number): Promise<OrgAdminDetailDto> {
    if (!(await this.deps.orgs.findById(orgId))) {
      throw new NotFoundError('Organization not found.');
    }
    const target = await this.deps.orgs.findUserById(userId);
    if (!target) {
      throw new NotFoundError('Target user not found.');
    }
    if (await this.deps.orgs.hasRole(userId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('User is already an organization admin.');
    }

    const roleId = await this.deps.orgs.findRoleId(ROLES.ORG_ADMIN);
    await this.deps.orgs.assignRole(userId, roleId);
    await this.deps.scopes.setOrgId(userId, orgId);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ASSIGN_ORG_ADMIN, 'organization', orgId, {
      userId,
      email: target.email,
    });

    return this.getOrgAdminDetail(orgId);
  }

  /** ORG-06: org dashboard for the scoped caller. */
  async getMyOrg(userId: number): Promise<MyOrgDto> {
    const orgId = await this.resolveScopedOrg(userId);
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }

    return {
      ...toOrganizationDto(org),
      emailDomain: await this.deps.orgs.getEmailDomain(orgId),
      stats: {
        classCount: await this.deps.classes.countByOrg(orgId),
        studentCount: await this.deps.members.countStudentsByOrg(orgId),
        professorCount: await this.deps.classes.findProfessorCount(orgId),
      },
    };
  }

  /** ORG-08. */
  async setEmailDomain(actor: OrgActor, orgId: number, domain: string): Promise<{ emailDomain: string | null }> {
    if (!(await this.deps.orgs.findById(orgId))) {
      throw new NotFoundError('Organization not found.');
    }

    await this.deps.orgs.setEmailDomain(orgId, domain, actor.userId);
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.SET_EMAIL_DOMAIN, 'organization', orgId, { domain });

    return { emailDomain: domain };
  }

  /** ORG-09: professor invite anchored to the org sentinel team. */
  async inviteProfessor(actor: OrgActor, orgId: number, email: string): Promise<InvitationDto> {
    const normalized = email.trim().toLowerCase();
    if (!(await this.deps.orgs.findById(orgId))) {
      throw new NotFoundError('Organization not found.');
    }
    const existingUser = await this.deps.orgs.findUserByEmail(normalized);
    if (!existingUser) {
      throw new NotFoundError('No user account exists for this email; the professor must register first.');
    }

    const existingScope = await this.deps.scopes.getOrgId(existingUser.userId);
    if (existingScope !== null && existingScope !== orgId) {
      throw new ConflictError('This user is already affiliated with another organization.');
    }
    if (await this.deps.orgs.hasRole(existingUser.userId, ROLES.ORG_ADMIN)) {
      throw new ConflictError('This user is an organization admin and cannot be invited as a professor.');
    }

    const sentinelTeamId = await this.deps.invitations.ensureSentinelTeam();
    const pending = await this.deps.invitations.findPendingByClassAndEmail(sentinelTeamId, normalized);
    if (pending) {
      throw new ConflictError('A pending professor invitation already exists for this email.');
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ORG_CONSTANTS.INVITE_TTL_SECONDS * 1000);
    await this.deps.invitations.insertMany([
      { teamId: sentinelTeamId, inviterId: actor.userId, inviteeEmail: normalized, token, expiresAt },
    ]);
    await this.deps.email.sendInvitationEmail(normalized, buildInviteUrl(token));

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.INVITE_PROFESSOR, 'organization', orgId, { email: normalized });

    return {
      invitationId: 0,
      inviteeEmail: normalized,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** ORG-10. */
  async listProfessors(orgId: number): Promise<ProfessorDto[]> {
    const userIds = await this.deps.members.professorUserIds(orgId);
    const usersById = new Map(
      (await this.deps.orgs.findUsersByIds(userIds)).map((user) => [user.userId, user]),
    );

    const professors: ProfessorDto[] = [];
    for (const userId of userIds) {
      const user = usersById.get(userId);
      if (!user) {
        continue;
      }
      professors.push({
        userId,
        fullName: user.fullName,
        email: user.email,
        assignedClassCount: (await this.deps.members.assignedClassIds(orgId, userId)).length,
      });
    }
    return professors;
  }

  /** ENR-03: the scoped student's single active class. */
  async getMyClass(userId: number) {
    const enrollment = await this.deps.members.findActiveStudentClass(userId);
    if (!enrollment) {
      throw new NotFoundError('You are not enrolled in any class.');
    }
    return {
      classId: enrollment.teamId,
      className: enrollment.teamName,
      organizationName: enrollment.organizationName,
      enrolledAt: enrollment.joinedAt.toISOString(),
    };
  }

  /** Resolves the caller's org from their `org_id` scope setting. */
  async resolveScopedOrg(userId: number): Promise<number> {
    const orgId = await this.deps.scopes.getOrgId(userId);
    if (!orgId) {
      throw new NotFoundError('No organization is associated with your account.');
    }
    return orgId;
  }
}

function toOrganizationDto(row: {
  organizationId: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  industry: string | null;
  isVerified: boolean;
  billingEmail: string | null;
  createdAt: Date;
}): OrganizationDto {
  return {
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logoUrl: row.logoUrl,
    website: row.website,
    industry: row.industry,
    isVerified: row.isVerified,
    billingEmail: row.billingEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildInviteUrl(token: string): string {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
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

export const orgService = new OrgService();