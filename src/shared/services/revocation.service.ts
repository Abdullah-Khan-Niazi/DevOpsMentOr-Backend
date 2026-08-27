import { createHash, randomBytes } from 'crypto';
import { redisClient, cacheKeys } from '../../app/cache/redis';

/**
 * JWT JTI revocation primitives backed by Redis.
 *
 * A blacklisted JTI is rejected by the authentication middleware for the
 * token's remaining lifetime. TTL is derived from the token's `exp` claim.
 */
export class RevocationService {
  async blacklist(jti: string, exp: number): Promise<void> {
    const ttlSeconds = Math.max(0, Math.floor(exp - Date.now() / 1000));
    if (ttlSeconds <= 0) {
      return;
    }
    await redisClient.set(cacheKeys.jtiBlacklist(jti), '1', 'EX', ttlSeconds);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const value = await redisClient.get(cacheKeys.jtiBlacklist(jti));
    return value !== null;
  }
}

/**
 * Opaque raw token + hash pair for API tokens.
 * The raw value is returned exactly once; only the SHA-256 hash is stored.
 */
export function generateApiTokenSecret(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  return { rawToken, tokenHash };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const revocationService = new RevocationService();