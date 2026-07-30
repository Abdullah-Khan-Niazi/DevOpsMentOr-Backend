import { eq } from 'drizzle-orm';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../../shared/errors';
import { passwordService, tokenService } from '../../../shared/services';
import { ROLES, UserStatus, getUserStatus } from '../../../shared/constants';
import { db, users } from '../../../app/database';

import type {
  AuthResponseDto,
  AuthTokensDto,
  LoginDto,
  MeResponseDto,
  OAuthLoginDto,
  OAuthSignupDto,
  RegisterDto,
} from '../dto/auth.dto';

import type { IUserRepository } from '../../users/repositories/user.repository';
import type { UserWithRoles } from '../../users/types';
import { userRepository } from '../../users/repositories/user.repository';

import { UserService, userService } from '../../users/services/user.service';

import type { IRoleRepository } from '../../roles/repositories/role.repository';
import { roleRepository } from '../../roles/repositories/role.repository';

import type { IRefreshTokenRepository } from '../repositories/refresh-token.repository';
import { refreshTokenRepository } from '../repositories/refresh-token.repository';

import type { ILoginHistoryRepository } from '../repositories/login-history.repository';
import { loginHistoryRepository } from '../repositories/login-history.repository';

import { oauthService } from './oauth.service';

export class AuthService {
  constructor(
    private readonly usersRepo: IUserRepository = userRepository,
    private readonly userSvc: UserService = userService,
    private readonly roles: IRoleRepository = roleRepository,
    private readonly refreshTokensRepo: IRefreshTokenRepository = refreshTokenRepository,
    private readonly loginHistoryRepo: ILoginHistoryRepository = loginHistoryRepository,
  ) {}

  async register(input: RegisterDto): Promise<AuthResponseDto> {
    const existingEmail = await this.usersRepo.findByEmail(input.email);

    if (existingEmail) {
      throw new ConflictError('A user with this email already exists.');
    }

    const existingUsername = await this.usersRepo.findByUsername(input.username);

    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const defaultRole = await this.roles.findByName(ROLES.USER);

    const passwordHash = await passwordService.hash(input.password);

    const user = await this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt: '',
      fullName: input.fullName,
      roleIds: defaultRole ? [defaultRole.id] : [],
    });

    const tokens = await this.generateTokens(user.userId, user.email, user.roles);

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
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
      await this.loginHistoryRepo.create({
        userId: user.userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        loginType: 'email',
        isSuccessful: false,
        failureReason: 'Invalid password',
      });

      throw new UnauthorizedError('Invalid email or password.');
    }

    const accountStatus = getUserStatus(user);

    if (accountStatus === UserStatus.SUSPENDED) {
      await this.loginHistoryRepo.create({
        userId: user.userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        loginType: 'email',
        isSuccessful: false,
        failureReason: 'Account suspended',
      });

      throw new UnauthorizedError(
        'Your account has been suspended. Please contact support.',
      );
    }

    if (accountStatus === UserStatus.INACTIVE) {
      await this.loginHistoryRepo.create({
        userId: user.userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        loginType: 'email',
        isSuccessful: false,
        failureReason: 'Account inactive',
      });

      throw new UnauthorizedError(
        'Your account is inactive. Please contact support.',
      );
    }

    const tokens = await this.generateTokens(user.userId, user.email, user.roles);

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: meta?.ipAddress ?? null,
      })
      .where(eq(users.userId, user.userId));

    await this.loginHistoryRepo.create({
      userId: user.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      loginType: 'email',
      isSuccessful: true,
    });

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokensDto> {
    tokenService.verifyRefreshToken(refreshToken);

    const storedToken = await this.refreshTokensRepo.findValidByToken(refreshToken);

    if (!storedToken) {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    await this.refreshTokensRepo.revoke(refreshToken);

    const user = await this.usersRepo.findById(storedToken.userId);

    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    const accountStatus = getUserStatus(user);

    if (accountStatus !== UserStatus.ACTIVE) {
      throw new UnauthorizedError('Account is not active.');
    }

    return this.generateTokens(user.userId, user.email, user.roles);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokensRepo.revoke(refreshToken);
  }

  async getMe(userId: number): Promise<MeResponseDto> {
    const user = await this.usersRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return {
      id: user.userId,
      email: user.email,
      name: user.fullName,
      roles: user.roles.map((r) => r.role.roleName),
    };
  }

  async oauthLogin(
    input: OAuthLoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const oauthUser = await oauthService.getUserInfo(input.provider, input.code, input.redirectUri);

    const existingUser = await this.usersRepo.findByEmail(oauthUser.email);

    if (!existingUser) {
      throw new UnauthorizedError(
        `No account linked with ${input.provider}. Please sign up first.`,
      );
    }

    const accountStatus = getUserStatus(existingUser);

    if (accountStatus !== UserStatus.ACTIVE) {
      await this.loginHistoryRepo.create({
        userId: existingUser.userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        loginType: input.provider,
        isSuccessful: false,
        failureReason: `Account ${accountStatus.toLowerCase()}`,
      });

      throw new UnauthorizedError(
        accountStatus === UserStatus.SUSPENDED
          ? 'Your account has been suspended.'
          : 'Your account is inactive.',
      );
    }

    const tokens = await this.generateTokens(
      existingUser.userId,
      existingUser.email,
      existingUser.roles,
    );

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: meta?.ipAddress ?? null,
      })
      .where(eq(users.userId, existingUser.userId));

    await this.loginHistoryRepo.create({
      userId: existingUser.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      loginType: input.provider,
      isSuccessful: true,
    });

    return {
      user: this.userSvc.toResponse(existingUser),
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
      throw new ConflictError(
        'An account with this email already exists. Please log in instead.',
      );
    }

    const existingUsername = await this.usersRepo.findByUsername(input.username);

    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const defaultRole = await this.roles.findByName(ROLES.USER);

    const user = await this.usersRepo.create({
      username: input.username,
      email: oauthUser.email,
      passwordHash: '',
      salt: '',
      fullName: input.fullName ?? oauthUser.name,
      roleIds: defaultRole ? [defaultRole.id] : [],
    });

    const tokens = await this.generateTokens(user.userId, user.email, user.roles);

    await this.loginHistoryRepo.create({
      userId: user.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      loginType: input.provider,
      isSuccessful: true,
    });

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }

  private async generateTokens(
    userId: number,
    email: string,
    userRoles: UserWithRoles['roles'],
    userPermissions?: string[],
  ): Promise<AuthTokensDto> {
    const allPermissions = userPermissions ?? this.extractPermissionsFromRoles(userRoles);

    const jwtPayload = {
      sub: String(userId),
      email,
      roles: userRoles.map((r) => r.role.roleName),
      permissions: allPermissions,
    };

    const tokenPair = tokenService.createTokenPair(jwtPayload);
    const expiresAt = tokenService.getRefreshTokenExpiryDate();

    await this.refreshTokensRepo.create({
      token: tokenPair.refreshToken,
      userId,
      expiresAt,
    });

    return tokenPair;
  }

  private extractPermissionsFromRoles(
    userRoles: UserWithRoles['roles'],
  ): string[] {
    const permissionsSet = new Set<string>();

    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissionsSet.add(rolePermission.permission.permissionName);
      }
    }

    return [...permissionsSet];
  }
}

export const authService = new AuthService();
