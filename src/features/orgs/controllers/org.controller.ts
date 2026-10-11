import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { OrgActor } from '../dto/org.dto';
import { classService } from '../services/class.service';
import { orgService } from '../services/org.service';

function actorFrom(req: Request): OrgActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

const userIdFrom = (req: Request): number => Number(req.user?.sub);
const toBoolean = (value: unknown): boolean => value === 'true';

export class OrgController {
  async createOrg(req: Request, res: Response): Promise<Response> {
    const org = await orgService.createOrg(actorFrom(req), req.body);
    return sendSuccess(res, org, 'Organization created successfully.', HTTP_STATUS.CREATED);
  }

  async listOrgs(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; pageSize: number; search?: string };
    const result = await orgService.listOrgsAdmin(query.page, query.pageSize, query.search);
    return sendSuccess(res, result, 'Organizations retrieved successfully.');
  }

  async getOrg(req: Request, res: Response): Promise<Response> {
    const detail = await orgService.getOrgAdminDetail(Number(req.params.orgId));
    return sendSuccess(res, detail, 'Organization retrieved successfully.');
  }

  async updateOrg(req: Request, res: Response): Promise<Response> {
    const org = await orgService.updateOrg(actorFrom(req), Number(req.params.orgId), req.body);
    return sendSuccess(res, org, 'Organization updated successfully.');
  }

  async assignOrgAdmin(req: Request, res: Response): Promise<Response> {
    const detail = await orgService.assignOrgAdmin(
      actorFrom(req),
      Number(req.params.orgId),
      Number(req.body.userId),
    );
    return sendSuccess(res, detail, 'Organization admin assigned successfully.');
  }

  async getMyOrg(req: Request, res: Response): Promise<Response> {
    const org = await orgService.getMyOrg(userIdFrom(req));
    return sendSuccess(res, org, 'Organization retrieved successfully.');
  }

  async updateMyOrg(req: Request, res: Response): Promise<Response> {
    const org = await orgService.updateMyOrg(actorFrom(req), userIdFrom(req), req.body);
    return sendSuccess(res, org, 'Organization updated successfully.');
  }

  async setEmailDomain(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const result = await orgService.setEmailDomain(actorFrom(req), orgId, req.body.domain);
    return sendSuccess(res, result, 'Email domain updated successfully.');
  }

  async inviteProfessor(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const invitation = await orgService.inviteProfessor(actorFrom(req), orgId, req.body.email);
    return sendSuccess(res, invitation, 'Professor invited successfully.', HTTP_STATUS.CREATED);
  }

  async listProfessors(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const professors = await orgService.listProfessors(orgId);
    return sendSuccess(res, professors, 'Professors retrieved successfully.');
  }

  async listInvitations(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; pageSize: number };
    const result = await classService.listInvitations(
      Number(req.params.classId),
      query.page,
      query.pageSize,
    );
    return sendSuccess(res, result, 'Invitations retrieved successfully.');
  }

  async listAdminClasses(req: Request, res: Response): Promise<Response> {
    const orgId = Number(req.params.orgId);
    const query = req.query as unknown as { page?: number; pageSize?: number };
    const result = await classService.listClasses(
      orgId,
      query.page ? Number(query.page) : 1,
      query.pageSize ? Number(query.pageSize) : 50,
    );
    return sendSuccess(res, result, 'Classes retrieved successfully.');
  }

  async getAdminClassDetail(req: Request, res: Response): Promise<Response> {
    const orgId = Number(req.params.orgId);
    const classId = Number(req.params.classId);
    const detail = await orgService.getAdminClassDetail(orgId, classId);
    return sendSuccess(res, detail, 'Class details retrieved successfully.');
  }

  async getOrgAnalytics(req: Request, res: Response): Promise<Response> {
    const orgId = Number(req.params.orgId);
    const analytics = await orgService.getOrgAnalytics(orgId);
    return sendSuccess(res, analytics, 'Organization analytics retrieved successfully.');
  }

  async inviteOrgAdmin(req: Request, res: Response): Promise<Response> {
    const orgId = Number(req.params.orgId);
    const result = await orgService.inviteOrgAdmin(actorFrom(req), orgId, req.body.email ?? req.body.userId);
    return sendSuccess(res, result, 'Admin invitation dispatched successfully.', HTTP_STATUS.CREATED);
  }

  async acceptOrgAdmin(req: Request, res: Response): Promise<Response> {
    const token = req.body?.token ?? req.query?.token;
    const detail = await orgService.acceptOrgAdmin(userIdFrom(req), String(token));
    return sendSuccess(res, detail, 'Organization admin role accepted successfully.');
  }

  async listOrgUsers(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const members = await orgService.listOrgUsers(actorFrom(req), orgId);
    return sendSuccess(res, members, 'Organization members retrieved successfully.');
  }

  async getOrgUserDetail(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const detail = await orgService.getOrgUserDetail(actorFrom(req), orgId, Number(req.params.userId));
    return sendSuccess(res, detail, 'Organization member detail retrieved successfully.');
  }

  async getMyOrgAnalytics(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const analytics = await orgService.getOrgAnalytics(orgId);
    return sendSuccess(res, analytics, 'Organization analytics retrieved successfully.');
  }
}

