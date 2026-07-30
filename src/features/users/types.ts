import type { UserStatus } from '../../shared/constants';
import type { RoleWithPermissions } from '../roles/types';

/** Internal user persistence model backed by MySQL. */
export interface UserEntity {
  userId: number;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  fullName: string | null;
  isActive: boolean;
  isBanned: boolean;
  deletedAt: Date | null;
  /** Derived application status; not a persisted MySQL column. */
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithRoles extends UserEntity {
  roles: Array<{
    role: RoleWithPermissions;
  }>;
}

export interface ListUsersFilter {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  status?: UserStatus;
}
