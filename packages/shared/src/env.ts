import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TZ: z.string().default('America/New_York'),

  DASHBOARD_URL: z.string().url(),
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32),
  ALLOWED_APPROVER_EMAILS: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),

  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM: z.string().min(1),

  DRIVE_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
  TMP_DIR: z.string().default('./tmp'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
