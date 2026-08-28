import { logger } from '../../../shared/logger';
import { generateApiTokenSecret } from '../../../shared/services';
import { NotFoundError } from '../../../shared/errors';
import type {
  ApiTokenCreatedDto,
  ApiTokenResponseDto,
  CreateApiTokenDto,
} from '../dto/auth.dto';
import type { IApiTokenRepository } from '../repositories/api-token.repository';
import { apiTokenRepository } from '../repositories/api-token.repository';

export class ApiTokenService {
  constructor(private readonly tokens: IApiTokenRepository = apiTokenRepository) {}

  async create(userId: number, input: CreateApiTokenDto): Promise<ApiTokenCreatedDto> {
    const { rawToken, tokenHash } = generateApiTokenSecret();

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const tokenId = await this.tokens.create({
      userId,
      tokenName: input.tokenName,
      apiTokenHash: tokenHash,
      permissions: [],
      expiresAt,
    });

    return {
      tokenId,
      tokenName: input.tokenName,
      rawToken,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      lastUsedAt: null,
    };
  }

  async list(userId: number): Promise<ApiTokenResponseDto[]> {
    const rows = await this.tokens.listActiveForUser(userId);

    return rows.map((row) => ({
      tokenId: row.tokenId,
      tokenName: row.tokenName,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    }));
  }

  async revoke(userId: number, tokenId: number): Promise<void> {
    const revoked = await this.tokens.revoke(userId, tokenId);

    if (!revoked) {
      logger.warn({ userId, tokenId }, 'API token revocation missed; token not owned or unknown');
      throw new NotFoundError('API token not found.');
    }
  }
}

export const apiTokenService = new ApiTokenService();