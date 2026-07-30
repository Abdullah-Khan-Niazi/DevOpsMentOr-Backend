import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../app/config/env';
import { UnauthorizedError } from '../errors';
import type { JwtPayload } from '../types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class TokenService {
  signAccessToken(payload: Omit<JwtPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  signRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  createTokenPair(payload: Omit<JwtPayload, 'type'>): TokenPair {
    const jti = randomUUID();

    const extendedPayload = { ...payload, jti };

    return {
      accessToken: this.signAccessToken(extendedPayload),
      refreshToken: this.signRefreshToken(extendedPayload),
    };
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
      if (payload.type !== 'access') {
        throw new UnauthorizedError('Invalid access token.');
      }
      return payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token.');
    }
  }

  verifyRefreshToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
      if (payload.type !== 'refresh') {
        throw new UnauthorizedError('Invalid refresh token.');
      }
      return payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }
  }

  getRefreshTokenExpiryDate(): Date {
    const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRES_IN);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * (multipliers[unit] ?? multipliers.d));
  }
}

export const tokenService = new TokenService();
