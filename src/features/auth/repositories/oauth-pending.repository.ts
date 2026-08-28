import { randomBytes } from 'crypto';
import { redisClient } from '../../../app/cache/redis';
import type { OAuthProvider } from '../dto/auth.dto';

const PENDING_PREFIX = 'oauth_pending:';
const PENDING_TTL_SECONDS = 15 * 60;

export interface PendingOAuth {
  email: string;
  name: string;
  provider: OAuthProvider;
  providerId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Stores the verified OAuth identity between the provider redirect and the
 * moment the user finishes choosing their account type. Single-use and TTL
 * bound so a leaked token cannot be reused to mint an account.
 */
export async function createPendingOAuth(profile: PendingOAuth): Promise<string> {
  const token = randomBytes(24).toString('hex');

  await redisClient.set(`${PENDING_PREFIX}${token}`, JSON.stringify(profile), 'EX', PENDING_TTL_SECONDS);

  return token;
}

export async function consumePendingOAuth(token: string): Promise<PendingOAuth | null> {
  const key = `${PENDING_PREFIX}${token}`;
  const raw = await redisClient.get(key);

  if (!raw) {
    return null;
  }

  await redisClient.del(key);

  try {
    return JSON.parse(raw) as PendingOAuth;
  } catch {
    return null;
  }
}
