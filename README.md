# PublicLedger

PublicLedger is a public, source-backed database of falsifiable predictions. It preserves the original statement, freezes a clear interpretation and resolution criteria, records the deadline, and later resolves the prediction against cited evidence. The product is intentionally strict: when evidence or attribution is weak, the item stays out of public scoring.

This repository is a from-scratch MVP implementation of the supplied product and technical brief. It does **not** include fabricated public-figure predictions. Without credentials, the app shows the real expert roster, public Polymarket context, and honest empty states. Verified predictions appear only after the ingestion and review pipeline has real source data.

## Architecture

- Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, and shadcn/ui
- Supabase Postgres, Auth, Row Level Security, and admin-only service-role writes
- Official X API ingestion; no scraping or unofficial mirrors
- OpenAI Responses API with Zod structured outputs for extraction, independent verification, market matching, and resolution proposals
- Public Polymarket Gamma API ingestion with hourly snapshots
- Wilson lower-bound leaderboard ranking, accuracy, Brier score, and calibration data
- Vitest unit/contract tests and Playwright desktop/mobile browser tests

The public read path is in `lib/data/public.ts`. Privileged reads and writes are separated into `lib/data/admin.ts`, `lib/auth/admin.ts`, server actions, and authenticated route handlers. Published prediction fields are frozen by a database trigger; later source and resolution events are captured separately in the audit log.

## Run locally

Prerequisites: Node.js 22+, pnpm 11+, and Docker if you want the local Supabase stack.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). With no configured services, the public app still runs: the expert roster is local and market cards are loaded from Polymarket when its public API is reachable.

## Configure Supabase

For a local database:

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset
```

Copy the local API URL, anon key, service-role key, and database connection string into `.env`. `db reset` applies both files under `supabase/migrations/`, including the schema, indexes, RLS policies, triggers, scorecard view, search function, and category seed.

For a hosted Supabase project:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase db push
```

Or, if you don't have the Supabase CLI installed and just want a one-shot bootstrap, paste `supabase/setup.sql` into the Supabase Dashboard SQL Editor. That file combines every migration, the categories seed, the 65-expert roster, and their category links into a single idempotent script — safe to re-run against any state.

In Supabase Auth, add `http://localhost:3000/auth/callback` locally and the deployed `/auth/callback` URL in production. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

**API keys.** Newer Supabase projects issue two key pairs: a legacy JWT anon/service-role pair and a modern `sb_publishable_...` / `sb_secret_...` pair. The app accepts either. Some Vercel plans flag `sb_publishable_` values as suspected secrets under `NEXT_PUBLIC_*` names — bulk-import via `.env` in the Vercel dashboard bypasses that check.

## Environment

Start with `.env.example`. The important groups are:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`: database, auth, server-only mutation access, and CLI ingestion.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VERIFIER_MODEL`: structured extraction and the independent second pass. Keep extractor and verifier logically independent even if they use the same model family.
- `X_BEARER_TOKEN`, `X_FULL_ARCHIVE_ENABLED`: official X API access. Full-archive search requires an eligible X API plan.
- `ADMIN_EMAILS`: comma-separated allowlist for magic-link admin access. The first successful allowlisted login is recorded in `app_admins`.
- `CRON_SECRET`: bearer secret for `POST /api/cron/polymarket`.
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`: optional, privacy-conscious product analytics. The app is a no-op when absent.
- `SUBMISSION_HASH_SALT`: production-only random value used to hash IPs for abuse throttling.

Do not enable `ENABLE_SYNTHETIC_FIXTURES` outside automated tests. Playwright injects it only into its own development server so the atomic Receipt page can be exercised without publishing fake data.

## Seed real data

Apply migrations first, then seed in stages:

```bash
pnpm seed:experts
pnpm seed:polymarket
pnpm seed:x -- --recent --all
pnpm tsx scripts/process-sources.ts
pnpm seed:resolve
pnpm readiness
```

`seed:experts` adds the PRD roster but keeps X identities unverified until the official API resolves each handle. `seed:polymarket` imports active and recently closed public markets, normalizes topics, and stores snapshots. `seed:x` stores exact official-source text with content hashes and provenance. `process-sources` applies the cheap deterministic filter, structured extraction, literal-quote validation, independent verification, duplicate detection, and conservative auto-publication thresholds.

To run the complete orchestration and receive a final ingestion summary:

```bash
pnpm seed
```

Use `X_FULL_ARCHIVE_ENABLED=true` only when your X API access supports it. Otherwise the seed uses recent search and leaves unavailable history unfilled rather than substituting scraped data. Bound cost and runtime with `SEED_MAX_POSTS_PER_EXPERT`, `SEED_MAX_OPENAI_ITEMS`, and `SEED_CONCURRENCY`.

### X discovery via xAI (no X Bearer Token)

When `XAI_API_KEY` is set, weekly X discovery runs through xAI's server-side `x_search` tool instead of the paid X API. Each candidate URL is then verified via `publish.x.com/oembed` (free, unauthenticated), and its `source_quote` must be an exact substring of the oEmbed body before it enters the extraction pipeline. Nothing is ever scraped.

```bash
# Rolling weekly window (respects per-expert checkpoints, 2-day overlap)
pnpm ingest:x:weekly

