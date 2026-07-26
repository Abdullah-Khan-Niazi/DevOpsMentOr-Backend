import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../shared/errors';
import { passwordService, tokenService } from '../../../shared/services';
import { ROLES, UserStatus } from '../../../shared/constants';
import type { AuthResponseDto, LoginDto, RegisterDto } from '../dto/auth.dto';
import type { IRefreshTokenRepository } from '../repositories/refresh-token.repository';
import { refreshTokenRepository } from '../repositories/refresh-token.repository';
import type { IUserRepository } from '../../users/repositories/user.repository';
import { userRepository } from '../../users/repositories/user.repository';
import { UserService, userService } from '../../users/services/user.service';
import type { IRoleRepository } from '../../roles/repositories/role.repository';
import { roleRepository } from '../../roles/repositories/role.repository';

export class AuthService {
  constructor(
    private readonly users: IUserRepository = userRepository,
    private readonly refreshTokens: IRefreshTokenRepository = refreshTokenRepository,
    private readonly userSvc: UserService = userService,
    private readonly roles: IRoleRepository = roleRepository,
  ) {}

  async register(input: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email already exists.');
    }

    const defaultRole = await this.roles.findByName(ROLES.USER);
    const passwordHash = await passwordService.hash(input.password);

    const user = await this.users.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleIds: defaultRole ? [defaultRole.id] : [],
    });

    return this.buildAuthResponse(user.id);
  }

  async login(input: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError('User account is not active.');
    }

    const valid = await passwordService.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    return this.buildAuthResponse(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const payload = tokenService.verifyRefreshToken(refreshToken);
    const stored = await this.refreshTokens.findValidByToken(refreshToken);

    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    await this.refreshTokens.revoke(refreshToken);
    return this.buildAuthResponse(payload.sub);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  private async buildAuthResponse(userId: string): Promise<AuthResponseDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError('User account is not active.');
    }

    const roleNames = user.roles.map((item) => item.role.name);
    const permissionNames = this.userSvc.extractPermissions(user);

    const tokens = tokenService.createTokenPair({
      sub: user.id,
      email: user.email,
      roles: roleNames,
      permissions: permissionNames,
    });

    await this.refreshTokens.create({
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: tokenService.getRefreshTokenExpiryDate(),
    });

    return {
      user: this.userSvc.toResponse(user),
      tokens,
    };
  }
}

export const authService = new AuthService();
