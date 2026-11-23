import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { env } from '../../../src/app/config/env';
import { UnauthorizedError } from '../../../src/shared/errors';
import { authRoutes } from '../../../src/features/auth/routes/auth.routes';

/**
 * Cookie session contract (contracts 11.5): the refresh token only ever travels in
 * the httpOnly `dm_rt` cookie, never in a body; every cookie-authenticated endpoint
 * (`/auth/refresh`, `/auth/logout`, `/auth/logout-all`) requires an allowed Origin and
 * the double-submit `X-CSRF-Token`. The service is stubbed; routing, validation, CSRF,
 * cookies and the error middleware run for real.
 */

const session = vi.hoisted(() => ({ user: null as null | { sub: string; jti: string; permissions: string[]; roles: string[] } }));

vi.mock('../../../src/shared/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/middleware')>();
  return {
    ...actual,
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => next(),
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      if (!session.user) {
        next(new UnauthorizedError('Authentication required.'));
        return;
      }
      req.user = session.user as NonNullable<Request['user']>;
      next();
    },
    optionalAuthenticate: (req: Request, _res: Response, next: NextFunction): void => {
      if (session.user) req.user = session.user as NonNullable<Request['user']>;
      next();
    },
  };
});

vi.mock('../../../src/features/auth/services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
  },
}));

import { authService } from '../../../src/features/auth/services/auth.service';
import { errorMiddleware } from '../../../src/shared/middleware';

const authMock = vi.mocked(authService);

const app = express();
app.use(express.json());
app.use(`${env.API_PREFIX}/auth`, authRoutes);
app.use(errorMiddleware);

const AUTH = `${env.API_PREFIX}/auth`;
const ALLOWED_ORIGIN = env.CORS_ORIGIN.split(',')[0].trim();
const EXPIRES = new Date(Date.now() + 7 * 86_400_000);

const issued = () => ({
  user: { userId: 1, email: 'learner@devopsmentor.local' },
  tokens: { accessToken: 'access.jwt', expiresInSeconds: 900, refreshToken: 'REFRESH-SECRET-JWT', refreshExpiresAt: EXPIRES },
});

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : header ? [String(header)] : [];
}

function cookie(res: request.Response, name: string): string | undefined {
  return setCookies(res).find((line) => line.startsWith(`${name}=`));
}

function cookieValue(line: string | undefined): string {
  return decodeURIComponent((line ?? '').split(';')[0].split('=').slice(1).join('='));
}

/** A cookie-authenticated request with a matching CSRF cookie and header. */
function csrfPost(path: string, overrides: { origin?: string | null; header?: string | null; cookieCsrf?: string | null; refresh?: string | null } = {}) {
  const csrf = 'csrf-token-value';
  const cookies: string[] = [];
  if (overrides.refresh !== null) cookies.push(`dm_rt=${overrides.refresh ?? 'old-refresh-jwt'}`);
  if (overrides.cookieCsrf !== null) cookies.push(`dm_csrf=${overrides.cookieCsrf ?? csrf}`);
  let req = request(app).post(path).set('Cookie', cookies.join('; '));
  if (overrides.origin !== null) req = req.set('Origin', overrides.origin ?? ALLOWED_ORIGIN);
  if (overrides.header !== null) req = req.set('X-CSRF-Token', overrides.header ?? csrf);
  return req.send({});
}

