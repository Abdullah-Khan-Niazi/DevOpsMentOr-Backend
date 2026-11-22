import { eq, sql } from 'drizzle-orm';
import { randomBytes, randomInt } from 'crypto';
import {
  BadRequestError,
  ConflictError,
  ERROR_CODES,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors';
import {
  passwordService,
  tokenService,
  emailService,
  totpService,
  revocationService,
} from '../../../shared/services';
import { ROLES, UserStatus, getUserStatus } from '../../../shared/constants';
import { env } from '../../../app/config/env';
import { db, users } from '../../../app/database';
import { countries, userProfiles } from '../../../app/database/schema';
import { logger } from '../../../shared/logger';

import type {
  AdminLoginDto,
  AuthResponseDto,
  Disable2faDto,
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  LoginHistoryEntryDto,
  IssuedAuthTokensDto,
  MeResponseDto,
  MessageResponseDto,
  OAuthCompleteDto,
  OAuthLoginDto,
  OAuthLoginResultDto,
  OAuthSignupDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationDto,
  SetPasswordDto,
  TwoFactorSetupDto,
  Verify2faDto,
  VerifyEmailDto,
} from '../dto/auth.dto';

import type { IUserRepository } from '../../users/repositories/user.repository';
import { userRepository } from '../../users/repositories/user.repository';
import { UserService, userService } from '../../users/services/user.service';

import type { IRoleRepository } from '../../roles/repositories/role.repository';
import { roleRepository } from '../../roles/repositories/role.repository';

import type { ISessionRepository } from '../repositories/session.repository';
import { sessionRepository } from '../repositories/session.repository';

import type { IOtpRepository } from '../repositories/otp.repository';
import { otpRepository } from '../repositories/otp.repository';

import type { ILoginHistoryRepository } from '../repositories/login-history.repository';
import { loginHistoryRepository } from '../repositories/login-history.repository';

import { oauthService } from './oauth.service';
import { createPendingOAuth, consumePendingOAuth } from '../repositories/oauth-pending.repository';
import { orgService } from '../../orgs/services/org.service';
import { classService } from '../../orgs/services/class.service';
import { invitationRepository } from '../../orgs/repositories/invitation.repository';
import type { OrgActor } from '../../orgs/dto/org.dto';
import type { JwtPayload } from '../../../shared/types';
import type { UserWithRoles } from '../../users/types';

const OTP_CODE_LENGTH = 6;
/** Wrong-code submissions tolerated for a single OTP before it is invalidated. */
const OTP_MAX_ATTEMPTS = 5;
/** Fallback access-token lifetime when JWT_ACCESS_EXPIRES_IN is not a `<n><s|m|h|d>` value. */
const DEFAULT_ACCESS_TTL_SECONDS = 900;

export class AuthService {
  constructor(
    private readonly usersRepo: IUserRepository = userRepository,
    private readonly userSvc: UserService = userService,
    private readonly roles: IRoleRepository = roleRepository,
    private readonly sessionsRepo: ISessionRepository = sessionRepository,
    private readonly otps: IOtpRepository = otpRepository,
    private readonly loginHistoryRepo: ILoginHistoryRepository = loginHistoryRepository,
  ) {}

  async register(
    input: RegisterDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MessageResponseDto> {
    const existingEmail = await this.usersRepo.findByEmail(input.email);
    if (existingEmail) {
      if (!existingEmail.isVerified) {
        // Edge case: unverified user abandoned OTP verification screen and came back to sign up again.
        // Update password hash, record origin country, and re-send fresh OTP without 409 conflict error.
        const passwordHash = await passwordService.hash(input.password);
        const salt = randomBytes(16).toString('hex');
        await db
          .update(users)
          .set({ passwordHash, salt, fullName: input.fullName, updatedAt: new Date() })
          .where(eq(users.userId, existingEmail.userId));

        await this.recordCountryOrigin(existingEmail.userId, input.countryCode);
        await this.issueAndSendVerification(existingEmail.userId, existingEmail.email);

        logger.info(
          { userId: existingEmail.userId },
          'Unverified user re-submitted registration; fresh verification OTP issued',
        );
        return {
          message:
            'An unverified account with this email was found. A fresh verification code has been sent to your email.',
        };
      }
      throw new ConflictError('A user with this email already exists.');
    }

    const existingUsername = await this.usersRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const passwordHash = await passwordService.hash(input.password);
    const salt = randomBytes(16).toString('hex');

    if (input.accountType === 'organization') {
      return this.registerOrganization(input, passwordHash, salt, meta);
    }

    if (input.accountType === 'member') {
      return this.registerMember(input, passwordHash, salt);
    }

    return this.registerIndividual(input, passwordHash, salt);
  }

  private async registerIndividual(
    input: Extract<RegisterDto, { accountType: 'individual' }>,
    passwordHash: string,
    salt: string,
  ): Promise<MessageResponseDto> {
    const defaultRole = await this.roles.findByName(ROLES.INDIVIDUAL_LEARNER);
    if (!defaultRole) {
      throw new Error('individual_learner role is not seeded.');
    }

    const user = await this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt,
      fullName: input.fullName,
      roleIds: [defaultRole.id],
    });

    await this.recordCountryOrigin(user.userId, input.countryCode);
    await this.issueAndSendVerification(user.userId, input.email);

    logger.info({ userId: user.userId }, 'Individual user registered; verification OTP issued');
    return { message: 'Registration successful. Please verify your email.' };
  }

  private async registerOrganization(
    input: Extract<RegisterDto, { accountType: 'organization' }>,
    passwordHash: string,
    salt: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MessageResponseDto> {
    const user = await this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt,
      fullName: input.fullName,
      roleIds: [],
    });

    await this.recordCountryOrigin(user.userId, input.countryCode);

    const actor: OrgActor = {
      userId: user.userId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    };

    const organization = await orgService.createOrg(actor, {
      name: input.organization.name,
      slug: input.organization.slug,
      description: input.organization.description,
      website: input.organization.website || undefined,
      industry: input.organization.industry,
      billingEmail: input.organization.billingEmail,
    });

    await orgService.assignOrgAdmin(actor, organization.organizationId, user.userId);

    await this.issueAndSendVerification(user.userId, input.email);

    logger.info(
      { userId: user.userId, organizationId: organization.organizationId },
      'Organization admin registered; org created, verification OTP issued',
    );
    return {
      message: 'Registration successful. Your organization has been created. Please verify your email.',
    };
  }

  private async registerMember(
    input: Extract<RegisterDto, { accountType: 'member' }>,
    passwordHash: string,
    salt: string,
  ): Promise<MessageResponseDto> {
    const invite = await invitationRepository.findByToken(input.invitationCode);
    if (!invite) {
      throw new BadRequestError('INVALID_INVITATION: this invitation code is not valid.');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestError('INVITE_ALREADY_USED: this invitation has already been used.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError('INVITE_EXPIRED: this invitation has expired.');
    }
    if (invite.inviteeEmail.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
      throw new ForbiddenError('This invitation was issued to a different email address.');
    }

    const user = await this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt,
      fullName: input.fullName,
      roleIds: [],
    });

    await db.update(users).set({ isVerified: true, updatedAt: new Date() }).where(eq(users.userId, user.userId));
    await this.recordCountryOrigin(user.userId, input.countryCode);
    const accepted = await classService.acceptInvitation(user.userId, input.invitationCode);

    logger.info(
      { userId: user.userId, kind: accepted.kind, organization: accepted.organizationName },
      'Member registered via invitation; email auto-verified via secure invitation token',
    );
    return {
      message: 'Registration successful! You have been enrolled in the organization. You can now sign in.',
    };
  }

  private async recordCountryOrigin(userId: number, countryCode?: string | null): Promise<void> {
    if (!countryCode) return;
    try {
      const codeUpper = countryCode.toUpperCase().trim();
      const [matched] = await db
        .select({ countryId: countries.countryId })
        .from(countries)
        .where(eq(sql`LOWER(${countries.countryCode})`, codeUpper.toLowerCase()))
        .limit(1);

      let countryIdToUse = matched?.countryId;
      if (!countryIdToUse) {
        let countryName = codeUpper;
        try {
          const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
          countryName = regionNames.of(codeUpper) || codeUpper;
        } catch {
          countryName = codeUpper;
        }
        const [inserted] = await db.insert(countries).values({
          countryCode: codeUpper,
          countryName,
          iso3Code: codeUpper.length === 2 ? codeUpper : undefined,
        });
        countryIdToUse = inserted.insertId;
      }

      if (countryIdToUse) {
        const existing = await db.query.userProfiles.findFirst({
          where: eq(userProfiles.userId, userId),
        });
        if (existing) {
          await db
            .update(userProfiles)
            .set({ countryId: countryIdToUse })
            .where(eq(userProfiles.userId, userId));
        } else {
          await db.insert(userProfiles).values({
            userId,
            countryId: countryIdToUse,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, userId, countryCode }, 'Could not record country of origin during signup');
    }
  }

  private async issueAndSendVerification(userId: number, email: string): Promise<void> {
    const otpCode = await this.issueOtp(userId, 'email_verification');
    await emailService.sendOtpEmail(email, otpCode, 'email verification');
  }

  async verifyEmail(
    input: VerifyEmailDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      throw new BadRequestError('Invalid email or code.');
    }

    if (user.isVerified) {
      throw new BadRequestError('This email is already verified.');
    }

    await this.consumeOtp(user.userId, 'email_verification', input.code);

    await db
      .update(users)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(users.userId, user.userId));

    logger.info({ userId: user.userId }, 'Email verified');

    const tokens = await this.createSession(user, 'email', meta, true);

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  async resendVerification(input: ResendVerificationDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      throw new BadRequestError('Invalid email address.');
    }

    if (user.isVerified) {
      throw new BadRequestError('This email is already verified.');
    }

    const otpCode = await this.issueOtp(user.userId, 'email_verification');
    await emailService.sendOtpEmail(input.email, otpCode, 'email verification');

    return { message: 'A fresh verification code has been sent to your email.' };
  }

  async login(
    input: LoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    if (!user.passwordHash || user.passwordHash.length === 0) {
      throw new BadRequestError(
        'This account was created with Google/GitHub. Please sign in using your OAuth provider above, or click "Forgot Password" to set a password.',
      );
    }

    const isPasswordValid = await passwordService.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordLoginFailure(user.userId, 'Invalid password', 'email', meta);
      throw new UnauthorizedError('INCORRECT_PASSWORD');
    }

    const accountStatus = getUserStatus(user);
    if (accountStatus === UserStatus.SUSPENDED) {
      await this.recordLoginFailure(user.userId, 'Account suspended', 'email', meta);
      throw new ForbiddenError('ACCOUNT_BANNED');
    }

    if (accountStatus === UserStatus.INACTIVE) {
      await this.recordLoginFailure(user.userId, 'Account inactive', 'email', meta);
      throw new ForbiddenError('ACCOUNT_INACTIVE');
    }

    if (!user.isVerified) {
      await this.issueAndSendVerification(user.userId, user.email);
      throw new ForbiddenError('ACCOUNT_NOT_VERIFIED');
    }

    if (user.twoFactorEnabled) {
      const decrypted = user.twoFactorSecret
        ? totpService.decryptSecret(user.twoFactorSecret)
        : null;

      if (!decrypted || !input.totpCode) {
        throw new ForbiddenError('TWO_FACTOR_REQUIRED');
      }

      const valid = await totpService.validateCode(decrypted, input.totpCode);
      if (!valid) {
        await this.recordLoginFailure(user.userId, 'Invalid 2FA code', 'email', meta);
        throw new UnauthorizedError('Invalid two-factor authentication code.');
      }
    }

    const tokens = await this.createSession(user, 'email', meta, true);

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  /**
   * Rotates the refresh token of a session. A presented refresh JWT that was
   * already rotated (blacklisted) or is no longer the session's current token
   * is a reuse: the whole session is revoked.
   */
  async refreshToken(refreshJwt: string | null): Promise<IssuedAuthTokensDto> {
    if (!refreshJwt) {
      throw this.invalidRefreshError();
    }

    let payload: JwtPayload;
    try {
      payload = tokenService.verifyRefreshToken(refreshJwt);
    } catch {
      throw this.invalidRefreshError();
    }
    if (!payload.jti) {
      throw this.invalidRefreshError();
    }

    const blacklisted = await this.isJtiBlacklisted(payload);
    const session = blacklisted ? null : await this.sessionsRepo.findActiveByRefreshToken(payload.jti);
    if (!session) {
      throw await this.rejectStaleRefreshToken(payload.jti, blacklisted);
    }

    const user = await this.usersRepo.findById(session.userId);
    if (!user) {
      throw this.invalidRefreshError();
    }

    const accountStatus = getUserStatus(user);
    if (accountStatus !== UserStatus.ACTIVE) {
      throw new ForbiddenError('Account is not active.');
    }

    // Rotation: blacklist the consumed refresh JTI, then rotate the DB row.
    if (payload.exp) {
      await revocationService.blacklist(payload.jti, payload.exp);
    }

    const newPair = await this.generateTokens(user);
    const rotated = await this.sessionsRepo.rotate(payload.jti, {
      sessionToken: newPair.accessJti,
      newRefreshToken: newPair.refreshJti,
      expiresAt: newPair.refreshExpiresAt,
    });
    if (!rotated) {
      // A concurrent refresh rotated (or a logout ended) this session between the
      // read and the update: the issued pair is not stored, so it must not leave.
      throw this.invalidRefreshError();
    }
    await this.persistRefreshSessionMapping(newPair.refreshJti, session.sessionId, newPair.refreshExpiresAt);

    return {
      accessToken: newPair.accessToken,
      expiresInSeconds: newPair.expiresInSeconds,
      refreshToken: newPair.refreshToken,
      refreshExpiresAt: newPair.refreshExpiresAt,
    };
  }

  /**
   * Ends the session of the presented refresh cookie and revokes the access
   * token when one is known. Never throws for a missing or invalid refresh token.
   */
  async logout(refreshJwt: string | null, accessJti?: string): Promise<void> {
    if (accessJti) {
      await revocationService.blacklist(accessJti, this.accessExpiryUnix());
    }

    if (!refreshJwt) {
      return;
    }

    let payload: JwtPayload;
    try {
      payload = tokenService.verifyRefreshToken(refreshJwt);
    } catch {
      return;
    }

    if (payload.jti && payload.exp) {
      await revocationService.blacklist(payload.jti, payload.exp);
    }
    if (payload.jti) {
      await this.sessionsRepo.deactivateByRefreshToken(payload.jti);
    }
  }

  /** Signs the user out of every session and revokes the current access token. */
  async logoutAll(userId: number, accessJti?: string): Promise<void> {
    await this.sessionsRepo.deactivateAllForUser(userId);

    if (accessJti) {
      await revocationService.blacklist(accessJti, this.accessExpiryUnix());
    }

    logger.info({ userId }, 'All sessions signed out');
  }

  async getMe(userId: number): Promise<MeResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const accountStatus = getUserStatus(user);

    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      status: accountStatus,
      isVerified: user.isVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      hasPassword: Boolean(user.passwordHash && user.passwordHash.length > 0),
      roles: user.roles.map((r) => r.role.roleName),
      permissions: this.extractPermissions(user.roles),
    };
  }

  async setPassword(userId: number, input: SetPasswordDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    // If user already has a password, verify their current password first
    if (user.passwordHash && user.passwordHash.length > 0) {
      if (!input.currentPassword) {
        throw new BadRequestError('Current password is required to update password.');
      }
      const isPasswordValid = await passwordService.compare(input.currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        throw new UnauthorizedError('Current password is incorrect.');
      }
    }

    const passwordHash = await passwordService.hash(input.newPassword);
    const salt = randomBytes(16).toString('hex');

    await db
      .update(users)
      .set({ passwordHash, salt, updatedAt: new Date() })
      .where(eq(users.userId, userId));

    // Credential change: every signed-in session is revoked.
    await this.sessionsRepo.deactivateAllForUser(userId);

    logger.info({ userId }, 'Password set/updated successfully from security settings');

    return { message: 'Password set successfully.' };
  }

  async forgotPassword(input: ForgotPasswordDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      // Do not reveal whether the account exists.
      return { message: 'If that email exists, a reset code has been sent.' };
    }

    const otpCode = await this.issueOtp(user.userId, 'password_reset');
    await emailService.sendOtpEmail(input.email, otpCode, 'password reset');

    return { message: 'If that email exists, a reset code has been sent.' };
  }

  async resetPassword(input: ResetPasswordDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      throw new BadRequestError('Invalid email or code.');
    }

    await this.consumeOtp(user.userId, 'password_reset', input.code);

    const passwordHash = await passwordService.hash(input.newPassword);
    const salt = randomBytes(16).toString('hex');

    await db
      .update(users)
      .set({ passwordHash, salt, updatedAt: new Date() })
      .where(eq(users.userId, user.userId));

    // Full revocation: every signed-in session is deactivated.
    await this.sessionsRepo.deactivateAllForUser(user.userId);

    logger.info({ userId: user.userId }, 'Password reset completed');

    return { message: 'Password reset successfully. You can now sign in.' };
  }

  /**
   * Starts (or restarts) a 2FA enrollment. The secret is generated and
   * persisted server-side as `two_factor_pending_secret`; it is only promoted
   * to `two_factor_secret` after a valid TOTP is confirmed in `verify2fa`.
   * Clients never supply the secret they will be enrolled with.
   */
  async enable2fa(userId: number, _input: Enable2faDto): Promise<TwoFactorSetupDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestError('Two-factor authentication is already enabled.');
    }

    const secret = totpService.generateSecret();
    const otpAuthUri = totpService.buildOtpAuthUri(secret, user.email);

    await db
      .update(users)
      .set({
        twoFactorPendingSecret: totpService.encryptSecret(secret),
        updatedAt: new Date(),
      })
      .where(eq(users.userId, userId));

    return { secret, otpAuthUri };
  }

  async verify2fa(userId: number, input: Verify2faDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    // Already enrolled: confirm against the stored secret only. There is no
    // client-supplied secret path in either branch.
    if (user.twoFactorEnabled) {
      const enrolledSecret = user.twoFactorSecret
        ? totpService.decryptSecret(user.twoFactorSecret)
        : null;

      if (!enrolledSecret) {
        throw new BadRequestError('Two-factor authentication is already enabled.');
      }

      const valid = await totpService.validateCode(enrolledSecret, input.code);
      if (!valid) {
        throw new BadRequestError('Invalid code. Please try again.');
      }

      return { message: 'Two-factor authentication enabled.' };
    }

    const pendingSecret = user.twoFactorPendingSecret
      ? totpService.decryptSecret(user.twoFactorPendingSecret)
      : null;

    if (!pendingSecret) {
      throw new BadRequestError('Enable two-factor authentication first.');
    }

    const valid = await totpService.validateCode(pendingSecret, input.code);
    if (!valid) {
      throw new BadRequestError('Invalid code. Please try again.');
    }

    const encrypted = totpService.encryptSecret(pendingSecret);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          twoFactorEnabled: true,
          twoFactorSecret: encrypted,
          twoFactorPendingSecret: null,
          updatedAt: new Date(),
        })
        .where(eq(users.userId, userId));
    });

    return { message: 'Two-factor authentication enabled.' };
  }

  /**
   * Step-up required: disabling 2FA needs both a valid TOTP and the account
   * password, so a stolen access token alone cannot remove the second factor.
   */
  async disable2fa(userId: number, input: Disable2faDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestError('Two-factor authentication is not enabled.');
    }

    if (!user.passwordHash || user.passwordHash.length === 0) {
      throw new BadRequestError(
        'This account has no password set. Set a password before disabling two-factor authentication.',
      );
    }

    const passwordValid = await passwordService.compare(input.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedError('Password is incorrect.');
    }

    const secret = totpService.decryptSecret(user.twoFactorSecret);
    const valid = await totpService.validateCode(secret, input.code);
    if (!valid) {
      throw new BadRequestError('Invalid two-factor authentication code.');
    }

    await db
      .update(users)
      .set({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        updatedAt: new Date(),
      })
      .where(eq(users.userId, userId));

    // Security-setting change: every signed-in session is revoked.
    await this.sessionsRepo.deactivateAllForUser(userId);

    return { message: 'Two-factor authentication disabled.' };
  }

  async adminLogin(
    input: AdminLoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.usersRepo.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    if (!user.passwordHash || user.passwordHash.length === 0) {
      throw new BadRequestError(
        'This account was created with Google/GitHub. Please sign in using your OAuth provider above, or click "Forgot Password" to set a password.',
      );
    }

    const isPasswordValid = await passwordService.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordLoginFailure(user.userId, 'Invalid password', 'email', meta);
      throw new UnauthorizedError('INCORRECT_PASSWORD');
    }

    const accountStatus = getUserStatus(user);
    if (accountStatus === UserStatus.SUSPENDED) {
      await this.recordLoginFailure(user.userId, 'Account suspended', 'email', meta);
      throw new ForbiddenError('ACCOUNT_BANNED');
    }

    if (accountStatus === UserStatus.INACTIVE) {
      await this.recordLoginFailure(user.userId, 'Account inactive', 'email', meta);
      throw new ForbiddenError('ACCOUNT_INACTIVE');
    }

    if (!user.isVerified) {
      await this.issueAndSendVerification(user.userId, user.email);
      throw new ForbiddenError('ACCOUNT_NOT_VERIFIED');
    }

    const permissions = this.extractPermissions(user.roles);
    if (!permissions.includes('platform.admin.access')) {
      await this.recordLoginFailure(user.userId, 'Not a platform admin', 'email', meta);
      throw new ForbiddenError('You do not have platform admin access.');
    }

    if (user.twoFactorEnabled) {
      const decrypted = user.twoFactorSecret
        ? totpService.decryptSecret(user.twoFactorSecret)
        : null;

      if (!decrypted || !input.totpCode) {
        throw new ForbiddenError('TWO_FACTOR_REQUIRED');
      }

      const valid = await totpService.validateCode(decrypted, input.totpCode);
      if (!valid) {
        await this.recordLoginFailure(user.userId, 'Invalid 2FA code', 'email', meta);
        throw new UnauthorizedError('Invalid two-factor authentication code.');
      }
    }

    const tokens = await this.createSession(user, 'email', meta, true);

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  async getLoginHistory(userId: number): Promise<LoginHistoryEntryDto[]> {
    const rows = await this.loginHistoryRepo.listByUser(userId);

    return rows.map((row) => ({
      loginId: row.loginId,
      createdAt: row.createdAt.toISOString(),
      loginType: row.loginType,
      isSuccessful: row.isSuccessful,
      failureReason: row.failureReason,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    }));
  }

  async oauthLogin(
    input: OAuthLoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<OAuthLoginResultDto> {
    const oauthUser = await oauthService.getUserInfo(
      input.provider,
      input.code,
      input.redirectUri,
      input.codeVerifier,
    );
    const normalizedEmail = oauthUser.email.trim().toLowerCase();

    const existingUser = await this.usersRepo.findByEmail(normalizedEmail);

    if (existingUser) {
      if (!existingUser.isVerified) {
        await db
          .update(users)
          .set({ isVerified: true, updatedAt: new Date() })
          .where(eq(users.userId, existingUser.userId));
        existingUser.isVerified = true;
      }

      const accountStatus = getUserStatus(existingUser);

      if (accountStatus !== UserStatus.ACTIVE) {
        await this.recordLoginFailure(
          existingUser.userId,
          `Account ${accountStatus.toLowerCase()}`,
          input.provider,
          meta,
        );
        throw new ForbiddenError(
          accountStatus === UserStatus.SUSPENDED ? 'ACCOUNT_BANNED' : 'ACCOUNT_INACTIVE',
        );
      }

      const tokens = await this.createSession(existingUser, input.provider, meta, true);

      return {
        user: this.userSvc.toResponse(existingUser),
        tokens,
      };
    }

    // New identity: hand back a single-use pending token and let the wizard
    // collect the account type before we mint the local account.
    const pendingToken = await createPendingOAuth({
      email: normalizedEmail,
      name: oauthUser.name,
      provider: oauthUser.provider,
      providerId: oauthUser.providerId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    return {
      exists: false,
      pendingToken,
      email: oauthUser.email,
      name: oauthUser.name,
      provider: oauthUser.provider,
    };
  }

  async oauthSignup(
    input: OAuthSignupDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<OAuthLoginResultDto> {
    const oauthUser = await oauthService.getUserInfo(
      input.provider,
      input.code,
      input.redirectUri,
      input.codeVerifier,
    );

    const existingUser = await this.usersRepo.findByEmail(oauthUser.email);
    if (existingUser) {
      throw new ConflictError('An account with this email already exists. Please log in instead.');
    }

    const pendingToken = await createPendingOAuth({
      email: oauthUser.email,
      name: input.fullName ?? oauthUser.name,
      provider: oauthUser.provider,
      providerId: oauthUser.providerId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    return {
      exists: false,
      pendingToken,
      email: oauthUser.email,
      name: input.fullName ?? oauthUser.name,
      provider: oauthUser.provider,
    };
  }

  async completeOAuthRegistration(
    input: OAuthCompleteDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const pending = await consumePendingOAuth(input.pendingToken);

    if (!pending) {
      throw new BadRequestError(
        'Your OAuth session has expired. Please sign in with your provider again.',
        [{ code: ERROR_CODES.OAUTH_PENDING_INVALID }],
      );
    }

    const fullName = input.fullName?.trim() || pending.name;

    if (input.accountType === 'member') {
      return this.completeOAuthMember(pending, input, fullName, meta);
    }

    if (input.accountType === 'organization') {
      return this.completeOAuthOrganization(pending, input, fullName, meta);
    }

    return this.completeOAuthIndividual(pending, input, fullName, meta);
  }

  private async deriveOAuthUsername(email: string, requested?: string): Promise<string> {
    const raw = (requested ?? email.split('@')[0]).replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
    const base = raw.length >= 3 ? raw : `${raw}_usr`;

    let username = base;
    let suffix = 1;
    while (await this.usersRepo.findByUsername(username)) {
      username = `${base}_${suffix}`;
      suffix++;
    }

    return username;
  }

  private async completeOAuthIndividual(
    pending: { email: string; name: string; provider: 'google' | 'github'; providerId: string },
    input: Extract<OAuthCompleteDto, { accountType: 'individual' }>,
    fullName: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const defaultRole = await this.roles.findByName(ROLES.INDIVIDUAL_LEARNER);
    if (!defaultRole) {
      throw new Error('individual_learner role is not seeded.');
    }

    const normalizedEmail = pending.email.trim().toLowerCase();
    const user = await this.usersRepo.create({
      username: await this.deriveOAuthUsername(normalizedEmail, input.username),
      email: normalizedEmail,
      passwordHash: '',
      salt: '',
      fullName,
      roleIds: [defaultRole.id],
      isVerified: true,
    });

    await db.update(users).set({ isVerified: true, updatedAt: new Date() }).where(eq(users.userId, user.userId));

    logger.info({ userId: user.userId, provider: pending.provider }, 'OAuth individual account created');

    return this.oauthAuthResponse(user.userId, pending.provider, meta);
  }

  private async completeOAuthOrganization(
    pending: { email: string; name: string; provider: 'google' | 'github'; providerId: string },
    input: Extract<OAuthCompleteDto, { accountType: 'organization' }>,
    fullName: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const normalizedEmail = pending.email.trim().toLowerCase();
    const user = await this.usersRepo.create({
      username: await this.deriveOAuthUsername(normalizedEmail, input.username),
      email: normalizedEmail,
      passwordHash: '',
      salt: '',
      fullName,
      roleIds: [],
      isVerified: true,
    });

    const actor: OrgActor = {
      userId: user.userId,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    };

    const organization = await orgService.createOrg(actor, {
      name: input.organization.name,
      slug: input.organization.slug,
      description: input.organization.description,
      website: input.organization.website || undefined,
      industry: input.organization.industry,
      billingEmail: input.organization.billingEmail,
    });

    await orgService.assignOrgAdmin(actor, organization.organizationId, user.userId);

    await db.update(users).set({ isVerified: true, updatedAt: new Date() }).where(eq(users.userId, user.userId));

    logger.info(
      { userId: user.userId, organizationId: organization.organizationId, provider: pending.provider },
      'OAuth organization account created; org admin assigned',
    );

    return this.oauthAuthResponse(user.userId, pending.provider, meta);
  }

  private async completeOAuthMember(
    pending: { email: string; name: string; provider: 'google' | 'github'; providerId: string },
    input: Extract<OAuthCompleteDto, { accountType: 'member' }>,
    fullName: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const invite = await invitationRepository.findByToken(input.invitationCode);
    if (!invite) {
      throw new BadRequestError('INVALID_INVITATION: this invitation code is not valid.');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestError('INVITE_ALREADY_USED: this invitation has already been used.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError('INVITE_EXPIRED: this invitation has expired.');
    }
    if (invite.inviteeEmail.trim().toLowerCase() !== pending.email.trim().toLowerCase()) {
      throw new ForbiddenError(
        'This invitation was issued to a different email address than your provider account.',
      );
    }

    const normalizedEmail = pending.email.trim().toLowerCase();
    const user = await this.usersRepo.create({
      username: await this.deriveOAuthUsername(normalizedEmail, input.username),
      email: normalizedEmail,
      passwordHash: '',
      salt: '',
      fullName,
      roleIds: [],
      isVerified: true,
    });

    const accepted = await classService.acceptInvitation(user.userId, input.invitationCode);

    await db.update(users).set({ isVerified: true, updatedAt: new Date() }).where(eq(users.userId, user.userId));

    logger.info(
      { userId: user.userId, kind: accepted.kind, organization: accepted.organizationName, provider: pending.provider },
      'OAuth member account created via invitation',
    );

    return this.oauthAuthResponse(user.userId, pending.provider, meta);
  }

  private async oauthAuthResponse(
    userId: number,
    provider: 'google' | 'github',
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.usersRepo.findById(userId);
    if (!user) {
      throw new Error('OAuth account creation failed.');
    }

    const tokens = await this.createSession(user, provider, meta, true);

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  private async createSession(
    user: UserWithRoles,
    loginType: 'email' | 'google' | 'github',
    meta?: { ipAddress?: string; userAgent?: string },
    recordHistory = false,
  ): Promise<IssuedAuthTokensDto> {
    const pair = await this.generateTokens(user);

    const sessionId = await this.sessionsRepo.create({
      userId: user.userId,
      sessionToken: pair.accessJti,
      refreshToken: pair.refreshJti,
      expiresAt: pair.refreshExpiresAt,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    await this.persistRefreshSessionMapping(pair.refreshJti, sessionId, pair.refreshExpiresAt);

    await db
      .update(users)
      .set({ lastLoginAt: new Date(), lastLoginIp: meta?.ipAddress ?? null })
      .where(eq(users.userId, user.userId));

    if (recordHistory) {
      await this.loginHistoryRepo.create({
        userId: user.userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        loginType,
        isSuccessful: true,
      });
    }

    return {
      accessToken: pair.accessToken,
      expiresInSeconds: pair.expiresInSeconds,
      refreshToken: pair.refreshToken,
      refreshExpiresAt: pair.refreshExpiresAt,
    };
  }

  private async generateTokens(user: {
    userId: number;
    email: string;
    roles: Array<{ role: { roleName: string; permissions: Array<{ permission: { permissionName: string } }> } }>;
  }) {
    const permissions = this.extractPermissions(user.roles);

    const jwtPayload = {
      sub: String(user.userId),
      email: user.email,
      roles: user.roles.map((r) => r.role.roleName),
      permissions,
    };

    const pair = tokenService.createTokenPair(jwtPayload);
    const refreshExpiresAt = tokenService.getRefreshTokenExpiryDate();

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessJti: pair.accessJti,
      refreshJti: pair.refreshJti,
      refreshExpiresAt,
      expiresInSeconds: this.accessTtlSeconds(),
    };
  }

  private extractPermissions(
    userRoles: Array<{ role: { permissions: Array<{ permission: { permissionName: string } }> } }>,
  ): string[] {
    const permissionsSet = new Set<string>();

    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissionsSet.add(rolePermission.permission.permissionName);
      }
    }

    return [...permissionsSet];
  }

  private async issueOtp(
    userId: number,
    type: 'email_verification' | 'password_reset' | 'two_factor',
  ): Promise<string> {
    const code = Array.from({ length: OTP_CODE_LENGTH }, () =>
      randomInt(0, 10).toString(),
    ).join('');

    await this.otps.create({
      userId,
      code,
      type,
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
    });

    return code;
  }

  private async consumeOtp(
    userId: number,
    type: 'email_verification' | 'password_reset',
    code: string,
  ): Promise<void> {
    const record = await this.otps.findActiveCode(userId, type, code);

    if (record) {
      // Single use: a correct code is consumed and resets nothing.
      await this.otps.markUsed(record.otpId);
      return;
    }

    const stale = await this.otps.findByUserIdAndType(userId, type, code);

    if (stale) {
      if (stale.isUsed) {
        throw new BadRequestError('OTP_ALREADY_USED');
      }
      throw new BadRequestError('OTP_EXPIRED');
    }

    // Wrong code: count the failure against the newest active OTP for this
    // user/type and invalidate it once the cap is reached. Messages stay
    // non-enumerating: they never reveal whether the address has an account.
    const active = await this.otps.findLatestActive(userId, type);
    if (active) {
      const attempts = await this.otps.incrementAttempts(active.otpId);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.otps.markUsed(active.otpId);
        throw new BadRequestError('Too many incorrect codes. Request a new code.');
      }
    }

    throw new BadRequestError('Invalid code.');
  }

  private async recordLoginFailure(
    userId: number,
    failureReason: string,
    loginType: 'email' | 'google' | 'github',
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.loginHistoryRepo.create({
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      loginType,
      isSuccessful: false,
      failureReason,
    });
  }

  private async isJtiBlacklisted(payload: JwtPayload): Promise<boolean> {
    if (!payload.jti) {
      return false;
    }
    return revocationService.isBlacklisted(payload.jti);
  }

  private invalidRefreshError(): UnauthorizedError {
    return new UnauthorizedError('Invalid or expired refresh token.', [
      { code: ERROR_CODES.REFRESH_TOKEN_INVALID },
    ]);
  }

  /**
   * Handles a refresh JWT that did not match an active current session. When it
   * was rotated away (blacklisted) or is no longer the session's refresh token,
   * the session is revoked and REFRESH_TOKEN_REUSED is returned. Otherwise the
   * token is unknown, expired or inactive and REFRESH_TOKEN_INVALID is returned.
   */
  private async rejectStaleRefreshToken(refreshJti: string, blacklisted: boolean): Promise<UnauthorizedError> {
    const sessionId = await this.readRefreshSessionMapping(refreshJti);
    if (sessionId === null) {
      return this.invalidRefreshError();
    }

    const record = await this.sessionsRepo.findById(sessionId);
    if (!record || !record.isActive) {
      // Already ended (logout, logout-all, revocation): nothing left to revoke.
      return this.invalidRefreshError();
    }

    const reused = blacklisted || record.refreshToken !== refreshJti;
    if (!reused) {
      return this.invalidRefreshError();
    }

    await this.sessionsRepo.deactivateById(record.sessionId);
    await revocationService.blacklist(record.sessionToken, this.accessExpiryUnix());

    logger.warn({ userId: record.userId, sessionId: record.sessionId }, 'Refresh token reuse detected');

    return new UnauthorizedError('Session revoked.', [{ code: ERROR_CODES.REFRESH_TOKEN_REUSED }]);
  }

  /** Records refresh jti -> session id for reuse detection. Failure never fails the login or refresh. */
  private async persistRefreshSessionMapping(refreshJti: string, sessionId: number, expiresAt: Date): Promise<void> {
    try {
      const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      await this.sessionsRepo.saveRefreshSessionMapping(refreshJti, sessionId, ttlSeconds);
    } catch (err) {
      logger.warn({ err, sessionId }, 'Could not record refresh session mapping; reuse detection degraded');
    }
  }

  /** Reads the session a refresh jti belongs to. A Redis failure reads as unknown (fails closed). */
  private async readRefreshSessionMapping(refreshJti: string): Promise<number | null> {
    try {
      return await this.sessionsRepo.findSessionIdByRefreshJti(refreshJti);
    } catch (err) {
      logger.warn({ err }, 'Could not read refresh session mapping');
      return null;
    }
  }

  /** Access-token lifetime in seconds, parsed from JWT_ACCESS_EXPIRES_IN (`<n><s|m|h|d>`). */
  private accessTtlSeconds(): number {
    const match = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_EXPIRES_IN);
    if (!match) {
      return DEFAULT_ACCESS_TTL_SECONDS;
    }
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(match[1]) * multipliers[match[2]];
  }

  /** Unix time at which an access token issued now expires. */
  private accessExpiryUnix(): number {
    return Math.floor(Date.now() / 1000) + this.accessTtlSeconds();
  }
}

export const authService = new AuthService();