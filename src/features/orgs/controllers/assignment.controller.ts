import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { OrgActor } from '../dto/org.dto';
import { assignmentService } from '../services/assignment.service';
import { courseAccessService } from '../services/course-access.service';

function actorFrom(req: Request): OrgActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    roles: req.user?.roles ?? [],
  };
}

/** Cohort course assignments + student course access (chaos sprint). */
export class AssignmentController {
  async listForClass(req: Request, res: Response): Promise<Response> {
    const assignments = await assignmentService.listForClass(
      actorFrom(req),
      Number(req.params.classId),
    );
    return sendSuccess(res, assignments, 'Class assignments retrieved successfully.');
  }

  async create(req: Request, res: Response): Promise<Response> {
    const assignment = await assignmentService.create(
      actorFrom(req),
      Number(req.params.classId),
      req.body,
    );
    return sendSuccess(
      res,
      assignment,
      'Course assigned to cohort successfully.',
      HTTP_STATUS.CREATED,
    );
  }

  async update(req: Request, res: Response): Promise<Response> {
    const assignment = await assignmentService.update(
      actorFrom(req),
      Number(req.params.classId),
      Number(req.params.assignmentId),
      req.body,
    );
    return sendSuccess(res, assignment, 'Assignment updated successfully.');
  }

  async remove(req: Request, res: Response): Promise<Response> {
    await assignmentService.delete(
      actorFrom(req),
      Number(req.params.classId),
      Number(req.params.assignmentId),
    );
    return sendSuccess(res, null, 'Assignment removed successfully.');
  }

  async listMine(req: Request, res: Response): Promise<Response> {
    const assignments = await assignmentService.listForStudent(Number(req.user?.sub));
    return sendSuccess(res, assignments, 'Your assignments retrieved successfully.');
  }

  async getCourseAccess(req: Request, res: Response): Promise<Response> {
    const access = await courseAccessService.getCourseAccess(
      actorFrom(req),
      Number(req.params.courseId),
    );
    return sendSuccess(res, access, 'Course access evaluated successfully.');
  }
}

export const assignmentController = new AssignmentController();
