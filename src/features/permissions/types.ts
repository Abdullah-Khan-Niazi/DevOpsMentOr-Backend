export interface PermissionEntity {
  id: number;
  permissionName: string;
  description: string | null;
  module: string | null;
  createdAt: Date;
}

export interface ListPermissionsFilter {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  module?: string;
}
