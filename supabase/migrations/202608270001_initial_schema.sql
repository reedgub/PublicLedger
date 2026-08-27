begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table public.categories (
  slug text primary key,
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

create table public.experts (
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

create table public.expert_categories (
  expert_id uuid not null references public.experts(id) on delete cascade,
  category_slug text not null references public.categories(slug),
  primary key (expert_id, category_slug)
);

create table public.topics (
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

create table public.markets (
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

create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  observed_at timestamptz not null,
  yes_probability numeric check (yes_probability between 0 and 1),
  no_probability numeric check (no_probability between 0 and 1),
  volume numeric,
  liquidity numeric,
  unique(market_id, observed_at)
);

create table public.sources (
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

create unique index sources_external_id_unique
  on public.sources(source_type, external_id) where external_id is not null;

create table public.prediction_candidates (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.predictions (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prediction_topics (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  relevance_score numeric check (relevance_score between 0 and 1),
  primary key (prediction_id, topic_id)
);

create table public.prediction_markets (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  semantic_match_score numeric check (semantic_match_score between 0 and 1),
  market_probability_at_prediction numeric check (market_probability_at_prediction between 0 and 1),
  matched_at timestamptz not null default now(),
  primary key (prediction_id, market_id)
);

create table public.resolutions (
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

create table public.resolution_evidence (
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

create table public.submissions (
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

create table public.ingestion_runs (
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

create table public.audit_log (
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

create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index experts_x_handle_idx on public.experts(x_handle);
create index predictions_expert_date_idx on public.predictions(expert_id, prediction_date desc);
create index predictions_status_idx on public.predictions(status);
create index predictions_category_idx on public.predictions(category_slug);
create index predictions_resolution_date_idx on public.predictions(resolution_date);
create index predictions_published_at_idx on public.predictions(published_at);
create index topics_category_idx on public.topics(category_slug);
create index markets_topic_idx on public.markets(topic_id);
create index markets_active_volume_idx on public.markets(active, volume desc);
create index candidates_status_idx on public.prediction_candidates(status);
create index candidates_expert_idx on public.prediction_candidates(expert_id);
create index resolutions_outcome_idx on public.resolutions(outcome);
create index submissions_ip_created_idx on public.submissions(ip_hash, created_at desc);
create index experts_name_trgm_idx on public.experts using gin(display_name gin_trgm_ops);
create index experts_handle_trgm_idx on public.experts using gin(x_handle gin_trgm_ops);
create index predictions_claim_trgm_idx on public.predictions using gin(normalized_claim gin_trgm_ops);
create index topics_title_trgm_idx on public.topics using gin(title gin_trgm_ops);
create index markets_question_trgm_idx on public.markets using gin(question gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger experts_updated_at before update on public.experts
for each row execute function public.set_updated_at();
create trigger topics_updated_at before update on public.topics
for each row execute function public.set_updated_at();
create trigger candidates_updated_at before update on public.prediction_candidates
for each row execute function public.set_updated_at();
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
  count(r.id) filter (where r.outcome in ('correct','incorrect')) < 20 as provisional
from public.experts e
left join public.predictions p on p.expert_id = e.id
  and p.published_at is not null and p.status <> 'source_unavailable'
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

create policy categories_public_read on public.categories for select using (true);
create policy experts_public_read on public.experts for select using (is_active);
create policy expert_categories_public_read on public.expert_categories for select
  using (exists(select 1 from public.experts e where e.id = expert_id and e.is_active));
create policy topics_public_read on public.topics for select using (true);
create policy markets_public_read on public.markets for select using (true);
create policy market_snapshots_public_read on public.market_snapshots for select using (true);
create policy sources_public_read on public.sources for select using (
  deleted_at is null and exists(select 1 from public.predictions p where p.source_id = sources.id and p.published_at is not null)
);
create policy predictions_public_read on public.predictions for select using (
  published_at is not null and status <> 'source_unavailable'
);
create policy prediction_topics_public_read on public.prediction_topics for select using (
  exists(select 1 from public.predictions p where p.id = prediction_id and p.published_at is not null and p.status <> 'source_unavailable')
);
create policy prediction_markets_public_read on public.prediction_markets for select using (
  exists(select 1 from public.predictions p where p.id = prediction_id and p.published_at is not null and p.status <> 'source_unavailable')
);
create policy resolutions_public_read on public.resolutions for select using (approved_at is not null);
create policy resolution_evidence_public_read on public.resolution_evidence for select using (
  exists(select 1 from public.resolutions r where r.id = resolution_id and r.approved_at is not null)
);

create policy admin_all_experts on public.experts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_expert_categories on public.expert_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_topics on public.topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_markets on public.markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_market_snapshots on public.market_snapshots for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_sources on public.sources for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_candidates on public.prediction_candidates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_predictions on public.predictions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_prediction_topics on public.prediction_topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_prediction_markets on public.prediction_markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_resolutions on public.resolutions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_evidence on public.resolution_evidence for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_submissions on public.submissions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_ingestion_runs on public.ingestion_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_audit_log on public.audit_log for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_read_admins on public.app_admins for select to authenticated using (public.is_admin());

grant select on public.expert_scorecards to anon, authenticated;
grant execute on function public.global_search(text, integer) to anon, authenticated;

commit;
