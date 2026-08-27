import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import type { Request, Response } from 'express';
import { env } from '../../../app/config';
import { HTTP_STATUS } from '../../../shared/constants';
import { AppError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { UPLOAD_DIR } from '../../../features/users/services/upload.service';
import { fileRepository } from '../../../features/users/repositories/file.repository';
import { entitlementService } from '../../../features/labs/services/EntitlementService';
import type { FileDownloadDto, AdminFileDto } from '../dto/operations.dto';
import type { IOperationsRepository } from '../repositories/operations.repository';
import { operationsRepository } from '../repositories/operations.repository';

/** Signed-URL lifetime for non-public file downloads. */
export const FILE_URL_TTL_SECONDS = 900;

/**
 * F8 §07 file library (OPS-20, OPS-43, OPS-44).
 *
 * - Public files resolve to the static `/uploads` path.
 * - Non-public files require authentication AND an entitlement check at URL
 *   generation time (F9 seam via `EntitlementService.getPlanTier`); the
 *   generated URL is HMAC-signed with an expiry and served by the
 *   `serve` endpoint (invariant 12, §05 IDOR mitigation).
 * - Every download INSERTs a `downloads` row and increments
 *   `files.downloads_count` atomically (invariant 12).
 */
export interface FileServiceDeps {
  repo: Pick<
    IOperationsRepository,
    | 'findFileById'
    | 'listFiles'
    | 'countFiles'
    | 'insertDownload'
    | 'incrementDownloadsCount'
  >;
  entitle: Pick<typeof entitlementService, 'getPlanTier'>;
}

function defaultDeps(): FileServiceDeps {
  return { repo: operationsRepository, entitle: entitlementService };
}

export class FileService {
  constructor(private readonly deps: FileServiceDeps = defaultDeps()) {}

  /** OPS-20: resolve a (possibly signed) download URL for a file. */
  async getDownloadUrl(
    userId: number,
    fileId: number,
    isAdmin: boolean,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<FileDownloadDto> {
    const file = await this.deps.repo.findFileById(fileId);
    if (!file) {
      throw new NotFoundError('File not found.');
    }

    let downloadUrl: string;
    if (file.isPublic) {
      downloadUrl = file.filePath;
    } else {
      const tier = await this.deps.entitle.getPlanTier(userId);
      if (tier === 'free' && !isAdmin) {
        throw new ForbiddenError(
          'This file requires an active subscription. Upgrade your plan to download it.',
        );
      }
      downloadUrl = this.signUrl(file.fileId);
    }

    await this.deps.repo.insertDownload(userId, fileId, ipAddress, userAgent);
    await this.deps.repo.incrementDownloadsCount(fileId);

    return {
      fileId: file.fileId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.fileSizeBytes,
      downloadUrl,
      expiresInSeconds: file.isPublic ? 0 : FILE_URL_TTL_SECONDS,
    };
  }

  /** Signed-URL generator: HMAC(secret, "fileId:expires"). */
  signUrl(fileId: number): string {
    const expires = Math.floor(Date.now() / 1000) + FILE_URL_TTL_SECONDS;
    const signature = this.signature(fileId, expires);
    return `${env.API_PREFIX}/files/${fileId}/serve?expires=${expires}&sig=${signature}`;
  }

  /** Validate the signature and expiry of a serve request. */
  verifySignature(fileId: number, expires: number, signature: string): boolean {
    if (Math.floor(Date.now() / 1000) > expires) {
      return false;
    }
    const expected = this.signature(fileId, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Stream a validated file to the response. */
  async serve(fileId: number, res: Response): Promise<void> {
    const file = await this.deps.repo.findFileById(fileId);
    if (!file) {
      throw new NotFoundError('File not found.');
    }

    const absolutePath = path.resolve(UPLOAD_DIR, path.basename(file.filePath));
    try {
      const buffer = await fs.readFile(absolutePath);
      res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch {
      throw new AppError('File content is unavailable.', HTTP_STATUS.NOT_FOUND);
    }
  }

  /** OPS-43: persist an uploaded file and record it in `files`. */
  async upload(
    adminUserId: number,
    input: {
      fileName: string;
      filePath: string;
      fileSizeBytes: number;
      mimeType: string;
      fileHash: string;
      isPublic: boolean;
      uploadIp: string | null;
    },
  ): Promise<AdminFileDto> {
    const record = await fileRepository.create({
      userId: adminUserId,
      ...input,
    });

    const row = await this.deps.repo.findFileById(record.fileId);
    if (!row) {
      throw new NotFoundError('File record not found.');
    }

    logger.info({ fileId: row.fileId, adminUserId }, 'Platform file uploaded');

    return this.toAdminFileDto(row);
  }

  /** OPS-44: admin file list. */
  async list(page: number, limit: number): Promise<{ data: AdminFileDto[]; total: number; page: number }> {
    const [rows, total] = await Promise.all([
      this.deps.repo.listFiles((page - 1) * limit, limit),
      this.deps.repo.countFiles(),
    ]);

    return { data: rows.map(this.toAdminFileDto), total, page };
  }

  private signature(fileId: number, expires: number): string {
    return crypto
      .createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(`${fileId}:${expires}`)
      .digest('hex');
  }

  private toAdminFileDto(row: {
    fileId: number;
    userId: number;
    fileName: string;
    filePath: string;
    fileSizeBytes: number | null;
    mimeType: string | null;
    storageType: 'local' | 's3' | 'azure' | 'gcs';
    isPublic: boolean;
    downloadsCount: number;
    createdAt: Date;
  }): AdminFileDto {
    return {
      fileId: row.fileId,
      fileName: row.fileName,
      filePath: row.filePath,
      fileSizeBytes: row.fileSizeBytes,
      mimeType: row.mimeType,
      storageType: row.storageType,
      isPublic: row.isPublic,
      downloadsCount: row.downloadsCount,
      uploadedBy: row.userId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const fileService = new FileService();

/** Serve request handler used by the route (validates signature). */
export async function handleFileServe(req: Request, res: Response): Promise<void> {
  const fileId = Number(req.params.fileId);
  const expires = Number(req.query.expires);
  const signature = String(req.query.sig ?? '');

  if (!Number.isInteger(fileId) || !Number.isInteger(expires) || !signature) {
    throw new AppError('Invalid download link.', HTTP_STATUS.FORBIDDEN);
  }
  if (!fileService.verifySignature(fileId, expires, signature)) {
    throw new AppError('This download link has expired.', HTTP_STATUS.FORBIDDEN);
  }

  await fileService.serve(fileId, res);
}