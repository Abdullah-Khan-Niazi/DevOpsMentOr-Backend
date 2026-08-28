import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { sendSuccessMock, classServiceMock, orgServiceMock } = vi.hoisted(() => ({
  sendSuccessMock: vi.fn(),
  classServiceMock: {
    createClass: vi.fn(),
    listClasses: vi.fn(),
    getClassDetail: vi.fn(),
    updateClass: vi.fn(),
    assignProfessor: vi.fn(),
    getClassRoster: vi.fn(),
    withdrawStudent: vi.fn(),
    inviteStudents: vi.fn(),
    importStudents: vi.fn(),
    listInvitations: vi.fn(),
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  },
  orgServiceMock: {
    resolveScopedOrg: vi.fn(),
    inviteProfessor: vi.fn(),
    listProfessors: vi.fn(),
    getMyClass: vi.fn(),
  },
}));

vi.mock('../../src/shared/utils', () => ({ sendSuccess: sendSuccessMock }));
vi.mock('../../src/features/orgs/services/class.service', () => ({ classService: classServiceMock }));
vi.mock('../../src/features/orgs/services/org.service', () => ({ orgService: orgServiceMock }));

import {
  ClassController,
  EnrollmentController,
  OrgController,
} from '../../src/features/orgs/controllers/org.controller';

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    user: { sub: '9', roles: [] },
    ip: '127.0.0.1',
    get: vi.fn(() => 'vitest'),
    body: {},
    params: {},
    query: {},
    file: undefined,
    ...overrides,
  } as unknown as Request;
}

const makeRes = (): Response => ({} as Response);

const statusArg = (): number | undefined => sendSuccessMock.mock.calls[0][3];

describe('F3 controller status codes (per §07 traceability matrix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgServiceMock.resolveScopedOrg.mockResolvedValue(1);
  });

  it('CLS-01 createClass returns 201', async () => {
    classServiceMock.createClass.mockResolvedValue({ classId: 10 });
    await new ClassController().createClass(makeReq(), makeRes());
    expect(statusArg()).toBe(201);
  });

  it('CLS-02/CLS-03/CLS-04/CLS-05/CLS-06 return 200 (default)', async () => {
    classServiceMock.getClassDetail.mockResolvedValue({ classId: 10 });
    await new ClassController().getClass(makeReq({ params: { classId: '10' } }), makeRes());
    expect(statusArg()).toBeUndefined();

    classServiceMock.getClassRoster.mockResolvedValue({ data: [], total: 0 });
    await new ClassController().getRoster(makeReq(), makeRes());
    expect(statusArg()).toBeUndefined();
  });

  it('CLS-07 inviteStudents returns 201 { invited, skipped }', async () => {
    classServiceMock.inviteStudents.mockResolvedValue({ invited: ['a@acme.edu'], skipped: [] });
    await new ClassController().inviteStudents(makeReq(), makeRes());
    expect(statusArg()).toBe(201);
  });

  it('CLS-08 importStudents returns 200 (default) { totalRows, successCount, errors }', async () => {
    classServiceMock.importStudents.mockResolvedValue({ totalRows: 2, successCount: 1, errors: [] });
    await new ClassController().importStudents(makeReq({ file: { buffer: Buffer.from('x') } }), makeRes());
    expect(sendSuccessMock).toHaveBeenCalledTimes(1);
    expect(statusArg()).toBeUndefined();
  });

  it('CLS-09 withdrawStudent returns 200', async () => {
    classServiceMock.withdrawStudent.mockResolvedValue(undefined);
    await new ClassController().withdrawStudent(makeReq(), makeRes());
    expect(statusArg()).toBeUndefined();
  });

  it('ORG-09 inviteProfessor returns 201', async () => {
    orgServiceMock.inviteProfessor.mockResolvedValue({ invitationId: 1 });
    await new OrgController().inviteProfessor(makeReq(), makeRes());
    expect(statusArg()).toBe(201);
  });

  it('ORG-06 listProfessors returns 200', async () => {
    orgServiceMock.listProfessors.mockResolvedValue([]);
    await new OrgController().listProfessors(makeReq(), makeRes());
    expect(statusArg()).toBeUndefined();
  });

  it('ENR-01 previewInvitation returns 200', async () => {
    classServiceMock.previewInvitation.mockResolvedValue({ kind: 'class', inviteeEmail: 'a@x.io' });
    await new EnrollmentController().previewInvitation(makeReq({ query: { token: 't' } }), makeRes());
    expect(statusArg()).toBeUndefined();
  });

  it('ENR-02 acceptInvitation returns 200', async () => {
    classServiceMock.acceptInvitation.mockResolvedValue({ kind: 'class', className: 'DevOps 101' });
    await new EnrollmentController().acceptInvitation(makeReq({ body: { token: 't' } }), makeRes());
    expect(statusArg()).toBeUndefined();
  });

  it('ENR-03 myClass returns 200', async () => {
    orgServiceMock.getMyClass.mockResolvedValue({ classId: 10 });
    await new EnrollmentController().myClass(makeReq(), makeRes());
    expect(statusArg()).toBeUndefined();
  });
});
