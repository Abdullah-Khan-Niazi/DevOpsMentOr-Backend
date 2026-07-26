export interface CreatePermissionDto {
  name: string;
  description?: string;
  resource: string;
  action: string;
}

export interface UpdatePermissionDto {
  name?: string;
  description?: string;
  resource?: string;
  action?: string;
}

export interface PermissionResponseDto {
  id: string;
  name: string;
  description: string | null;
  resource: string;
  action: string;
  createdAt: Date;
  updatedAt: Date;
}
