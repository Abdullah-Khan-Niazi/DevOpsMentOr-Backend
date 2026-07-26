export interface RoleEntity {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleWithPermissions extends RoleEntity {
  permissions: Array<{
    permission: {
      id: string;
      name: string;
      resource: string;
      action: string;
    };
  }>;
}

export interface ListRolesFilter {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}
