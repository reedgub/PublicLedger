-- Adds the metadata + audit tables the xAI-driven weekly X ingestion needs.
-- Idempotent: safe to re-run against a partially-migrated project.

-- Per-expert checkpoint of the last successful discovery window.
create table if not exists public.ingestion_checkpoints (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  source_type text not null,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_from_date timestamptz,
  last_to_date timestamptz,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(expert_id, source_type)
);
create index if not exists ingestion_checkpoints_expert_idx on public.ingestion_checkpoints(expert_id);
create index if not exists ingestion_checkpoints_source_success_idx on public.ingestion_checkpoints(source_type, last_success_at nulls first);

-- Per-request cost + token accounting for xAI discovery calls.
create table if not exists public.x_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid references public.ingestion_runs(id) on delete set null,
  expert_id uuid not null references public.experts(id) on delete cascade,
  from_date timestamptz not null,
  to_date timestamptz not null,
  model text,
  prompt_version text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cached', 'saturated', 'deferred')),
  candidate_count integer not null default 0,
  x_search_tool_calls integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric not null default 0,
  request_id text,
  raw jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(expert_id, from_date, to_date, prompt_version, model)
);
create index if not exists x_discovery_runs_expert_idx on public.x_discovery_runs(expert_id);
create index if not exists x_discovery_runs_started_idx on public.x_discovery_runs(started_at desc);

-- X-specific source metadata. Extends the existing sources table.
alter table public.sources add column if not exists oembed_verified_at timestamptz;
alter table public.sources add column if not exists oembed_cache_age bigint;
alter table public.sources add column if not exists source_verification_level text
  check (source_verification_level in ('xai_discovery', 'xai_oembed', 'x_api'));
alter table public.sources add column if not exists source_available boolean not null default true;

-- Read-only view surfaces the last xAI run per expert for the admin dashboard.
create or replace view public.expert_x_ingestion_status as
select
  e.id as expert_id, e.slug, e.display_name, e.x_handle,
  c.last_success_at, c.last_from_date, c.last_to_date, c.last_status, c.last_error,
  (
    select jsonb_build_object(
      'started_at', r.started_at, 'status', r.status, 'candidates', r.candidate_count,
      'cost_usd', r.cost_usd, 'from_date', r.from_date, 'to_date', r.to_date
    )
    from public.x_discovery_runs r
    where r.expert_id = e.id
    order by r.started_at desc
    limit 1
  ) as latest_run
from public.experts e
left join public.ingestion_checkpoints c on c.expert_id = e.id and c.source_type = 'x'
where e.is_active;

grant select on public.expert_x_ingestion_status to authenticated;

-- RLS: only admins can see the new tables. Discovery runs and checkpoints
-- carry operational cost info; keep them out of the anon-readable surface.
alter table public.ingestion_checkpoints enable row level security;
alter table public.x_discovery_runs enable row level security;

drop policy if exists admin_all_ingestion_checkpoints on public.ingestion_checkpoints;
create policy admin_all_ingestion_checkpoints on public.ingestion_checkpoints for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all_x_discovery_runs on public.x_discovery_runs;
create policy admin_all_x_discovery_runs on public.x_discovery_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
