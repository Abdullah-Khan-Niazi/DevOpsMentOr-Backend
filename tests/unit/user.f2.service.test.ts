import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserService } from '../../src/features/users/services/user.service';
import type { IUserRepository } from '../../src/features/users/repositories/user.repository';
import type { IUserProfileRepository, UpdateProfileInput } from '../../src/features/users/repositories/user-profile.repository';
import type { IUserSkillRepository } from '../../src/features/users/repositories/user-skill.repository';
import type { IFollowRepository } from '../../src/features/users/repositories/follow.repository';
import type { IUserSettingRepository } from '../../src/features/users/repositories/user-setting.repository';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import type { UserWithRoles } from '../../src/features/users/types';

vi.mock('../../src/shared/services', () => ({
  passwordService: { hash: vi.fn(async () => 'x'), compare: vi.fn(async () => true) },
  tokenService: {},
}));

vi.mock('../../src/app/cache/redis', () => ({
  cacheKeys: { learnerPoolStats: () => 'lp_stats' },
  redisClient: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') },
}));

vi.mock('../../src/features/users/services/upload.service', () => ({
  saveImageUpload: vi.fn(),
}));

import { saveImageUpload } from '../../src/features/users/services/upload.service';

const mockSaveImageUpload = vi.mocked(saveImageUpload);

const validFile = {
  fieldname: 'avatar',
  originalname: 'pic.png',
  encoding: '7bit',
  mimetype: 'image/png',
  size: 1024,
  buffer: Buffer.from('png'),
} as Express.Multer.File;

const baseUser: UserWithRoles = {
  userId: 1,
  username: 'janedoe',
  email: 'jane@example.com',
  passwordHash: 'x',
  salt: '',
  fullName: 'Jane Doe',
  displayName: null,
  bio: null,
  avatarUrl: null,
  coverPhotoUrl: null,
  isActive: true,
  isBanned: false,
  isVerified: true,
  banReason: null,
  lastLoginAt: null,
  lastLoginIp: null,
  registrationIp: null,
  timezone: 'UTC',
  language: 'en',
  twoFactorEnabled: false,
  twoFactorSecret: null,
  deletedAt: null,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  roles: [
    {
      role: {
        id: 1,
        roleName: 'individual_learner',
        description: null,
        priority: 0,
        createdAt: new Date(),
        permissions: [
          {
            permission: { id: 1, permissionName: 'users:profile:update', description: null, module: 'users', createdAt: new Date() },
          },
        ],
      },
    },
  ],
};

type ProfileResult = Awaited<ReturnType<IUserProfileRepository['findByUserId']>>;

function profileResult(overrides: Partial<ProfileResult> = {}): ProfileResult {
  return {
    profileId: 1,
    userId: 1,
    countryId: null,
    city: null,
    occupation: null,
    company: null,
    website: null,
    githubUrl: null,
    linkedinUrl: null,
    twitterHandle: null,
    discordUsername: null,
    reputationScore: 0,
    profileViews: 0,
    isPublic: true,
    country: null,
    ...overrides,
  };
}