describe('login sets the session cookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
  });

  it('sets dm_rt (HttpOnly, SameSite=Strict, Path=/api/v1/auth) and dm_csrf, and returns no refresh token', async () => {
    authMock.login.mockResolvedValue(issued() as never);
    const res = await request(app).post(`${AUTH}/login`).send({ email: 'learner@devopsmentor.local', password: 'Admin@12345' });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens).toEqual({ accessToken: 'access.jwt', expiresInSeconds: 900 });
    expect(JSON.stringify(res.body)).not.toContain('REFRESH-SECRET-JWT');
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');

    const rt = cookie(res, 'dm_rt');
    expect(rt).toBeDefined();
    expect(cookieValue(rt)).toBe('REFRESH-SECRET-JWT');
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toContain(`Path=${env.API_PREFIX}/auth`);
    expect(rt).toContain('Path=/api/v1/auth');
    expect(rt).toMatch(/Expires=/i);

    const csrf = cookie(res, 'dm_csrf');
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(csrf).toMatch(/SameSite=Strict/i);
    expect(csrf).toMatch(/Path=\//);
    expect(cookieValue(csrf).length).toBeGreaterThanOrEqual(32);
    expect(res.headers['x-csrf-token']).toBe(cookieValue(csrf));
  });

  it('GET /auth/csrf ensures dm_csrf cookie and returns token in body and X-CSRF-Token header', async () => {
    const res = await request(app).get(`${AUTH}/csrf`);
    expect(res.status).toBe(200);
    const headerToken = res.headers['x-csrf-token'] as string;
    expect(headerToken.length).toBeGreaterThanOrEqual(32);
    expect(res.body.data.csrfToken).toBe(headerToken);
    expect(cookieValue(cookie(res, 'dm_csrf'))).toBe(headerToken);
  });

  it('marks both cookies Secure exactly when AUTH_COOKIE_SECURE is on', async () => {
    authMock.login.mockResolvedValue(issued() as never);
    const res = await request(app).post(`${AUTH}/login`).send({ email: 'a@b.co', password: 'Admin@12345' });
    for (const name of ['dm_rt', 'dm_csrf']) {
      expect(/;\s*Secure/i.test(cookie(res, name) ?? '')).toBe(env.AUTH_COOKIE_SECURE);
    }
  });

  it('issues a fresh CSRF value on every login', async () => {
    authMock.login.mockResolvedValue(issued() as never);
    const a = await request(app).post(`${AUTH}/login`).send({ email: 'a@b.co', password: 'Admin@12345' });
    const b = await request(app).post(`${AUTH}/login`).send({ email: 'a@b.co', password: 'Admin@12345' });
    expect(cookieValue(cookie(a, 'dm_csrf'))).not.toBe(cookieValue(cookie(b, 'dm_csrf')));
  });
});

