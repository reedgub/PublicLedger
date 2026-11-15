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
  XAI_DISCOVERY_PROMPT_VERSION: z.string().default("v4-multi-source-cost-capped"),
  // maxResults per tool call. Grok's Agent Tools bills per response, and
  // costs scale with both tool-call count and result payload size (each
  // returned source pushes ~1–2 KB of tokens into the next round). The
  // 20-per-call default made a 2-day 80-expert sweep cost $7.60. Dropping
  // to 5 cuts the returned-result payload ~4× and, together with the prompt
  // guidance below, gets the model to make fewer parallel tool calls.
  XAI_MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(50).default(5),
  // How many predictions the model is asked to return per window. Cutting
  // this from 10 to 5 telegraphs to the model that it does not need to hunt
  // exhaustively — the daily volume from a single expert is almost never
  // more than 2–3 real predictions anyway.
  XAI_MAX_CANDIDATES_PER_WINDOW: z.coerce.number().int().min(1).max(50).default(5),
  XAI_PRICE_INPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.3),
  XAI_PRICE_OUTPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.5),
  XAI_PRICE_PER_SEARCH_SOURCE_USD: z.coerce.number().nonnegative().default(0.025),
  X_INGESTION_WEEKLY_SOFT_BUDGET_USD: z.coerce.number().nonnegative().default(3),
  X_INGESTION_WEEKLY_HARD_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  // ---- Low-cost cascade pipeline -------------------------------------------
  // Stage 1/2 run on open-weight models behind any OpenAI-compatible endpoint:
  // a hosted provider (DeepInfra, Together, Groq, Fireworks, OpenRouter) or
  // your own vLLM/Ollama server. Swap providers by changing the base URL.
  // Model ids differ per provider — check your provider's model list.
  OPEN_MODEL_BASE_URL: z.string().url().default("https://api.deepinfra.com/v1/openai"),
  OPEN_MODEL_API_KEY: z.string().optional(),
  OPEN_MODEL_SCREEN_MODEL: z.string().default("meta-llama/Meta-Llama-3.1-8B-Instruct"),
  OPEN_MODEL_EXTRACT_MODEL: z.string().default("Qwen/Qwen3-32B"),
  // Per-million-token prices, used for spend accounting and --estimate only.
  // Defaults are rough; set them from your provider's pricing page.
  OPEN_MODEL_SCREEN_PRICE_INPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.03),
  OPEN_MODEL_SCREEN_PRICE_OUTPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.05),
  OPEN_MODEL_EXTRACT_PRICE_INPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.1),
  OPEN_MODEL_EXTRACT_PRICE_OUTPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.3),
  OPEN_MODEL_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  // Stage 3: one frontier verification call per surviving candidate. "batch"
  // uses the OpenAI Batch API (~50% cheaper, results within 24h); "sync" is
  // for small volumes or local debugging.
  VERIFIER_MODE: z.enum(["batch", "sync"]).default("batch"),
  CASCADE_VERIFIER_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_PRICE_INPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(0.25),
  OPENAI_PRICE_OUTPUT_PER_MTOK_USD: z.coerce.number().nonnegative().default(2),
  OPENAI_BATCH_DISCOUNT: z.coerce.number().min(0).max(1).default(0.5),
  // Official X API pay-per-use read price per returned post. Verify against
  // the X developer console before trusting --estimate output.
  X_PRICE_PER_POST_READ_USD: z.coerce.number().nonnegative().default(0.005),
  X_PRICE_PER_REQUEST_USD: z.coerce.number().nonnegative().default(0),
  // Podcast transcription through any OpenAI-compatible /audio/transcriptions
  // endpoint (Groq, DeepInfra, or a self-hosted faster-whisper server).
  TRANSCRIBE_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  TRANSCRIBE_API_KEY: z.string().optional(),
  TRANSCRIBE_MODEL: z.string().default("whisper-large-v3-turbo"),
  TRANSCRIBE_PRICE_PER_HOUR_USD: z.coerce.number().nonnegative().default(0.04),
  // Hard caps, enforced from public.pipeline_spend before every paid call.
  DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2),
  BACKFILL_BUDGET_USD: z.coerce.number().nonnegative().default(25),
  RESOLUTION_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  // OpenAI web_search tool price per call (spend accounting only).
  RESOLUTION_SEARCH_CALL_USD: z.coerce.number().nonnegative().default(0.01),
  RESOLUTION_MAX_PER_RUN: z.coerce.number().int().positive().default(100),
  CASCADE_MAX_SOURCES_PER_RUN: z.coerce.number().int().positive().default(5000),
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
  OPEN_MODEL_BASE_URL: raw(process.env.OPEN_MODEL_BASE_URL),
  OPEN_MODEL_API_KEY: raw(process.env.OPEN_MODEL_API_KEY),
  OPEN_MODEL_SCREEN_MODEL: raw(process.env.OPEN_MODEL_SCREEN_MODEL),
  OPEN_MODEL_EXTRACT_MODEL: raw(process.env.OPEN_MODEL_EXTRACT_MODEL),
  OPEN_MODEL_SCREEN_PRICE_INPUT_PER_MTOK_USD: raw(process.env.OPEN_MODEL_SCREEN_PRICE_INPUT_PER_MTOK_USD),
  OPEN_MODEL_SCREEN_PRICE_OUTPUT_PER_MTOK_USD: raw(process.env.OPEN_MODEL_SCREEN_PRICE_OUTPUT_PER_MTOK_USD),
  OPEN_MODEL_EXTRACT_PRICE_INPUT_PER_MTOK_USD: raw(process.env.OPEN_MODEL_EXTRACT_PRICE_INPUT_PER_MTOK_USD),
  OPEN_MODEL_EXTRACT_PRICE_OUTPUT_PER_MTOK_USD: raw(process.env.OPEN_MODEL_EXTRACT_PRICE_OUTPUT_PER_MTOK_USD),
  OPEN_MODEL_CONCURRENCY: raw(process.env.OPEN_MODEL_CONCURRENCY),
  VERIFIER_MODE: raw(process.env.VERIFIER_MODE),
  CASCADE_VERIFIER_MODEL: raw(process.env.CASCADE_VERIFIER_MODEL),
  OPENAI_PRICE_INPUT_PER_MTOK_USD: raw(process.env.OPENAI_PRICE_INPUT_PER_MTOK_USD),
  OPENAI_PRICE_OUTPUT_PER_MTOK_USD: raw(process.env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD),
  OPENAI_BATCH_DISCOUNT: raw(process.env.OPENAI_BATCH_DISCOUNT),
  X_PRICE_PER_POST_READ_USD: raw(process.env.X_PRICE_PER_POST_READ_USD),
  X_PRICE_PER_REQUEST_USD: raw(process.env.X_PRICE_PER_REQUEST_USD),
  TRANSCRIBE_BASE_URL: raw(process.env.TRANSCRIBE_BASE_URL),
  TRANSCRIBE_API_KEY: raw(process.env.TRANSCRIBE_API_KEY),
  TRANSCRIBE_MODEL: raw(process.env.TRANSCRIBE_MODEL),
  TRANSCRIBE_PRICE_PER_HOUR_USD: raw(process.env.TRANSCRIBE_PRICE_PER_HOUR_USD),
  DAILY_BUDGET_USD: raw(process.env.DAILY_BUDGET_USD),
  BACKFILL_BUDGET_USD: raw(process.env.BACKFILL_BUDGET_USD),
  RESOLUTION_DAILY_BUDGET_USD: raw(process.env.RESOLUTION_DAILY_BUDGET_USD),
  RESOLUTION_SEARCH_CALL_USD: raw(process.env.RESOLUTION_SEARCH_CALL_USD),
  RESOLUTION_MAX_PER_RUN: raw(process.env.RESOLUTION_MAX_PER_RUN),
  CASCADE_MAX_SOURCES_PER_RUN: raw(process.env.CASCADE_MAX_SOURCES_PER_RUN),
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
  openModel: Boolean(env.OPEN_MODEL_API_KEY),
  transcribe: Boolean(env.TRANSCRIBE_API_KEY),
  polymarket: true,
} as const;

export function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