describe('UserService (F2)', () => {
  let usersRepo: { findById: ReturnType<typeof vi.fn> };
  let profilesRepo: {
    findByUserId: ReturnType<typeof vi.fn>;
    upsertProfile: ReturnType<typeof vi.fn>;
    updateUsersRow: ReturnType<typeof vi.fn>;
    updateAvatarUrl: ReturnType<typeof vi.fn>;
    incrementProfileViews: ReturnType<typeof vi.fn>;
  };
  let skillsRepo: {
    findCatalogSkill: ReturnType<typeof vi.fn>;
    findByUserAndSkill: ReturnType<typeof vi.fn>;
    addSkill: ReturnType<typeof vi.fn>;
    listMySkills: ReturnType<typeof vi.fn>;
  };
  let followRepo: {
    exists: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    countFollowers: ReturnType<typeof vi.fn>;
    countFollowing: ReturnType<typeof vi.fn>;
  };
  let settingsRepo: { listByUser: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  let fileRepo: { create: ReturnType<typeof vi.fn> };
  let service: UserService;

  beforeEach(() => {
    usersRepo = { findById: vi.fn(async () => baseUser) };
    profilesRepo = {
      findByUserId: vi.fn(async () => profileResult()),
      upsertProfile: vi.fn(async (userId: number, input: UpdateProfileInput) => profileResult({ ...input })),
      updateUsersRow: vi.fn(async () => ({ fullName: 'Jane Doe', displayName: null, bio: null, avatarUrl: null })),
      updateAvatarUrl: vi.fn(async () => undefined),
      incrementProfileViews: vi.fn(async () => undefined),
    };
    skillsRepo = {
      findCatalogSkill: vi.fn(async () => ({ skillId: 3, skillName: 'Docker', category: 'cloud' as const, description: null })),
      findByUserAndSkill: vi.fn(async () => null),
      addSkill: vi.fn(async () => ({
        skillId: 3,
        skillName: 'Docker',
        category: 'cloud' as const,
        proficiencyLevel: 'beginner' as const,
        yearsExperience: 0,
        isVerified: false,
      })),
      listMySkills: vi.fn(async () => []),
    };
    followRepo = {
      exists: vi.fn(async () => false),
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      countFollowers: vi.fn(async () => 0),
      countFollowing: vi.fn(async () => 0),
    };
    settingsRepo = {
      listByUser: vi.fn(async () => []),
      upsert: vi.fn(async () => undefined),
    };
    fileRepo = { create: vi.fn(async () => undefined) };
    mockSaveImageUpload.mockReset();
    mockSaveImageUpload.mockResolvedValue({
      fileName: 'avatar-1.png',
      filePath: 'uploads/avatar-1.png',
      urlPath: '/uploads/avatar-1.png',
      fileHash: 'abc123',
    });

    service = new UserService(
      usersRepo as unknown as IUserRepository,
      profilesRepo as unknown as IUserProfileRepository,
      skillsRepo as unknown as IUserSkillRepository,
      followRepo as unknown as IFollowRepository,
      settingsRepo as unknown as IUserSettingRepository,
      fileRepo as unknown as { create: (record: unknown) => Promise<void> },
    );
  });

  describe('updateMyProfile', () => {
    it('delegates to the profile UPSERT and returns the merged profile', async () => {
      profilesRepo.upsertProfile.mockResolvedValueOnce(
        profileResult({ isPublic: true, country: { countryId: 5, countryName: 'Germany' } }),
      );

      const result = await service.updateMyProfile(1, { bio: 'DevOps' });

      expect(profilesRepo.upsertProfile).toHaveBeenCalledWith(1, { bio: 'DevOps' });
      expect(profilesRepo.updateUsersRow).toHaveBeenCalledWith(1, { bio: 'DevOps' });
      expect(result.isPublic).toBe(true);
      expect(result.country).toEqual({ countryId: 5, countryName: 'Germany' });
    });
  });

  describe('addSkill', () => {
    it('inserts a skill from the catalog', async () => {
      const result = await service.addSkill(1, { skillId: 3, proficiencyLevel: 'advanced', yearsExperience: 3 });

      expect(skillsRepo.addSkill).toHaveBeenCalledWith(1, 3, 'advanced', 3);
      expect(result.skillName).toBe('Docker');
    });

    it('rejects a skill not present in the catalog', async () => {
      skillsRepo.findCatalogSkill.mockResolvedValueOnce(null);
      await expect(service.addSkill(1, { skillId: 77 })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects duplicates with 409 Conflict', async () => {
      skillsRepo.findByUserAndSkill.mockResolvedValueOnce({
        skillId: 3,
        skillName: 'Docker',
        category: 'cloud' as const,
        proficiencyLevel: 'beginner' as const,
        yearsExperience: 0,
        isVerified: false,
      });
      await expect(service.addSkill(1, { skillId: 3 })).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('getPublicProfile', () => {
    it('allows anonymous reads only for public profiles', async () => {
      profilesRepo.findByUserId.mockResolvedValueOnce(profileResult({ isPublic: true }));
      const result = await service.getPublicProfile(1, null);
      expect(result.userId).toBe(1);
    });

    it('blocks anonymous reads of private profiles with 403', async () => {
      profilesRepo.findByUserId.mockResolvedValueOnce(profileResult({ isPublic: false }));
      await expect(service.getPublicProfile(1, null)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('treats a missing profile record as non-public (invariant 9)', async () => {
      profilesRepo.findByUserId.mockResolvedValueOnce(null);
      await expect(service.getPublicProfile(1, null)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('lets the owner read their own private profile', async () => {
      profilesRepo.findByUserId.mockResolvedValueOnce(profileResult({ isPublic: false }));
      const result = await service.getPublicProfile(1, { userId: 1, hasUserRead: false });
      expect(result.userId).toBe(1);
    });

    it('lets an admin (platform.users.read) read any private profile', async () => {
      usersRepo.findById.mockResolvedValueOnce({ ...baseUser, userId: 2 });
      profilesRepo.findByUserId.mockResolvedValueOnce(profileResult({ userId: 2, isPublic: false }));
      const result = await service.getPublicProfile(2, { userId: 9, hasUserRead: true });
      expect(result.userId).toBe(2);
    });

    it('increments profile views only for non-owner views', async () => {
      await service.getPublicProfile(1, { userId: 2, hasUserRead: false });
      expect(profilesRepo.incrementProfileViews).toHaveBeenCalledWith(1);
    });

    it('does not increment views for the owner', async () => {
      await service.getPublicProfile(1, { userId: 1, hasUserRead: false });
      expect(profilesRepo.incrementProfileViews).not.toHaveBeenCalled();
    });
  });

  describe('followUser / unfollowUser', () => {
    it('rejects self-follow with 400', async () => {
      await expect(service.followUser(1, 1)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects following a missing user with 404', async () => {
      usersRepo.findById.mockResolvedValueOnce(null);
      await expect(service.followUser(1, 99)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects duplicate follow with 409', async () => {
      followRepo.exists.mockResolvedValueOnce(true);
      await expect(service.followUser(1, 2)).rejects.toBeInstanceOf(ConflictError);
    });

    it('follows successfully', async () => {
      const result = await service.followUser(1, 2);
      expect(followRepo.add).toHaveBeenCalledWith(1, 2);
      expect(result.isFollowing).toBe(true);
    });

    it('rejects unfollow when not following with 404', async () => {
      followRepo.exists.mockResolvedValueOnce(false);
      await expect(service.unfollowUser(1, 2)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

describe('uploadAvatar (F2 §11)', () => {
    it('persists the file record first, then updates avatar_url', async () => {
      const result = await service.uploadAvatar(1, validFile, '127.0.0.1');

      expect(mockSaveImageUpload).toHaveBeenCalledWith(validFile, 'avatar', 1);
      expect(fileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          fileName: 'avatar-1.png',
          filePath: 'uploads/avatar-1.png',
          fileSizeBytes: 1024,
          mimeType: 'image/png',
          isPublic: true,
          uploadIp: '127.0.0.1',
        }),
      );
      expect(profilesRepo.updateAvatarUrl).toHaveBeenCalledWith(1, '/uploads/avatar-1.png');
      expect(result.avatarUrl).toBe('/uploads/avatar-1.png');
    });

    it('propagates 400 when the file is oversized (LIMIT_FILE_SIZE)', async () => {
      const oversized = { ...validFile, size: 6 * 1024 * 1024 };
      mockSaveImageUpload.mockRejectedValueOnce(
        Object.assign(new Error('File too large.'), { statusCode: 400 }),
      );
      await expect(service.uploadAvatar(1, oversized, null)).rejects.toMatchObject({ statusCode: 400 });
      expect(fileRepo.create).not.toHaveBeenCalled();
      expect(profilesRepo.updateAvatarUrl).not.toHaveBeenCalled();
    });

    it('propagates 415 when the MIME type is not allowed', async () => {
      const pdf = { ...validFile, mimetype: 'application/pdf' };
      mockSaveImageUpload.mockRejectedValueOnce(
        Object.assign(new Error('Unsupported file type.'), { statusCode: 415 }),
      );
      await expect(service.uploadAvatar(1, pdf, null)).rejects.toMatchObject({ statusCode: 415 });
      expect(fileRepo.create).not.toHaveBeenCalled();
      expect(profilesRepo.updateAvatarUrl).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('upserts every key and returns the full setting list', async () => {
      settingsRepo.listByUser.mockResolvedValueOnce([
        { settingKey: 'theme', settingValue: 'dark' },
        { settingKey: 'notify_email', settingValue: false },
      ]);

      const result = await service.updateSettings(1, [
        { key: 'theme', value: 'dark' },
        { key: 'notify_email', value: false },
      ]);

      expect(settingsRepo.upsert).toHaveBeenCalledTimes(2);
      expect(settingsRepo.upsert).toHaveBeenCalledWith(1, 'theme', 'dark');
      expect(result).toHaveLength(2);
    });
  });
});