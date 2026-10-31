import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_CONSTANTS } from '../../src/shared/constants';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { OrgService } from '../../src/features/orgs/services/org.service';
import { ClassService } from '../../src/features/orgs/services/class.service';
import type { OrgServiceDeps } from '../../src/features/orgs/services/org.service';
import type { ClassServiceDeps } from '../../src/features/orgs/services/class.service';

const { redisClientMock } = vi.hoisted(() => ({
  redisClientMock: {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn(),
    srem: vi.fn(),
    ttl: vi.fn(),
    scan: vi.fn(),
  },
}));

vi.mock('../../src/app/cache/redis', () => ({ redisClient: redisClientMock }));

const actor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 1,
    name: 'Acme University',
    slug: 'acme',
    description: null,
    logoUrl: null,
    website: null,
    industry: null,
    isVerified: false,
    billingEmail: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function classRow(overrides: Record<string, unknown> = {}) {
  return {
    teamId: 10,
    organizationId: 1,
    teamName: 'DevOps 101',
    slug: 'devops-101',
    description: null,
    teamOwnerId: 3,
    maxMembers: 50,
    isPublic: false,
    createdAt: new Date('2026-01-05T00:00:00.000Z'),
    studentCount: 0,
    ...overrides,
  };
}

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeOrgDeps(): Mocked<OrgServiceDeps> {
  return {
    orgs: {
      findBySlug: vi.fn(async () => null),
      create: vi.fn(async () => 1),
      findById: vi.fn(async () => orgRow()),
      listAdmin: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
      getAdminDetail: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
      deleteById: vi.fn(async () => undefined),
      findUserById: vi.fn(async () => ({ userId: 2, email: 'bob@example.com', fullName: 'Bob' })),
      findUserByEmail: vi.fn(async () => null),
      findUsersByIds: vi.fn(async () => []),
      hasRole: vi.fn(async () => false),
      findRoleId: vi.fn(async () => 7),
      assignRole: vi.fn(async () => undefined),
      removeRole: vi.fn(async () => undefined),
      removeRoles: vi.fn(async () => undefined),
      listRoleNames: vi.fn(async () => []),
      getEmailDomain: vi.fn(async () => null),
      setEmailDomain: vi.fn(async () => undefined),
      clearEmailDomain: vi.fn(async () => undefined),
    },
    scopes: {
      getOrgId: vi.fn(async () => 1),
      setOrgId: vi.fn(async () => undefined),
      clearOrgId: vi.fn(async () => undefined),
      listUserIdsByOrgId: vi.fn(async () => [9]),
    },
    classes: {
      countByOrg: vi.fn(async () => 2),
      findProfessorCount: vi.fn(async () => 1),
      listAllByOrg: vi.fn(async () => [classRow()]),
      deleteByOrg: vi.fn(async () => undefined),
      countOwnedByUser: vi.fn(async () => 0),
    },
    members: {
      countStudentsByOrg: vi.fn(async () => 4),
      professorUserIds: vi.fn(async () => []),
      assignedClassIds: vi.fn(async () => []),
      findActiveStudentClass: vi.fn(async () => null),
      listActiveStudentClasses: vi.fn(async () => []),
      listActiveStudentIds: vi.fn(async () => []),
      listActiveUserIdsByOrg: vi.fn(async () => []),
      hasAnyActiveMembership: vi.fn(async () => false),
    },
    invitations: {
      ensureSentinelTeam: vi.fn(async () => 99),
      findById: vi.fn(async () => null),
      findByToken: vi.fn(async () => null),
      findPendingByClassAndEmail: vi.fn(async () => null),
      insertMany: vi.fn(async () => undefined),
      updateInvitation: vi.fn(async () => undefined),
      markAccepted: vi.fn(async () => undefined),
      listByClass: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
    },
    email: { sendInvitationEmail: vi.fn(async () => undefined) },
    audit: { record: vi.fn(async () => undefined) },
  };
}

