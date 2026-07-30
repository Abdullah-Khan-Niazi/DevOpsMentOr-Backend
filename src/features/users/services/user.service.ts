import { ConflictError, NotFoundError } from '../../../shared/errors';
import { passwordService } from '../../../shared/services';
import { buildPaginationMeta } from '../../../shared/utils';
import type { PaginatedData } from '../../../shared/types';

import type {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
} from '../dto/user.dto';

import type { IUserRepository } from '../repositories/user.repository';
import { userRepository } from '../repositories/user.repository';

import type {
  ListUsersFilter,
  UserWithRoles,
} from '../types';

export class UserService {
  constructor(
    private readonly users: IUserRepository = userRepository,
  ) {}

  async createUser(input: CreateUserDto): Promise<UserResponseDto> {
    const existingEmail = await this.users.findByEmail(input.email);

    if (existingEmail) {
      throw new ConflictError(
        'A user with this email already exists.',
      );
    }

    const existingUsername = await this.users.findByUsername(
      input.username,
    );

    if (existingUsername) {
      throw new ConflictError(
        'A user with this username already exists.',
      );
    }

    const passwordHash = await passwordService.hash(
      input.password,
    );

    const user = await this.users.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt: '',
      fullName: input.fullName,
      status: input.status,
      roleIds: input.roleIds,
    });

    return this.toResponse(user);
  }

  async getUsers(
    filter: ListUsersFilter,
  ): Promise<PaginatedData<UserResponseDto>> {
    const { items, total } =
      await this.users.findMany(filter);

    return {
      items: items.map((user) => this.toResponse(user)),
      pagination: buildPaginationMeta(
        filter.page,
        filter.limit,
        total,
      ),
    };
  }

  async getUserById(
    id: number,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(id);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return this.toResponse(user);
  }

  async updateUser(
    id: number,
    input: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new NotFoundError('User not found.');
    }

    const user = await this.users.update(id, input);

    return this.toResponse(user);
  }

  async deleteUser(id: number): Promise<void> {
    const existing = await this.users.findById(id);

    if (!existing) {
      throw new NotFoundError('User not found.');
    }

    await this.users.delete(id);
  }

  toResponse(user: UserWithRoles): UserResponseDto {
    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      roles: user.roles.map(
        (item) => item.role.roleName,
      ),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  extractPermissions(user: UserWithRoles): string[] {
    const permissions = new Set<string>();

    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(
          rolePermission.permission.permissionName,
        );
      }
    }

    return [...permissions];
  }
}

export const userService = new UserService();