import { AUDIT_ACTIONS } from '../../../shared/constants';
import { NotFoundError } from '../../../shared/errors';
import { emailAdapter } from '../../../features/notifications';
import type {
  EmailTemplateDto,
  EmailTemplatePreviewDto,
} from '../dto/operations.dto';
import type { IOperationsRepository } from '../repositories/operations.repository';
import { operationsRepository } from '../repositories/operations.repository';
import type { AuditLogService } from '../../../features/admin/services/audit-log.service';
import { auditLogService } from '../../../features/admin/services/audit-log.service';

/** Identity of the platform admin performing a mutation (for audit rows). */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * F8 §07 email template management (OPS-35..37).
 *
 * - Updates are audit-logged (AUDIT_ACTIONS.UPDATE_EMAIL_TEMPLATE).
 * - Preview renders the template with sample placeholder values through the
 *   shared EmailAdapter renderer (no SMTP dispatch).
 */
export interface EmailTemplateServiceDeps {
  repo: Pick<
    IOperationsRepository,
    'listEmailTemplates' | 'findEmailTemplateById' | 'updateEmailTemplate'
  >;
  audit: Pick<AuditLogService, 'record'>;
}

function defaultDeps(): EmailTemplateServiceDeps {
  return { repo: operationsRepository, audit: auditLogService };
}

function toDto(row: {
  templateId: number;
  templateKey: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  placeholders: string[] | null;
  isActive: boolean;
  updatedAt: Date;
}): EmailTemplateDto {
  return {
    templateId: row.templateId,
    templateKey: row.templateKey,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    placeholders: row.placeholders,
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class EmailTemplateService {
  constructor(private readonly deps: EmailTemplateServiceDeps = defaultDeps()) {}

  /** OPS-35: list all templates. */
  async list(): Promise<EmailTemplateDto[]> {
    const rows = await this.deps.repo.listEmailTemplates();
    return rows.map(toDto);
  }

  /** OPS-36: update a template (subject, body, active flag). */
  async update(
    actor: AdminActor,
    templateId: number,
    patch: { subject?: string; bodyHtml?: string; bodyText?: string; isActive?: boolean },
  ): Promise<EmailTemplateDto> {
    const existing = await this.deps.repo.findEmailTemplateById(templateId);
    if (!existing) {
      throw new NotFoundError('Email template not found.');
    }

    await this.deps.repo.updateEmailTemplate(templateId, patch);

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UPDATE_EMAIL_TEMPLATE,
      targetType: 'email_template',
      targetId: templateId,
      changes: { before: { subject: existing.subject }, after: { subject: patch.subject ?? existing.subject } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = await this.deps.repo.findEmailTemplateById(templateId);
    if (!updated) {
      throw new NotFoundError('Email template not found.');
    }
    return toDto(updated);
  }

  /** OPS-37: render a template with sample placeholder values. */
  async preview(templateId: number): Promise<EmailTemplatePreviewDto> {
    const template = await this.deps.repo.findEmailTemplateById(templateId);
    if (!template) {
      throw new NotFoundError('Email template not found.');
    }

    const samples: Record<string, string> = {
      appName: 'DevOpsMentOr',
      userName: 'Alex Learner',
      otpCode: '123456',
      inviteUrl: 'https://app.devopsmentor.io/invite/accept',
      message: 'This is a sample message.',
      linkUrl: 'https://app.devopsmentor.io',
      eventTitle: 'Sample Webinar',
      announcementTitle: 'Sample Announcement',
    };
    for (const key of template.placeholders ?? []) {
      const name = key.replace(/[{}]/g, '');
      if (!(name in samples)) {
        samples[name] = `sample_${name}`;
      }
    }

    const rendered = emailAdapter.render(
      {
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
      },
      samples,
    );

    return {
      templateId: template.templateId,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
    };
  }
}

export const emailTemplateService = new EmailTemplateService();