function makeClassDeps() {
  const orgs = {
    findUserById: vi.fn(async () => ({ userId: 3, email: 'prof@acme.edu', fullName: 'Prof X' })),
    findUserByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => orgRow()),
    findRoleId: vi.fn(async () => 8),
    assignRole: vi.fn(async () => undefined),
    removeRole: vi.fn(async () => undefined),
    hasRole: vi.fn(async () => false),
    getEmailDomain: vi.fn(async () => null),
    setEmailDomain: vi.fn(async () => undefined),
    findBySlug: vi.fn(async () => null),
    create: vi.fn(async () => 1),
    findUsersByIds: vi.fn(async () => []),
    getAdminDetail: vi.fn(async () => null),
    listAdmin: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
    update: vi.fn(async () => undefined),
  };
  const scopes = {
    getOrgId: vi.fn(async (userId: number) => (userId === 9 ? 1 : null)),
    setOrgId: vi.fn(async () => undefined),
    clearOrgId: vi.fn(async () => undefined),
    listUserIdsByOrgId: vi.fn(async () => []),
  };
  const members = {
    isActiveMember: vi.fn(async () => false),
    isProfessorOf: vi.fn(async () => false),
    assignedClassIds: vi.fn(async () => []),
    professorUserIds: vi.fn(async () => []),
    countStudentsByOrg: vi.fn(async () => 0),
    upsertProfessor: vi.fn(async () => undefined),
    deactivateOtherProfessors: vi.fn(async () => undefined),
    insertStudent: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    roster: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
    findActiveStudentClass: vi.fn(async () => null),
    listActiveStudentClasses: vi.fn(async () => []),
    listActiveStudentIds: vi.fn(async () => []),
    listActiveUserIdsByOrg: vi.fn(async () => []),
    hasAnyActiveMembership: vi.fn(async () => false),
  };
  const invitations = {
    ensureSentinelTeam: vi.fn(async () => 99),
    findById: vi.fn(async () => null),
    findByToken: vi.fn(async () => null),
    findPendingByClassAndEmail: vi.fn(async () => null),
    insertMany: vi.fn(async () => undefined),
    updateInvitation: vi.fn(async () => undefined),
    markAccepted: vi.fn(async () => undefined),
    listByClass: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
  };
  const email = { sendInvitationEmail: vi.fn(async () => undefined) };
  const audit = { record: vi.fn(async () => undefined) };
  const classes = {
    create: vi.fn(async () => 10),
    findBySlug: vi.fn(async () => null),
    findById: vi.fn(async () => classRow()),
    findOwnerOrg: vi.fn(async () => ({ organizationId: 1 })),
    listByOrg: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
    update: vi.fn(async () => undefined),
    deleteById: vi.fn(async () => undefined),
    listAllByOrg: vi.fn(async () => []),
    deleteByOrg: vi.fn(async () => undefined),
    countOwnedByUser: vi.fn(async () => 0),
    setOwner: vi.fn(async () => undefined),
    countByOrg: vi.fn(async () => 0),
    findProfessorCount: vi.fn(async () => 0),
  };
  const deps: ClassServiceDeps = { classes, orgs, scopes, members, invitations, email, audit };
  return deps as unknown as { [K in keyof ClassServiceDeps]: Mocked<ClassServiceDeps[K]> };
}

