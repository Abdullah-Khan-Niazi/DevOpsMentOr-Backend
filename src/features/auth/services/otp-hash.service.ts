import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../../../app/config/env';

/**
 * HMAC-SHA256 hashing for one-time passcodes.
 *
 * `otp_codes.code` must never hold a raw OTP: every issue path writes the hex
 * digest and every consume path re-hashes the submitted value before lookup.
 * The HMAC key comes from `OTP_HASH_SECRET` when configured; otherwise it is
 * derived deterministically from `JWT_ACCESS_SECRET` so existing deployments
 * keep working without a new secret. Neither the key nor raw codes are logged.
 */
export class OtpHashService {
  private cachedKey: Buffer | null = null;

  private key(): Buffer {
    if (!this.cachedKey) {
      const configured = env.OTP_HASH_SECRET;
      this.cachedKey =
        configured && configured.length > 0
          ? Buffer.from(configured, 'utf8')
          : createHmac('sha256', env.JWT_ACCESS_SECRET).update('devopsmentor:otp').digest();
    }
    return this.cachedKey;
  }

  /** Returns the 64-char hex HMAC-SHA256 digest of `code`. */
  hash(code: string): string {
    return createHmac('sha256', this.key()).update(code).digest('hex');
  }

  /** Constant-time comparison of a raw code against a stored digest. */
  matches(code: string, digest: string): boolean {
    const candidate = Buffer.from(this.hash(code), 'hex');
    const expected = Buffer.from(digest, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}

export const otpHashService = new OtpHashService();