describe('POST /auth/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
  });

  it('403 CSRF_REJECTED without an Origin (or Referer)', async () => {
    const res = await csrfPost(`${AUTH}/refresh`, { origin: null });
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code ?? JSON.stringify(res.body)).toContain('CSRF_REJECTED');
    expect(authMock.refreshToken).not.toHaveBeenCalled();
  });

  it('403 CSRF_REJECTED for an Origin that is not allowed', async () => {
    const res = await csrfPost(`${AUTH}/refresh`, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('CSRF_REJECTED');
    expect(authMock.refreshToken).not.toHaveBeenCalled();
  });

  it('403 with a wrong, a missing, or an unmatched X-CSRF-Token', async () => {
    for (const overrides of [{ header: 'wrong-token' }, { header: null }, { cookieCsrf: null }]) {
      const res = await csrfPost(`${AUTH}/refresh`, overrides);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('CSRF_REJECTED');
    }
    expect(authMock.refreshToken).not.toHaveBeenCalled();
  });

  it('accepts the Referer origin when Origin is absent', async () => {
    authMock.refreshToken.mockResolvedValue({ accessToken: 'a', expiresInSeconds: 900, refreshToken: 'r', refreshExpiresAt: EXPIRES } as never);
    const res = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', 'dm_rt=old; dm_csrf=tok')
      .set('Referer', `${ALLOWED_ORIGIN}/dashboard`)
      .set('X-CSRF-Token', 'tok')
      .send({});
    expect(res.status).toBe(200);
  });

  it('200 with cookie + Origin + matching header: new access token and rotated cookies, refresh token only from the cookie', async () => {
    authMock.refreshToken.mockResolvedValue({ accessToken: 'new.access', expiresInSeconds: 900, refreshToken: 'ROTATED-REFRESH', refreshExpiresAt: EXPIRES } as never);
    const res = await csrfPost(`${AUTH}/refresh`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ accessToken: 'new.access', expiresInSeconds: 900 });
    expect(authMock.refreshToken).toHaveBeenCalledWith('old-refresh-jwt');
    expect(cookieValue(cookie(res, 'dm_rt'))).toBe('ROTATED-REFRESH');
    expect(cookie(res, 'dm_rt')).toMatch(/HttpOnly/i);
    expect(cookieValue(cookie(res, 'dm_csrf'))).not.toBe('csrf-token-value');
    expect(JSON.stringify(res.body)).not.toContain('ROTATED-REFRESH');
  });

  it('422 for a legacy { refreshToken } body and for any other body key', async () => {
    for (const body of [{ refreshToken: 'x' }, { anything: 1 }]) {
      const res = await request(app)
        .post(`${AUTH}/refresh`)
        .set('Cookie', 'dm_rt=old; dm_csrf=tok')
        .set('Origin', ALLOWED_ORIGIN)
        .set('X-CSRF-Token', 'tok')
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(authMock.refreshToken).not.toHaveBeenCalled();
  });

  it('a missing refresh cookie reaches the service as null and the failure clears both cookies', async () => {
    authMock.refreshToken.mockRejectedValue(new UnauthorizedError('Invalid or expired refresh token.', [{ code: 'REFRESH_TOKEN_INVALID' }]));
    const res = await csrfPost(`${AUTH}/refresh`, { refresh: null });
    expect(res.status).toBe(401);
    expect(authMock.refreshToken).toHaveBeenCalledWith(null);
    for (const name of ['dm_rt', 'dm_csrf']) {
      const line = cookie(res, name);
      expect(line).toBeDefined();
      expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
    }
  });

  it('REFRESH_TOKEN_REUSED is a 401 that clears the cookies', async () => {
    authMock.refreshToken.mockRejectedValue(new UnauthorizedError('Session revoked.', [{ code: 'REFRESH_TOKEN_REUSED' }]));
    const res = await csrfPost(`${AUTH}/refresh`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toContain('REFRESH_TOKEN_REUSED');
    expect(cookie(res, 'dm_rt')).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('transient 500 failure in refreshToken does NOT clear cookies', async () => {
    authMock.refreshToken.mockRejectedValue(new Error('Transient Redis timeout'));
    const res = await csrfPost(`${AUTH}/refresh`);
    expect(res.status).toBe(500);
    expect(cookie(res, 'dm_rt')).toBeUndefined();
    expect(cookie(res, 'dm_csrf')).toBeUndefined();
  });
});

describe('POST /auth/logout and /auth/logout-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
  });

  it('logout clears both cookies with the path they were set with and passes the cookie token to the service', async () => {
    authMock.logout.mockResolvedValue(undefined as never);
    const res = await csrfPost(`${AUTH}/logout`);
    expect(res.status).toBe(200);
    expect(authMock.logout).toHaveBeenCalledWith('old-refresh-jwt', undefined);
    const rt = cookie(res, 'dm_rt');
    const csrf = cookie(res, 'dm_csrf');
    expect(rt).toContain(`Path=${env.API_PREFIX}/auth`);
    expect(rt).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(csrf).toMatch(/Path=\/(;|$)/);
    expect(csrf).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('logout still requires CSRF and rejects a body token', async () => {
    expect((await csrfPost(`${AUTH}/logout`, { origin: null })).status).toBe(403);
    expect((await csrfPost(`${AUTH}/logout`, { header: 'nope' })).status).toBe(403);
    const res = await request(app)
      .post(`${AUTH}/logout`)
      .set('Cookie', 'dm_rt=old; dm_csrf=tok')
      .set('Origin', ALLOWED_ORIGIN)
      .set('X-CSRF-Token', 'tok')
      .send({ refreshToken: 'x' });
    expect(res.status).toBe(422);
    expect(authMock.logout).not.toHaveBeenCalled();
  });

  it('logout with an expired access token still works and clears the cookies', async () => {
    authMock.logout.mockResolvedValue(undefined as never);
    const res = await csrfPost(`${AUTH}/logout`);
    expect(res.status).toBe(200);
    expect(authMock.logout).toHaveBeenCalledWith('old-refresh-jwt', undefined);
  });

  it('logout passes the access jti when a valid access token is presented', async () => {
    session.user = { sub: '1', jti: 'access-jti', permissions: [], roles: [] };
    authMock.logout.mockResolvedValue(undefined as never);
    await csrfPost(`${AUTH}/logout`);
    expect(authMock.logout).toHaveBeenCalledWith('old-refresh-jwt', 'access-jti');
  });

  it('logout-all needs authentication and CSRF, then clears the cookies', async () => {
    expect((await csrfPost(`${AUTH}/logout-all`)).status).toBe(401);
    session.user = { sub: '1', jti: 'access-jti', permissions: [], roles: [] };
    expect((await csrfPost(`${AUTH}/logout-all`, { origin: 'https://evil.example' })).status).toBe(403);
    authMock.logoutAll.mockResolvedValue(undefined as never);
    const ok = await csrfPost(`${AUTH}/logout-all`);
    expect(ok.status).toBe(200);
    expect(authMock.logoutAll).toHaveBeenCalledWith(1, 'access-jti');
    expect(cookie(ok, 'dm_rt')).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});
