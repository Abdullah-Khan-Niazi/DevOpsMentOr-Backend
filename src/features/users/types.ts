import type { UserStatus } from '../../shared/constants';

export interface UserEntity {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithRoles extends UserEntity {
  roles: Array<{
    role: {
      id: string;
      name: string;
      permissions: Array<{
        permission: {
          id: string;
          name: string;
        };
      }>;
    };
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
