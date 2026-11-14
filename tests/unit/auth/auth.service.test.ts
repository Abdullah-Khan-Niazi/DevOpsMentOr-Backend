import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserStatus } from '../../../src/shared/constants';
import { AuthService } from '../../../src/features/auth/services/auth.service';
import type { IUserRepository } from '../../../src/features/users/repositories/user.repository';
import type { ISessionRepository } from '../../../src/features/auth/repositories/session.repository';
import type { IOtpRepository } from '../../../src/features/auth/repositories/otp.repository';
import type { ILoginHistoryRepository } from '../../../src/features/auth/repositories/login-history.repository';
import type { IRoleRepository } from '../../../src/features/roles/repositories/role.repository';
import type { UserWithRoles } from '../../../src/features/users/types';
import { UserService } from '../../../src/features/users/services/user.service';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../src/shared/errors';
import { revocationService, totpService } from '../../../src/shared/services';

vi.mock('../../../src/shared/services', () => ({
  passwordService: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(async (password: string) => password === 'Password123!'),
  },
  tokenService: {
    createTokenPair: vi.fn(() => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessJti: 'test-jti',
      refreshJti: 'test-refresh-jti',
    })),
    getRefreshTokenExpiryDate: vi.fn(() => new Date(Date.now() + 86400000)),
    decodeToken: vi.fn(() => ({ jti: 'test-jti' })),
    verifyRefreshToken: vi.fn(() => ({
      sub: '1',
      email: 'jane@example.com',
      roles: ['USER'],
      permissions: [],
      type: 'refresh' as const,
      jti: 'test-jti',
      exp: 1900000000,
    })),
    verifyAccessToken: vi.fn(),
  },
  revocationService: {
    blacklist: vi.fn(async () => undefined),
    isBlacklisted: vi.fn(async () => false),
  },
  totpService: {
    generateSecret: vi.fn(() => 'test-secret'),
    buildOtpAuthUri: vi.fn(() => 'otpauth://totp/Test:jane@example.com?secret=test-secret'),
    encryptSecret: vi.fn((secret: string) => `enc:${secret}`),
    decryptSecret: vi.fn(() => null),
    validateCode: vi.fn(async () => true),
  },
  emailService: {
    sendOtpEmail: vi.fn(async () => undefined),
  },
}));

const dbMock = vi.hoisted(() => {
  const sets: Record<string, unknown>[] = [];

  const makeUpdateHandle = () => ({
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        sets.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  });

  return {
    sets,
    makeUpdateHandle,
    rootUpdate: makeUpdateHandle().update,
    transaction: vi.fn(
      async (callback: (tx: ReturnType<typeof makeUpdateHandle>) => Promise<unknown>) =>
        callback(makeUpdateHandle()),
    ),
  };
});

vi.mock('../../../src/app/database', () => ({
  db: {
    update: dbMock.rootUpdate,
    transaction: dbMock.transaction,
  },
  users: {},
  sessions: {},
}));

const baseUser: UserWithRoles = {
  userId: 1,
  username: 'janedoe',
  email: 'jane@example.com',
  passwordHash: 'hashed-password',
  salt: '',
  fullName: 'Jane Doe',
  displayName: null,
  bio: null,
  avatarUrl: null,
  coverPhotoUrl: null,
  isActive: true,
  isBanned: false,
  isVerified: false,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorPendingSecret: null,
  banReason: null,
  lastLoginAt: null,
  lastLoginIp: null,
  registrationIp: null,
  timezone: 'UTC',
  language: 'en',
  deletedAt: null,
  status: UserStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
  roles: [
    {
      role: {
        id: 1,
        roleName: 'individual_learner',
        description: null,
        priority: 0,
        createdAt: new Date(),
        permissions: [],
      },
    },
  ],
};

const activeUser: UserWithRoles = { ...baseUser, isVerified: true };

const suspendedUser: UserWithRoles = { ...activeUser, isBanned: true, status: UserStatus.SUSPENDED };

const inactiveUser: UserWithRoles = { ...activeUser, isActive: false, status: UserStatus.INACTIVE };

const unverifiedUser: UserWithRoles = { ...baseUser, status: UserStatus.ACTIVE };

