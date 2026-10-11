import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_CONSTANTS } from '../../src/shared/constants';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { OrgService } from '../../src/features/orgs/services/org.service';
import { ClassService } from '../../src/features/orgs/services/class.service';
import type { OrgServiceDeps } from '../../src/features/orgs/services/org.service';
import type { ClassServiceDeps } from '../../src/features/orgs/services/class.service';

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
      findUserById: vi.fn(async () => ({ userId: 2, email: 'bob@example.com', fullName: 'Bob' })),
      findUserByEmail: vi.fn(async () => null),
      findUsersByIds: vi.fn(async () => []),
      hasRole: vi.fn(async () => false),
      findRoleId: vi.fn(async () => 7),
      assignRole: vi.fn(async () => undefined),
      getEmailDomain: vi.fn(async () => null),
      setEmailDomain: vi.fn(async () => undefined),
    },
    scopes: { getOrgId: vi.fn(async () => 1), setOrgId: vi.fn(async () => undefined) },
    classes: { countByOrg: vi.fn(async () => 2), findProfessorCount: vi.fn(async () => 1) },
    members: {
      countStudentsByOrg: vi.fn(async () => 4),
      professorUserIds: vi.fn(async () => []),
      assignedClassIds: vi.fn(async () => []),
      findActiveStudentClass: vi.fn(async () => null),
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
  const scopes = { getOrgId: vi.fn(async (userId: number) => (userId === 9 ? 1 : null)), setOrgId: vi.fn(async () => undefined) };
  const members = {
    isActiveMember: vi.fn(async () => false),
    isProfessorOf: vi.fn(async () => false),
    assignedClassIds: vi.fn(async () => []),
    professorUserIds: vi.fn(async () => []),
    countStudentsByOrg: vi.fn(async () => 0),
    upsertProfessor: vi.fn(async () => undefined),
    insertStudent: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    roster: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })),
    findActiveStudentClass: vi.fn(async () => null),
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
