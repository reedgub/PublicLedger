-- ============================================================================
-- Project Lighthouse one-shot setup (IDEMPOTENT — safe to re-run against any state).
-- Paste into Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- Contains:
--   1. Schema (all tables, indexes, RLS, is_admin(), triggers, views, RPC).
--   2. Category seed (12 rows).
--   3. Expert roster seed (65 experts + 91 category links).
-- Zero fabricated predictions.
-- ============================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.categories (
  slug text primary key,
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.experts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,
  x_user_id text unique,
  x_handle text unique,
  avatar_url text,
  headline text,
  primary_category_slug text references public.categories(slug),
  is_public_figure boolean not null default true,
  is_active boolean not null default true,
  source_status text not null default 'unverified'
    check (source_status in ('unverified', 'verified', 'unresolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expert_categories (
  expert_id uuid not null references public.experts(id) on delete cascade,
  category_slug text not null references public.categories(slug),
  primary key (expert_id, category_slug)
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  category_slug text references public.categories(slug),
  description text,
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_from text not null default 'manual' check (created_from in ('manual', 'polymarket', 'prediction')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text,
  provider_market_id text not null,
  provider_slug text,
  topic_id uuid references public.topics(id),
  question text not null,
  description text,
  resolution_source text,
  start_at timestamptz,
  end_at timestamptz,
  active boolean not null default false,
  closed boolean not null default false,
  volume numeric,
  liquidity numeric,
  yes_probability numeric check (yes_probability between 0 and 1),
  no_probability numeric check (no_probability between 0 and 1),
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, provider_market_id)
);

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  observed_at timestamptz not null,
  yes_probability numeric check (yes_probability between 0 and 1),
  no_probability numeric check (no_probability between 0 and 1),
  volume numeric,
  liquidity numeric,
  unique(market_id, observed_at)
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  external_id text,
  canonical_path text,
  author_external_id text,
  author_handle text,
  published_at timestamptz not null,
  exact_text text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  last_verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists sources_external_id_unique
  on public.sources(source_type, external_id) where external_id is not null;

create table if not exists public.prediction_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id),
  expert_id uuid not null references public.experts(id),
  normalized_claim text,
  source_quote text,
  resolution_date timestamptz,
  resolution_criteria text,
  explicit_probability numeric check (explicit_probability between 0 and 1),
  confidence_language text,
  category_slug text references public.categories(slug),
  extraction_confidence numeric check (extraction_confidence between 0 and 1),
  falsifiability_score numeric check (falsifiability_score between 0 and 1),
  source_fidelity_score numeric check (source_fidelity_score between 0 and 1),
  verifier_verdict text,
  verifier_confidence numeric check (verifier_confidence between 0 and 1),
  status text not null default 'pending'
    check (status in ('pending', 'review', 'auto_verified', 'approved', 'rejected', 'duplicate')),
  reason_rejected text,
  model_name text,
  raw_extraction jsonb not null default '{}'::jsonb,
  record_type text not null default 'prediction' check (record_type in ('prediction', 'take')),
  imputation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id),
  source_id uuid not null references public.sources(id),
  category_slug text not null references public.categories(slug),
  normalized_claim text not null,
  source_quote text not null,
  prediction_date timestamptz not null,
  resolution_date timestamptz,
  resolution_criteria text not null,
  explicit_probability numeric check (explicit_probability between 0 and 1),
  confidence_language text,
  falsifiability_score numeric check (falsifiability_score between 0 and 1),
  verification_mode text not null check (verification_mode in ('auto', 'admin')),
  status text not null default 'open'
    check (status in ('open', 'due', 'resolution_pending', 'resolved', 'ambiguous', 'void', 'source_unavailable')),
  fingerprint_sha256 text unique not null,
  published_at timestamptz,
  frozen_at timestamptz not null default now(),
  record_type text not null default 'prediction' check (record_type in ('prediction', 'take')),
  imputation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists predictions_record_type_idx on public.predictions(record_type) where published_at is not null;

create table if not exists public.prediction_topics (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  relevance_score numeric check (relevance_score between 0 and 1),
  primary key (prediction_id, topic_id)
);

create table if not exists public.prediction_markets (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  semantic_match_score numeric check (semantic_match_score between 0 and 1),
  market_probability_at_prediction numeric check (market_probability_at_prediction between 0 and 1),
  matched_at timestamptz not null default now(),
  primary key (prediction_id, market_id)
);