describe('AuthService', () => {
  let users: IUserRepository;
  let sessions: ISessionRepository;
  let otps: IOtpRepository;
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
    sessions = {
      create: vi.fn(),
      findActiveByRefreshToken: vi.fn(),
      rotate: vi.fn(),
      deactivateByRefreshToken: vi.fn(),
      deactivateAllForUser: vi.fn(),
    };
    otps = {
      create: vi.fn(),
      findActiveCode: vi.fn(),
      findByUserIdAndType: vi.fn(),
      findLatestActive: vi.fn(),
      incrementAttempts: vi.fn(),
      markUsed: vi.fn(),
    };
    loginHistory = {
      create: vi.fn(),
      listByUser: vi.fn(),
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
    service = new AuthService(users, new UserService(users), roles, sessions, otps, loginHistory);
    dbMock.sets.length = 0;
    dbMock.transaction.mockClear();
  });

  describe('register', () => {
    it('creates a user, issues a verification OTP and returns a message', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(null);
      vi.mocked(users.findByUsername).mockResolvedValue(null);
      vi.mocked(roles.findByName).mockResolvedValue(baseUser.roles[0].role);
      vi.mocked(users.create).mockResolvedValue(baseUser);

      const result = await service.register({
        username: 'janedoe',
        email: 'jane@example.com',
        password: 'Password123!',
        fullName: 'Jane Doe',
      });

      expect(result.message).toContain('verify your email');
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@example.com', roleIds: [1] }),
      );
      expect(otps.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, type: 'email_verification' }),
      );
    });

    it('throws ConflictError when email already exists', async () => {
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

    it('throws ConflictError when username already exists', async () => {
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
    it('logs in with valid credentials and starts a session', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

      const result = await service.login({
        email: 'jane@example.com',
        password: 'Password123!',
      });

      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.tokens.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('jane@example.com');
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, sessionToken: 'test-jti' }),
      );
      expect(loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSuccessful: true, loginType: 'email' }),
      );
    });

    it('rejects invalid credentials and records the failure', async () => {
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

    it('returns ACCOUNT_NOT_VERIFIED for unverified users', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(unverifiedUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ message: 'ACCOUNT_NOT_VERIFIED' });
    });

    it('returns ACCOUNT_BANNED for suspended users', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(suspendedUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ message: 'ACCOUNT_BANNED' });
    });

    it('returns ACCOUNT_INACTIVE for inactive users', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(inactiveUser);

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ message: 'ACCOUNT_INACTIVE' });
    });

    it('requires a TOTP code when 2FA is enabled', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue({
        ...activeUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'encrypted-secret',
      });

      await expect(
        service.login({
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({ message: 'TWO_FACTOR_REQUIRED' });
    });
  });

  describe('refreshToken', () => {
    it('rotates the refresh token and returns a new pair', async () => {
      vi.mocked(sessions.findActiveByRefreshToken).mockResolvedValue({
        sessionId: 1,
        userId: 1,
        sessionToken: 'old-jti',
        refreshToken: 'valid-refresh-token',
        expiresAt: new Date(),
      });
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.refreshToken({ refreshToken: 'valid-refresh-token' });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(sessions.rotate).toHaveBeenCalledWith(
        'test-jti',
        expect.objectContaining({ sessionToken: 'test-jti' }),
      );
    });

    it('rejects a blacklisted refresh token', async () => {
      vi.mocked(revocationService.isBlacklisted).mockResolvedValueOnce(true);

      await expect(
        service.refreshToken({ refreshToken: 'stolen-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError when the session is missing', async () => {
      vi.mocked(sessions.findActiveByRefreshToken).mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'invalid-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError when the user is not found', async () => {
      vi.mocked(sessions.findActiveByRefreshToken).mockResolvedValue({
        sessionId: 1,
        userId: 999,
        sessionToken: 'old-jti',
        refreshToken: 'valid-refresh-token',
        expiresAt: new Date(),
      });
      vi.mocked(users.findById).mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'valid-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('blacklists the access JTI and deactivates the session', async () => {
      await service.logout({ refreshToken: 'token-to-revoke' }, 'access-jti');

      expect(revocationService.blacklist).toHaveBeenCalledWith('access-jti', expect.any(Number));
      expect(sessions.deactivateByRefreshToken).toHaveBeenCalledWith('test-jti');
    });
  });

  describe('forgotPassword', () => {
    it('does not reveal whether the account exists', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'ghost@example.com' });

      expect(result.message).toContain('If that email exists');
    });

    it('issues a password reset OTP for existing accounts', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

      const result = await service.forgotPassword({ email: 'jane@example.com' });

      expect(result.message).toContain('If that email exists');
      expect(otps.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, type: 'password_reset' }),
      );
    });
  });

  describe('getMe', () => {
    it('returns user info with roles and permissions', async () => {
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.getMe(1);

      expect(result.email).toBe('jane@example.com');
      expect(result.roles).toEqual(['individual_learner']);
    });

    it('throws NotFoundError when user does not exist', async () => {
      vi.mocked(users.findById).mockResolvedValue(null);

      await expect(service.getMe(999)).rejects.toBeInstanceOf(Error);
    });
  });

  describe('getLoginHistory', () => {
    it('returns the user login history entries', async () => {
      vi.mocked(loginHistory.listByUser).mockResolvedValue([
        {
          loginId: 1,
          userId: 1,
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
          loginType: 'email',
          isSuccessful: true,
          failureReason: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.getLoginHistory(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ loginId: 1, isSuccessful: true });
    });
  });

  describe('adminLogin', () => {
    it('rejects users without platform admin access', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

      await expect(
        service.adminLogin({ email: 'jane@example.com', password: 'Password123!' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('logs in a platform admin', async () => {
      const adminUser: UserWithRoles = {
        ...activeUser,
        roles: [
          {
            role: {
              ...baseUser.roles[0].role,
              permissions: [
                {
                  permission: {
                    id: 1,
                    permissionName: 'platform.admin.access',
                    description: null,
                    module: 'platform',
                    createdAt: new Date(),
                  },
                },
              ],
            },
          },
        ],
      };
      vi.mocked(users.findByEmail).mockResolvedValue(adminUser);

      const result = await service.adminLogin({
        email: 'admin@example.com',
        password: 'Password123!',
      });

      expect(result.tokens.accessToken).toBe('access-token');
      expect(sessions.create).toHaveBeenCalled();
    });
  });

  describe('OTP verification attempt caps', () => {
    const activeOtp = {
      otpId: 7,
      userId: 1,
      code: 'a'.repeat(64),
      type: 'password_reset' as const,
      isUsed: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('consumes a correct code once and never touches the attempt counter', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);
      vi.mocked(otps.findActiveCode).mockResolvedValue(activeOtp);

      await service.resetPassword({
        email: 'jane@example.com',
        code: '123456',
        newPassword: 'NewPassword123!',
      });

      expect(otps.markUsed).toHaveBeenCalledWith(7);
      expect(otps.incrementAttempts).not.toHaveBeenCalled();
    });

    it('increments attempts on a wrong code and keeps the OTP alive below the cap', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);
      vi.mocked(otps.findActiveCode).mockResolvedValue(null);
      vi.mocked(otps.findByUserIdAndType).mockResolvedValue(null);
      vi.mocked(otps.findLatestActive).mockResolvedValue(activeOtp);
      vi.mocked(otps.incrementAttempts).mockResolvedValue(2);

      await expect(
        service.resetPassword({
          email: 'jane@example.com',
          code: '000000',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toMatchObject({ message: 'Invalid code.' });

      expect(otps.incrementAttempts).toHaveBeenCalledWith(7);
      expect(otps.markUsed).not.toHaveBeenCalled();
    });

    it('invalidates the OTP at five failed attempts with an actionable error', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);
      vi.mocked(otps.findActiveCode).mockResolvedValue(null);
      vi.mocked(otps.findByUserIdAndType).mockResolvedValue(null);
      vi.mocked(otps.findLatestActive).mockResolvedValue(activeOtp);
      vi.mocked(otps.incrementAttempts).mockResolvedValue(5);

      await expect(
        service.resetPassword({
          email: 'jane@example.com',
          code: '000000',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toMatchObject({
        message: 'Too many incorrect codes. Request a new code.',
      });

      expect(otps.markUsed).toHaveBeenCalledWith(7);
    });

    it('does not leak whether an account exists on a wrong code', async () => {
      vi.mocked(users.findByEmail).mockResolvedValue(activeUser);
      vi.mocked(otps.findActiveCode).mockResolvedValue(null);
      vi.mocked(otps.findByUserIdAndType).mockResolvedValue(null);
      vi.mocked(otps.findLatestActive).mockResolvedValue(null);

      await expect(
        service.resetPassword({
          email: 'jane@example.com',
          code: '000000',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toMatchObject({ message: 'Invalid code.' });
    });
  });

  describe('2FA enrollment (pending secret)', () => {
    it('persists a server-generated pending secret on enable and does not enroll yet', async () => {
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      const result = await service.enable2fa(1, {});

      expect(result.secret).toBe('test-secret');
      expect(result.otpAuthUri).toContain('otpauth://');
      expect(dbMock.sets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ twoFactorPendingSecret: 'enc:test-secret' }),
        ]),
      );
      expect(dbMock.sets.every((values) => values.twoFactorEnabled !== true)).toBe(true);
    });

    it('promotes the pending secret after validating the submitted TOTP', async () => {
      vi.mocked(users.findById).mockResolvedValue({
        ...activeUser,
        twoFactorPendingSecret: 'enc-pending',
      });
      vi.mocked(totpService.decryptSecret).mockReturnValueOnce('pending-secret');

      const result = await service.verify2fa(1, { code: '123456' });

      expect(result.message).toBe('Two-factor authentication enabled.');
      expect(dbMock.transaction).toHaveBeenCalledTimes(1);
      expect(dbMock.sets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            twoFactorEnabled: true,
            twoFactorSecret: 'enc:pending-secret',
            twoFactorPendingSecret: null,
          }),
        ]),
      );
    });

    it('refuses to enroll when no pending secret was issued', async () => {
      vi.mocked(users.findById).mockResolvedValue(activeUser);

      await expect(service.verify2fa(1, { code: '123456' })).rejects.toMatchObject({
        message: 'Enable two-factor authentication first.',
      });
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });

    it('verifies against the stored secret when 2FA is already enabled', async () => {
      vi.mocked(users.findById).mockResolvedValue({
        ...activeUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'enc-enrolled',
      });
      vi.mocked(totpService.decryptSecret).mockReturnValueOnce('enrolled-secret');

      await service.verify2fa(1, { code: '123456' });

      expect(totpService.decryptSecret).toHaveBeenCalledWith('enc-enrolled');
      expect(totpService.validateCode).toHaveBeenCalledWith('enrolled-secret', '123456');
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });
  });

  describe('2FA disable (password + TOTP step-up)', () => {
    it('rejects a wrong password without changing enrollment state', async () => {
      vi.mocked(users.findById).mockResolvedValue({
        ...activeUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'enc-enrolled',
      });

      await expect(
        service.disable2fa(1, { code: '123456', password: 'wrong-password' }),
      ).rejects.toMatchObject({ message: 'Password is incorrect.' });

      expect(dbMock.sets).toHaveLength(0);
    });

    it('rejects a wrong TOTP code even when the password is correct', async () => {
      vi.mocked(users.findById).mockResolvedValue({
        ...activeUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'enc-enrolled',
      });
      vi.mocked(totpService.decryptSecret).mockReturnValueOnce('enrolled-secret');
      vi.mocked(totpService.validateCode).mockResolvedValueOnce(false);

      await expect(
        service.disable2fa(1, { code: '000000', password: 'Password123!' }),
      ).rejects.toMatchObject({ message: 'Invalid two-factor authentication code.' });

      expect(dbMock.sets).toHaveLength(0);
    });

    it('disables 2FA when both the password and TOTP code are valid', async () => {
      vi.mocked(users.findById).mockResolvedValue({
        ...activeUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'enc-enrolled',
      });

      const result = await service.disable2fa(1, {
        code: '123456',
        password: 'Password123!',
      });

      expect(result.message).toBe('Two-factor authentication disabled.');
      expect(dbMock.sets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            twoFactorEnabled: false,
            twoFactorSecret: null,
            twoFactorPendingSecret: null,
          }),
        ]),
      );
    });
  });
});