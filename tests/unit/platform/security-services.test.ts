import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { tokenService } from '../../../src/shared/services/token.service';
import { passwordService } from '../../../src/shared/services/password.service';
import { totpService } from '../../../src/shared/services/totp.service';
import {
  authorizeAnyPermissions,
  authorizePermissions,
  authorizeRoles,
} from '../../../src/shared/middleware/authorize.middleware';
import { UnauthorizedError, ForbiddenError } from '../../../src/shared/errors';
import { sanitizeEmail, sanitizeString } from '../../../src/shared/utils/sanitize';

// iat/exp are added by jsonwebtoken from the configured lifetimes; passing
// them here would conflict with `expiresIn` at signing time.
const basePayload = {
  sub: 7,
  email: 'student@example.com',
  roles: ['org_student'],
  permissions: ['enrollment:read'],
  jti: 'jti-1',
} as unknown as Parameters<typeof tokenService.signAccessToken>[0];

describe('TokenService (security-critical)', () => {
  it('signs and verifies an access token with all claims intact', () => {
    const token = tokenService.signAccessToken(basePayload);
    const decoded = tokenService.verifyAccessToken(token);
    expect(decoded).toMatchObject({
      sub: 7,
      email: 'student@example.com',
      roles: ['org_student'],
      permissions: ['enrollment:read'],
      type: 'access',
    });
  });

  it('signs and verifies a refresh token', () => {
    const token = tokenService.signRefreshToken({
      sub: 7,
      email: 'student@example.com',
      jti: 'refresh-1',
    });
    expect(tokenService.verifyRefreshToken(token)).toMatchObject({
      sub: 7,
      type: 'refresh',
      jti: 'refresh-1',
    });
  });

  it('refuses a refresh token on the access verifier', () => {
    const refresh = tokenService.signRefreshToken({
      sub: 7,
      email: 'student@example.com',
      jti: 'refresh-1',
    });
    expect(() => tokenService.verifyAccessToken(refresh)).toThrow(UnauthorizedError);
  });

  it('refuses an access token on the refresh verifier', () => {
    const access = tokenService.signAccessToken(basePayload);
    expect(() => tokenService.verifyRefreshToken(access)).toThrow(UnauthorizedError);
  });

  it('rejects a tampered token', () => {
    const access = tokenService.signAccessToken(basePayload);
    const tampered = `${access.slice(0, -2)}xx`;
    expect(() => tokenService.verifyAccessToken(tampered)).toThrow(UnauthorizedError);
  });

  it('createTokenPair issues unique jtis per pair', () => {
    const first = tokenService.createTokenPair(basePayload);
    const second = tokenService.createTokenPair(basePayload);
    expect(first.accessJti).not.toBe(second.accessJti);
    expect(first.refreshJti).not.toBe(second.refreshJti);
    expect(tokenService.verifyAccessToken(first.accessToken).type).toBe('access');
    expect(tokenService.verifyRefreshToken(second.refreshToken).type).toBe('refresh');
  });
});

describe('PasswordService', () => {
  // bcrypt at 12 rounds is intentionally slow; give it headroom under the
  // full parallel suite instead of relying on the 5s default.
  it('hashes with a random salt and verifies correctly', async () => {
    const hash = await passwordService.hash('Admin@12345');
    expect(hash).not.toContain('Admin@12345');
    expect(await passwordService.compare('Admin@12345', hash)).toBe(true);
    expect(await passwordService.compare('wrong-password', hash)).toBe(false);
  }, 30000);

  it('produces a different hash for the same password (salted)', async () => {
    const [a, b] = await Promise.all([
      passwordService.hash('same-password'),
      passwordService.hash('same-password'),
    ]);
    expect(a).not.toBe(b);
  }, 30000);
});

describe('TotpService', () => {
  it('round-trips an encrypted secret and rejects tampering', () => {
    const secret = totpService.generateSecret();
    const encrypted = totpService.encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(totpService.decryptSecret(encrypted)).toBe(secret);

    const parts = encrypted.split(':');
    parts[2] = `${parts[2].slice(0, -4)}AAAA`;
    expect(() => totpService.decryptSecret(parts.join(':'))).toThrow();
  });

  it('validates a freshly generated code and refuses a wrong one', async () => {
    const secret = totpService.generateSecret();
    const code = await totpService.generateCode(secret);
    expect(await totpService.validateCode(secret, code)).toBe(true);
    expect(await totpService.validateCode(secret, '000000')).toBe(false);
  });

  it('throws on malformed payloads', () => {
    expect(() => totpService.decryptSecret('not-a-payload')).toThrow(/Malformed/);
  });
});

describe('authorize middleware', () => {
  const reqWith = (roles: string[], permissions: string[]) =>
    ({ user: { roles, permissions } }) as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;

  it('authorizeRoles allows a held role and blocks the rest', () => {
    expect(() => authorizeRoles('org_admin')(reqWith(['org_admin'], []), res, next)).not.toThrow();
    expect(() => authorizeRoles('org_admin')(reqWith(['professor'], []), res, next)).toThrow(
      ForbiddenError,
    );
  });

  it('authorizePermissions requires every permission', () => {
    expect(() =>
      authorizePermissions('a', 'b')(reqWith([], ['a', 'b']), res, next),
    ).not.toThrow();
    expect(() => authorizePermissions('a', 'b')(reqWith([], ['a']), res, next)).toThrow(
      ForbiddenError,
    );
  });

  it('authorizeAnyPermissions requires at least one', () => {
    expect(() =>
      authorizeAnyPermissions('a', 'b')(reqWith([], ['b']), res, next),
    ).not.toThrow();
    expect(() => authorizeAnyPermissions('a', 'b')(reqWith([], ['c']), res, next)).toThrow(
      ForbiddenError,
    );
  });

  it('rejects unauthenticated requests with Unauthorized', () => {
    expect(() =>
      authorizeRoles('org_admin')({} as Request, res, next),
    ).toThrow(UnauthorizedError);
  });
});

describe('sanitize utils', () => {
  it('sanitizeString trims and collapses whitespace', () => {
    expect(sanitizeString('  hello   world  ')).toBe('hello world');
  });

  it('sanitizeEmail trims and lowercases', () => {
    expect(sanitizeEmail('  Student@Example.COM ')).toBe('student@example.com');
  });
});