describe('OrgService (F3)', () => {
  let deps: Mocked<OrgServiceDeps>;
  let service: OrgService;

  beforeEach(() => {
    deps = makeOrgDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new OrgService(deps as any);
  });

  describe('createOrg (ORG-01)', () => {
    it('creates a verified=false org and writes an audit row', async () => {
      const result = await service.createOrg(actor, {
        name: 'Acme University',
        slug: 'Acme University '.toLowerCase().trim(),
      });

      expect(result.organizationId).toBe(1);
      expect(result.slug).toBe('acme university');
      expect(deps.orgs.create).toHaveBeenCalledWith(expect.objectContaining({ isVerified: false }));
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_org', targetType: 'organization' }),
      );
    });

    it('throws ConflictError on duplicate slug (AC-02)', async () => {
      deps.orgs.findBySlug.mockResolvedValueOnce(orgRow());
      await expect(
        service.createOrg(actor, { name: 'Acme', slug: 'acme' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('createMyOrg (self-service)', () => {
    it('creates the org and assigns the caller as its org admin', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(null);
      deps.orgs.getAdminDetail.mockResolvedValueOnce({
        ...orgRow(),
        adminUserId: 9,
        adminEmail: 'actor@example.com',
      });

      const result = await service.createMyOrg(actor, {
        name: 'Acme University',
        slug: 'acme',
      });

      expect(result.organizationId).toBe(1);
      expect(deps.orgs.assignRole).toHaveBeenCalledWith(9, 7);
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(9, 1);
    });

    it('rejects an account that already has an org scope', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(1);
      await expect(
        service.createMyOrg(actor, { name: 'Acme', slug: 'acme' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects an account holding a stale org role without a scope', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(null);
      deps.orgs.hasRole.mockResolvedValueOnce(true);
      await expect(
        service.createMyOrg(actor, { name: 'Acme', slug: 'acme' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('assignOrgAdmin (ORG-05)', () => {
    it('assigns the role and sets the org scope', async () => {
      deps.orgs.getAdminDetail.mockResolvedValueOnce({
        ...orgRow(),
        adminUserId: 2,
        adminEmail: 'bob@example.com',
      });
      const result = await service.assignOrgAdmin(actor, 1, 2);

      expect(deps.orgs.findRoleId).toHaveBeenCalledWith('org_admin');
      expect(deps.orgs.assignRole).toHaveBeenCalledWith(2, 7);
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(2, 1);
      expect(result.adminEmail).toBe('bob@example.com');
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'assign_org_admin' }),
      );
    });

    it('throws ConflictError when the user is already an org admin', async () => {
      deps.orgs.hasRole.mockResolvedValueOnce(true);
      await expect(service.assignOrgAdmin(actor, 1, 2)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('updateMyOrg (ORG-07)', () => {
    it('updates the caller-scoped organization', async () => {
      const result = await service.updateMyOrg(actor, 9, { description: 'new' });

      expect(deps.orgs.update).toHaveBeenCalledWith(1, { description: 'new' });
      expect(result.organizationId).toBe(1);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_org' }),
      );
    });

    it('throws when the caller has no org scope', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(null);
      await expect(
        service.updateMyOrg(actor, 9, { description: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('inviteProfessor (ORG-09)', () => {
    it('rejects users already affiliated with another organization', async () => {
      deps.orgs.findUserByEmail.mockResolvedValueOnce({
        userId: 5,
        email: 'p@other.edu',
        fullName: null,
      });
      deps.scopes.getOrgId.mockResolvedValueOnce(2);
      await expect(service.inviteProfessor(actor, 1, 'p@other.edu')).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('allows inviting an email that does not have a user account yet', async () => {
      deps.orgs.findUserByEmail.mockResolvedValueOnce(null);
      const res = await service.inviteProfessor(actor, 1, 'nobody@acme.edu');
      expect(res.inviteeEmail).toBe('nobody@acme.edu');
      expect(res.status).toBe('pending');
      expect(deps.email.sendInvitationEmail).toHaveBeenCalled();
    });
  });

  describe('getMyOrg (ORG-06)', () => {
    it('returns org with computed stats and email domain', async () => {
      const result = await service.getMyOrg(9);
      expect(result.stats).toEqual({ classCount: 2, studentCount: 4, professorCount: 1 });
      expect(result.emailDomain).toBeNull();
    });
  });

  describe('multi-class context (ENR-03)', () => {
    it('returns every active class for the learner', async () => {
      deps.members.listActiveStudentClasses.mockResolvedValueOnce([
        {
          teamId: 10,
          teamName: 'DevOps 101',
          organizationId: 1,
          organizationName: 'Acme University',
          joinedAt: new Date('2026-01-05T00:00:00.000Z'),
        },
        {
          teamId: 11,
          teamName: 'Cloud 201',
          organizationId: 1,
          organizationName: 'Acme University',
          joinedAt: new Date('2026-02-05T00:00:00.000Z'),
        },
      ]);

      const result = await service.listMyClasses(9);
      expect(result.map((entry) => entry.classId)).toEqual([10, 11]);
    });

    it('narrows the selected class by id', async () => {
      deps.members.findActiveStudentClass.mockResolvedValueOnce({
        teamId: 11,
        teamName: 'Cloud 201',
        organizationId: 1,
        organizationName: 'Acme University',
        joinedAt: new Date('2026-02-05T00:00:00.000Z'),
      });

      const result = await service.getMyClass(9, 11);
      expect(deps.members.findActiveStudentClass).toHaveBeenCalledWith(9, 11);
      expect(result.className).toBe('Cloud 201');
    });
  });

  describe('deleteOrg (ORG-01 destructive extension)', () => {
    it('rejects non-platform admins', async () => {
      deps.orgs.hasRole.mockResolvedValueOnce(false);
      await expect(service.deleteOrg(actor, 1)).rejects.toBeInstanceOf(ForbiddenError);
      expect(deps.classes.deleteByOrg).not.toHaveBeenCalled();
    });

    it('deletes classes before the org and cleans scoped roles/scopes', async () => {
      deps.orgs.hasRole.mockResolvedValue(true);
      deps.orgs.listRoleNames
        .mockResolvedValueOnce(['org_student'])
        .mockResolvedValueOnce([]);
      deps.classes.listAllByOrg.mockResolvedValueOnce([classRow()]);
      deps.scopes.listUserIdsByOrgId.mockResolvedValueOnce([2]);
      deps.members.listActiveUserIdsByOrg.mockResolvedValueOnce([2]);
      deps.members.hasAnyActiveMembership.mockResolvedValueOnce(false);
      deps.classes.countOwnedByUser.mockResolvedValueOnce(0);
      redisClientMock.scan
        .mockResolvedValueOnce(['0', []])
        .mockResolvedValueOnce(['0', []]);

      const result = await service.deleteOrg(
        { ...actor, roles: ['platform_admin'] },
        1,
      );

      expect(deps.classes.deleteByOrg).toHaveBeenCalledWith(1);
      expect(deps.orgs.deleteById).toHaveBeenCalledWith(1);
      expect(deps.scopes.clearOrgId).toHaveBeenCalledWith(2);
      expect(deps.orgs.removeRoles).toHaveBeenCalledWith(2, [
        'org_admin',
        'professor',
        'org_student',
      ]);
      expect(deps.orgs.findRoleId).toHaveBeenCalledWith('individual_learner');
      expect(deps.orgs.assignRole).toHaveBeenCalledWith(2, 7);
      expect(result.classCount).toBe(1);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_org', targetType: 'organization' }),
      );
    });
  });
});

describe('ClassService (F3)', () => {
  let deps: ReturnType<typeof makeClassDeps>;
  let service: ClassService;

  beforeEach(() => {
    deps = makeClassDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ClassService(deps as any);
  });

  describe('createClass (CLS-01)', () => {
    it('creates a class bound to the provided org id and audits (AC-03)', async () => {
      const result = await service.createClass(actor, 1, { className: 'DevOps 101' });

      expect(deps.classes.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 1, maxMembers: 50 }),
      );
      expect(result.classId).toBe(10);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_class' }),
      );
    });

    it('auto-assigns a professor creator as the class captain', async () => {
      await service.createClass({ ...actor, roles: ['professor'] }, 1, {
        className: 'DevOps 101',
      });

      expect(deps.members.upsertProfessor).toHaveBeenCalledWith(10, 9, 'captain');
    });

    it('does not add an org admin creator to the class roster', async () => {
      await service.createClass({ ...actor, roles: ['org_admin'] }, 1, {
        className: 'DevOps 101',
      });

      expect(deps.members.upsertProfessor).not.toHaveBeenCalled();
    });
  });

  describe('class join codes (Task 3)', () => {
    beforeEach(() => {
      redisClientMock.get.mockReset();
      redisClientMock.set.mockReset();
      redisClientMock.incr.mockReset();
      redisClientMock.expire.mockReset();
    });

    it('mints an eight-character code bound to the class and org', async () => {
      redisClientMock.set.mockResolvedValueOnce('OK');
      deps.scopes.getOrgId.mockResolvedValueOnce(1);

      const result = await service.generateJoinCode(
        { ...actor, roles: ['org_admin'] },
        10,
      );

      expect(result.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(result.expiresAt).toBeTruthy();
      expect(redisClientMock.set).toHaveBeenCalledWith(
        expect.stringContaining(result.code),
        expect.stringContaining('"classId":10'),
        'EX',
        ORG_CONSTANTS.CLASS_CODE_TTL_SECONDS,
        'NX',
      );
    });

    it('refuses to mint a code for staff outside the class org', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(2);

      await expect(
        service.generateJoinCode({ ...actor, roles: ['org_admin'] }, 10),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('enrolls a learner, repairs the student role, and sets the org scope', async () => {
      redisClientMock.incr.mockResolvedValueOnce(1);
      redisClientMock.get.mockResolvedValueOnce(
        JSON.stringify({ classId: 10, organizationId: 1 }),
      );
      deps.scopes.getOrgId.mockResolvedValueOnce(null);

      const result = await service.joinClassWithCode({ ...actor, userId: 2 }, 'abcd2345');

      expect(result.alreadyEnrolled).toBe(false);
      expect(deps.members.insertStudent).toHaveBeenCalledWith(10, 2);
      expect(deps.orgs.assignRole).toHaveBeenCalledWith(2, 8);
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(2, 1);
    });

    it('repairs stale membership without inserting a duplicate roster row', async () => {
      redisClientMock.incr.mockResolvedValueOnce(1);
      redisClientMock.get.mockResolvedValueOnce(
        JSON.stringify({ classId: 10, organizationId: 1 }),
      );
      deps.members.isActiveMember.mockResolvedValueOnce(true);
      deps.orgs.hasRole.mockImplementation(async (_id: number, role: string) => role === 'org_student');
      deps.scopes.getOrgId.mockResolvedValueOnce(null);

      const result = await service.joinClassWithCode({ ...actor, userId: 2 }, 'abcd2345');

      expect(result.alreadyEnrolled).toBe(true);
      expect(deps.members.insertStudent).not.toHaveBeenCalled();
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(2, 1);
    });

    it('blocks staff accounts from consuming a student join code', async () => {
      redisClientMock.incr.mockResolvedValueOnce(1);
      redisClientMock.get.mockResolvedValueOnce(
        JSON.stringify({ classId: 10, organizationId: 1 }),
      );
      deps.orgs.hasRole.mockImplementation(async (_id: number, role: string) => role === 'professor');

      await expect(
        service.joinClassWithCode({ ...actor, userId: 2 }, 'abcd2345'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects a code from a different organization than the caller scope', async () => {
      redisClientMock.incr.mockResolvedValueOnce(1);
      redisClientMock.get.mockResolvedValueOnce(
        JSON.stringify({ classId: 10, organizationId: 1 }),
      );
      deps.scopes.getOrgId.mockResolvedValueOnce(2);

      await expect(
        service.joinClassWithCode({ ...actor, userId: 2 }, 'abcd2345'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects an unknown or expired code', async () => {
      redisClientMock.incr.mockResolvedValueOnce(1);
      redisClientMock.get.mockResolvedValueOnce(null);

      await expect(
        service.joinClassWithCode({ ...actor, userId: 2 }, 'missing1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('class code management & deletion', () => {
    beforeEach(() => {
      redisClientMock.get.mockReset();
      redisClientMock.set.mockReset();
      redisClientMock.del.mockReset();
      redisClientMock.sadd.mockReset();
      redisClientMock.smembers.mockReset();
      redisClientMock.srem.mockReset();
      redisClientMock.ttl.mockReset();
      deps.scopes.getOrgId.mockResolvedValue(1);
    });

    it('indexes a minted code and audits only its fingerprint', async () => {
      redisClientMock.set.mockResolvedValueOnce('OK');
      redisClientMock.sadd.mockResolvedValueOnce(1);
      redisClientMock.expire.mockResolvedValueOnce(1);

      const result = await service.generateJoinCode(
        { ...actor, roles: ['org_admin'] },
        10,
      );

      expect(redisClientMock.sadd).toHaveBeenCalledWith(
        `${ORG_CONSTANTS.CLASS_CODE_INDEX_PREFIX}10`,
        result.code,
      );
      const auditCall = deps.audit.record.mock.calls.at(-1)?.[0] as {
        changes: Record<string, unknown>;
      };
      expect(auditCall.changes.codeFingerprint).toMatch(/^[a-f0-9]{12}$/);
      expect(JSON.stringify(auditCall.changes)).not.toContain(result.code);
    });

    it('lists live codes and prunes expired entries', async () => {
      redisClientMock.smembers.mockResolvedValueOnce(['CODE2345', 'STALE999']);
      redisClientMock.get
        .mockResolvedValueOnce(
          JSON.stringify({
            classId: 10,
            organizationId: 1,
            createdBy: 9,
            createdAt: '2026-01-01T00:00:00.000Z',
          }),
        )
        .mockResolvedValueOnce(null);
      redisClientMock.ttl.mockResolvedValueOnce(3600);

      const result = await service.listJoinCodes(
        { ...actor, roles: ['org_admin'] },
        10,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ code: 'CODE2345', createdBy: 9 });
      expect(redisClientMock.srem).toHaveBeenCalledWith(
        `${ORG_CONSTANTS.CLASS_CODE_INDEX_PREFIX}10`,
        'STALE999',
      );
    });

    it('revokes a code and audits the fingerprint', async () => {
      redisClientMock.del.mockResolvedValueOnce(1);
      redisClientMock.srem.mockResolvedValueOnce(1);

      const result = await service.revokeJoinCode(
        { ...actor, roles: ['org_admin'] },
        10,
        'code2345',
      );

      expect(result.revoked).toBe(true);
      expect(redisClientMock.del).toHaveBeenCalledWith(
        `${ORG_CONSTANTS.CLASS_CODE_PREFIX}CODE2345`,
      );
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'revoke_class_join_code',
          changes: expect.objectContaining({ codeFingerprint: expect.any(String) }),
        }),
      );
    });

    it('deletes a class, revokes codes, and clears only orphaned student scope', async () => {
      deps.members.listActiveStudentIds.mockResolvedValueOnce([2, 3]);
      redisClientMock.smembers.mockResolvedValueOnce(['CODE2345']);
      redisClientMock.get.mockResolvedValueOnce(
        JSON.stringify({ classId: 10, organizationId: 1 }),
      );
      redisClientMock.ttl.mockResolvedValueOnce(3600);
      deps.members.findActiveStudentClass
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          teamId: 11,
          teamName: 'Cloud 201',
          organizationId: 1,
          organizationName: 'Acme University',
          joinedAt: new Date(),
        });

      const result = await service.deleteClass(
        { ...actor, roles: ['org_admin'] },
        10,
      );

      expect(deps.classes.deleteById).toHaveBeenCalledWith(10);
      expect(redisClientMock.del).toHaveBeenCalledWith(
        `${ORG_CONSTANTS.CLASS_CODE_PREFIX}CODE2345`,
      );
      expect(deps.scopes.clearOrgId).toHaveBeenCalledWith(2);
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(3, 1);
      expect(deps.orgs.removeRole).toHaveBeenCalledWith(2, 'org_student');
      expect(deps.orgs.removeRole).not.toHaveBeenCalledWith(3, 'org_student');
      expect(result).toMatchObject({ classId: 10, studentCount: 2, revokedCodeCount: 1 });
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_class', targetType: 'team' }),
      );
    });
  });

  describe('assignProfessor (CLS-05)', () => {
    it('rejects a professor from another organization (AC-08)', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(2);
      await expect(service.assignProfessor(actor, 10, 3)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('assigns captain role and sets the owner within the org', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(1);
      await service.assignProfessor(actor, 10, 3);
      expect(deps.members.upsertProfessor).toHaveBeenCalledWith(10, 3, 'captain');
      expect(deps.classes.setOwner).toHaveBeenCalledWith(10, 3);
    });

    it('blocks org admins from being class professors', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(1);
      deps.orgs.hasRole.mockResolvedValueOnce(true);
      await expect(service.assignProfessor(actor, 10, 3)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('inviteStudents (CLS-07)', () => {
    it('skips emails that violate the org domain restriction (AC-04)', async () => {
      deps.orgs.getEmailDomain.mockResolvedValueOnce('acme.edu');
      const result = await service.inviteStudents(actor, 10, ['bob@evil.com', 'alice@acme.edu']);

      expect(result.invited).toEqual(['alice@acme.edu']);
      expect(result.skipped).toEqual([
        { email: 'bob@evil.com', reason: 'domain_mismatch' },
      ]);
      expect(deps.invitations.insertMany).toHaveBeenCalledTimes(1);
      expect(deps.email.sendInvitationEmail).toHaveBeenCalledTimes(1);
    });

    it('skips already enrolled and pending-invite emails', async () => {
      deps.orgs.getEmailDomain.mockResolvedValue(null);
      deps.orgs.findUserByEmail.mockResolvedValue({
        userId: 7,
        email: 'one@acme.edu',
        fullName: null,
      });
      deps.members.isActiveMember.mockResolvedValueOnce(true);
      deps.invitations.findPendingByClassAndEmail.mockResolvedValueOnce({
        invitationId: 1,
        teamId: 10,
        inviterId: 9,
        inviteeEmail: 'two@acme.edu',
        inviteeUserId: null,
        token: 't',
        status: 'pending',
        expiresAt: new Date(),
        createdAt: new Date(),
        acceptedAt: null,
      });

      const result = await service.inviteStudents(actor, 10, ['one@acme.edu', 'two@acme.edu']);
      expect(result.skipped).toEqual([
        { email: 'one@acme.edu', reason: 'already_enrolled' },
        { email: 'two@acme.edu', reason: 'invite_pending' },
      ]);
      expect(deps.invitations.insertMany).toHaveBeenCalledWith([]);
    });

    it('resends a pending invitation with refreshed token and email dispatch', async () => {
      deps.invitations.findById.mockResolvedValueOnce({
        invitationId: 42,
        teamId: 10,
        inviterId: 9,
        inviteeEmail: 'student@acme.edu',
        inviteeUserId: null,
        token: 'old-token',
        status: 'pending',
        expiresAt: new Date(),
        createdAt: new Date(),
        acceptedAt: null,
      });

      const res = await service.resendInvitation(actor, 10, 42);
      expect(res).toEqual({ success: true, email: 'student@acme.edu' });
      expect(deps.invitations.updateInvitation).toHaveBeenCalledWith(42, expect.objectContaining({
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }));
      expect(deps.email.sendInvitationEmail).toHaveBeenCalledWith(
        'student@acme.edu',
        expect.stringContaining('/enroll/accept?token='),
        expect.any(String),
      );
    });
  });

  describe('importStudents (CLS-08)', () => {
    function csvBuffer(lines: string[]): Express.Multer.File {
      return {
        buffer: Buffer.from(lines.join('\n')),
        size: lines.join('\n').length,
        originalname: 'students.csv',
        mimetype: 'text/csv',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    it('rejects the whole upload when rows exceed 200 (AC-05)', async () => {
      const rows = Array.from({ length: ORG_CONSTANTS.IMPORT_ROW_LIMIT + 1 }, (_, i) => `s${i}@acme.edu`);
      await expect(service.importStudents(actor, 10, csvBuffer(rows))).rejects.toMatchObject({
        message: expect.stringContaining('IMPORT_LIMIT_EXCEEDED'),
      });
      expect(deps.invitations.insertMany).not.toHaveBeenCalled();
    });

    it('rejects non-CSV content with 415', async () => {
      const file = csvBuffer(['a@b.c']);
      file.originalname = 'students.xlsx';
      file.mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await expect(service.importStudents(actor, 10, file)).rejects.toMatchObject({
        statusCode: 415,
      });
    });

    it('collects invalid rows and creates invites for valid ones', async () => {
      const file = csvBuffer(['good@acme.edu', 'not-an-email', 'second@acme.edu']);
      const result = await service.importStudents(actor, 10, file);
      expect(result.totalRows).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.errors).toEqual([
        { row: 2, email: 'not-an-email', reason: 'invalid_email' },
      ]);
    });

    it('skips a header row so the downloadable Email template imports cleanly', async () => {
      const file = csvBuffer(['Email', 'good@acme.edu', 'second@acme.edu']);
      const result = await service.importStudents(actor, 10, file);
      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errors).toEqual([]);
    });
  });

  describe('acceptInvitation (ENR-02)', () => {
    const baseInv = {
      invitationId: 5,
      teamId: 10,
      inviterId: 9,
      inviteeEmail: 'bob@example.com',
      inviteeUserId: null,
      token: 'tok',
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      acceptedAt: null,
    };

    it('enrolls the student and marks the invitation accepted', async () => {
      deps.invitations.findByToken.mockResolvedValueOnce(baseInv);
      deps.orgs.findUserById.mockResolvedValueOnce({
        userId: 2,
        email: 'bob@example.com',
        fullName: 'Bob',
      });
      const result = await service.acceptInvitation(2, 'tok');

      expect(result.kind).toBe('class');
      expect(result.className).toBe('DevOps 101');
      expect(deps.invitations.markAccepted).toHaveBeenCalledWith(5, 2);
      expect(deps.members.insertStudent).toHaveBeenCalledWith(10, 2);
    });

    it('rejects a used token with 400 (AC-06)', async () => {
      deps.invitations.findByToken.mockResolvedValueOnce({ ...baseInv, status: 'accepted' });
      await expect(service.acceptInvitation(2, 'tok')).rejects.toMatchObject({
        message: expect.stringContaining('INVITE_ALREADY_USED'),
      });
    });

    it('rejects an expired token', async () => {
      deps.invitations.findByToken.mockResolvedValueOnce({
        ...baseInv,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.acceptInvitation(2, 'tok')).rejects.toMatchObject({
        message: expect.stringContaining('INVITE_EXPIRED'),
      });
    });

    it('rejects acceptance when the email does not match the caller', async () => {
      deps.invitations.findByToken.mockResolvedValueOnce(baseInv);
      await expect(service.acceptInvitation(9, 'tok')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('grants the professor role (not org_admin) for sentinel invites', async () => {
      deps.invitations.findByToken.mockResolvedValueOnce({
        ...baseInv,
        teamId: 99,
        inviteeEmail: 'prof@acme.edu',
      });
      deps.orgs.findUserById.mockResolvedValueOnce({
        userId: 2,
        email: 'prof@acme.edu',
        fullName: 'Prof',
      });
      deps.scopes.getOrgId.mockResolvedValueOnce(1);
      deps.orgs.findById.mockResolvedValueOnce(orgRow());
      deps.orgs.hasRole.mockImplementation(
        async (id: number, role: string) => id === 9 && role === 'org_admin',
      );

      const result = await service.acceptInvitation(2, 'tok');
      expect(result.kind).toBe('professor');
      expect(deps.orgs.findRoleId).toHaveBeenCalledWith('professor');
      expect(deps.orgs.assignRole).toHaveBeenCalledWith(2, 8);
      expect(deps.scopes.setOrgId).toHaveBeenCalledWith(2, 1);
    });
  });

  describe('withdrawStudent (CLS-09)', () => {
    it('soft-withdraws by deactivating the membership (AC-07)', async () => {
      deps.members.isActiveMember.mockResolvedValueOnce(true);
      await service.withdrawStudent(actor, 10, 2);
      expect(deps.members.withdraw).toHaveBeenCalledWith(10, 2);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'withdraw_student' }),
      );
    });

    it('throws when the user is not an active member', async () => {
      await expect(service.withdrawStudent(actor, 10, 2)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
