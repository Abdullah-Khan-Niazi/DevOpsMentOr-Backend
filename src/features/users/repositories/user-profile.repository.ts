import { eq, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import { userProfiles, users as usersTable } from '../../../app/database/schema';

export interface UserProfileEntity {
  profileId: number;
  userId: number;
  countryId: number | null;
  city: string | null;
  occupation: string | null;
  company: string | null;
  website: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  twitterHandle: string | null;
  discordUsername: string | null;
  reputationScore: number;
  profileViews: number;
  isPublic: boolean;
  country: { countryId: number; countryName: string } | null;
}

export interface UpdateProfileInput {
  fullName?: string;
  displayName?: string;
  bio?: string;
  countryId?: number | null;
  city?: string | null;
  occupation?: string | null;
  company?: string | null;
  website?: string | null;
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  twitterHandle?: string | null;
  discordUsername?: string | null;
  isPublic?: boolean;
  timezone?: string;
  language?: string;
}

export interface IUserProfileRepository {
  findByUserId(userId: number): Promise<UserProfileEntity | null>;
  upsertProfile(userId: number, input: UpdateProfileInput): Promise<UserProfileEntity>;
  updateUsersRow(
    userId: number,
    input: UpdateProfileInput,
  ): Promise<{
    fullName: string | null;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  }>;
  updateAvatarUrl(userId: number, avatarUrl: string): Promise<void>;
  updateCoverUrl(userId: number, coverPhotoUrl: string): Promise<void>;
  incrementProfileViews(userId: number): Promise<void>;
}

export class UserProfileRepository implements IUserProfileRepository {
  async findByUserId(userId: number): Promise<UserProfileEntity | null> {
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      with: { country: true },
    });

    if (!profile) {
      return null;
    }

    return {
      profileId: profile.profileId,
      userId: profile.userId,
      countryId: profile.countryId,
      city: profile.city,
      occupation: profile.occupation,
      company: profile.company,
      website: profile.website,
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      twitterHandle: profile.twitterHandle,
      discordUsername: profile.discordUsername,
      reputationScore: profile.reputationScore,
      profileViews: profile.profileViews,
      isPublic: profile.isPublic,
      country: profile.country
        ? { countryId: profile.country.countryId, countryName: profile.country.countryName }
        : null,
    };
  }

  async upsertProfile(userId: number, input: UpdateProfileInput): Promise<UserProfileEntity> {
    const existing = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });

    if (existing) {
      const setValues = {
        ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
        ...(input.company !== undefined ? { company: input.company } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.githubUrl !== undefined ? { githubUrl: input.githubUrl } : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl } : {}),
        ...(input.twitterHandle !== undefined ? { twitterHandle: input.twitterHandle } : {}),
        ...(input.discordUsername !== undefined ? { discordUsername: input.discordUsername } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      };
      if (Object.keys(setValues).length > 0) {
        await db
          .update(userProfiles)
          .set(setValues)
          .where(eq(userProfiles.userId, userId));
      }
    } else {
      await db.insert(userProfiles).values({
        userId,
        countryId: input.countryId ?? null,
        city: input.city ?? null,
        occupation: input.occupation ?? null,
        company: input.company ?? null,
        website: input.website ?? null,
        githubUrl: input.githubUrl ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        twitterHandle: input.twitterHandle ?? null,
        discordUsername: input.discordUsername ?? null,
        isPublic: input.isPublic ?? true,
      });
    }

    const result = await this.findByUserId(userId);
    if (!result) {
      throw new Error('Profile upsert failed.');
    }
    return result;
  }

  async updateUsersRow(
    userId: number,
    input: UpdateProfileInput,
  ): Promise<{ fullName: string | null; displayName: string | null; bio: string | null; avatarUrl: string | null }> {
    const setValues = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
    };

    if (Object.keys(setValues).length > 0) {
      await db
        .update(usersTable)
        .set(setValues)
        .where(eq(usersTable.userId, userId));
    }

    const row = await db.query.users.findFirst({
      where: eq(usersTable.userId, userId),
      columns: { fullName: true, displayName: true, bio: true, avatarUrl: true },
    });

    return {
      fullName: row?.fullName ?? null,
      displayName: row?.displayName ?? null,
      bio: row?.bio ?? null,
      avatarUrl: row?.avatarUrl ?? null,
    };
  }

  async updateAvatarUrl(userId: number, avatarUrl: string): Promise<void> {
    await db.update(usersTable).set({ avatarUrl }).where(eq(usersTable.userId, userId));
  }

  async updateCoverUrl(userId: number, coverPhotoUrl: string): Promise<void> {
    await db.update(usersTable).set({ coverPhotoUrl }).where(eq(usersTable.userId, userId));
  }

  async incrementProfileViews(userId: number): Promise<void> {
    await db
      .update(userProfiles)
      .set({ profileViews: sql`${userProfiles.profileViews} + 1` })
      .where(eq(userProfiles.userId, userId));
  }
}

export const userProfileRepository = new UserProfileRepository();