# 90-day backfill for a single expert (skipping extraction until you review)
pnpm ingest:x:backfill --expert nate_silver --days 90 --skip-extraction

# Dry-run to inspect candidate counts and cost without inserting sources
pnpm ingest:x:weekly --dry-run
```

Cost is enforced against `X_INGESTION_WEEKLY_SOFT_BUDGET_USD` (warn, keep going) and `X_INGESTION_WEEKLY_HARD_BUDGET_USD` (stop). Every request is recorded in `x_discovery_runs` with model, tokens, `x_search` tool calls, and dollar cost; each expert's `ingestion_checkpoints` row advances only on success. Saturated windows (xAI returns the max number of results and reports the window may still hold more) are automatically split in half and re-queried, bounded so a pathological account cannot burn the budget.

The GitHub Actions workflow `.github/workflows/ingest-x.yml` runs `pnpm ingest:x:weekly` every day at 12:00 UTC. It requires the following repo secrets: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `SUBMISSION_HASH_SALT`, and optional overrides for model IDs and budget caps. Add `SLACK_WEBHOOK_URL` and `NEXT_PUBLIC_SITE_ORIGIN` to route per-run summaries into Slack.

## Admin and operations

Visit `/admin/login` with an email listed in `ADMIN_EMAILS`. The admin area contains:

- a launch and ingestion dashboard;
- side-by-side candidate/source moderation with required audit reasons;
- resolution proposal review with explicit confirmation for scoring changes;
- expert identity state and ingestion-run inspection;
- manual Polymarket refresh.

Production schedulers should call:

```text
POST /api/cron/polymarket
Authorization: Bearer <CRON_SECRET>
```

Suggested cadence: Polymarket hourly, recent X sync every few hours, source availability refresh daily, and due-prediction resolution daily. The CLI commands `pnpm sync:polymarket`, `pnpm sync:x`, `pnpm refresh:x`, and `pnpm seed:resolve` are suitable scheduler entry points when run in a trusted environment.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm readiness` checks the launch volume targets and fails on key integrity violations such as scoring resolutions without evidence. Volume shortfalls are warnings because the system must never weaken verification rules merely to hit a target.

## Deploy

The app can be deployed on Vercel or any Node.js platform that supports Next.js 16. Configure the production environment, set `NEXT_PUBLIC_SITE_ORIGIN`, push the database migrations, add the production auth callback, and schedule the authenticated refresh jobs. Run all quality gates and `pnpm readiness` before public launch.

Vercel-specific notes:

- **Hobby plan** allows one cron per day at most. `vercel.json` is set to `0 12 * * *` (daily at 12:00 UTC). On Pro or above, change it to `0 * * * *` for hourly refresh.
- The cron endpoint `/api/cron/polymarket` accepts both `GET` (Vercel Cron) and `POST` (manual invocations), and requires `Authorization: Bearer $CRON_SECRET`.
- `instrumentation.ts` runs on server startup and patches `Headers.prototype.set/append` + wraps `globalThis.fetch` to strip any character with code point > 255 from outgoing HTTP header values. This is a defensive shim against Node 22's stricter `undici` validation; observed to matter for at least one request-scoped supabase-js code path in production.

## Content and scoring rules

- Only direct statements from an attributable original source qualify.
- A source quote must remain an exact contiguous substring of the stored source text.
- Predictions require falsifiable criteria and a deadline or clearly bounded event.
- Published normalization, deadline, and criteria are immutable; corrections create audited state rather than silently rewriting history.
- Deleted or unverifiable sources are not shown from stale text and are removed from public scoring until alternate verification is approved.
- Ambiguous and void outcomes do not count as binary wins or losses.
- Leaderboard eligibility requires the configured minimum sample; provisional records remain visibly labeled.

See `/methodology` in the running app for the reader-facing explanation.
