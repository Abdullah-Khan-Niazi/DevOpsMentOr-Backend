import type { UserStatus } from '../../../shared/constants';

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roleIds?: string[];
  status?: UserStatus;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  status?: UserStatus;
  roleIds?: string[];
}

export interface UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}