create table if not exists public.resolutions (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid unique not null references public.predictions(id),
  outcome text not null check (outcome in ('correct', 'incorrect', 'partial', 'ambiguous', 'void')),
  explanation text not null,
  resolution_confidence numeric check (resolution_confidence between 0 and 1),
  resolution_method text not null,
  scoring_eligible boolean not null default false,
  resolved_at timestamptz not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (not scoring_eligible or outcome in ('correct', 'incorrect'))
);

create table if not exists public.resolution_evidence (
  id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null references public.resolutions(id) on delete cascade,
  source_type text not null,
  source_title text,
  source_path text not null,
  publisher text,
  excerpt text,
  is_primary_source boolean not null default false,
  observed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  source_path text not null,
  suggested_expert text,
  suggested_category text,
  submitter_email text,
  submission_type text not null default 'prediction'
    check (submission_type in ('prediction', 'issue')),
  issue_type text,
  details text,
  related_prediction_id uuid references public.predictions(id),
  status text not null default 'pending'
    check (status in ('pending', 'waiting_for_source_fetch', 'review', 'resolved', 'rejected')),
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  job_type text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'limited')),
  started_at timestamptz not null,
  finished_at timestamptz,
  items_requested integer not null default 0,
  items_fetched integer not null default 0,
  items_created integer not null default 0,
  items_rejected integer not null default 0,
  errors integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_type text not null,
  actor_id text,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists experts_x_handle_idx on public.experts(x_handle);