export class ClassController {
  async createClass(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const cls = await classService.createClass(actorFrom(req), orgId, req.body);
    return sendSuccess(res, cls, 'Class created successfully.', HTTP_STATUS.CREATED);
  }

  async listClasses(req: Request, res: Response): Promise<Response> {
    const orgId = await orgService.resolveScopedOrg(userIdFrom(req));
    const query = req.query as unknown as { page: number; pageSize: number };
    const result = await classService.listClasses(orgId, query.page, query.pageSize);
    return sendSuccess(res, result, 'Classes retrieved successfully.');
  }

  async getClass(req: Request, res: Response): Promise<Response> {
    const cls = await classService.getClassDetail(Number(req.params.classId));
    return sendSuccess(res, cls, 'Class retrieved successfully.');
  }

  async updateClass(req: Request, res: Response): Promise<Response> {
    const cls = await classService.updateClass(actorFrom(req), Number(req.params.classId), req.body);
    return sendSuccess(res, cls, 'Class updated successfully.');
  }

  async assignProfessor(req: Request, res: Response): Promise<Response> {
    const cls = await classService.assignProfessor(
      actorFrom(req),
      Number(req.params.classId),
      Number(req.body.professorUserId),
    );
    return sendSuccess(res, cls, 'Professor assigned successfully.');
  }

  async getRoster(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; pageSize: number; includeInactive?: string };
    const roster = await classService.getClassRoster(
      Number(req.params.classId),
      query.page,
      query.pageSize,
      toBoolean(query.includeInactive),
    );
    return sendSuccess(res, roster, 'Roster retrieved successfully.');
  }

  async withdrawStudent(req: Request, res: Response): Promise<Response> {
    await classService.withdrawStudent(
      actorFrom(req),
      Number(req.params.classId),
      Number(req.params.userId),
    );
    return sendSuccess(res, null, 'Student removed from class.');
  }

  async inviteStudents(req: Request, res: Response): Promise<Response> {
    const result = await classService.inviteStudents(
      actorFrom(req),
      Number(req.params.classId),
      req.body.emails,
    );
    return sendSuccess(res, result, 'Student invitations processed.', HTTP_STATUS.CREATED);
  }

  async resendInvitation(req: Request, res: Response): Promise<Response> {
    const result = await classService.resendInvitation(
      actorFrom(req),
      Number(req.params.classId),
      Number(req.params.invitationId),
    );
    return sendSuccess(res, result, 'Invitation resent successfully.');
  }

  async importStudents(req: Request, res: Response): Promise<Response> {
    const result = await classService.importStudents(
      actorFrom(req),
      Number(req.params.classId),
      req.file as Express.Multer.File,
    );
    return sendSuccess(res, result, 'Student import completed.');
  }
}

export class EnrollmentController {
  async previewInvitation(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { token: string };
    const preview = await classService.previewInvitation(query.token);
    return sendSuccess(res, preview, 'Invitation retrieved successfully.');
  }

  async acceptInvitation(req: Request, res: Response): Promise<Response> {
    const result = await classService.acceptInvitation(userIdFrom(req), req.body.token);
    return sendSuccess(res, result, 'Invitation accepted successfully.');
  }

  async myClass(req: Request, res: Response): Promise<Response> {
    const cls = await orgService.getMyClass(userIdFrom(req));
    return sendSuccess(res, cls, 'Enrollment retrieved successfully.');
  }
}

export const orgController = new OrgController();
export const classController = new ClassController();
export const enrollmentController = new EnrollmentController();