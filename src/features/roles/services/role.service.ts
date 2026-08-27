import { ConflictError, NotFoundError } from '../../../shared/errors';
import { buildPaginationMeta } from '../../../shared/utils';
import type { PaginatedData } from '../../../shared/types';
import type { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from '../dto/role.dto';
import type { IRoleRepository } from '../repositories/role.repository';
import { roleRepository } from '../repositories/role.repository';
import type { ListRolesFilter, RoleWithPermissions } from '../types';

export class RoleService {
  constructor(private readonly roles: IRoleRepository = roleRepository) {}

  async createRole(input: CreateRoleDto): Promise<RoleResponseDto> {
    const existing = await this.roles.findByName(input.roleName);
    if (existing) {
      throw new ConflictError('A role with this name already exists.');
    }

    const role = await this.roles.create(input);
    return this.toResponse(role);
  }

  async getRoles(filter: ListRolesFilter): Promise<PaginatedData<RoleResponseDto>> {
    const { items, total } = await this.roles.findMany(filter);
    return {
      items: items.map((role) => this.toResponse(role)),
      pagination: buildPaginationMeta(filter.page, filter.limit, total),
    };
  }

  async getRoleById(id: number): Promise<RoleResponseDto> {
    const role = await this.roles.findById(id);
    if (!role) {
      throw new NotFoundError('Role not found.');
    }
    return this.toResponse(role);
  }

  async updateRole(id: number, input: UpdateRoleDto): Promise<RoleResponseDto> {
    const existing = await this.roles.findById(id);
    if (!existing) {
      throw new NotFoundError('Role not found.');
    }

    if (input.roleName && input.roleName !== existing.roleName) {
      const duplicate = await this.roles.findByName(input.roleName);
      if (duplicate) {
        throw new ConflictError('A role with this name already exists.');
      }
    }

    const role = await this.roles.update(id, input);
    return this.toResponse(role);
  }

  async deleteRole(id: number): Promise<void> {
    const existing = await this.roles.findById(id);
    if (!existing) {
      throw new NotFoundError('Role not found.');
    }
    await this.roles.delete(id);
  }

  private toResponse(role: RoleWithPermissions): RoleResponseDto {
    return {
      id: role.id,
      roleName: role.roleName,
      description: role.description,
      priority: role.priority,
      permissions: role.permissions.map((item) => item.permission.permissionName),
      createdAt: role.createdAt,
    };
  }
}

export const roleService = new RoleService();
