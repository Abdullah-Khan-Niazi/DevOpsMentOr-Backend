import { randomUUID } from 'crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  activityLogs,
  countries,
  orders,
  pwnboxInstances,
  quizAttempts,
  roles,
  subscriptions,
  teamMembers,
  teams,
  userProfiles,
  userProgress,
  userRoles,
  users,
  userSettings,
} from '../../../app/database/schema';
import { redisClient } from '../../../app/cache/redis';
import { env } from '../../../app/config/env';
import { AUDIT_ACTIONS, ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
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
  OrgUserDto,
  OrgUserDetailDto,
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

    const emailDomain = await this.deps.orgs.getEmailDomain(orgId);
    if (emailDomain) {
      const [, domain] = normalized.split('@') as [string, string];
      if (domain !== emailDomain) {
        throw new BadRequestError(`Email must belong to organization domain (@${emailDomain}).`);
      }
    }

    const existingUser = await this.deps.orgs.findUserByEmail(normalized);
    if (existingUser) {
      const existingScope = await this.deps.scopes.getOrgId(existingUser.userId);
      if (existingScope !== null && existingScope !== orgId) {
        throw new ConflictError('This user is already affiliated with another organization.');
      }
      if (await this.deps.orgs.hasRole(existingUser.userId, ROLES.ORG_ADMIN)) {
        throw new ConflictError('This user is an organization admin and cannot be invited as a professor.');
      }
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
    await this.deps.email.sendInvitationEmail(normalized, buildInviteUrl(token), token);

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

  async inviteOrgAdmin(
    actor: OrgActor,
    orgId: number,
    emailOrUserId: string | number,
  ): Promise<{ token: string; email: string }> {
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }

    let targetEmail: string;
    let targetUserId: number | null = null;

    if (typeof emailOrUserId === 'number' || (!Number.isNaN(Number(emailOrUserId)) && String(emailOrUserId).trim() !== '')) {
      const user = await this.deps.orgs.findUserById(Number(emailOrUserId));
      if (!user) throw new NotFoundError('Target user not found.');
      targetEmail = user.email;
      targetUserId = user.userId;
    } else {
      targetEmail = String(emailOrUserId).trim().toLowerCase();
      const user = await this.deps.orgs.findUserByEmail(targetEmail);
      if (user) targetUserId = user.userId;
    }

    const token = randomUUID();
    const payload = JSON.stringify({
      email: targetEmail,
      userId: targetUserId,
      orgId,
      invitedBy: actor.userId,
      role: ROLES.ORG_ADMIN,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });

    await redisClient.set(`org_admin_invite:${token}`, payload, 'EX', 72 * 3600);

    const inviteUrl = `${env.FRONTEND_URL}/admin/organizations/accept-admin?token=${token}&orgId=${orgId}`;
    await this.deps.email.sendInvitationEmail(targetEmail, inviteUrl, token);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.ASSIGN_ORG_ADMIN, 'organization', orgId, {
      targetEmail,
      targetUserId,
      invited: true,
    });

    return { token, email: targetEmail };
  }

  async acceptOrgAdmin(userId: number, token: string): Promise<OrgAdminDetailDto> {
    const raw = await redisClient.get(`org_admin_invite:${token}`);
    if (!raw) {
      throw new BadRequestError('Invitation token is invalid or has expired.');
    }
    const invite = JSON.parse(raw) as { email: string; userId: number | null; orgId: number };
    const user = await this.deps.orgs.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }
    if (user.email.toLowerCase() !== invite.email.toLowerCase() && invite.userId && invite.userId !== userId) {
      throw new ForbiddenError('This invitation belongs to a different email address.');
    }

    const roleId = await this.deps.orgs.findRoleId(ROLES.ORG_ADMIN);
    await this.deps.orgs.assignRole(userId, roleId);
    await this.deps.scopes.setOrgId(userId, invite.orgId);
    await redisClient.del(`org_admin_invite:${token}`);

    return this.getOrgAdminDetail(invite.orgId);
  }

  async getOrgAnalytics(orgId: number) {
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }
    const adminDetail = await this.deps.orgs.getAdminDetail(orgId);

    // 1. Gather all users belonging to this organization across all DB sources
    const memberIdSet = new Set<number>();

    if (adminDetail?.adminUserId) {
      memberIdSet.add(adminDetail.adminUserId);
    }

    const orgSettings = await db
      .select({ userId: userSettings.userId })
      .from(userSettings)
      .where(
        and(
          eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
          eq(userSettings.settingValue, String(orgId)),
        ),
      );
    for (const s of orgSettings) {
      memberIdSet.add(s.userId);
    }

    const orgTeams = await db
      .select({ teamId: teams.teamId, teamOwnerId: teams.teamOwnerId })
      .from(teams)
      .where(eq(teams.organizationId, orgId));

    for (const t of orgTeams) {
      if (t.teamOwnerId) memberIdSet.add(t.teamOwnerId);
    }

    const teamIds = orgTeams.map((t) => t.teamId);
    if (teamIds.length > 0) {
      const rosterRows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, teamIds));
      for (const m of rosterRows) {
        memberIdSet.add(m.userId);
      }
    }

    const userIds = Array.from(memberIdSet);

    // 2. Member Breakdown
    let studentsCount = 0;
    let professorsCount = 0;
    let adminsCount = 0;

    if (userIds.length > 0) {
      const userRoleRows = await db
        .select({ roleName: roles.roleName })
        .from(userRoles)
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(inArray(userRoles.userId, userIds));

      for (const r of userRoleRows) {
        if (r.roleName === ROLES.ORG_STUDENT) studentsCount++;
        else if (r.roleName === ROLES.PROFESSOR) professorsCount++;
        else if (r.roleName === ROLES.ORG_ADMIN) adminsCount++;
      }
    }

    if (adminDetail?.adminUserId && adminsCount === 0) {
      adminsCount = 1;
    }

    // 3. Revenue & Billing
    const orgSubs = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId));

    let totalRevenue = 0;
    let paidOrdersCount = 0;
    const subIds = orgSubs.map((s) => s.subscriptionId);

    if (subIds.length > 0) {
      const orderRows = await db
        .select({ totalAmount: orders.totalAmount, status: orders.status })
        .from(orders)
        .where(inArray(orders.subscriptionId, subIds));

      for (const ord of orderRows) {
        if (ord.status === 'paid') {
          totalRevenue += Number(ord.totalAmount) || 0;
          paidOrdersCount++;
        }
      }
    }

    // 4. Compute Resource Stats (Pwnbox / Containers allocated for Org users)
    let minCpu = 0;
    let avgCpu = 0;
    let maxCpu = 0;
    let minRam = 0;
    let avgRam = 0;
    let maxRam = 0;
    let activePods = 0;

    if (userIds.length > 0) {
      const pwnboxRows = await db
        .select({
          cpuCores: pwnboxInstances.cpuCores,
          ramGb: pwnboxInstances.ramGb,
          status: pwnboxInstances.status,
        })
        .from(pwnboxInstances)
        .where(inArray(pwnboxInstances.userId, userIds));

      if (pwnboxRows.length > 0) {
        const cpus = pwnboxRows.map((r) => r.cpuCores);
        const rams = pwnboxRows.map((r) => r.ramGb);
        minCpu = Math.min(...cpus);
        maxCpu = Math.max(...cpus);
        avgCpu = Number((cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1));

        minRam = Math.min(...rams);
        maxRam = Math.max(...rams);
        avgRam = Number((rams.reduce((a, b) => a + b, 0) / rams.length).toFixed(1));

        activePods = pwnboxRows.filter((r) => r.status === 'running' || r.status === 'pending').length;
      }
    }

    // 5. Daily Active Users (DAU) & Trend (Last 14 days)
    const dailyTrend: Array<{ date: string; activeUsers: number; labCompletions: number }> = [];
    const now = new Date();
    const dauCounts: number[] = [];

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const activityRows = userIds.length > 0
      ? await db
          .select({
            userId: activityLogs.userId,
            activityType: activityLogs.activityType,
            createdAt: activityLogs.createdAt,
          })
          .from(activityLogs)
          .where(
            and(
              inArray(activityLogs.userId, userIds),
              gte(activityLogs.createdAt, fourteenDaysAgo),
            ),
          )
      : [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(5, 10); // MM-DD
      const startOfDay = new Date(d.setHours(0, 0, 0, 0)).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

      const dayEvents = activityRows.filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= startOfDay && t < endOfDay;
      });

      const uniqueUsers = new Set(dayEvents.map((e) => e.userId)).size;
      const completions = dayEvents.filter((e) => e.activityType.includes('COMPLETE') || e.activityType.includes('LAB')).length;

      dailyTrend.push({ date: dateKey, activeUsers: uniqueUsers, labCompletions: completions });
      dauCounts.push(uniqueUsers);
    }

    const minDau = dauCounts.length > 0 ? Math.min(...dauCounts) : 0;
    const maxDau = dauCounts.length > 0 ? Math.max(...dauCounts) : 0;
    const avgDau = dauCounts.length > 0 ? Number((dauCounts.reduce((a, b) => a + b, 0) / dauCounts.length).toFixed(1)) : 0;

    const totalModuleCompletions = activityRows.filter((e) => e.activityType.includes('MODULE_COMPLETE') || e.activityType.includes('MODULE')).length;
    const totalLabCompletions = activityRows.filter((e) => e.activityType.includes('LAB_COMPLETE') || e.activityType.includes('LAB_SOLVE')).length;

    const avgModuleCompletionRate = userIds.length > 0 ? Math.min(100, Math.round((totalModuleCompletions / (userIds.length * 5)) * 100)) : 0;
    const avgLabCompletionRate = userIds.length > 0 ? Math.min(100, Math.round((totalLabCompletions / (userIds.length * 8)) * 100)) : 0;

    return {
      revenue: {
        totalRevenue,
        paidOrdersCount,
        activeSubscriptions: orgSubs.length,
        subscriptionPlan: orgSubs[0]?.planName ?? 'Free',
      },
      members: {
        totalMembers: userIds.length,
        studentsCount,
        professorsCount,
        adminsCount,
      },
      progress: {
        avgModuleCompletionRate,
        avgLabCompletionRate,
        totalModuleCompletions,
        totalLabCompletions,
      },
      compute: {
        activePods,
        minCpu,
        avgCpu,
        maxCpu,
        minRam,
        avgRam,
        maxRam,
      },
      dau: {
        minDau,
        avgDau,
        maxDau,
        dailyTrend,
      },
    };
  }

  async listOrgUsers(_actor: OrgActor, orgId: number): Promise<OrgUserDto[]> {
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }
    const adminDetail = await this.deps.orgs.getAdminDetail(orgId);

    const memberIdSet = new Set<number>();
    if (adminDetail?.adminUserId) {
      memberIdSet.add(adminDetail.adminUserId);
    }

    const orgSettings = await db
      .select({ userId: userSettings.userId })
      .from(userSettings)
      .where(
        and(
          eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
          eq(userSettings.settingValue, String(orgId)),
        ),
      );
    for (const s of orgSettings) {
      memberIdSet.add(s.userId);
    }

    const orgTeams = await db
      .select({ teamId: teams.teamId, teamName: teams.teamName, teamOwnerId: teams.teamOwnerId })
      .from(teams)
      .where(eq(teams.organizationId, orgId));

    const userClassMap = new Map<number, Array<{ classId: number; className: string }>>();
    for (const t of orgTeams) {
      if (t.teamOwnerId) {
        memberIdSet.add(t.teamOwnerId);
        const existing = userClassMap.get(t.teamOwnerId) || [];
        existing.push({ classId: t.teamId, className: t.teamName });
        userClassMap.set(t.teamOwnerId, existing);
      }
    }

    const teamIds = orgTeams.map((t) => t.teamId);
    if (teamIds.length > 0) {
      const rosterRows = await db
        .select({
          userId: teamMembers.userId,
          teamId: teamMembers.teamId,
          teamName: teams.teamName,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
        .where(inArray(teamMembers.teamId, teamIds));
      for (const m of rosterRows) {
        memberIdSet.add(m.userId);
        const existing = userClassMap.get(m.userId) || [];
        if (!existing.some((c) => c.classId === m.teamId)) {
          existing.push({ classId: m.teamId, className: m.teamName });
        }
        userClassMap.set(m.userId, existing);
      }
    }

    const userIds = Array.from(memberIdSet);
    if (userIds.length === 0) {
      return [];
    }

    const userRows = await db
      .select({
        userId: users.userId,
        email: users.email,
        fullName: users.fullName,
        username: users.username,
        isActive: users.isActive,
        isBanned: users.isBanned,
        deletedAt: users.deletedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(inArray(users.userId, userIds));

    const userRoleRows = await db
      .select({
        userId: userRoles.userId,
        roleName: roles.roleName,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(inArray(userRoles.userId, userIds));

    const userRoleMap = new Map<number, 'org_admin' | 'professor' | 'org_student'>();
    for (const r of userRoleRows) {
      if (r.roleName === ROLES.ORG_ADMIN) {
        userRoleMap.set(r.userId, 'org_admin');
      } else if (r.roleName === ROLES.PROFESSOR && userRoleMap.get(r.userId) !== 'org_admin') {
        userRoleMap.set(r.userId, 'professor');
      } else if (r.roleName === ROLES.ORG_STUDENT && !userRoleMap.has(r.userId)) {
        userRoleMap.set(r.userId, 'org_student');
      }
    }

    const progressRows = await db
      .select({
        userId: userProgress.userId,
        completedCount: sql<number>`count(*)`.as('completed_count'),
      })
      .from(userProgress)
      .where(and(inArray(userProgress.userId, userIds), eq(userProgress.isCompleted, true)))
      .groupBy(userProgress.userId);

    const progressMap = new Map<number, number>();
    for (const p of progressRows) {
      progressMap.set(p.userId, Number(p.completedCount) || 0);
    }

    return userRows.map((u) => {
      let role: 'org_admin' | 'professor' | 'org_student' = userRoleMap.get(u.userId) || 'org_student';
      if (u.userId === adminDetail?.adminUserId) {
        role = 'org_admin';
      }
      const status = u.deletedAt ? 'deleted' : u.isBanned ? 'banned' : !u.isActive ? 'inactive' : 'active';
      return {
        userId: u.userId,
        email: u.email,
        fullName: u.fullName,
        username: u.username,
        status,
        role,
        classes: userClassMap.get(u.userId) || [],
        enrolledAt: u.createdAt.toISOString(),
        completedModules: progressMap.get(u.userId) || 0,
      };
    });
  }

  async getOrgUserDetail(actor: OrgActor, orgId: number, targetUserId: number): Promise<OrgUserDetailDto> {
    const orgUsers = await this.listOrgUsers(actor, orgId);
    const found = orgUsers.find((u) => u.userId === targetUserId);
    if (!found) {
      throw new NotFoundError('User does not belong to this organization.');
    }

    const countryRows = await db
      .select({ countryCode: countries.countryCode })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.userId))
      .leftJoin(countries, eq(countries.countryId, userProfiles.countryId))
      .where(eq(users.userId, targetUserId))
      .limit(1);

    const quizRows = await db
      .select({ passedCount: sql<number>`count(*)`.as('passed_count') })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, targetUserId), eq(quizAttempts.isPassed, true)));

    const pwnboxRows = await db
      .select({
        startedAt: pwnboxInstances.startedAt,
        expiresAt: pwnboxInstances.expiresAt,
        terminatedAt: pwnboxInstances.terminatedAt,
      })
      .from(pwnboxInstances)
      .where(eq(pwnboxInstances.userId, targetUserId));

    const totalMinutes = pwnboxRows.reduce((acc, row) => {
      const end = row.terminatedAt?.getTime() ?? row.expiresAt?.getTime() ?? Date.now();
      const start = row.startedAt.getTime();
      return acc + Math.max(0, Math.round((end - start) / 60000));
    }, 0);
    const labHours = Math.round((totalMinutes / 60) * 10) / 10;

    return {
      ...found,
      countryCode: countryRows[0]?.countryCode ?? null,
      quizzesPassed: Number(quizRows[0]?.passedCount) || 0,
      labHours,
    };
  }

  async getAdminClassDetail(orgId: number, classId: number) {
    const org = await this.deps.orgs.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found.');
    }
    const cls = await this.deps.classes.findById(classId);
    if (!cls || (cls.organizationId !== orgId && cls.organizationId !== null)) {
      throw new NotFoundError('Class not found in this organization.');
    }

    const rosterData = await this.deps.members.roster(classId, 1, 100, false);
    const professor = cls.teamOwnerId ? await this.deps.orgs.findUserById(cls.teamOwnerId) : null;
    const studentUserIds = rosterData.data.map((r) => r.userId);

    let activePods = 0;
    let avgRam = 0;
    let avgCpu = 0;

    if (studentUserIds.length > 0) {
      const pwnboxRows = await db
        .select({
          ramGb: pwnboxInstances.ramGb,
          cpuCores: pwnboxInstances.cpuCores,
          status: pwnboxInstances.status,
        })
        .from(pwnboxInstances)
        .where(inArray(pwnboxInstances.userId, studentUserIds));

      if (pwnboxRows.length > 0) {
        const cpus = pwnboxRows.map((r) => r.cpuCores);
        const rams = pwnboxRows.map((r) => r.ramGb);
        avgCpu = Number((cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1));
        avgRam = Number((rams.reduce((a, b) => a + b, 0) / rams.length).toFixed(1));
        activePods = pwnboxRows.filter((r) => r.status === 'running' || r.status === 'pending').length;
      }
    }

    const leaderboard: Array<{
      userId: number;
      fullName: string | null;
      email: string;
      enrolledAt: string;
      completedModules: number;
      completedLabs: number;
      totalScore: number;
    }> = [];

    if (studentUserIds.length > 0) {
      const activities = await db
        .select({
          userId: activityLogs.userId,
          activityType: activityLogs.activityType,
        })
        .from(activityLogs)
        .where(inArray(activityLogs.userId, studentUserIds));

      const activityByUser = new Map<number, { modules: number; labs: number }>();
      for (const act of activities) {
        const current = activityByUser.get(act.userId) ?? { modules: 0, labs: 0 };
        if (act.activityType.includes('MODULE')) current.modules++;
        if (act.activityType.includes('LAB')) current.labs++;
        activityByUser.set(act.userId, current);
      }

      for (const st of rosterData.data) {
        const stats = activityByUser.get(st.userId) ?? { modules: 0, labs: 0 };
        const score = stats.modules * 100 + stats.labs * 50;
        leaderboard.push({
          userId: st.userId,
          fullName: st.fullName,
          email: st.email,
          enrolledAt: st.enrolledAt.toISOString(),
          completedModules: stats.modules,
          completedLabs: stats.labs,
          totalScore: score,
        });
      }

      leaderboard.sort((a, b) => b.totalScore - a.totalScore);
    }

    const totalStudents = rosterData.data.length;
    const avgProgress = totalStudents > 0
      ? Math.min(100, Math.round((leaderboard.reduce((acc, s) => acc + s.completedModules, 0) / (totalStudents * 5)) * 100))
      : 0;

    return {
      detail: {
        classId: cls.teamId,
        organizationId: cls.organizationId ?? orgId,
        className: cls.teamName,
        slug: cls.slug,
        description: cls.description,
        maxStudents: cls.maxMembers,
        studentCount: rosterData.total,
        createdAt: cls.createdAt.toISOString(),
      },
      professor: professor
        ? {
            userId: professor.userId,
            fullName: professor.fullName,
            email: professor.email,
          }
        : null,
      roster: rosterData.data.map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        email: r.email,
        enrolledAt: r.enrolledAt.toISOString(),
        isActive: r.isActive,
      })),
      analytics: {
        avgProgress,
        activePods,
        avgCpu,
        avgRam,
      },
      leaderboard,
    };
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

export const orgService = new OrgService();