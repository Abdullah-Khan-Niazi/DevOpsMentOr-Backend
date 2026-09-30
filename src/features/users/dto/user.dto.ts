import type { UserStatus } from '../../../shared/constants';

export interface CreateUserDto {
  username: string;
  email: string;
  password: string;
  fullName: string;
  roleIds?: number[];
  status?: UserStatus;
}

export interface UpdateUserDto {
  username?: string;
  fullName?: string;
  status?: UserStatus;
  roleIds?: number[];
}

export interface UserResponseDto {
  userId: number;
  username: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  isVerified?: boolean;
  twoFactorEnabled?: boolean;
  roles: string[];
  permissions?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** USR-01: own session identity. Mirrors the F1 `/auth/me` shape. */
export interface MeResponseDto {
  userId: number;
  username: string;
  email: string;
  fullName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  roles: string[];
  permissions: string[];
}

/** USR-02: profile UPSERT response (F2 §07 ProfileResponseSchema). */
export interface ProfileResponseDto {
  userId: number;
  fullName: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  country: { countryId: number; countryName: string } | null;
}

/** USR-05/06/07: user skill mapping row. */
export interface UserSkillDto {
  skillId: number;
  skillName: string;
  category: SkillCategory;
  proficiencyLevel: ProficiencyLevel;
  yearsExperience: number;
  isVerified: boolean;
}

/** USR-13: skills catalog entry. */
export interface SkillDto {
  skillId: number;
  skillName: string;
  category: SkillCategory;
  description: string | null;
}

/** USR-14: countries catalog entry. */
export interface CountryDto {
  countryId: number;
  countryCode: string;
  countryName: string;
  phoneCode: string | null;
  flagEmoji: string | null;
}

/** USR-08/09: user setting key/value pair. */
export interface UserSettingDto {
  settingKey: string;
  settingValue: unknown;
}

/** USR-10: public profile view. */
export interface PublicProfileDto {
  userId: number;
  username: string;
  fullName: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverPhotoUrl: string | null;
  occupation: string | null;
  city: string | null;
  company: string | null;
  website: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  twitterHandle: string | null;
  discordUsername: string | null;
  country: { countryId: number; countryName: string } | null;
  isPublic: boolean;
  skills: UserSkillDto[];
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
}

/** Forward hook (F2 §02): lightweight user card for F3/F6 consumption. */
export interface UserSnapshotDto {
  userId: number;
  fullName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string;
  isActive: boolean;
  isBanned: boolean;
}

/** Forward hook (F2 §02): individual learner pool aggregate. */
export interface LearnerPoolStatsDto {
  totalCount: number;
  activeCount: number;
}

export type SkillCategory =
  | 'offensive'
  | 'defensive'
  | 'forensics'
  | 'networking'
  | 'web'
  | 'mobile'
  | 'cloud'
  | 'ai_ml'
  | 'governance';

export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';