import { eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { emailTemplates } from '../../../app/database/schema';
import { env } from '../../../app/config';
import { emailService } from '../../../shared/services';
import { logger } from '../../../shared/logger';

/**
 * F8 §08 transactional email adapter.
 *
 * Renders an `email_templates` row with placeholder substitution and
 * dispatches it through the centralized email service. Templates with
 * `is_active = FALSE` are silently skipped (invariant 13). Provider
 * configuration comes exclusively from `.env` via the shared service.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string | null;
}

export interface EmailAdapterDeps {
  findTemplate(templateKey: string): Promise<
    | {
        templateKey: string;
        name: string;
        subject: string;
        bodyHtml: string;
        bodyText: string | null;
        placeholders: string[] | null;
        isActive: boolean;
      }
    | undefined
  >;
}

function defaultDeps(): EmailAdapterDeps {
  return {
    async findTemplate(templateKey: string) {
      const rows = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.templateKey, templateKey))
        .limit(1);
      return rows[0];
    },
  };
}

export class EmailAdapter {
  constructor(private readonly deps: EmailAdapterDeps = defaultDeps()) {}

  /**
   * Renders the template with the provided placeholder values. Only keys
   * declared in `placeholders` are substituted; unmatched `{{...}}` tokens
   * are left untouched so previews never crash.
   */
  render(template: { subject: string; bodyHtml: string; bodyText: string | null }, values: Record<string, string>): RenderedEmail {
    const substitute = (source: string): string =>
      source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        const value = values[key];
        return value === undefined ? match : value;
      });

    return {
      subject: substitute(template.subject),
      html: substitute(template.bodyHtml),
      text: template.bodyText === null ? null : substitute(template.bodyText),
    };
  }

  /**
   * Dispatch hook consumed by NotificationService. Resolves the recipient
   * email from the `users` row, renders the active template and sends.
   */
  async dispatch(
    templateKey: string,
    to: string,
    recipientName: string,
    values: Record<string, string>,
  ): Promise<boolean> {
    const template = await this.deps.findTemplate(templateKey);
    if (!template || !template.isActive) {
      logger.info({ templateKey }, 'Email template missing or inactive - dispatch skipped');
      return false;
    }

    const rendered = this.render(
      { subject: template.subject, bodyHtml: template.bodyHtml, bodyText: template.bodyText },
      { appName: env.APP_NAME, userName: recipientName, ...values },
    );

    await emailService.sendEmail(to, rendered.subject, rendered.html, rendered.text);
    return true;
  }
}

export const emailAdapter = new EmailAdapter();