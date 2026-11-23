import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const envMock = vi.hoisted(() => ({
  API_PREFIX: '/api/v1',
  AUTH_COOKIE_SECURE: true,
  AUTH_COOKIE_SAME_SITE: 'strict' as 'strict' | 'lax' | 'none',
  AUTH_COOKIE_DOMAIN: '',
}));

vi.mock('../../../src/app/config/env', () => ({
  env: envMock,
}));

import {
  AUTH_COOKIES,
  clearAuthCookies,
  ensureCsrfCookie,
  parseCookies,
  readCookie,
  setAuthCookies,
} from '../../../src/shared/utils/auth-cookies';

function fakeResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    setHeader: vi.fn(),
  };
}

describe('parseCookies', () => {
  it('parses pairs and decodes percent-encoded values', () => {
    expect(parseCookies('a=1; b=x%20y')).toEqual({ a: '1', b: 'x y' });
  });

  it('returns an empty map for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('ignores a malformed pair without an equals sign', () => {
    expect(parseCookies('a=1; broken; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('ignores a cookie whose value cannot be decoded', () => {
    expect(parseCookies('bad=%E0%A4%A; ok=yes')).toEqual({ ok: 'yes' });
  });

  it('keeps the first `=` as the separator so values may contain `=`', () => {
    expect(parseCookies('token=abc==')).toEqual({ token: 'abc==' });
  });
});

describe('readCookie', () => {
  it('reads one cookie from the request header', () => {
    const req = { headers: { cookie: 'dm_rt=refresh-value; dm_csrf=csrf' } } as unknown as Request;
    expect(readCookie(req, AUTH_COOKIES.refresh)).toBe('refresh-value');
    expect(readCookie(req, 'missing')).toBeUndefined();
  });
});

describe('setAuthCookies', () => {
  const refreshExpiresAt = new Date('2030-01-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets the httpOnly refresh cookie, readable CSRF cookie, and X-CSRF-Token header', () => {
    const res = fakeResponse();
    const csrf = setAuthCookies(res as unknown as Response, {
      refreshToken: 'refresh-jwt',
      refreshExpiresAt,
    });

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', csrf);

    expect(res.cookie).toHaveBeenNthCalledWith(1, 'dm_rt', 'refresh-jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires: refreshExpiresAt,
      domain: undefined,
    });

    expect(res.cookie).toHaveBeenNthCalledWith(2, 'dm_csrf', csrf, {
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
      expires: refreshExpiresAt,
      domain: undefined,
    });
  });

  it('marks only the refresh cookie httpOnly', () => {
    const res = fakeResponse();
    setAuthCookies(res as unknown as Response, { refreshToken: 'r', refreshExpiresAt });

    const httpOnlyByName = Object.fromEntries(
      vi.mocked(res.cookie).mock.calls.map(([name, , options]) => [
        name,
        (options as { httpOnly: boolean }).httpOnly,
      ]),
    );
    expect(httpOnlyByName).toEqual({ dm_rt: true, dm_csrf: false });
  });

  it('returns a fresh base64url CSRF value of 32 random bytes on each call', () => {
    const res = fakeResponse();
    const first = setAuthCookies(res as unknown as Response, { refreshToken: 'r', refreshExpiresAt });
    const second = setAuthCookies(res as unknown as Response, { refreshToken: 'r', refreshExpiresAt });

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('forces Secure=true when AUTH_COOKIE_SAME_SITE is none', () => {
    envMock.AUTH_COOKIE_SECURE = false;
    envMock.AUTH_COOKIE_SAME_SITE = 'none';
    const res = fakeResponse();
    setAuthCookies(res as unknown as Response, { refreshToken: 'r', refreshExpiresAt });
    expect(res.cookie).toHaveBeenNthCalledWith(
      1,
      'dm_rt',
      'r',
      expect.objectContaining({ sameSite: 'none', secure: true }),
    );
    envMock.AUTH_COOKIE_SECURE = true;
    envMock.AUTH_COOKIE_SAME_SITE = 'strict';
  });
});

describe('ensureCsrfCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses a valid dm_csrf cookie and exposes X-CSRF-Token', () => {
    const existing = 'a'.repeat(43);
    const req = { headers: { cookie: `dm_csrf=${existing}` } } as unknown as Request;
    const res = fakeResponse();
    const token = ensureCsrfCookie(req, res as unknown as Response);
    expect(token).toBe(existing);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', existing);
  });

  it('mints a fresh dm_csrf cookie and header when absent or malformed', () => {
    const req = { headers: { cookie: 'dm_csrf=short' } } as unknown as Request;
    const res = fakeResponse();
    const token = ensureCsrfCookie(req, res as unknown as Response);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', token);
  });
});

describe('clearAuthCookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears both auth cookies with the same path and security options', () => {
    const res = fakeResponse();
    clearAuthCookies(res as unknown as Response);

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(res.clearCookie).toHaveBeenNthCalledWith(1, 'dm_rt', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      domain: undefined,
    });
    expect(res.clearCookie).toHaveBeenNthCalledWith(2, 'dm_csrf', {
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
      domain: undefined,
    });
  });
});
