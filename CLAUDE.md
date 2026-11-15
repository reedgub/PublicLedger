@AGENTS.md

# PublicLedger handoff

PublicLedger (formerly "Project Lighthouse" and, before that, "Receipts") is a source-backed public database of falsifiable predictions. Treat the original source, attribution, frozen claim, deadline, resolution criteria, evidence, and audit history as integrity-critical data.

## Start here

1. Read `README.md` for setup, architecture, seed commands, and deployment guidance.
2. Run `pnpm install`.
3. Run `supabase start`, copy `.env.example` to `.env`, and fill the local values printed by Supabase.
4. Run `pnpm seed:experts` and `pnpm seed:polymarket` for the credential-free dataset.
5. Add official X and OpenAI credentials only in the ignored `.env`, then run `pnpm seed` for real prediction extraction.
6. Before handing off changes, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm test:db` (against a disposable Postgres; CI runs it).

## Non-negotiable product rules

- Never fabricate a public figure's quote, prediction, source, deadline, probability, or resolution.
- Never scrape X or substitute unofficial mirrors; use the official API or leave history unavailable.
- A stored source quote must be an exact contiguous substring of the source text.
- Do not infer numeric probabilities from qualitative language.
- Published prediction substance is immutable. Corrections must be explicit and audited.
- Deleted or unverifiable source text must not remain publicly displayed or scored.
- Ambiguous and void outcomes are not binary wins or losses.
- Market context is informational and must not be presented as an attributed expert prediction.
- The database enforces these rules (`supabase/migrations/202611150001_integrity_guards.sql`). Never disable, bypass or weaken a guard to make a script work; fix the script. New schema changes go in a new migration, then `pnpm db:setup-sql`.
- There is one automated publish path: `publishCandidate` (`lib/pipeline/publish.ts`). Don't add another. Leads from Grok or anywhere else go through `seed/manual/` and `pnpm import:manual`, never straight into `predictions`.
- Quarantine (`lib/predictions/quarantine.ts`) is the only way a published prediction leaves public view; it never clears `published_at`.

## Design system (locked)

The visual design is final and documented in `DESIGN.md`. Read it before building or changing any UI, and follow it for everything new:

- Reuse the tokens in `app/globals.css` and the components in `components/brand/` and `components/motion/`. Don't introduce new colors, fonts, radii, or one-off styles. If something new is truly needed, add it as a reusable primitive and document it in `DESIGN.md` in the same change.
- Dark `#060606` canvas, Inter display headings at weight 400, Geist Mono uppercase labels, `PixelButton` CTAs, 20px cards, `.surface-light` for white panels.
- New sections enter with `Reveal` / `SplitReveal`; all motion respects reduced motion. No smooth-scroll or scroll-hijacking libraries.
- The product name is always written "PublicLedger".
- Check new UI at 390px and 1440px before handing off.

## Current implementation map

- Public App Router pages: `app/`
- Design system: `DESIGN.md`, `app/globals.css`, `components/brand/`, `components/motion/`
- Public data access: `lib/data/public.ts`
- Privileged data access and authorization: `lib/data/admin.ts`, `lib/auth/admin.ts`
- Schema, RLS, views, triggers, and search: `supabase/migrations/`
- X, feed/sitemap, podcast and Polymarket adapters: `lib/sources/`
- Low-cost cascade (screen → extract → batch verify), spend caps, coverage, backfill estimates: `lib/pipeline/`, `lib/llm/`
- OpenAI extraction and independent verification: `lib/ai/`
- Deterministic validation, deduplication, and promotion: `lib/predictions/`
- Ingestion and resolution commands: `scripts/` (`ingest-daily.ts`, `backfill.ts`, `process-cascade.ts`, `verify-batch.ts` are the default path; `import-manual.ts` takes Grok/hand-curated leads; `refresh-sources.ts` is the compliance re-check; `ingest-x-weekly.ts` is the legacy xAI path)
- Single publish path and quarantine: `lib/pipeline/publish.ts`, `lib/predictions/quarantine.ts`, `lib/sources/liveCheck.ts`
- Generated one-paste bootstrap: `supabase/setup.sql` (from `scripts/build-setup-sql.ts`; never edit by hand)
- Real expert discovery roster: `seed/experts.ts`
- Unit and browser coverage: `**/*.test.ts`, `tests/e2e/`; database guards and integration: `supabase/tests/`, `tests/db/`

## Handoff status

The repository contains a complete, tested MVP. A credential-free local seed produces the expert roster in `seed/experts.ts`, real Polymarket markets, and market snapshots, and zero public predictions. Predictions are published only by the cascade verifier (or an allowlisted admin in `/admin`), from sources collected by the daily job (X, feeds, podcasts) or from leads in `seed/manual/` (the daily Grok Bot file, hand-curated lists) that pass live re-verification. Production rows published before the database guards existed are listed by `prediction_integrity_violations` and reported by `pnpm readiness`.
