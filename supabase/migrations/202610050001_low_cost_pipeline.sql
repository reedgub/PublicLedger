-- Low-cost ingestion pipeline + 2–5 year historical backfill.
--
-- Adds the bookkeeping the cascade pipeline needs:
--   * Capture provenance on sources and predictions (live vs. backfill, and
--     the immutable first-seen timestamp) so a retroactively captured
--     prediction is never presented as if it had been recorded live.
--   * Per-source screening state, so millions of backfilled posts can be
--     triaged without writing a prediction_candidates row for each one.
--   * Coverage ledger: which expert × source × month windows were scanned
--     completely. Scorecards can then state coverage instead of implying
--     completeness, and backfills are resumable.
--   * Spend ledger across every paid provider, for hard budget caps.
--   * Non-X expert sources (Substack/blog feeds, sitemaps, podcasts).
--   * Batch verification jobs (OpenAI Batch API, ~50% cheaper, async).
--   * Expert suggestions mined from the mention graph / Wikidata.
-- Idempotent where Postgres allows it.

-- ---------------------------------------------------------------------------
-- Capture provenance
-- ---------------------------------------------------------------------------
alter table public.sources add column if not exists expert_id uuid references public.experts(id) on delete set null;
alter table public.sources add column if not exists ingestion_mode text not null default 'live';
alter table public.sources add column if not exists discovered_at timestamptz not null default now();
alter table public.sources drop constraint if exists sources_ingestion_mode_check;
alter table public.sources add constraint sources_ingestion_mode_check check (ingestion_mode in ('live', 'backfill'));

-- Existing rows: first-seen time is the row's creation time, and anything
-- stored more than 7 days after it was published was an archive capture
-- (hand-curated imports and look-back discovery), not a live capture.
-- Runs before the guard trigger below exists.
update public.sources set discovered_at = created_at where discovered_at > created_at;
update public.sources set ingestion_mode = 'backfill'
  where ingestion_mode = 'live' and created_at > published_at + interval '7 days';

-- discovered_at is the first time PublicLedger saw the source. Upserts must
-- never move it; enforce that in the database rather than trusting callers.
create or replace function public.guard_source_discovered_at()
returns trigger language plpgsql as $$
begin
  new.discovered_at := old.discovered_at;
  -- A source first captured live stays live even if a backfill re-fetches it.
  if old.ingestion_mode = 'live' then new.ingestion_mode := 'live'; end if;
  return new;
end;
$$;
drop trigger if exists sources_guard_discovered_at on public.sources;
create trigger sources_guard_discovered_at before update on public.sources
for each row execute function public.guard_source_discovered_at();

alter table public.predictions add column if not exists capture_mode text not null default 'live';
alter table public.predictions drop constraint if exists predictions_capture_mode_check;
alter table public.predictions add constraint predictions_capture_mode_check check (capture_mode in ('live', 'backfill'));

-- Existing predictions recorded more than 7 days after the statement are
-- archive captures. Must run before the guard trigger below.
update public.predictions set capture_mode = 'backfill'
  where capture_mode = 'live' and created_at > prediction_date + interval '7 days';

-- capture_mode is part of the published record's provenance: once published
-- it may not be flipped (a backfilled prediction can never become "live").
create or replace function public.guard_prediction_capture_mode()
returns trigger language plpgsql as $$
begin
  if old.published_at is not null and new.capture_mode is distinct from old.capture_mode then
    raise exception 'capture_mode of a published prediction is immutable.';
  end if;
  return new;
end;
$$;
drop trigger if exists predictions_guard_capture_mode on public.predictions;
create trigger predictions_guard_capture_mode before update on public.predictions
for each row execute function public.guard_prediction_capture_mode();

-- ---------------------------------------------------------------------------
-- Screening state (stage 0 heuristic + stage 1 cheap classifier)
-- ---------------------------------------------------------------------------
alter table public.sources add column if not exists screen_status text not null default 'pending';
alter table public.sources drop constraint if exists sources_screen_status_check;
alter table public.sources add constraint sources_screen_status_check
  check (screen_status in ('pending', 'dropped', 'passed', 'extracted', 'error'));
alter table public.sources add column if not exists screen_score numeric;
alter table public.sources add column if not exists screen_model text;
alter table public.sources add column if not exists screened_at timestamptz;
-- Existing sources already handled by the legacy pipeline or imported with
-- their predictions must not be extracted (and paid for) a second time.
update public.sources set screen_status = 'extracted', screen_model = coalesce(screen_model, 'legacy'), screened_at = coalesce(screened_at, now())
  where screen_status = 'pending' and (
    exists (select 1 from public.prediction_candidates pc where pc.source_id = sources.id)
    or exists (select 1 from public.predictions p where p.source_id = sources.id));
