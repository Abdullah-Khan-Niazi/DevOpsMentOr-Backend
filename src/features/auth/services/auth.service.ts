import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import {
  BadRequestError,
  ConflictError,
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
import { logger } from '../../../shared/logger';

import type {
  AdminLoginDto,
  AuthResponseDto,
  AuthTokensDto,
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  LoginHistoryEntryDto,
  LogoutDto,
  MeResponseDto,
  MessageResponseDto,
  OAuthLoginDto,
  OAuthSignupDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationDto,
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
import type { JwtPayload } from '../../../shared/types';
import type { UserWithRoles } from '../../users/types';

const OTP_CODE_LENGTH = 6;

export class AuthService {
  constructor(
    private readonly usersRepo: IUserRepository = userRepository,
    private readonly userSvc: UserService = userService,
    private readonly roles: IRoleRepository = roleRepository,
    private readonly sessionsRepo: ISessionRepository = sessionRepository,
    private readonly otps: IOtpRepository = otpRepository,
    private readonly loginHistoryRepo: ILoginHistoryRepository = loginHistoryRepository,
  ) {}

  async register(input: RegisterDto): Promise<MessageResponseDto> {
    const existingEmail = await this.usersRepo.findByEmail(input.email);
    if (existingEmail) {
      throw new ConflictError('A user with this email already exists.');
    }

    const existingUsername = await this.usersRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const defaultRole = await this.roles.findByName(ROLES.INDIVIDUAL_LEARNER);
    if (!defaultRole) {
      throw new Error('individual_learner role is not seeded.');
    }

    const passwordHash = await passwordService.hash(input.password);
    const salt = randomBytes(16).toString('hex');

    const user = await this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt,
      fullName: input.fullName,
      roleIds: [defaultRole.id],
    });

    const otpCode = await this.issueOtp(user.userId, 'email_verification');
    await emailService.sendOtpEmail(input.email, otpCode, 'email verification');

    logger.info({ userId: user.userId }, 'User registered; verification OTP issued');

    return {
      message: 'Registration successful. Please verify your email.',
    };
  }

  async verifyEmail(input: VerifyEmailDto): Promise<MessageResponseDto> {
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

    return { message: 'Email verified successfully. You can now sign in.' };
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

    const isPasswordValid = await passwordService.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordLoginFailure(user.userId, 'Invalid password', 'email', meta);
      throw new UnauthorizedError('Invalid email or password.');
    }

    if (user.isVerified === false) {
      await this.recordLoginFailure(user.userId, 'Account not verified', 'email', meta);
      throw new ForbiddenError('ACCOUNT_NOT_VERIFIED');
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

  async refreshToken(input: RefreshTokenDto): Promise<AuthTokensDto> {
    const payload = tokenService.verifyRefreshToken(input.refreshToken);

    if (await this.isJtiBlacklisted(payload)) {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    const session = await this.sessionsRepo.findActiveByRefreshToken(payload.jti ?? '');
    if (!session) {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    const user = await this.usersRepo.findById(session.userId);
    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    const accountStatus = getUserStatus(user);
    if (accountStatus !== UserStatus.ACTIVE) {
      throw new ForbiddenError('Account is not active.');
    }

    // Rotation: blacklist the consumed refresh JTI, then rotate the DB row.
    if (payload.jti && payload.exp) {
      await revocationService.blacklist(payload.jti, payload.exp);
    }

    const newPair = await this.generateTokens(user);
    await this.sessionsRepo.rotate(payload.jti ?? '', {
      sessionToken: newPair.accessJti,
      newRefreshToken: newPair.refreshJti,
      expiresAt: newPair.refreshExpiresAt,
    });

    return { accessToken: newPair.accessToken, refreshToken: newPair.refreshToken };
  }

  async logout(input: LogoutDto, accessJti?: string): Promise<void> {
    if (accessJti) {
      await revocationService.blacklist(accessJti, Math.floor(Date.now() / 1000) + 900);
    }

    let payload: JwtPayload | null = null;
    try {
      payload = tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      payload = null;
    }

    if (payload?.jti && payload?.exp) {
      await revocationService.blacklist(payload.jti, payload.exp);
    }

    await this.sessionsRepo.deactivateByRefreshToken(payload?.jti ?? '');
  }

  async getMe(userId: number): Promise<MeResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return {
      userId: user.userId,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((r) => r.role.roleName),
      permissions: this.extractPermissions(user.roles),
    };
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

    // Verify-then-store is done in verify2fa; here we only hand out the secret.
    return { secret, otpAuthUri };
  }

  async verify2fa(userId: number, input: Verify2faDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const secret =
      input.secret ?? (user.twoFactorSecret ? totpService.decryptSecret(user.twoFactorSecret) : null);

    if (!secret) {
      throw new BadRequestError('Enable two-factor authentication first.');
    }

    const valid = await totpService.validateCode(secret, input.code);
    if (!valid) {
      throw new BadRequestError('Invalid code. Please try again.');
    }

    await db
      .update(users)
      .set({
        twoFactorEnabled: true,
        twoFactorSecret: totpService.encryptSecret(secret),
        updatedAt: new Date(),
      })
      .where(eq(users.userId, userId));

    return { message: 'Two-factor authentication enabled.' };
  }

  async disable2fa(userId: number, input: Verify2faDto): Promise<MessageResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestError('Two-factor authentication is not enabled.');
    }

    const secret = totpService.decryptSecret(user.twoFactorSecret);
    const valid = await totpService.validateCode(secret, input.code);
    if (!valid) {
      throw new BadRequestError('Invalid code. Please try again.');
    }

    await db
      .update(users)
      .set({ twoFactorEnabled: false, twoFactorSecret: null, updatedAt: new Date() })
      .where(eq(users.userId, userId));

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

    const isPasswordValid = await passwordService.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordLoginFailure(user.userId, 'Invalid password', 'email', meta);
      throw new UnauthorizedError('Invalid email or password.');
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
  ): Promise<AuthResponseDto> {
    const oauthUser = await oauthService.getUserInfo(input.provider, input.code, input.redirectUri);

    const existingUser = await this.usersRepo.findByEmail(oauthUser.email);

    if (existingUser) {
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

    const tokens = await this.createOAuthAccount(oauthUser, input.provider, meta);

    const created = await this.usersRepo.findByEmail(oauthUser.email);
    if (!created) {
      throw new Error('OAuth account creation failed.');
    }

    return {
      user: this.userSvc.toResponse(created),
      tokens,
    };
  }

  async oauthSignup(
    input: OAuthSignupDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const oauthUser = await oauthService.getUserInfo(input.provider, input.code, input.redirectUri);

    const existingEmail = await this.usersRepo.findByEmail(oauthUser.email);
    if (existingEmail) {
      throw new ConflictError('An account with this email already exists. Please log in instead.');
    }

    const existingUsername = await this.usersRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const tokens = await this.createOAuthAccount(
      { ...oauthUser, name: input.fullName ?? oauthUser.name },
      input.provider,
      meta,
    );

    // Assign the chosen username to the freshly created account.
    const created = await this.usersRepo.findByEmail(oauthUser.email);
    if (!created) {
      throw new Error('OAuth account creation failed.');
    }

    await db.update(users).set({ username: input.username }).where(eq(users.userId, created.userId));

    const finalUser = await this.usersRepo.findById(created.userId);
    if (!finalUser) {
      throw new Error('OAuth account creation failed.');
    }

    return {
      user: this.userSvc.toResponse(finalUser),
      tokens,
    };
  }

  private async createOAuthAccount(
    oauthUser: { provider: 'google' | 'github'; email: string; name: string },
    provider: 'google' | 'github',
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthTokensDto> {
    const emailPrefix = oauthUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');

    let username = emailPrefix;
    let suffix = 1;
    while (await this.usersRepo.findByUsername(username)) {
      username = `${emailPrefix}_${suffix}`;
      suffix++;
    }

    const defaultRole = await this.roles.findByName(ROLES.INDIVIDUAL_LEARNER);
    if (!defaultRole) {
      throw new Error('individual_learner role is not seeded.');
    }

    const user = await this.usersRepo.create({
      username,
      email: oauthUser.email,
      passwordHash: '',
      salt: '',
      fullName: oauthUser.name ?? emailPrefix,
      roleIds: [defaultRole.id],
    });

    await db
      .update(users)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(users.userId, user.userId));

    return this.createSession(user, provider, meta, true);
  }

  private async createSession(
    user: UserWithRoles,
    loginType: 'email' | 'google' | 'github',
    meta?: { ipAddress?: string; userAgent?: string },
    recordHistory = false,
  ): Promise<AuthTokensDto> {
    const pair = await this.generateTokens(user);

    await this.sessionsRepo.create({
      userId: user.userId,
      sessionToken: pair.accessJti,
      refreshToken: pair.refreshJti,
      expiresAt: pair.refreshExpiresAt,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

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

    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
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

    const decoded = tokenService.decodeToken(pair.accessToken);
    const decodedRefresh = tokenService.decodeToken(pair.refreshToken);

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessJti: decoded.jti ?? '',
      refreshJti: decodedRefresh.jti ?? '',
      refreshExpiresAt,
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
      Math.floor(Math.random() * 10).toString(),
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

    if (!record) {
      const stale = await this.otps.findByUserIdAndType(userId, type, code);

      if (stale) {
        if (stale.isUsed) {
          throw new BadRequestError('OTP_ALREADY_USED');
        }
        throw new BadRequestError('OTP_EXPIRED');
      }

      throw new BadRequestError('Invalid code.');
    }

    await this.otps.markUsed(record.otpId);
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
}

export const authService = new AuthService();