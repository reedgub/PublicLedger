import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: optionalUrl,
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_VERIFIER_MODEL: z.string().default("gpt-5-mini"),
  X_BEARER_TOKEN: z.string().optional(),
  X_FULL_ARCHIVE_ENABLED: z.enum(["true", "false"]).default("false"),
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  XAI_MODEL: z.string().default("grok-4-fast-non-reasoning"),
  XAI_DISCOVERY_PROMPT_VERSION: z.string().default("v3-multi-source"),
  XAI_MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(50).default(20),
  XAI_MAX_CANDIDATES_PER_WINDOW: z.coerce.number().int().min(1).max(50).default(10),
  XAI_PRICE_INPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.3),
  XAI_PRICE_OUTPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.5),
  XAI_PRICE_PER_SEARCH_SOURCE_USD: z.coerce.number().nonnegative().default(0.025),
  X_INGESTION_WEEKLY_SOFT_BUDGET_USD: z.coerce.number().nonnegative().default(3),
  X_INGESTION_WEEKLY_HARD_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  AUTO_APPROVE_MODE: z.enum(["on", "off"]).default("on"),
  ADMIN_EMAILS: z.string().default(""),
  CRON_SECRET: z.string().optional(),
  NEXT_PUBLIC_SITE_ORIGIN: optionalUrl,
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrl,
  SEED_MAX_POSTS_PER_EXPERT: z.coerce.number().int().positive().default(250),
  SEED_MAX_OPENAI_ITEMS: z.coerce.number().int().positive().default(500),
  SEED_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  SEED_START_DATE: z.string().default("2021-01-01T00:00:00Z"),
  SEED_END_DATE: z.string().optional(),
  HISTORICAL_MARKET_MAX_DISTANCE_HOURS: z.coerce.number().positive().default(12),
  SUBMISSION_HASH_SALT: z.string().default("local-development-only"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const DEFAULT_SUBMISSION_HASH_SALT = "local-development-only";

// Vercel materializes unset env vars as empty strings, which defeats Zod's
// .default() (defaults only apply when the input is undefined). Normalize
// empty strings to undefined so defaults and .optional() behave the same way
// locally and in production.
const raw = (value: string | undefined) => (value && value.trim() !== "" ? value : undefined);

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: raw(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: raw(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: raw(process.env.SUPABASE_SERVICE_ROLE_KEY),
  DATABASE_URL: raw(process.env.DATABASE_URL),
  OPENAI_API_KEY: raw(process.env.OPENAI_API_KEY),
  OPENAI_MODEL: raw(process.env.OPENAI_MODEL),
  OPENAI_VERIFIER_MODEL: raw(process.env.OPENAI_VERIFIER_MODEL),
  X_BEARER_TOKEN: raw(process.env.X_BEARER_TOKEN),
  X_FULL_ARCHIVE_ENABLED: raw(process.env.X_FULL_ARCHIVE_ENABLED),
  XAI_API_KEY: raw(process.env.XAI_API_KEY),
  XAI_BASE_URL: raw(process.env.XAI_BASE_URL),
  XAI_MODEL: raw(process.env.XAI_MODEL),
  XAI_DISCOVERY_PROMPT_VERSION: raw(process.env.XAI_DISCOVERY_PROMPT_VERSION),
  XAI_MAX_SEARCH_RESULTS: raw(process.env.XAI_MAX_SEARCH_RESULTS),
  XAI_MAX_CANDIDATES_PER_WINDOW: raw(process.env.XAI_MAX_CANDIDATES_PER_WINDOW),
  XAI_PRICE_INPUT_PER_MTOK_USD: raw(process.env.XAI_PRICE_INPUT_PER_MTOK_USD),
  XAI_PRICE_OUTPUT_PER_MTOK_USD: raw(process.env.XAI_PRICE_OUTPUT_PER_MTOK_USD),
  XAI_PRICE_PER_SEARCH_SOURCE_USD: raw(process.env.XAI_PRICE_PER_SEARCH_SOURCE_USD),
  X_INGESTION_WEEKLY_SOFT_BUDGET_USD: raw(process.env.X_INGESTION_WEEKLY_SOFT_BUDGET_USD),
  X_INGESTION_WEEKLY_HARD_BUDGET_USD: raw(process.env.X_INGESTION_WEEKLY_HARD_BUDGET_USD),
  AUTO_APPROVE_MODE: raw(process.env.AUTO_APPROVE_MODE),
  ADMIN_EMAILS: raw(process.env.ADMIN_EMAILS),
  CRON_SECRET: raw(process.env.CRON_SECRET),
  NEXT_PUBLIC_SITE_ORIGIN: raw(process.env.NEXT_PUBLIC_SITE_ORIGIN),
  NEXT_PUBLIC_POSTHOG_KEY: raw(process.env.NEXT_PUBLIC_POSTHOG_KEY),
  NEXT_PUBLIC_POSTHOG_HOST: raw(process.env.NEXT_PUBLIC_POSTHOG_HOST),
  SEED_MAX_POSTS_PER_EXPERT: raw(process.env.SEED_MAX_POSTS_PER_EXPERT),
  SEED_MAX_OPENAI_ITEMS: raw(process.env.SEED_MAX_OPENAI_ITEMS),
  SEED_CONCURRENCY: raw(process.env.SEED_CONCURRENCY),
  SEED_START_DATE: raw(process.env.SEED_START_DATE),
  SEED_END_DATE: raw(process.env.SEED_END_DATE),
  HISTORICAL_MARKET_MAX_DISTANCE_HOURS: raw(process.env.HISTORICAL_MARKET_MAX_DISTANCE_HOURS),
  SUBMISSION_HASH_SALT: raw(process.env.SUBMISSION_HASH_SALT),
  NODE_ENV: raw(process.env.NODE_ENV),
});

// In production the IP-hash salt MUST be unique per deployment. The default
// value is publicly known (it lives in this repository), so if we ever ship it
// the /api/submissions rate limit collapses: any attacker can precompute the
// hashes and bypass throttling. Fail loudly at runtime boot instead of
// silently — but skip during `next build` (NEXT_PHASE=phase-production-build),
// where the module is evaluated for route collection without real secrets in
// scope.
const IS_NEXT_BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";
if (
  env.NODE_ENV === "production" &&
  !IS_NEXT_BUILD_PHASE &&
  env.SUBMISSION_HASH_SALT === DEFAULT_SUBMISSION_HASH_SALT
) {
  throw new Error(
    "SUBMISSION_HASH_SALT is set to the default development value in production. " +
      "Set a strong, deployment-unique value (e.g. `openssl rand -hex 32`) before booting.",
  );
}

export const integrations = {
  supabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseAdmin: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  database: Boolean(env.DATABASE_URL),
  openai: Boolean(env.OPENAI_API_KEY),
  x: Boolean(env.X_BEARER_TOKEN),
  xFullArchive: Boolean(env.X_BEARER_TOKEN) && env.X_FULL_ARCHIVE_ENABLED === "true",
  xai: Boolean(env.XAI_API_KEY),
  polymarket: true,
} as const;

export function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
