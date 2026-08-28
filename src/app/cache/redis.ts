import Redis from 'ioredis';
import { env } from '../config';
import { logger } from '../../shared/logger';

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis;
};

// Render/Vercel store env values literally, so a value copied from a quoted
// local `.env` (e.g. "rediss://...") keeps its surrounding quotes and ioredis
// fails with `connect EINVAL`. Strip any leading/trailing quotes and whitespace.
const redisUrl = env.REDIS_URL.replace(/^["']|["']$/g, '').trim();

export const redisClient =
  globalForRedis.redisClient ?? new Redis(redisUrl, { lazyConnect: false });

if (env.NODE_ENV !== 'production') {
  globalForRedis.redisClient = redisClient;
}

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

export async function connectRedis(): Promise<void> {
  await redisClient.ping();
  logger.info('Redis connected.');
}

export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  logger.info('Redis disconnected.');
}

/** Key namespace helpers for the F1 session/revocation primitives. */
export const cacheKeys = {
  /** `jti:{jti}` → '1'; TTL = remaining access-token lifetime. */
  jtiBlacklist: (jti: string): string => `jti:${jti}`,
  /** `rate:{window}:{ip-or-id}` → request count. */
  rateLimit: (scope: string, identifier: string): string => `rate:${scope}:${identifier}`,
  /** `identity:{userId}` → JSON SessionIdentity; TTL = IDENTITY_CACHE_TTL_SECONDS. */
  identity: (userId: number): string => `identity:${userId}`,
  /** `admin_invite:{token}` → JSON { email, fullName, expiresAt }. */
  adminInvite: (token: string): string => `admin_invite:${token}`,
  /** `lp_stats` → JSON LearnerPoolStatsDto; TTL = 60s (F2 forward hook). */
  learnerPoolStats: (): string => 'lp_stats',
  /** `admin_kpi` → JSON AdminDashboardDto; TTL = 5min (ADM-06). */
  adminDashboard: (): string => 'admin_kpi',
  /** `course_progress:{userId}` → JSON CourseProgressDto; TTL = 60s (F5 §08). */
  courseProgress: (userId: number): string => `course_progress:${userId}`,
  /** `ai_mentor:{userId}:{lessonId}` → JSON AiMentorSession; TTL = 7200s (F6 §05 invariant 9). */
  aiMentorSession: (userId: number, lessonId: number): string => `ai_mentor:${userId}:${lessonId}`,
  /** `ai_mentor_rate:{userId}` → message count; TTL = 3600s (F6 §05 invariant 10). */
  aiMentorRate: (userId: number): string => `ai_mentor_rate:${userId}`,
  /** `lab_extend:{instanceId}` → extension count; TTL until instance expiry (F6 §05). */
  labExtendCount: (instanceId: number): string => `lab_extend:${instanceId}`,
} as const;