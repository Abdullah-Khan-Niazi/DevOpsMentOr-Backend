import { ConflictError, NotFoundError, BadRequestError, ForbiddenError } from '../../../shared/errors';
import { passwordService } from '../../../shared/services';
import { buildPaginationMeta } from '../../../shared/utils';
import { cacheKeys, redisClient } from '../../../app/cache/redis';
import type { PaginatedData } from '../../../shared/types';

import type {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  MeResponseDto,
  ProfileResponseDto,
  UserSkillDto,
  UserSettingDto,
  PublicProfileDto,
  UserSnapshotDto,
  LearnerPoolStatsDto,
  ProficiencyLevel,
} from '../dto/user.dto';

import type { IUserRepository } from '../repositories/user.repository';
import { userRepository } from '../repositories/user.repository';
import type { IUserProfileRepository, UpdateProfileInput } from '../repositories/user-profile.repository';
import { userProfileRepository } from '../repositories/user-profile.repository';
import type { IUserSkillRepository } from '../repositories/user-skill.repository';
import { userSkillRepository } from '../repositories/user-skill.repository';
import type { IFollowRepository } from '../repositories/follow.repository';
import { followRepository } from '../repositories/follow.repository';
import type { IUserSettingRepository } from '../repositories/user-setting.repository';
import { userSettingRepository } from '../repositories/user-setting.repository';
import type { IFileRepository } from '../repositories/file.repository';
import { fileRepository } from '../repositories/file.repository';
import { saveImageUpload } from './upload.service';
import { countries as countriesTable, roles, userRoles, users as usersTable } from '../../../app/database/schema';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../../../app/database';
import { ROLES } from '../../../shared/constants';

import type {
  ListUsersFilter,
  UserWithRoles,
} from '../types';

/** F2 §05 invariant 1: `is_public = false` (or absent profile) blocks public reads. */
export type PublicProfileViewer = { userId: number; hasUserRead: boolean } | null;

export class UserService {
  constructor(
    private readonly users: IUserRepository = userRepository,
    private readonly profiles: IUserProfileRepository = userProfileRepository,
    private readonly userSkills: IUserSkillRepository = userSkillRepository,
    private readonly follow: IFollowRepository = followRepository,
    private readonly settingsRepo: IUserSettingRepository = userSettingRepository,
    private readonly fileRecords: IFileRepository = fileRepository,
  ) {}

