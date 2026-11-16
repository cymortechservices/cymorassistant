import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from backend/ first, then the repository root. Real environment
// variables (e.g. Heroku Config Vars) always win: dotenv never overrides them.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(here, '../../.env'), path.resolve(here, '../../../.env')]) dotenv.config({ path: p, quiet: true });

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_PROVIDER: z.string().default('gemini'),
  OWNER_PHONE_NUMBER: z.string().optional().default(''),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  SESSION_ENCRYPTION_KEY: z.string().min(16, 'SESSION_ENCRYPTION_KEY must be set (use 64 hex chars)'),
  DASHBOARD_USERNAME: z.string().min(1),
  DASHBOARD_PASSWORD_HASH: z.string().min(10),
  APP_BASE_URL: z.string().optional().default(''),
  ASSISTANT_ENABLED: bool(false),
  NOTIFICATION_ENABLED: bool(true),
  TIMEZONE: z.string().default('Africa/Nairobi'),
  SESSION_ID: z.string().default('primary'),
  LOG_LEVEL: z.string().default('info'),
  MESSAGE_RETENTION_DAYS: z.coerce.number().default(90),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}

let cached;
export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper. */
export function resetConfigCache() {
  cached = undefined;
}
