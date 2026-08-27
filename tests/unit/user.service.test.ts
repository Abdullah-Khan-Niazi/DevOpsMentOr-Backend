import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserStatus } from '../../src/shared/constants';
import { UserService } from '../../src/features/users/services/user.service';
import type { IUserRepository } from '../../src/features/users/repositories/user.repository';
import type { UserWithRoles } from '../../src/features/users/types';
import { ConflictError, NotFoundError } from '../../src/shared/errors';

vi.mock('../../src/shared/services', () => ({
  passwordService: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(async () => true),
  },
  tokenService: {},
}));

const baseUser: UserWithRoles = {
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  roles: [
    {
      role: {
        id: 1,
        roleName: 'USER',
        description: null,
        priority: 0,
        createdAt: new Date(),
        permissions: [
          {
            permission: {
              id: 1,
              permissionName: 'dashboard:read',
              description: null,
              module: null,
              createdAt: new Date(),
            },
          },
        ],
      },
    },
  ],
};

describe('UserService', () => {
  let repository: IUserRepository;
  let service: UserService;

  beforeEach(() => {
    repository = {
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
    service = new UserService(repository);
  });

  it('creates a user when email is unique', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(null);
    vi.mocked(repository.create).mockResolvedValue(baseUser);

    const result = await service.createUser({
      email: 'jane@example.com',
      password: 'Password123!',
      username: 'janedoe',
      fullName: 'Jane Doe',
    });

    expect(result.email).toBe('jane@example.com');
    expect(result.roles).toEqual(['USER']);
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it('throws ConflictError when email already exists', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(baseUser);

    await expect(
      service.createUser({
        email: 'jane@example.com',
        password: 'Password123!',
        username: 'janedoe',
        fullName: 'Jane Doe',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(repository.findById).mockResolvedValue(null);

    await expect(service.getUserById(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('extracts unique permissions from roles', () => {
    const permissions = service.extractPermissions(baseUser);
    expect(permissions).toEqual(['dashboard:read']);
  });
});
