import { ConflictError, NotFoundError } from '../../../shared/errors';
import { buildPaginationMeta } from '../../../shared/utils';
import type { PaginatedData } from '../../../shared/types';
import type {
  CreatePermissionDto,
  PermissionResponseDto,
  UpdatePermissionDto,
} from '../dto/permission.dto';
import type { IPermissionRepository } from '../repositories/permission.repository';
import { permissionRepository } from '../repositories/permission.repository';
import type { ListPermissionsFilter, PermissionEntity } from '../types';

export class PermissionService {
  constructor(private readonly permissions: IPermissionRepository = permissionRepository) {}

  async createPermission(input: CreatePermissionDto): Promise<PermissionResponseDto> {
    const existing = await this.permissions.findByName(input.permissionName);
    if (existing) {
      throw new ConflictError('A permission with this name already exists.');
    }

    const permission = await this.permissions.create(input);
    return this.toResponse(permission);
  }

  async getPermissions(
    filter: ListPermissionsFilter,
  ): Promise<PaginatedData<PermissionResponseDto>> {
    const { items, total } = await this.permissions.findMany(filter);
    return {
      items: items.map((permission) => this.toResponse(permission)),
      pagination: buildPaginationMeta(filter.page, filter.limit, total),
    };
  }

  async getPermissionById(id: number): Promise<PermissionResponseDto> {
    const permission = await this.permissions.findById(id);
    if (!permission) {
      throw new NotFoundError('Permission not found.');
    }
    return this.toResponse(permission);
  }

  async updatePermission(id: number, input: UpdatePermissionDto): Promise<PermissionResponseDto> {
    const existing = await this.permissions.findById(id);
    if (!existing) {
      throw new NotFoundError('Permission not found.');
    }

    if (input.permissionName && input.permissionName !== existing.permissionName) {
      const duplicate = await this.permissions.findByName(input.permissionName);
      if (duplicate) {
        throw new ConflictError('A permission with this name already exists.');
      }
    }

    const permission = await this.permissions.update(id, input);
    return this.toResponse(permission);
  }

  async deletePermission(id: number): Promise<void> {
    const existing = await this.permissions.findById(id);
    if (!existing) {
      throw new NotFoundError('Permission not found.');
    }
    await this.permissions.delete(id);
  }

  private toResponse(permission: PermissionEntity): PermissionResponseDto {
    return {
      id: permission.id,
      permissionName: permission.permissionName,
      description: permission.description,
      module: permission.module,
      createdAt: permission.createdAt,
    };
  }
}

export const permissionService = new PermissionService();