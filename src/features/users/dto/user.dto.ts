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
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}