create index if not exists sources_screen_pending_idx on public.sources(published_at) where screen_status in ('pending', 'passed');
create index if not exists sources_expert_idx on public.sources(expert_id);

-- Candidates waiting on an async (batch) verifier.
alter table public.prediction_candidates add column if not exists verification_batch_id uuid;
alter table public.prediction_candidates add column if not exists pipeline text not null default 'legacy';
create index if not exists prediction_candidates_pending_idx on public.prediction_candidates(created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Non-X expert sources
-- ---------------------------------------------------------------------------
create table if not exists public.expert_sources (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  kind text not null check (kind in ('feed', 'sitemap', 'podcast')),
  url text not null,
  -- For podcasts: whether the expert is the host/sole speaker. Transcripts
  -- have no reliable speaker attribution, so candidates from shows where the
  -- expert is only a guest always go to admin review.
  expert_is_host boolean not null default false,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_item_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (expert_id, url)
);

-- ---------------------------------------------------------------------------
-- Coverage ledger
-- ---------------------------------------------------------------------------
create table if not exists public.ingestion_coverage (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  source_type text not null,
  mode text not null check (mode in ('live', 'backfill')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'partial', 'failed', 'skipped')),
  query_version text,
  estimated_items integer,
  items_fetched integer not null default 0,
  cost_usd numeric not null default 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (expert_id, source_type, period_start, period_end),
  check (period_end > period_start)
);
create index if not exists ingestion_coverage_status_idx on public.ingestion_coverage(status, period_start desc);

-- Public, aggregate-only coverage summary for scorecards: how much of each
-- expert's history has been scanned completely. No cost data exposed.
create or replace view public.expert_coverage_summary as
select
  c.expert_id,
  c.source_type,
  min(c.period_start) filter (where c.status = 'complete') as covered_from,
  max(c.period_end) filter (where c.status = 'complete') as covered_to,
  count(*) filter (where c.status = 'complete') as complete_periods,
  count(*) as planned_periods
from public.ingestion_coverage c
join public.experts e on e.id = c.expert_id and e.is_active
group by c.expert_id, c.source_type;
grant select on public.expert_coverage_summary to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spend ledger
-- ---------------------------------------------------------------------------
create table if not exists public.pipeline_spend (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  scope text not null default 'daily' check (scope in ('daily', 'backfill', 'resolution', 'discovery', 'other')),
  provider text not null,
  stage text not null,
  units numeric not null default 0,
  unit_kind text not null,
  cost_usd numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_spend_scope_created_idx on public.pipeline_spend(scope, created_at desc);

-- ---------------------------------------------------------------------------
-- Batch verification jobs
-- ---------------------------------------------------------------------------
create table if not exists public.verification_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'openai',
  provider_batch_id text unique,
  kind text not null check (kind in ('candidate_verify')),
  status text not null default 'submitted'
    check (status in ('submitted', 'completed', 'failed', 'expired', 'cancelled', 'collected')),
  model text not null,
  item_count integer not null default 0,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  collected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Expert suggestions (roster growth, admin-approved)
-- ---------------------------------------------------------------------------
create table if not exists public.expert_suggestions (
  id uuid primary key default gen_random_uuid(),
  x_handle text not null,
  display_name text,
  discovered_via text not null check (discovered_via in ('mention_graph', 'wikidata', 'manual')),
  mention_count integer not null default 0,
  mentioned_by_experts integer not null default 0,
  forecast_posts_90d integer,
  total_posts_90d integer,
  prediction_density numeric,
  status text not null default 'new' check (status in ('new', 'approved', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expert_suggestions_handle_unique on public.expert_suggestions(lower(x_handle));

-- ---------------------------------------------------------------------------
-- Live cursors for timeline polling (since_id) live on checkpoints.
-- ---------------------------------------------------------------------------
alter table public.ingestion_checkpoints add column if not exists cursor text;

-- ---------------------------------------------------------------------------
-- RLS: operational tables are admin-only (scripts use the service role).
-- ---------------------------------------------------------------------------
alter table public.expert_sources enable row level security;
alter table public.ingestion_coverage enable row level security;
alter table public.pipeline_spend enable row level security;
alter table public.verification_batches enable row level security;
alter table public.expert_suggestions enable row level security;

drop policy if exists admin_all_expert_sources on public.expert_sources;
create policy admin_all_expert_sources on public.expert_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_ingestion_coverage on public.ingestion_coverage;
create policy admin_all_ingestion_coverage on public.ingestion_coverage for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_pipeline_spend on public.pipeline_spend;
create policy admin_all_pipeline_spend on public.pipeline_spend for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_verification_batches on public.verification_batches;
create policy admin_all_verification_batches on public.verification_batches for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_expert_suggestions on public.expert_suggestions;
create policy admin_all_expert_suggestions on public.expert_suggestions for all to authenticated using (public.is_admin()) with check (public.is_admin());
