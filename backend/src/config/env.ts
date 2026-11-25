import { z } from 'zod'

// private/.env is the cPanel deploy location: that folder is web-blocked by its own .htaccess.
for (const file of ['.env', 'private/.env']) try { process.loadEnvFile(file) } catch { /* missing; rely on real env vars */ }

// A blank line in .env means "not set" (z.coerce would read it as 0, z.url would refuse to start).
const blankIsUnset = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s)

const schema = z.object({
  // Unset means production: a server that forgets this setting gets full security, never dev shortcuts.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  // Local development only: skip two-step at sign-in and enable the no-email password reset.
  // Ignored unless NODE_ENV=development as well.
  DEV_AUTH_SHORTCUTS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Sign-in, two-step and password attempts allowed per client IP per 15 minutes.
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  PORT: z.union([z.coerce.number().int().positive(), z.string().min(1)]).default(4000), // Passenger may pass a socket path
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  STORAGE_DIR: z.string().default('storage'), // local evidence storage; outside any web-served folder
  // Password-less quick-switch for the "Zenith Testing" sandbox org only (see test-switch.controller.ts).
  TEST_SWITCH: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Two-step verification. Defaults on. Set MFA_ENABLED=false to skip the /verify step for every login
  // (testing/demo phase); set it back to true (or remove it) before real customers use the site.
  MFA_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Encrypts authenticator secrets in the database, so a database copy alone cannot pass two-step verification.
  // A long random string; never change or lose it once set, or existing users must have two-step reset.
  MFA_ENCRYPTION_KEY: blankIsUnset(z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters').optional()),
  FRONTEND_DIR: z.string().optional(), // built frontend to serve from this server (single-domain hosting)
  PYTHON_SERVICE_URL: z.url().default('http://localhost:8000'),
  // AI document reading. Never expose these to the browser; the model and key have no defaults in code.
  AI_PROVIDER: z.string().default('gemini'),
  AI_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: blankIsUnset(z.url().optional()),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: blankIsUnset(z.url().optional()),
  // Organisations allowed to send documents to the external AI service, as comma-separated organisation ids.
  // Empty (the default) means no organisation: nothing is sent until written authorisation names the organisation.
  AI_ALLOWED_ORGS: z.string().default('').transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AI_DAILY_LIMIT_PER_ORG: z.coerce.number().int().positive().default(200), // AI calls per organisation per day: a cost guard
  AI_DAILY_LIMIT_PLATFORM: z.coerce.number().int().positive().default(2000), // AI calls across all organisations per day
  AI_INPUT_COST_PER_MILLION: blankIsUnset(z.coerce.number().nonnegative().optional()), // USD per million tokens, from the provider's price list
  AI_OUTPUT_COST_PER_MILLION: blankIsUnset(z.coerce.number().nonnegative().optional()),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const devShortcuts = env.NODE_ENV === 'development' && env.DEV_AUTH_SHORTCUTS
