import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Runtime environment contract.
 *
 * Every secret originates exclusively from the environment. There are no
 * hardcoded fallbacks for credentials: missing secrets fail fast at boot.
 * All values crossing into the application are parsed and validated here.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('DevOpsMentOr'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  UPLOAD_DIR: z.string().min(1).default('uploads'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required.'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters.'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters.'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(12),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(48),
  IDENTITY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  TOTP_ISSUER: z.string().min(1).default('DevOpsMentOr'),
  TWO_FACTOR_ENCRYPTION_KEY: z
    .string()
    .min(32, 'TWO_FACTOR_ENCRYPTION_KEY must be at least 32 characters.'),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('DevOpsMentOr <no-reply@devopsmentor.io>'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),

  // ─── F6 Labs / Execution Engine / AI Mentor ───────────────────────────────
  // Empty by default: the adapters fail with a user-safe error until the
  // deployment supplies a real endpoint/key (F6 §12 BLOCKING conditions).
  CONTAINER_ORCHESTRATION_API_URL: z.string().default(''),
  LLM_API_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  AI_MENTOR_MODEL: z.string().default(''),
  AI_MENTOR_SYSTEM_PROMPT: z.string().default(
    'You are AI Mentor, a DevOps teaching assistant. Guide the learner toward ' +
      'solving the problem with hints and explanations. Never reveal answer keys ' +
      'or credentials, and stay strictly within the provided lesson and lab context.',
  ),
  AI_MENTOR_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
  AI_MENTOR_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AI_MENTOR_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  LAB_TTL_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  LAB_EXTEND_MINUTES: z.coerce.number().int().positive().default(60),
  LAB_MAX_EXTENSIONS: z.coerce.number().int().min(0).default(3),

  // ─── F7 Achievements / Gamification / Certification ───────────────────────
  // Certificate public verification page origin (BLOCKING per F7 §12: a missing
  // value must halt boot). Used to build the shareable `certificates.certificate_url`.
  CERTIFICATE_VERIFY_BASE_URL: z.string().min(1, 'CERTIFICATE_VERIFY_BASE_URL is required.'),
  // Leaderboard recompute cadence (minutes) for the scheduled computation job.
  LEADERBOARD_RECOMPUTE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

  // ─── F9 Subscription, Billing & Entitlements ─────────────────────────────
  // Empty by default: the Stripe adapter fails with a user-safe error until
  // the deployment supplies real keys (same pattern as the F6 adapters).
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_ID_PREMIUM_MONTHLY: z.string().default(''),
  STRIPE_PRICE_ID_PREMIUM_ANNUAL: z.string().default(''),
  STRIPE_PRICE_ID_ENTERPRISE_MONTHLY: z.string().default(''),
  STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: z.string().default(''),
  STRIPE_PRICE_ID_STUDENT_MONTHLY: z.string().default(''),
  STRIPE_PRICE_ID_STUDENT_ANNUAL: z.string().default(''),
  STRIPE_CURRENCY: z.string().length(3).default('usd'),
  // Billing cycle resolution for `subscriptions.end_date` (invariant 12).
  SUBSCRIPTION_EXPIRY_CHECK_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;