  async createUser(input: CreateUserDto): Promise<UserResponseDto> {
    const existingEmail = await this.users.findByEmail(input.email);

    if (existingEmail) {
      throw new ConflictError(
        'A user with this email already exists.',
      );
    }

    const existingUsername = await this.users.findByUsername(
      input.username,
    );

    if (existingUsername) {
      throw new ConflictError(
        'A user with this username already exists.',
      );
    }

    const passwordHash = await passwordService.hash(
      input.password,
    );

    const user = await this.users.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt: '',
      fullName: input.fullName,
      status: input.status,
      roleIds: input.roleIds,
    });

    return this.toResponse(user);
  }

  async getUsers(
    filter: ListUsersFilter,
  ): Promise<PaginatedData<UserResponseDto>> {
    const { items, total } =
      await this.users.findMany(filter);

    return {
      items: items.map((user) => this.toResponse(user)),
      pagination: buildPaginationMeta(
        filter.page,
        filter.limit,
        total,
      ),
    };
  }

  async getUserById(
    id: number,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(id);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return this.toResponse(user);
  }

  async updateUser(
    id: number,
    input: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new NotFoundError('User not found.');
    }

    const user = await this.users.update(id, input);

    return this.toResponse(user);
  }

  async deleteUser(id: number): Promise<void> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new NotFoundError('User not found.');
    }

    await this.users.delete(id);
  }

  toResponse(user: UserWithRoles): UserResponseDto {
    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      isVerified: user.isVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roles: user.roles.map(
        (item) => item.role.roleName,
      ),
      permissions: this.extractPermissions(user),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  extractPermissions(user: UserWithRoles): string[] {
    const permissions = new Set<string>();

    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(
          rolePermission.permission.permissionName,
        );
      }
    }

    return [...permissions];
  }

  // ─── F2 — Users / Profiles / Platform Administration ──────────────────────

  async getMe(userId: number): Promise<MeResponseDto> {
    const user = await this.users.findById(userId);

    if (!user || user.deletedAt) {
      throw new NotFoundError('User not found.');
    }

    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      roles: user.roles.map((r) => r.role.roleName),
      permissions: this.extractPermissions(user),
    };
  }

  async updateMyProfile(
    userId: number,
    input: UpdateProfileInput,
  ): Promise<ProfileResponseDto> {
    if (input.countryId) {
      const country = await this.countryExists(input.countryId);
      if (!country) {
        throw new BadRequestError('Invalid country.');
      }
    }

    const profile = await this.profiles.upsertProfile(userId, input);
    const userFields = await this.profiles.updateUsersRow(userId, input);

    return {
      userId,
      fullName: userFields.fullName,
      displayName: userFields.displayName,
      bio: userFields.bio,
      avatarUrl: userFields.avatarUrl,
      isPublic: profile.isPublic,
      country: profile.country,
    };
  }

  async uploadAvatar(
    userId: number,
    file: Express.Multer.File,
    ipAddress: string | null,
  ): Promise<{ avatarUrl: string }> {
    const saved = await saveImageUpload(file, 'avatar', userId);

    await this.fileRecords.create({
      userId,
      fileName: saved.fileName,
      filePath: saved.filePath,
      fileSizeBytes: file.size,
      mimeType: file.mimetype,
      fileHash: saved.fileHash,
      isPublic: true,
      uploadIp: ipAddress,
    });

    await this.profiles.updateAvatarUrl(userId, saved.urlPath);

    return { avatarUrl: saved.urlPath };
  }

  async uploadCover(
    userId: number,
    file: Express.Multer.File,
    ipAddress: string | null,
  ): Promise<{ coverPhotoUrl: string }> {
    const saved = await saveImageUpload(file, 'cover', userId);

    await this.fileRecords.create({
      userId,
      fileName: saved.fileName,
      filePath: saved.filePath,
      fileSizeBytes: file.size,
      mimeType: file.mimetype,
      fileHash: saved.fileHash,
      isPublic: true,
      uploadIp: ipAddress,
    });

    await this.profiles.updateCoverUrl(userId, saved.urlPath);

    return { coverPhotoUrl: saved.urlPath };
  }

  async getMySkills(userId: number): Promise<UserSkillDto[]> {
    return this.userSkills.listMySkills(userId);
  }

  async addSkill(
    userId: number,
    input: { skillId: number; proficiencyLevel?: ProficiencyLevel; yearsExperience?: number },
  ): Promise<UserSkillDto> {
    const catalogSkill = await this.userSkills.findCatalogSkill(input.skillId);
    if (!catalogSkill) {
      throw new NotFoundError('Skill not found in catalog.');
    }

    const existing = await this.userSkills.findByUserAndSkill(userId, input.skillId);
    if (existing) {
      throw new ConflictError('Skill already added.');
    }

    return this.userSkills.addSkill(
      userId,
      input.skillId,
      input.proficiencyLevel ?? 'beginner',
      input.yearsExperience ?? 0,
    );
  }

  async removeSkill(userId: number, skillId: number): Promise<void> {
    const existing = await this.userSkills.findByUserAndSkill(userId, skillId);
    if (!existing) {
      throw new NotFoundError('Skill not linked to your profile.');
    }
    await this.userSkills.removeSkill(userId, skillId);
  }

  async getSettings(userId: number): Promise<UserSettingDto[]> {
    return this.settingsRepo.listByUser(userId);
  }

  async updateSettings(
    userId: number,
    settings: Array<{ key: string; value: unknown }>,
  ): Promise<UserSettingDto[]> {
    for (const setting of settings) {
      await this.settingsRepo.upsert(userId, setting.key, setting.value);
    }
    return this.settingsRepo.listByUser(userId);
  }

  async getPublicProfile(
    targetUserId: number,
    viewer: PublicProfileViewer,
  ): Promise<PublicProfileDto> {
    const user = await this.users.findById(targetUserId);

    if (!user || user.deletedAt) {
      throw new NotFoundError('User not found.');
    }

    const profile = await this.profiles.findByUserId(targetUserId);
    const isPublic = profile?.isPublic ?? false;

    const canView =
      isPublic || (viewer !== null && (viewer.userId === targetUserId || viewer.hasUserRead));

    if (!canView) {
      throw new ForbiddenError('Profile is not public.');
    }

    if (profile && viewer?.userId !== targetUserId) {
      await this.profiles.incrementProfileViews(targetUserId);
    }

    const [skills, followersCount, followingCount, isFollowing] = await Promise.all([
      this.userSkills.listMySkills(targetUserId),
      this.follow.countFollowers(targetUserId),
      this.follow.countFollowing(targetUserId),
      viewer ? this.follow.exists(viewer.userId, targetUserId) : Promise.resolve(false),
    ]);

    return {
      userId: user.userId,
      username: user.username,
      fullName: user.fullName,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      coverPhotoUrl: user.coverPhotoUrl,
      occupation: profile?.occupation ?? null,
      city: profile?.city ?? null,
      company: profile?.company ?? null,
      website: profile?.website ?? null,
      githubUrl: profile?.githubUrl ?? null,
      linkedinUrl: profile?.linkedinUrl ?? null,
      twitterHandle: profile?.twitterHandle ?? null,
      discordUsername: profile?.discordUsername ?? null,
      country: profile?.country ?? null,
      isPublic,
      skills,
      followersCount,
      followingCount,
      isFollowing,
    };
  }

  async followUser(followerId: number, followingId: number): Promise<{ isFollowing: boolean }> {
    if (followerId === followingId) {
      throw new BadRequestError('You cannot follow yourself.');
    }

    const target = await this.users.findById(followingId);
    if (!target || target.deletedAt) {
      throw new NotFoundError('User not found.');
    }

    const alreadyFollowing = await this.follow.exists(followerId, followingId);
    if (alreadyFollowing) {
      throw new ConflictError('Already following this user.');
    }

    await this.follow.add(followerId, followingId);
    return { isFollowing: true };
  }

  async unfollowUser(followerId: number, followingId: number): Promise<{ isFollowing: boolean }> {
    const following = await this.follow.exists(followerId, followingId);
    if (!following) {
      throw new NotFoundError('Not following this user.');
    }

    await this.follow.remove(followerId, followingId);
    return { isFollowing: false };
  }

  async getSnapshot(userId: number): Promise<UserSnapshotDto> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundError('User not found.');
    }

    return {
      userId: user.userId,
      fullName: user.fullName,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      email: user.email,
      isActive: user.isActive,
      isBanned: user.isBanned,
    };
  }

  async getLearnerPoolStats(): Promise<LearnerPoolStatsDto> {
    const cached = await redisClient.get(cacheKeys.learnerPoolStats());
    if (cached) {
      return JSON.parse(cached) as LearnerPoolStatsDto;
    }

    const [totalRow, activeRow] = await Promise.all([
      db
        .select({ value: count() })
        .from(usersTable)
        .innerJoin(userRoles, eq(userRoles.userId, usersTable.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(
          and(
            eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
            isNull(usersTable.deletedAt),
          ),
        ),
      db
        .select({ value: count() })
        .from(usersTable)
        .innerJoin(userRoles, eq(userRoles.userId, usersTable.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(
          and(
            eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
            isNull(usersTable.deletedAt),
            eq(usersTable.isActive, true),
            eq(usersTable.isBanned, false),
          ),
        ),
    ]);

    const stats: LearnerPoolStatsDto = {
      totalCount: totalRow[0]?.value ?? 0,
      activeCount: activeRow[0]?.value ?? 0,
    };

    await redisClient.set(cacheKeys.learnerPoolStats(), JSON.stringify(stats), 'EX', 60);
    return stats;
  }

  private async countryExists(countryId: number): Promise<boolean> {
    const row = await db.query.countries.findFirst({
      where: eq(countriesTable.countryId, countryId),
    });
    return row !== undefined;
  }
}

export const userService = new UserService();