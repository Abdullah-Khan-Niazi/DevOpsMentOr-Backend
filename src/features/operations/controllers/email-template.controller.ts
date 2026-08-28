import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor, EmailTemplateService } from '../services/email-template.service';
import { emailTemplateService } from '../services/email-template.service';

/** F8 §07 email template HTTP handlers (OPS-35..37). */
export class EmailTemplateController {
  constructor(private readonly service: EmailTemplateService = emailTemplateService) {}

  private actor(req: Request): AdminActor {
    return {
      userId: Number(req.user?.sub),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  /** OPS-35: list all templates. */
  async list(_req: Request, res: Response): Promise<Response> {
    const templates = await this.service.list();
    return sendSuccess(res, templates, 'Email templates retrieved successfully.');
  }

  /** OPS-36: update a template. */
  async update(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      isActive?: boolean;
    };
    const template = await this.service.update(this.actor(req), Number(req.params.id), {
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      bodyText: body.bodyText,
      isActive: body.isActive,
    });
    return sendSuccess(res, template, 'Email template updated successfully.');
  }

  /** OPS-37: preview a template with sample values. */
  async preview(req: Request, res: Response): Promise<Response> {
    const preview = await this.service.preview(Number(req.params.id));
    return sendSuccess(res, preview, 'Email template preview generated.');
  }
}

export const emailTemplateController = new EmailTemplateController();