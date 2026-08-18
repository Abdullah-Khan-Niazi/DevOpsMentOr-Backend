import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { BadRequestError } from '../../../shared/errors';
import { sendSuccess } from '../../../shared/utils';
import { UPLOAD_DIR } from '../../../features/users/services/upload.service';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import type { AdminActor } from '../services/admin-event.service';
import { auditLogService } from '../../../features/admin/services/audit-log.service';
import { fileService } from '../services/file.service';

/** Max size for platform file uploads (25 MB). */
export const MAX_PLATFORM_FILE_BYTES = 25 * 1024 * 1024;

const platformFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PLATFORM_FILE_BYTES, files: 1 },
});

/** Multer wrapper: parses the multipart field `file` with size-limit mapping. */
export function singlePlatformFileUpload() {
  return (req: Request, res: Response, next: NextFunction): void => {
    platformFileUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(new BadRequestError('File exceeds the 25 MB size limit.'));
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  };
}

function actor(req: Request): AdminActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/** OPS-43: POST /api/admin/files (multipart). */
export async function uploadFile(req: Request, res: Response): Promise<Response> {
  if (!req.file || !req.file.buffer) {
    throw new BadRequestError('No file uploaded.');
  }

  const extension = path.extname(req.file.originalname).slice(0, 16) || '.bin';
  const safeBase = path
    .basename(req.file.originalname, extension)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const fileName = `platform-${safeBase}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  const urlPath = `/uploads/${fileName}`;
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), req.file.buffer);

  const act = actor(req);
  const file = await fileService.upload(act.userId, {
    fileName: req.file.originalname.slice(0, 255),
    filePath: urlPath,
    fileSizeBytes: req.file.size,
    mimeType: req.file.mimetype.slice(0, 100),
    fileHash,
    isPublic: req.query.isPublic === 'true',
    uploadIp: req.ip ?? null,
  });

  await auditLogService.record({
    adminUserId: act.userId,
    action: AUDIT_ACTIONS.UPLOAD_FILE,
    targetType: 'file',
    targetId: file.fileId,
    changes: { fileName: file.fileName, sizeBytes: file.fileSizeBytes },
    ipAddress: act.ipAddress,
    userAgent: act.userAgent,
  });

  logger.info({ fileId: file.fileId, adminUserId: act.userId }, 'Platform file uploaded');
  return sendSuccess(res, file, 'File uploaded successfully.', 201);
}

/** OPS-44: GET /api/admin/files. */
export async function listFiles(req: Request, res: Response): Promise<Response> {
  const result = await fileService.list(Number(req.query.page), Number(req.query.limit));
  return sendSuccess(res, result, 'Files retrieved successfully.');
}

/** OPS-20: GET /api/files/:fileId/download (signed URL for non-public files). */
export async function getDownloadUrl(req: Request, res: Response): Promise<Response> {
  const isAdmin = Array.isArray(req.user?.roles)
    ? req.user!.roles.includes('admin')
    : false;
  const result = await fileService.getDownloadUrl(
    Number(req.user?.sub),
    Number(req.params.fileId),
    isAdmin,
    req.ip ?? null,
    req.get('user-agent') ?? null,
  );
  return sendSuccess(res, result, 'Download URL generated successfully.');
}