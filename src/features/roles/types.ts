import type { PermissionEntity } from '../permissions/types';

export interface RoleEntity {
  id: number;
  roleName: string;
  description: string | null;
  priority: number;
  createdAt: Date;
}

export interface RoleWithPermissions extends RoleEntity {
  permissions: Array<{
    permission: PermissionEntity;
  }>;
}

export interface ListRolesFilter {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}
