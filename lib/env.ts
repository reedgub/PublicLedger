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
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_VERIFIER_MODEL: process.env.OPENAI_VERIFIER_MODEL,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  X_FULL_ARCHIVE_ENABLED: process.env.X_FULL_ARCHIVE_ENABLED,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  CRON_SECRET: process.env.CRON_SECRET,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  SEED_MAX_POSTS_PER_EXPERT: process.env.SEED_MAX_POSTS_PER_EXPERT,
  SEED_MAX_OPENAI_ITEMS: process.env.SEED_MAX_OPENAI_ITEMS,
  SEED_CONCURRENCY: process.env.SEED_CONCURRENCY,
  SEED_START_DATE: process.env.SEED_START_DATE,
  SEED_END_DATE: process.env.SEED_END_DATE,
  HISTORICAL_MARKET_MAX_DISTANCE_HOURS: process.env.HISTORICAL_MARKET_MAX_DISTANCE_HOURS,
  SUBMISSION_HASH_SALT: process.env.SUBMISSION_HASH_SALT,
});

export const integrations = {
  supabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseAdmin: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  database: Boolean(env.DATABASE_URL),
  openai: Boolean(env.OPENAI_API_KEY),
  x: Boolean(env.X_BEARER_TOKEN),
  xFullArchive: Boolean(env.X_BEARER_TOKEN) && env.X_FULL_ARCHIVE_ENABLED === "true",
  polymarket: true,
} as const;

export function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
