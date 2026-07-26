import bcrypt from 'bcryptjs';
import { env } from '../../app/config/env';

export class PasswordService {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  }

  async compare(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}

export const passwordService = new PasswordService();
