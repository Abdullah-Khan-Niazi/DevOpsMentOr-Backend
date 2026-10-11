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

  private isConfigured(): boolean {
    const hasGoogleOAuth = Boolean(
      env.GOOGLE_MAIL_REFRESH_TOKEN && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
    );
    return hasGoogleOAuth || Boolean(env.SMTP_HOST);
  }

  private ensureTransport(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    // Google OAuth2 transport (bypasses blocked SMTP ports via HTTPS token exchange)
    if (env.GOOGLE_MAIL_REFRESH_TOKEN && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: env.GMAIL_USER || env.SMTP_USER,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          refreshToken: env.GOOGLE_MAIL_REFRESH_TOKEN,
        },
      });
      return this.transporter;
    }

    // Standard SMTP transport
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

    if (!this.isConfigured()) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Email service is not configured; email delivery is unavailable.');
      }

      logger.info(
        { to, purpose, code, ttlMinutes: env.OTP_TTL_MINUTES },
        'Email service not configured (development) - OTP delivered via log',
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
   * F3 invitation dispatch. Same fallback policy as OTP emails:
   * dev logs the invite link, production requires configured email transport.
   * The invite URL always points at the frontend accept screen (SCR-F3-08).
   */
  async sendInvitationEmail(to: string, inviteUrl: string, inviteCode?: string): Promise<void> {
    const code = inviteCode ?? (new URL(inviteUrl).searchParams.get('token') || '');
    const gatewayUrl = `${env.FRONTEND_URL}/enroll/accept`;

    if (!this.isConfigured()) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Email service is not configured; email delivery is unavailable.');
      }

      logger.info(
        { to, inviteUrl, inviteCode: code, gatewayUrl },
        'Email service not configured (development) - invitation delivered via log',
      );
      return;
    }

    const transporter = this.ensureTransport();
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `You have been invited to join ${env.APP_NAME}`,
      text:
        `You have been invited to join ${env.APP_NAME}.\n\n` +
        `Join by clicking this link:\n${inviteUrl}\n\n` +
        `Or join by entering your invitation code directly:\n${code}\n` +
        `at: ${gatewayUrl}\n\n` +
        `This invitation expires in ${env.INVITE_TTL_HOURS} hours.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #111;">You're invited to join ${env.APP_NAME}</h2>
          <p>You have been invited to join an organization on ${env.APP_NAME}. You can get started right away using either option below:</p>
          <div style="margin: 24px 0;">
            <a href="${inviteUrl}" style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
              Join by clicking this link
            </a>
          </div>
          <p style="margin-top: 24px; color: #555;">Or enter your invitation code directly:</p>
          <div style="background-color: #f3f4f6; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 16px; font-weight: bold; letter-spacing: 1px; color: #111;">
            ${code}
          </div>
          <p style="margin-top: 12px; font-size: 14px; color: #666;">
            Enter this code at <a href="${gatewayUrl}">${gatewayUrl}</a>.
          </p>
          <p style="margin-top: 24px; font-size: 12px; color: #888;">
            This invitation expires in ${env.INVITE_TTL_HOURS} hours.
          </p>
        </div>
      `,
    });
  }

  /**
   * F8 transactional dispatch used by the notification email adapter.
   * Same fallback policy: development logs the message, production
   * requires email configuration.
   */
  async sendEmail(to: string, subject: string, html: string, text: string | null): Promise<void> {
    if (!this.isConfigured()) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Email service is not configured; email delivery is unavailable.');
      }

      logger.info(
        { to, subject, text: text?.slice(0, 500) },
        'Email service not configured (development) - transactional email delivered via log',
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