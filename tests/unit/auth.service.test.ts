import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserStatus } from '../../src/shared/constants';
import { AuthService } from '../../src/features/auth/services/auth.service';
import type { IUserRepository } from '../../src/features/users/repositories/user.repository';
import type { IRefreshTokenRepository } from '../../src/features/auth/repositories/refresh-token.repository';
import type { ILoginHistoryRepository } from '../../src/features/auth/repositories/login-history.repository';
import type { IRoleRepository } from '../../src/features/roles/repositories/role.repository';
import type { UserWithRoles } from '../../src/features/users/types';
import { UserService } from '../../src/features/users/services/user.service';
import { UnauthorizedError, ConflictError } from '../../src/shared/errors';

vi.mock('../../src/shared/services', () => ({
  passwordService: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(async (password: string) => password === 'Password123!'),
  },
  tokenService: {
    createTokenPair: vi.fn(() => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    getRefreshTokenExpiryDate: vi.fn(() => new Date(Date.now() + 86400000)),
    verifyRefreshToken: vi.fn(() => ({
      sub: '1',
      email: 'jane@example.com',
      roles: ['USER'],
      permissions: [],
      type: 'refresh' as const,
      jti: 'test-jti',
    })),
    verifyAccessToken: vi.fn(),
  },
}));

const activeUser: UserWithRoles = {
  userId: 1,
  username: 'janedoe',
  email: 'jane@example.com',
  passwordHash: 'hashed-password',
  salt: '',
  fullName: 'Jane Doe',
  isActive: true,
  isBanned: false,
  deletedAt: null,
  status: UserStatus.ACTIVE,
  bio: null,
  avatarUrl: null,
  coverPhotoUrl: null,
  isVerified: false,
  banReason: null,
  lastLoginAt: null,
  lastLoginIp: null,
  registrationIp: null,
  timezone: 'UTC',
  language: 'en',
  twoFactorEnabled: false,
  twoFactorSecret: null,
  displayName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  roles: [
    {
      role: {
        id: 1,
        roleName: 'USER',
        description: null,
        priority: 0,
        createdAt: new Date(),
        permissions: [],
      },
    },
  ],
};

const suspendedUser: UserWithRoles = {
  ...activeUser,
  isBanned: true,
  status: UserStatus.SUSPENDED,
};

const inactiveUser: UserWithRoles = {
  ...activeUser,
  isActive: false,
  status: UserStatus.INACTIVE,
};

describe('AuthService', () => {
  let users: IUserRepository;
  let refreshTokens: IRefreshTokenRepository;
  let loginHistory: ILoginHistoryRepository;
  let roles: IRoleRepository;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByUsername: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      countByStatus: vi.fn(),
    };
    refreshTokens = {
      create: vi.fn(),
      findValidByToken: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn(),
    };
    loginHistory = {
      create: vi.fn(),
    };
    roles = {
      findById: vi.fn(),
      findByName: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    };
    service = new AuthService(users, new UserService(users), roles, refreshTokens, loginHistory);
  });

  describe('register', () => {
    it('creates a user and returns tokens', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(null);
      vi.mocked(users.findByUsername).mockResolvedValue(null);
      vi.mocked(roles.findByName).mockResolvedValue({
        id: 1,
        roleName: 'USER',
        description: null,
        priority: 0,
        createdAt: new Date(),
        permissions: [],
      });
      vi.mocked(users.create).mockResolvedValue(activeUser);
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.register({
        username: 'janedoe',
        email: 'jane@example.com',
        password: 'Password123!',
        fullName: 'Jane Doe',
      });

      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.tokens.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('jane@example.com');
    });

    it('throws ConflictError when email exists', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

      await expect(
        service.register({
          username: 'janedoe',
          email: 'jane@example.com',
          password: 'Password123!',
          fullName: 'Jane Doe',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('throws ConflictError when username exists', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(null);
      vi.mocked(users.findByUsername).mockResolvedValue(activeUser);

      await expect(
        service.register({
          username: 'janedoe',
          email: 'jane@example.com',
          password: 'Password123!',
          fullName: 'Jane Doe',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('login', () => {
    it('logs in with valid credentials', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.login({
        email: 'jane@example.com',
        password: 'Password123!',
      });

      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.user.email).toBe('jane@example.com');
      expect(refreshTokens.create).toHaveBeenCalledOnce();
      expect(loginHistory.create).toHaveBeenCalled();
    });

    it('rejects invalid credentials', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSuccessful: false, failureReason: 'Invalid password' }),
      );
    });

    it('rejects login for non-existent user', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects login for suspended user', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(suspendedUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSuccessful: false, failureReason: 'Account suspended' }),
      );
    });

    it('rejects login for inactive user', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(inactiveUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSuccessful: false, failureReason: 'Account inactive' }),
      );
    });
  });

  describe('refreshToken', () => {
    it('returns new token pair when refresh token is valid', async () => {
      vi.mocked(refreshTokens.findValidByToken).mockResolvedValue({ id: 1, userId: 1 });
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.refreshToken('valid-refresh-token');

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(refreshTokens.revoke).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('throws UnauthorizedError when refresh token is invalid', async () => {
      vi.mocked(refreshTokens.findValidByToken).mockResolvedValue(null);

      await expect(
        service.refreshToken('invalid-refresh-token'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError when user is not found', async () => {
      vi.mocked(refreshTokens.findValidByToken).mockResolvedValue({ id: 1, userId: 1 });
      vi.mocked(users.findById).mockResolvedValue(null);

      await expect(
        service.refreshToken('valid-refresh-token'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      await service.logout('token-to-revoke');
      expect(refreshTokens.revoke).toHaveBeenCalledWith('token-to-revoke');
    });
  });

  describe('getMe', () => {
    it('returns user info for valid user', async () => {
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.getMe(1);

      expect(result.email).toBe('jane@example.com');
      expect(result.roles).toEqual(['USER']);
    });

    it('throws NotFoundError when user does not exist', async () => {
      vi.mocked(users.findById).mockResolvedValue(null);

      await expect(service.getMe(999)).rejects.toBeInstanceOf(Error);
    });
  });
});
