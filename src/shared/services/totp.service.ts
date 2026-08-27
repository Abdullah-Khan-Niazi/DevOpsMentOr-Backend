import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import { env } from '../../app/config/env';

/**
 * TOTP (RFC 6238) two-factor primitives.
 *
 * The raw Base32 secret is never persisted in plain form: it is encrypted
 * with AES-256-GCM using TWO_FACTOR_ENCRYPTION_KEY from the environment and
 * stored in `users.two_factor_secret`. The stored shape is
 * `iv:authTag:ciphertext`, all base64.
 */
export class TotpService {
  private static readonly ALGORITHM = 'aes-256-gcm';

  private deriveKey(): Buffer {
    return Buffer.from(env.TWO_FACTOR_ENCRYPTION_KEY, 'utf8').subarray(0, 32);
  }

  generateSecret(): string {
    return generateSecret({ length: 20 });
  }

  async generateCode(secret: string): Promise<string> {
    return generate({ secret });
  }

  buildOtpAuthUri(secret: string, account: string): string {
    return generateURI({
      issuer: env.TOTP_ISSUER,
      label: account,
      secret,
    });
  }

  async validateCode(secret: string, code: string): Promise<boolean> {
    const result = await verify({ secret, token: code });
    return result.valid;
  }

  encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(TotpService.ALGORITHM, this.deriveKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
      ':',
    );
  }

  decryptSecret(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed encrypted 2FA secret.');
    }

    const decipher = createDecipheriv(
      TotpService.ALGORITHM,
      this.deriveKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);

    return plaintext.toString('utf8');
  }
}

export const totpService = new TotpService();