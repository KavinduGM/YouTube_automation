import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TZ: z.string().default('America/New_York'),

  DASHBOARD_URL: z.string().url(),
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32),
  // Emails that get overdue / failure notifications. Login is by
  // username + password only — this list does not gate sign-in.
  ALLOWED_APPROVER_EMAILS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),

  // Bootstrap admin credentials. Created on first startup if no admin exists.
  BOOTSTRAP_ADMIN_USERNAME: z.string().default('ADMIN2026'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().default('Admin26GM@#'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),

  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM: z.string().min(1),

  DRIVE_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(30),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(20),
  TMP_DIR: z.string().default('./tmp'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Bearer token for service-to-service calls from the Content Automation
  // system. When set, enables the /automation/* routes. When unset, those
  // routes return 503 — leave it blank if you don't use that integration.
  AUTOMATION_BEARER: z.string().min(16).optional(),
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
