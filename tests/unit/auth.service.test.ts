import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserStatus } from '../../src/shared/constants';
import { AuthService } from '../../src/features/auth/services/auth.service';
import type { IUserRepository } from '../../src/features/users/repositories/user.repository';
import type { IRefreshTokenRepository } from '../../src/features/auth/repositories/refresh-token.repository';
import type { IRoleRepository } from '../../src/features/roles/repositories/role.repository';
import type { UserWithRoles } from '../../src/features/users/types';
import { UserService } from '../../src/features/users/services/user.service';
import { UnauthorizedError } from '../../src/shared/errors';

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
    verifyRefreshToken: vi.fn(),
  },
}));

const activeUser: UserWithRoles = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'jane@example.com',
  passwordHash: 'hashed-password',
  firstName: 'Jane',
  lastName: 'Doe',
  status: UserStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
  roles: [
    {
      role: {
        id: 'role-user-id',
        name: 'USER',
        permissions: [],
      },
    },
  ],
};

describe('AuthService', () => {
  let users: IUserRepository;
  let refreshTokens: IRefreshTokenRepository;
  let roles: IRoleRepository;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
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
    roles = {
      findById: vi.fn(),
      findByName: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    };
    service = new AuthService(users, refreshTokens, new UserService(users), roles);
  });

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
  });

  it('rejects invalid credentials', async () => {
    vi.mocked(users.findByEmail).mockResolvedValue(activeUser);

    await expect(
      service.login({
        email: 'jane@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