create index if not exists predictions_expert_date_idx on public.predictions(expert_id, prediction_date desc);
create index if not exists predictions_status_idx on public.predictions(status);
create index if not exists predictions_category_idx on public.predictions(category_slug);
create index if not exists predictions_resolution_date_idx on public.predictions(resolution_date);
create index if not exists predictions_published_at_idx on public.predictions(published_at);
create index if not exists topics_category_idx on public.topics(category_slug);
create index if not exists markets_topic_idx on public.markets(topic_id);
create index if not exists markets_active_volume_idx on public.markets(active, volume desc);
create index if not exists candidates_status_idx on public.prediction_candidates(status);
create index if not exists candidates_expert_idx on public.prediction_candidates(expert_id);
create index if not exists resolutions_outcome_idx on public.resolutions(outcome);
create index if not exists submissions_ip_created_idx on public.submissions(ip_hash, created_at desc);
create index if not exists experts_name_trgm_idx on public.experts using gin(display_name gin_trgm_ops);
create index if not exists experts_handle_trgm_idx on public.experts using gin(x_handle gin_trgm_ops);
create index if not exists predictions_claim_trgm_idx on public.predictions using gin(normalized_claim gin_trgm_ops);
create index if not exists topics_title_trgm_idx on public.topics using gin(title gin_trgm_ops);
create index if not exists markets_question_trgm_idx on public.markets using gin(question gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists experts_updated_at on public.experts;
create trigger experts_updated_at before update on public.experts
for each row execute function public.set_updated_at();
drop trigger if exists topics_updated_at on public.topics;
create trigger topics_updated_at before update on public.topics
for each row execute function public.set_updated_at();
drop trigger if exists candidates_updated_at on public.prediction_candidates;
create trigger candidates_updated_at before update on public.prediction_candidates
for each row execute function public.set_updated_at();
drop trigger if exists predictions_updated_at on public.predictions;
create trigger predictions_updated_at before update on public.predictions
for each row execute function public.set_updated_at();

create or replace function public.guard_published_prediction()
returns trigger language plpgsql as $$
begin
  if old.published_at is not null and (
    new.expert_id is distinct from old.expert_id or
    new.source_id is distinct from old.source_id or
    new.category_slug is distinct from old.category_slug or
    new.normalized_claim is distinct from old.normalized_claim or
    new.source_quote is distinct from old.source_quote or
    new.prediction_date is distinct from old.prediction_date or
    new.resolution_date is distinct from old.resolution_date or
    new.resolution_criteria is distinct from old.resolution_criteria or
    new.explicit_probability is distinct from old.explicit_probability or
    new.confidence_language is distinct from old.confidence_language or
    new.fingerprint_sha256 is distinct from old.fingerprint_sha256
  ) then
    raise exception 'Published prediction substance is immutable; create an audited correction.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_published_prediction on public.predictions;
create trigger guard_published_prediction before update on public.predictions
for each row execute function public.guard_published_prediction();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.app_admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace view public.expert_scorecards
with (security_invoker = true)
as
select
  e.id as expert_id,
  e.slug,
  e.display_name,
  e.x_handle,
  e.avatar_url,
  e.headline,
  e.primary_category_slug,
  count(p.id)::integer as total_predictions,
  count(p.id) filter (where p.status in ('open', 'due', 'resolution_pending'))::integer as open_predictions,
  count(r.id) filter (where r.outcome in ('correct', 'incorrect'))::integer as resolved_predictions,
  count(r.id) filter (where r.outcome = 'correct')::integer as correct_predictions,
  count(r.id) filter (where r.outcome = 'incorrect')::integer as incorrect_predictions,
  count(r.id) filter (where r.outcome = 'partial')::integer as partial_predictions,
  count(r.id) filter (where r.outcome = 'ambiguous')::integer as ambiguous_predictions,
  count(r.id) filter (where r.outcome = 'void')::integer as void_predictions,
  case when count(r.id) filter (where r.outcome in ('correct','incorrect')) > 0
    then count(r.id) filter (where r.outcome = 'correct')::numeric /
      count(r.id) filter (where r.outcome in ('correct','incorrect'))
    else null end as accuracy,
  case when count(r.id) filter (where r.outcome in ('correct','incorrect')) > 0 then
    greatest(0, (
      (count(r.id) filter (where r.outcome = 'correct')::numeric /
       count(r.id) filter (where r.outcome in ('correct','incorrect')) + 1.281551565545^2 /
       (2 * count(r.id) filter (where r.outcome in ('correct','incorrect')))) -
      1.281551565545 * sqrt((
        (count(r.id) filter (where r.outcome = 'correct')::numeric /
         count(r.id) filter (where r.outcome in ('correct','incorrect'))) *
        (1 - count(r.id) filter (where r.outcome = 'correct')::numeric /
         count(r.id) filter (where r.outcome in ('correct','incorrect'))) +
        1.281551565545^2 / (4 * count(r.id) filter (where r.outcome in ('correct','incorrect')))
      ) / count(r.id) filter (where r.outcome in ('correct','incorrect')))
    ) / (1 + 1.281551565545^2 /
      count(r.id) filter (where r.outcome in ('correct','incorrect'))))
    else null end as wilson_rank_score,
  count(r.id) filter (
    where r.outcome in ('correct','incorrect') and p.explicit_probability is not null
  )::integer as probabilistic_predictions,
  avg(power(p.explicit_probability - case when r.outcome = 'correct' then 1 else 0 end, 2))
    filter (where r.outcome in ('correct','incorrect') and p.explicit_probability is not null) as brier_score,
  count(r.id) filter (where r.outcome in ('correct','incorrect')) >= 5 as leaderboard_eligible,
  count(r.id) filter (where r.outcome in ('correct','incorrect')) < 20 as provisional,
  (select count(*)::integer from public.predictions t
     where t.expert_id = e.id and t.published_at is not null
       and t.status <> 'source_unavailable' and t.record_type = 'take') as total_takes
from public.experts e
left join public.predictions p on p.expert_id = e.id
  and p.published_at is not null and p.status <> 'source_unavailable'
  and p.record_type = 'prediction'
left join public.resolutions r on r.prediction_id = p.id and r.approved_at is not null
where e.is_active
group by e.id;

create or replace function public.global_search(search_query text, result_limit integer default 10)
returns table(result_type text, result_id text, title text, subtitle text, href text, score real)
language sql
stable
security invoker
as $$
  with q as (select trim(search_query) as value)
  select * from (
    select 'expert', e.id::text, e.display_name,
      case when e.x_handle is not null then '@' || e.x_handle else e.headline end,
      '/experts/' || e.slug,
      (case when lower(e.display_name) = lower(q.value) then 4 else 0 end +
       case when lower(coalesce(e.x_handle,'')) = lower(regexp_replace(q.value, '^@', '')) then 3 else 0 end +
       greatest(similarity(e.display_name, q.value), similarity(coalesce(e.x_handle,''), q.value)))::real
    from public.experts e cross join q
    where e.is_active and (e.display_name % q.value or coalesce(e.x_handle,'') % regexp_replace(q.value, '^@', ''))
    union all
    select 'topic', t.id::text, t.title, c.name, '/topics/' || t.slug,
      (case when lower(t.title) = lower(q.value) then 3 else 0 end + similarity(t.title, q.value))::real
    from public.topics t cross join q left join public.categories c on c.slug = t.category_slug
    where t.status = 'active' and t.title % q.value
    union all
    select 'prediction', p.id::text, p.normalized_claim, e.display_name, '/predictions/' || p.id,
      similarity(p.normalized_claim, q.value)::real
    from public.predictions p cross join q join public.experts e on e.id = p.expert_id
    where p.published_at is not null and p.status <> 'source_unavailable' and p.normalized_claim % q.value
    union all
    select 'market', m.id::text, m.question, 'Polymarket', '/topics/' || coalesce(t.slug, ''),
      similarity(m.question, q.value)::real
    from public.markets m cross join q left join public.topics t on t.id = m.topic_id
    where t.id is not null and m.question % q.value
  ) results(result_type, result_id, title, subtitle, href, score)
  order by results.score desc
  limit greatest(1, least(result_limit, 25));
$$;

alter table public.categories enable row level security;
alter table public.experts enable row level security;
alter table public.expert_categories enable row level security;
alter table public.topics enable row level security;
alter table public.markets enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.sources enable row level security;
alter table public.prediction_candidates enable row level security;
alter table public.predictions enable row level security;
alter table public.prediction_topics enable row level security;
alter table public.prediction_markets enable row level security;
alter table public.resolutions enable row level security;
alter table public.resolution_evidence enable row level security;
alter table public.submissions enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_admins enable row level security;

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories for select using (true);
drop policy if exists experts_public_read on public.experts;
create policy experts_public_read on public.experts for select using (is_active);
drop policy if exists expert_categories_public_read on public.expert_categories;
create policy expert_categories_public_read on public.expert_categories for select
  using (exists(select 1 from public.experts e where e.id = expert_id and e.is_active));
drop policy if exists topics_public_read on public.topics;
create policy topics_public_read on public.topics for select using (true);
drop policy if exists markets_public_read on public.markets;
create policy markets_public_read on public.markets for select using (true);
drop policy if exists market_snapshots_public_read on public.market_snapshots;
create policy market_snapshots_public_read on public.market_snapshots for select using (true);
drop policy if exists sources_public_read on public.sources;
create policy sources_public_read on public.sources for select using (
  deleted_at is null and exists(select 1 from public.predictions p where p.source_id = sources.id and p.published_at is not null)
);
drop policy if exists predictions_public_read on public.predictions;
create policy predictions_public_read on public.predictions for select using (
  published_at is not null and status <> 'source_unavailable'
);
drop policy if exists prediction_topics_public_read on public.prediction_topics;
create policy prediction_topics_public_read on public.prediction_topics for select using (
  exists(select 1 from public.predictions p where p.id = prediction_id and p.published_at is not null and p.status <> 'source_unavailable')
);
drop policy if exists prediction_markets_public_read on public.prediction_markets;
create policy prediction_markets_public_read on public.prediction_markets for select using (
  exists(select 1 from public.predictions p where p.id = prediction_id and p.published_at is not null and p.status <> 'source_unavailable')
);
drop policy if exists resolutions_public_read on public.resolutions;
create policy resolutions_public_read on public.resolutions for select using (approved_at is not null);
drop policy if exists resolution_evidence_public_read on public.resolution_evidence;
create policy resolution_evidence_public_read on public.resolution_evidence for select using (
  exists(select 1 from public.resolutions r where r.id = resolution_id and r.approved_at is not null)
);

drop policy if exists admin_all_experts on public.experts;
create policy admin_all_experts on public.experts for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_expert_categories on public.expert_categories;
create policy admin_all_expert_categories on public.expert_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_topics on public.topics;
create policy admin_all_topics on public.topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_markets on public.markets;
create policy admin_all_markets on public.markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_market_snapshots on public.market_snapshots;
create policy admin_all_market_snapshots on public.market_snapshots for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_sources on public.sources;
create policy admin_all_sources on public.sources for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_candidates on public.prediction_candidates;
create policy admin_all_candidates on public.prediction_candidates for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_predictions on public.predictions;
create policy admin_all_predictions on public.predictions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_prediction_topics on public.prediction_topics;
create policy admin_all_prediction_topics on public.prediction_topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_prediction_markets on public.prediction_markets;
create policy admin_all_prediction_markets on public.prediction_markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_resolutions on public.resolutions;
create policy admin_all_resolutions on public.resolutions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_evidence on public.resolution_evidence;
create policy admin_all_evidence on public.resolution_evidence for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_submissions on public.submissions;
create policy admin_all_submissions on public.submissions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_ingestion_runs on public.ingestion_runs;
create policy admin_all_ingestion_runs on public.ingestion_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all_audit_log on public.audit_log;
create policy admin_all_audit_log on public.audit_log for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_read_admins on public.app_admins;
create policy admin_read_admins on public.app_admins for select to authenticated using (public.is_admin());

grant select on public.expert_scorecards to anon, authenticated;
grant execute on function public.global_search(text, integer) to anon, authenticated;

commit;
insert into public.categories (slug, name, sort_order) values
  ('ai-tech', 'AI & Technology', 10),
  ('economy-rates', 'Economy & Rates', 20),
  ('markets-investing', 'Markets & Investing', 30),
  ('crypto', 'Crypto', 40),
  ('politics-elections', 'Politics & Elections', 50),
  ('geopolitics-conflict', 'Geopolitics & Conflict', 60),
  ('business-startups', 'Business & Startups', 70),
  ('energy-climate', 'Energy & Climate', 80),
  ('science-space', 'Science & Space', 90),
  ('sports', 'Sports', 100),
  ('media-culture', 'Media & Culture', 110),
  ('other', 'Other', 120)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;
insert into public.experts (slug, display_name, x_handle, headline, primary_category_slug, source_status) values
  ('sam-altman', 'Sam Altman', 'sama', 'Technology executive', 'ai-tech', 'unverified'),
  ('elon-musk', 'Elon Musk', 'elonmusk', 'Technology executive', 'ai-tech', 'unverified'),
  ('demis-hassabis', 'Demis Hassabis', 'demishassabis', 'AI researcher and executive', 'ai-tech', 'unverified'),
  ('yann-lecun', 'Yann LeCun', 'ylecun', 'AI scientist', 'ai-tech', 'unverified'),
  ('andrej-karpathy', 'Andrej Karpathy', 'karpathy', 'AI researcher and educator', 'ai-tech', 'unverified'),
  ('gary-marcus', 'Gary Marcus', 'GaryMarcus', 'AI researcher and author', 'ai-tech', 'unverified'),
  ('ethan-mollick', 'Ethan Mollick', 'emollick', 'Technology and management professor', 'ai-tech', 'unverified'),
  ('andrew-ng', 'Andrew Ng', 'AndrewYNg', 'AI educator and entrepreneur', 'ai-tech', 'unverified'),
  ('satya-nadella', 'Satya Nadella', 'satyanadella', 'Technology executive', 'ai-tech', 'unverified'),
  ('bill-gates', 'Bill Gates', 'BillGates', 'Technologist and philanthropist', 'ai-tech', 'unverified'),
  ('marc-andreessen', 'Marc Andreessen', 'pmarca', 'Technology investor', 'business-startups', 'unverified'),
  ('benedict-evans', 'Benedict Evans', 'benedictevans', 'Technology analyst', 'ai-tech', 'unverified'),
  ('naval-ravikant', 'Naval Ravikant', 'naval', 'Technology investor and founder', 'business-startups', 'unverified'),
  ('sriram-krishnan', 'Sriram Krishnan', 'sriramk', 'Technology investor and policy adviser', 'ai-tech', 'unverified'),
  ('francois-chollet', 'François Chollet', 'fchollet', 'AI researcher and engineer', 'ai-tech', 'unverified'),
  ('ray-dalio', 'Ray Dalio', 'RayDalio', 'Investor', 'markets-investing', 'unverified'),
  ('bill-ackman', 'Bill Ackman', 'BillAckman', 'Investor', 'markets-investing', 'unverified'),
  ('cathie-wood', 'Cathie Wood', 'CathieDWood', 'Investor', 'markets-investing', 'unverified'),
  ('larry-summers', 'Larry Summers', 'LHSummers', 'Economist and former U.S. Treasury secretary', 'economy-rates', 'unverified'),
  ('jason-furman', 'Jason Furman', 'jasonfurman', 'Economist', 'economy-rates', 'unverified'),
  ('mohamed-el-erian', 'Mohamed El-Erian', 'elerianm', 'Economist and investor', 'economy-rates', 'unverified'),
  ('nouriel-roubini', 'Nouriel Roubini', 'Nouriel', 'Economist', 'economy-rates', 'unverified'),
  ('claudia-sahm', 'Claudia Sahm', 'Claudia_Sahm', 'Economist', 'economy-rates', 'unverified'),
  ('paul-krugman', 'Paul Krugman', 'paulkrugman', 'Economist and columnist', 'economy-rates', 'unverified'),
  ('noah-smith', 'Noah Smith', 'Noahpinion', 'Economics writer', 'economy-rates', 'unverified'),
  ('joseph-politano', 'Joseph Politano', 'JosephPolitano', 'Economics writer', 'economy-rates', 'unverified'),
  ('michael-saylor', 'Michael Saylor', 'saylor', 'Technology executive and investor', 'crypto', 'unverified'),
  ('vitalik-buterin', 'Vitalik Buterin', 'VitalikButerin', 'Ethereum co-founder', 'crypto', 'unverified'),
  ('balaji-srinivasan', 'Balaji Srinivasan', 'balajis', 'Technology founder and investor', 'crypto', 'unverified'),
  ('anthony-pompliano', 'Anthony Pompliano', 'APompliano', 'Investor and media host', 'crypto', 'unverified'),
  ('raoul-pal', 'Raoul Pal', 'RaoulGMI', 'Investor', 'crypto', 'unverified'),
  ('arthur-hayes', 'Arthur Hayes', 'Arthur_0x', 'Crypto market commentator', 'crypto', 'unverified'),
  ('brian-armstrong', 'Brian Armstrong', 'brian_armstrong', 'Technology executive', 'crypto', 'unverified'),
  ('changpeng-zhao', 'Changpeng Zhao', 'cz_binance', 'Technology founder', 'crypto', 'unverified'),
  ('erik-voorhees', 'Erik Voorhees', 'ErikVoorhees', 'Crypto entrepreneur', 'crypto', 'unverified'),
  ('mike-novogratz', 'Mike Novogratz', 'novogratz', 'Investor', 'crypto', 'unverified'),
  ('nate-silver', 'Nate Silver', 'NateSilver538', 'Statistician and forecaster', 'politics-elections', 'unverified'),
  ('g-elliott-morris', 'G. Elliott Morris', 'gelliottmorris', 'Political forecaster', 'politics-elections', 'unverified'),
  ('nate-cohn', 'Nate Cohn', 'Nate_Cohn', 'Political data journalist', 'politics-elections', 'unverified'),
  ('david-shor', 'David Shor', 'DavidShor', 'Political data scientist', 'politics-elections', 'unverified'),
  ('larry-sabato', 'Larry Sabato', 'LarrySabato', 'Political analyst', 'politics-elections', 'unverified'),
  ('ian-bremmer', 'Ian Bremmer', 'ianbremmer', 'Political scientist', 'geopolitics-conflict', 'unverified'),
  ('richard-haass', 'Richard Haass', 'RichardHaass', 'Foreign-policy analyst', 'geopolitics-conflict', 'unverified'),
  ('fareed-zakaria', 'Fareed Zakaria', 'FareedZakaria', 'Journalist and foreign-policy analyst', 'geopolitics-conflict', 'unverified'),
  ('jiang-xueqin', 'Jiang Xueqin', null, 'Writer and educator', 'geopolitics-conflict', 'unresolved'),
  ('paul-graham', 'Paul Graham', 'paulg', 'Founder and investor', 'business-startups', 'unverified'),
  ('jason-calacanis', 'Jason Calacanis', 'jason', 'Technology investor', 'business-startups', 'unverified'),
  ('chamath-palihapitiya', 'Chamath Palihapitiya', 'chamath', 'Investor', 'business-startups', 'unverified'),
  ('garry-tan', 'Garry Tan', 'garrytan', 'Technology investor and founder', 'business-startups', 'unverified'),
  ('david-sacks', 'David Sacks', 'DavidSacks', 'Technology investor and founder', 'business-startups', 'unverified'),
  ('aaron-levie', 'Aaron Levie', 'levie', 'Technology executive', 'business-startups', 'unverified'),
  ('david-heinemeier-hansson', 'David Heinemeier Hansson', 'dhh', 'Software developer and entrepreneur', 'business-startups', 'unverified'),
  ('keith-rabois', 'Keith Rabois', 'rabois', 'Technology investor', 'business-startups', 'unverified'),
  ('fred-wilson', 'Fred Wilson', 'fredwilson', 'Technology investor', 'business-startups', 'unverified'),
  ('scott-galloway', 'Scott Galloway', 'profgalloway', 'Business professor and author', 'business-startups', 'unverified'),
  ('tyler-cowen', 'Tyler Cowen', 'tylercowen', 'Economist and author', 'economy-rates', 'unverified'),
  ('jesse-jenkins', 'Jesse Jenkins', 'JesseJenkins', 'Energy systems researcher', 'energy-climate', 'unverified'),
  ('david-roberts', 'David Roberts', 'drvolts', 'Energy and climate writer', 'energy-climate', 'unverified'),
  ('ramez-naam', 'Ramez Naam', 'ramez', 'Climate technology investor and author', 'energy-climate', 'unverified'),
  ('peter-diamandis', 'Peter Diamandis', 'PeterDiamandis', 'Technology entrepreneur and author', 'science-space', 'unverified'),
  ('neil-degrasse-tyson', 'Neil deGrasse Tyson', 'neiltyson', 'Astrophysicist and science communicator', 'science-space', 'unverified'),
  ('haralabos-voulgaris', 'Haralabos Voulgaris', 'haralabob', 'Basketball analyst', 'sports', 'unverified'),
  ('bill-simmons', 'Bill Simmons', 'BillSimmons', 'Sports media host', 'sports', 'unverified'),
  ('kevin-pelton', 'Kevin Pelton', 'kpelton', 'Basketball analyst', 'sports', 'unverified'),
  ('daryl-morey', 'Daryl Morey', 'dmorey', 'Basketball executive', 'sports', 'unverified')
on conflict (slug) do nothing;
insert into public.expert_categories (expert_id, category_slug) values
  (( select id from public.experts where slug = 'sam-altman' ), 'ai-tech'),
  (( select id from public.experts where slug = 'sam-altman' ), 'business-startups'),
  (( select id from public.experts where slug = 'elon-musk' ), 'ai-tech'),
  (( select id from public.experts where slug = 'elon-musk' ), 'business-startups'),
  (( select id from public.experts where slug = 'elon-musk' ), 'science-space'),
  (( select id from public.experts where slug = 'demis-hassabis' ), 'ai-tech'),
  (( select id from public.experts where slug = 'yann-lecun' ), 'ai-tech'),
  (( select id from public.experts where slug = 'andrej-karpathy' ), 'ai-tech'),
  (( select id from public.experts where slug = 'gary-marcus' ), 'ai-tech'),
  (( select id from public.experts where slug = 'ethan-mollick' ), 'ai-tech'),
  (( select id from public.experts where slug = 'andrew-ng' ), 'ai-tech'),
  (( select id from public.experts where slug = 'satya-nadella' ), 'ai-tech'),
  (( select id from public.experts where slug = 'satya-nadella' ), 'business-startups'),
  (( select id from public.experts where slug = 'bill-gates' ), 'ai-tech'),
  (( select id from public.experts where slug = 'bill-gates' ), 'energy-climate'),
  (( select id from public.experts where slug = 'bill-gates' ), 'science-space'),
  (( select id from public.experts where slug = 'marc-andreessen' ), 'business-startups'),
  (( select id from public.experts where slug = 'marc-andreessen' ), 'ai-tech'),
  (( select id from public.experts where slug = 'marc-andreessen' ), 'markets-investing'),
  (( select id from public.experts where slug = 'benedict-evans' ), 'ai-tech'),
  (( select id from public.experts where slug = 'naval-ravikant' ), 'business-startups'),
  (( select id from public.experts where slug = 'sriram-krishnan' ), 'ai-tech'),
  (( select id from public.experts where slug = 'francois-chollet' ), 'ai-tech'),
  (( select id from public.experts where slug = 'ray-dalio' ), 'markets-investing'),
  (( select id from public.experts where slug = 'ray-dalio' ), 'economy-rates'),
  (( select id from public.experts where slug = 'bill-ackman' ), 'markets-investing'),
  (( select id from public.experts where slug = 'bill-ackman' ), 'economy-rates'),
  (( select id from public.experts where slug = 'cathie-wood' ), 'markets-investing'),
  (( select id from public.experts where slug = 'cathie-wood' ), 'ai-tech'),
  (( select id from public.experts where slug = 'cathie-wood' ), 'crypto'),
  (( select id from public.experts where slug = 'larry-summers' ), 'economy-rates'),
  (( select id from public.experts where slug = 'jason-furman' ), 'economy-rates'),
  (( select id from public.experts where slug = 'mohamed-el-erian' ), 'economy-rates'),
  (( select id from public.experts where slug = 'mohamed-el-erian' ), 'markets-investing'),
  (( select id from public.experts where slug = 'nouriel-roubini' ), 'economy-rates'),
  (( select id from public.experts where slug = 'claudia-sahm' ), 'economy-rates'),
  (( select id from public.experts where slug = 'paul-krugman' ), 'economy-rates'),
  (( select id from public.experts where slug = 'noah-smith' ), 'economy-rates'),
  (( select id from public.experts where slug = 'joseph-politano' ), 'economy-rates'),
  (( select id from public.experts where slug = 'michael-saylor' ), 'crypto'),
  (( select id from public.experts where slug = 'michael-saylor' ), 'markets-investing'),
  (( select id from public.experts where slug = 'vitalik-buterin' ), 'crypto'),
  (( select id from public.experts where slug = 'vitalik-buterin' ), 'ai-tech'),
  (( select id from public.experts where slug = 'balaji-srinivasan' ), 'crypto'),
  (( select id from public.experts where slug = 'balaji-srinivasan' ), 'ai-tech'),
  (( select id from public.experts where slug = 'balaji-srinivasan' ), 'business-startups'),
  (( select id from public.experts where slug = 'anthony-pompliano' ), 'crypto'),
  (( select id from public.experts where slug = 'anthony-pompliano' ), 'markets-investing'),
  (( select id from public.experts where slug = 'raoul-pal' ), 'crypto'),
  (( select id from public.experts where slug = 'raoul-pal' ), 'markets-investing'),
  (( select id from public.experts where slug = 'arthur-hayes' ), 'crypto'),
  (( select id from public.experts where slug = 'brian-armstrong' ), 'crypto'),
  (( select id from public.experts where slug = 'brian-armstrong' ), 'business-startups'),
  (( select id from public.experts where slug = 'changpeng-zhao' ), 'crypto'),
  (( select id from public.experts where slug = 'erik-voorhees' ), 'crypto'),
  (( select id from public.experts where slug = 'mike-novogratz' ), 'crypto'),
  (( select id from public.experts where slug = 'mike-novogratz' ), 'markets-investing'),
  (( select id from public.experts where slug = 'nate-silver' ), 'politics-elections'),
  (( select id from public.experts where slug = 'nate-silver' ), 'sports'),
  (( select id from public.experts where slug = 'g-elliott-morris' ), 'politics-elections'),
  (( select id from public.experts where slug = 'nate-cohn' ), 'politics-elections'),
  (( select id from public.experts where slug = 'david-shor' ), 'politics-elections'),
  (( select id from public.experts where slug = 'larry-sabato' ), 'politics-elections'),
  (( select id from public.experts where slug = 'ian-bremmer' ), 'geopolitics-conflict'),
  (( select id from public.experts where slug = 'richard-haass' ), 'geopolitics-conflict'),
  (( select id from public.experts where slug = 'fareed-zakaria' ), 'geopolitics-conflict'),
  (( select id from public.experts where slug = 'jiang-xueqin' ), 'geopolitics-conflict'),
  (( select id from public.experts where slug = 'paul-graham' ), 'business-startups'),
  (( select id from public.experts where slug = 'jason-calacanis' ), 'business-startups'),
  (( select id from public.experts where slug = 'chamath-palihapitiya' ), 'business-startups'),
  (( select id from public.experts where slug = 'chamath-palihapitiya' ), 'markets-investing'),
  (( select id from public.experts where slug = 'garry-tan' ), 'business-startups'),
  (( select id from public.experts where slug = 'david-sacks' ), 'business-startups'),
  (( select id from public.experts where slug = 'aaron-levie' ), 'business-startups'),
  (( select id from public.experts where slug = 'david-heinemeier-hansson' ), 'business-startups'),
  (( select id from public.experts where slug = 'keith-rabois' ), 'business-startups'),
  (( select id from public.experts where slug = 'fred-wilson' ), 'business-startups'),
  (( select id from public.experts where slug = 'scott-galloway' ), 'business-startups'),
  (( select id from public.experts where slug = 'tyler-cowen' ), 'economy-rates'),
  (( select id from public.experts where slug = 'tyler-cowen' ), 'business-startups'),
  (( select id from public.experts where slug = 'jesse-jenkins' ), 'energy-climate'),
  (( select id from public.experts where slug = 'david-roberts' ), 'energy-climate'),
  (( select id from public.experts where slug = 'ramez-naam' ), 'energy-climate'),
  (( select id from public.experts where slug = 'ramez-naam' ), 'science-space'),
  (( select id from public.experts where slug = 'peter-diamandis' ), 'science-space'),
  (( select id from public.experts where slug = 'peter-diamandis' ), 'ai-tech'),
  (( select id from public.experts where slug = 'neil-degrasse-tyson' ), 'science-space'),
  (( select id from public.experts where slug = 'haralabos-voulgaris' ), 'sports'),
  (( select id from public.experts where slug = 'bill-simmons' ), 'sports'),
  (( select id from public.experts where slug = 'kevin-pelton' ), 'sports'),
  (( select id from public.experts where slug = 'daryl-morey' ), 'sports')
on conflict do nothing;
