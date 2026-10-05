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
- Locked design system (dark canvas, Inter display type, Geist Mono labels, Motion-based scroll animation). See [`DESIGN.md`](DESIGN.md) before building UI

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
- `OPEN_MODEL_*`, `TRANSCRIBE_*`, `VERIFIER_MODE`, `CASCADE_VERIFIER_MODEL`: the low-cost cascade (see below). `*_PRICE_*` values drive spend accounting and `--estimate`; set them from your provider dashboards.
- `DAILY_BUDGET_USD`, `BACKFILL_BUDGET_USD`, `RESOLUTION_DAILY_BUDGET_USD`: hard spend caps.
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

## Low-cost ingestion pipeline (daily + historical backfill)

The default pipeline reads everything cheaply and only spends money on text that survives cheaper filters:

| Stage | What runs | Cost |
| --- | --- | --- |
| Collect | Official X API (keyword-filtered recent search daily, so only candidate posts are billed; merged full-archive queries for backfill), RSS/Atom feeds, sitemaps, podcast RSS + Whisper | X reads are billed per post; feeds/sitemaps are free |
| 0 | Regex heuristic + passage selection for long documents (`lib/pipeline/chunk.ts`) | free |
| 1 | Small open model screens ~20 items per call, tuned for recall (`lib/pipeline/screen.ts`) | ~free |
| 2 | Open-weight extraction with the production prompt + outcome-blindness rules (`lib/pipeline/extract.ts`) | cents per thousand units |
| — | Deterministic checks: exact-substring quote, dates, dedupe (`lib/predictions/`) | free |
| 3 | ONE frontier verification call per candidate via the OpenAI Batch API (`lib/pipeline/verify.ts`) | ~50% of normal price |

Open models run behind any OpenAI-compatible endpoint (`OPEN_MODEL_BASE_URL`): DeepInfra, Together, Groq, Fireworks, OpenRouter, or your own vLLM/Ollama server. Without `OPEN_MODEL_API_KEY`, screening is skipped (heuristic only) and extraction falls back to `OPENAI_MODEL`.

Every paid call is booked in `pipeline_spend`, and hard caps are enforced before each call: `DAILY_BUDGET_USD` (rolling 24h), `RESOLUTION_DAILY_BUDGET_USD`, and `BACKFILL_BUDGET_USD` (a **lifetime** cap across all backfill runs — raise it to continue). `pnpm spend` prints where the money went and the cost per published prediction.

```bash
pnpm ingest:daily                 # collect finished batches → X recent search/feeds/podcasts → cascade → submit batch
pnpm backfill --estimate --years 2   # forecast cost from X counts (no post reads)
pnpm backfill --years 2 --budget 20  # collect + process, resumable; rerun to continue
pnpm backfill --years 5 --experts sama,LHSummers --sources x,writing,podcast
pnpm verify:collect               # apply finished verification batches (also runs at the start of ingest:daily)
pnpm sources:add --expert larry-summers --kind sitemap --url https://example.substack.com/sitemap.xml
pnpm discover:experts --wikidata --score   # suggest new experts; approve with --approve <handle> --slug --category
pnpm export:training              # labelled JSONL for fine-tuning the cheap stages
pnpm spend
```

Backfill integrity rules:

- **Scan whole months, never "notable" posts.** Months are visited 12–36 months old first (resolvable now), then the last year, then older history, interleaved across experts. Every month's status is stored in `ingestion_coverage` and exposed (aggregate only) via `expert_coverage_summary`.
- **Outcome blindness.** Extraction sees only the source and its timestamp; the verifier rejects `hindsight_leak` (claims or criteria that use information unknowable on the source date).
- **No human review queue.** The verifier publishes only `faithful` approvals at ≥ 0.9 confidence with a resolution date; everything else is rejected with its reason kept in `prediction_candidates`. Resolutions that miss the auto thresholds stay unresolved and are retried every 30 days.
- **Provenance.** `sources.discovered_at` and `ingestion_mode`, and `predictions.capture_mode`, are protected by triggers. Backfilled predictions show an "Archive capture" badge and never get market links (no historical snapshots exist).
- **Speaker attribution.** Feed/sitemap articles whose byline names someone else are skipped. Podcast transcripts have no speaker labels, so candidates from shows where the expert is not the registered host are never published (rejected as speaker-uncertain).
- **Compliance.** `pnpm refresh:x` (weekly workflow) re-checks posts behind published predictions 100 ids per request and quarantines deleted or edited ones.

Resolution is also cheaper: one web-search proposal per prediction, then every cited excerpt is checked against the live page (`lib/resolution/evidence.ts`) and only confirmed evidence is shown, counted toward auto-resolution, or passed to the verifier (which no longer runs its own web search).

Workflows: `ingest-daily.yml` (daily), `backfill.yml` (manual, `estimate` defaults to true), `refresh-sources.yml` (weekly), `resolve-due.yml` (daily). Add repo secrets `X_BEARER_TOKEN`, `OPEN_MODEL_API_KEY`, `TRANSCRIBE_API_KEY`, `OPENAI_API_KEY`, plus the existing database secrets; optional repo variables override models, endpoints, prices, and budgets.

### X discovery via xAI (legacy, manual)

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

The GitHub Actions workflow `.github/workflows/ingest-x.yml` runs `pnpm ingest:x:weekly` on manual dispatch only (superseded by `ingest-daily.yml`). It requires the following repo secrets: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `SUBMISSION_HASH_SALT`, and optional overrides for model IDs and budget caps. Add `SLACK_WEBHOOK_URL` and `NEXT_PUBLIC_SITE_ORIGIN` to route per-run summaries into Slack.

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
