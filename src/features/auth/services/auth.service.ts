import { ConflictError } from '../../../shared/errors';
import { passwordService } from '../../../shared/services';
import { ROLES } from '../../../shared/constants';

import type { AuthResponseDto, RegisterDto } from '../dto/auth.dto';

import type { IUserRepository } from '../../users/repositories/user.repository';
import { userRepository } from '../../users/repositories/user.repository';

import { UserService, userService } from '../../users/services/user.service';

import type { IRoleRepository } from '../../roles/repositories/role.repository';
import { roleRepository } from '../../roles/repositories/role.repository';

export class AuthService {
  constructor(
    private readonly users: IUserRepository = userRepository,
    private readonly userSvc: UserService = userService,
    private readonly roles: IRoleRepository = roleRepository,
  ) {}

  async register(input: RegisterDto): Promise<AuthResponseDto> {
    const existingEmail = await this.users.findByEmail(input.email);

    if (existingEmail) {
      throw new ConflictError('A user with this email already exists.');
    }

    const existingUsername = await this.users.findByUsername(input.username);

    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const defaultRole = await this.roles.findByName(ROLES.USER);

    const passwordHash = await passwordService.hash(input.password);

    const user = await this.users.create({
      username: input.username,
      email: input.email,
      passwordHash,
      salt: '',
      fullName: input.fullName,
      roleIds: defaultRole ? [defaultRole.id] : [],
    });

    return {
      user: this.userSvc.toResponse(user),
      tokens: {
        accessToken: '',
        refreshToken: '',
      },
    };
  }
}

export const authService = new AuthService();