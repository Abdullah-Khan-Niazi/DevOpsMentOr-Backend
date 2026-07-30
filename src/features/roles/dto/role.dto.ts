export interface CreateRoleDto {
  roleName: string;
  description?: string;
  priority?: number;
  permissionIds?: number[];
}

export interface UpdateRoleDto {
  roleName?: string;
  description?: string;
  priority?: number;
  permissionIds?: number[];
}

export interface RoleResponseDto {
  id: number;
  roleName: string;
  description: string | null;
  priority: number;
  permissions: string[];
  createdAt: Date;
}
