export interface CreatePermissionDto {
  permissionName: string;
  description?: string;
  module?: string;
}

export interface UpdatePermissionDto {
  permissionName?: string;
  description?: string;
  module?: string;
}

export interface PermissionResponseDto {
  id: number;
  permissionName: string;
  description: string | null;
  module: string | null;
  createdAt: Date;
}
