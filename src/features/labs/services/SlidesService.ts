import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq } from 'drizzle-orm';
import { env } from '../../../app/config';
import { db } from '../../../app/database';
import { academyCourses } from '../../../app/database/schema';
import { AppError, ERROR_CODES, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants/http-status';
import { logger } from '../../../shared/logger';
import { ITEM_SLUG_RE } from '../../../shared/utils/curriculum-slug';
import type { EntitlementService } from './EntitlementService';
import { entitlementService } from './EntitlementService';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

/** Presigned deck URLs stay valid across long lab workspace sessions. */
export const SLIDES_URL_TTL_SECONDS = 3600;

/** Defence in depth: only keys of the catalog layout are ever signed. */
export const SLIDES_KEY_RE = /^Slides\/[A-Za-z0-9 _.-]+\/[A-Za-z0-9 _.-]+\.pdf$/;

export interface SlidesResult {
  labId: number;
  url: string;
  expiresAt: string;
}

export interface R2ListedObject {
  key: string;
  fileName: string;
}

export interface SlidesServiceDeps {
  repo: Pick<LabsRepository, 'findLabById'>;
  entitlement: Pick<EntitlementService, 'assertLabAccess'>;
  /** Stored deck key of a course slug, or null. */
  findCourseSlidesKey: (courseSlug: string) => Promise<string | null>;
  /** Presigns a GET for `key`; throws when R2 is not configured. */
  presign: (key: string, ttlSeconds: number) => Promise<string>;
}

let cachedClient: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
}

function r2Client(): S3Client {
  cachedClient ??= new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return cachedClient;
}

export async function presignR2Object(
  key: string,
  ttlSeconds: number,
  disposition: 'inline' | 'attachment' = 'inline',
  contentType?: string,
): Promise<string> {
  if (!isR2Configured()) {
    throw new AppError('Slides are not available right now.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
      { code: ERROR_CODES.SLIDES_UNAVAILABLE },
    ]);
  }
  const safeName = key.split('/').pop()?.replaceAll('"', '') ?? 'resource';
  const contentDisposition =
    disposition === 'attachment' ? `attachment; filename="${safeName}"` : 'inline';
  try {
    return await getSignedUrl(
      r2Client(),
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        ...(contentType ? { ResponseContentType: contentType } : {}),
        ResponseContentDisposition: contentDisposition,
      }),
      { expiresIn: ttlSeconds },
    );
  } catch (error) {
    logger.error({ err: error, key }, 'R2 presign failed');
    throw new AppError('Slides are not available right now.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
      { code: ERROR_CODES.SLIDES_UNAVAILABLE },
    ]);
  }
}

export async function listR2ObjectsByPrefix(prefix: string): Promise<R2ListedObject[]> {
  if (!isR2Configured()) return [];
  try {
    const response = await r2Client().send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: prefix,
        MaxKeys: 50,
      }),
    );
    const items = response.Contents ?? [];
    return items
      .filter((entry): entry is { Key: string } => typeof entry.Key === 'string' && !entry.Key.endsWith('/'))
      .map((entry) => ({
        key: entry.Key,
        fileName: entry.Key.split('/').pop() ?? entry.Key,
      }));
  } catch (error) {
    logger.warn({ err: error, prefix }, 'R2 list objects failed; returning empty list');
    return [];
  }
}

async function presignDeck(key: string, ttlSeconds: number): Promise<string> {
  return presignR2Object(key, ttlSeconds, 'inline', 'application/pdf');
}

async function findCourseSlidesKey(courseSlug: string): Promise<string | null> {
  const [row] = await db
    .select({ key: academyCourses.videoTrailerUrl })
    .from(academyCourses)
    .where(eq(academyCourses.slug, courseSlug))
    .limit(1);
  return row?.key ?? null;
}

function defaultDeps(): SlidesServiceDeps {
  return { repo: labsRepository, entitlement: entitlementService, findCourseSlidesKey, presign: presignDeck };
}

/**
 * Slides of a lab (item) = the combined deck of its course. The course is derived
 * from the lab's `CxxMxxLxx` slug and the object key comes only from the database;
 * the client never supplies a key. Returns a short-lived presigned R2 GET URL.
 */
export class SlidesService {
  constructor(private readonly deps: SlidesServiceDeps = defaultDeps()) {}

  async getSlides(userId: number, labId: number): Promise<SlidesResult> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || !lab.isActive) {
      throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
    }
    await this.deps.entitlement.assertLabAccess(userId, labId);

    const notFound = () =>
      new NotFoundError('No slides are available for this course yet.', [{ code: ERROR_CODES.SLIDES_NOT_FOUND }]);
    if (!ITEM_SLUG_RE.test(lab.slug)) {
      throw notFound();
    }
    const key = await this.deps.findCourseSlidesKey(lab.slug.slice(0, 3));
    if (!key || !SLIDES_KEY_RE.test(key)) {
      throw notFound();
    }

    const expiresAt = new Date(Date.now() + SLIDES_URL_TTL_SECONDS * 1000).toISOString();
    const url = await this.deps.presign(key, SLIDES_URL_TTL_SECONDS);
    return { labId, url, expiresAt };
  }
}

export const slidesService = new SlidesService();
