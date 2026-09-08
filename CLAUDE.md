@AGENTS.md

# Project Lighthouse handoff

Project Lighthouse (repo directory: `receipts/`, historical brand: "Receipts") is a source-backed public database of falsifiable predictions. Treat the original source, attribution, frozen claim, deadline, resolution criteria, evidence, and audit history as integrity-critical data.

## Start here

1. Read `README.md` for setup, architecture, seed commands, and deployment guidance.
2. Run `pnpm install`.
3. Run `supabase start`, copy `.env.example` to `.env`, and fill the local values printed by Supabase.
4. Run `pnpm seed:experts` and `pnpm seed:polymarket` for the credential-free dataset.
5. Add official X and OpenAI credentials only in the ignored `.env`, then run `pnpm seed` for real prediction extraction.
6. Before handing off changes, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`.

## Non-negotiable product rules

- Never fabricate a public figure's quote, prediction, source, deadline, probability, or resolution.
- Never scrape X or substitute unofficial mirrors; use the official API or leave history unavailable.
- A stored source quote must be an exact contiguous substring of the source text.
- Do not infer numeric probabilities from qualitative language.
- Published prediction substance is immutable. Corrections must be explicit and audited.
- Deleted or unverifiable source text must not remain publicly displayed or scored.
- Ambiguous and void outcomes are not binary wins or losses.
- Market context is informational and must not be presented as an attributed expert prediction.

## Current implementation map

- Public App Router pages: `app/`
- Public data access: `lib/data/public.ts`
- Privileged data access and authorization: `lib/data/admin.ts`, `lib/auth/admin.ts`
- Schema, RLS, views, triggers, and search: `supabase/migrations/`
- X and Polymarket adapters: `lib/sources/`
- OpenAI extraction and independent verification: `lib/ai/`
- Deterministic validation, deduplication, and promotion: `lib/predictions/`
- Ingestion and resolution commands: `scripts/`
- Real expert discovery roster: `seed/experts.ts`
- Unit and browser coverage: `**/*.test.ts`, `tests/e2e/`

## Handoff status

The repository contains a complete, tested MVP. A credential-free local seed produces 65 experts, 199 topics, 200 real Polymarket markets, and 200 market snapshots. It intentionally produces zero public predictions until an official X bearer token and OpenAI API key are configured and the resulting candidates pass verification or admin review.
