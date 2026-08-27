import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../app/config/env';
import { logger } from '../logger';

/**
 * Centralized email dispatch.
 *
 * SMTP credentials come exclusively from the environment. In development,
 * when SMTP_HOST is unset, required messages (e.g. OTP codes) are emitted
 * through the structured Pino logger so flows remain testable offline.
 * Production refuses to send when SMTP is not configured.
 */
export class EmailService {
  private transporter: Transporter | null = null;

  private ensureTransport(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    });

    return this.transporter;
  }

  async sendOtpEmail(to: string, code: string, purpose: string): Promise<void> {
    const subject = `Your ${env.APP_NAME} ${purpose} code`;

    if (!env.SMTP_HOST) {
      if (env.NODE_ENV === 'production') {
        throw new Error('SMTP_HOST is not configured; email delivery is unavailable.');
      }

      logger.info(
        { to, purpose, code, ttlMinutes: env.OTP_TTL_MINUTES },
        'SMTP not configured (development) - OTP delivered via log',
      );
      return;
    }

    const transporter = this.ensureTransport();
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      text: `Your ${env.APP_NAME} ${purpose} code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. If you did not request this, you can safely ignore this email.`,
    });
  }

  /**
   * F3 invitation dispatch. Same SMTP fallback policy as OTP emails:
   * dev logs the invite link, production requires SMTP. The invite URL
   * always points at the frontend accept screen (SCR-F3-08).
   */
  async sendInvitationEmail(to: string, inviteUrl: string): Promise<void> {
    if (!env.SMTP_HOST) {
      if (env.NODE_ENV === 'production') {
        throw new Error('SMTP_HOST is not configured; email delivery is unavailable.');
      }

      logger.info({ to, inviteUrl }, 'SMTP not configured (development) - invitation delivered via log');
      return;
    }

    const transporter = this.ensureTransport();
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `You have been invited to join ${env.APP_NAME}`,
      text: `Accept your invitation here: ${inviteUrl}`,
    });
  }

  /**
   * F8 transactional dispatch used by the notification email adapter.
   * Same SMTP fallback policy: development logs the message, production
   * requires SMTP configuration.
   */
  async sendEmail(to: string, subject: string, html: string, text: string | null): Promise<void> {
    if (!env.SMTP_HOST) {
      if (env.NODE_ENV === 'production') {
        throw new Error('SMTP_HOST is not configured; email delivery is unavailable.');
      }

      logger.info(
        { to, subject, text: text?.slice(0, 500) },
        'SMTP not configured (development) - transactional email delivered via log',
      );
      return;
    }

    const transporter = this.ensureTransport();
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
      text: text ?? undefined,
    });
  }
}

export const emailService = new EmailService();