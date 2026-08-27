import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../../app/config';
import { AppError, BadRequestError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';

/** Absolute directory where local uploads are persisted and statically served. */
export const UPLOAD_DIR = path.resolve(process.cwd(), env.UPLOAD_DIR);

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(
        new AppError(
          'Unsupported media type. Only jpeg, png and webp images are accepted.',
          HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

/**
 * Multer wrapper: parses the multipart field into `req.file` and converts
 * multer's internal error codes into contract errors (5 MB limit → 400).
 */
export function singleImageUpload(fieldName: 'avatar' | 'cover') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const middleware = imageUpload.single(fieldName);
    middleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(new BadRequestError('File exceeds the 5 MB size limit.'));
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

export interface SavedImage {
  fileName: string;
  filePath: string;
  fileHash: string;
  urlPath: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Persists a validated image buffer to the local uploads directory and
 * returns the artifact identifiers used by the `files` table and `users.*`
 * URL columns. Called only after multer validation (MIME/size already
 * enforced); broken file references are impossible by construction.
 */
export async function saveImageUpload(
  file: Express.Multer.File,
  kind: 'avatar' | 'cover',
  userId: number,
): Promise<SavedImage> {
  if (!file.buffer) {
    throw new BadRequestError('No file uploaded.');
  }

  const extension = EXTENSION_BY_MIME[file.mimetype] ?? '.bin';
  const fileName = `${kind}-${userId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  const urlPath = `/uploads/${fileName}`;
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), file.buffer);

  return {
    fileName,
    filePath: urlPath,
    fileHash,
    urlPath,
  };
}