-- Audited corrections, and a probability rule that recognises more ways of
-- stating a probability.
--
-- 1. probability_is_stated() also accepts "84-in-100 chance" / "84 out of 100
--    chance", and a short uppercase label between the number and the
--    probability word ("72% D probability"). Mirrors probabilityIsStated() in
--    lib/predictions/validation.ts.
-- 2. correct_prediction() is the only way to fix a published prediction's
--    probability or confidence language. Published rows are immutable, so it
--    publishes a corrected copy (with the same source, quote, dates, criteria
--    and any resolution with its evidence), hides the original, links the two
--    through superseded_by, and audits both. It runs in one transaction.
--    The corrected copy's public history shows "Correction applied" and the
--    reason.

create or replace function public.probability_is_stated(quote text, probability numeric)
returns boolean language sql immutable as $$
  select probability is null or exists (
    select 1
    from (
      -- "70% chance", "90 percent confident"
      select m[1] as value from regexp_matches(coalesce(quote, ''),
        '(?:^|[^0-9.])([0-9]{1,3}(?:\.[0-9]+)?)\s?(?:%|percent|per cent)\s*(?:chance|probability|odds|likely|likelihood|confident|confidence|sure|certain)', 'gi') as m
      union all
      -- "72% D probability": a short UPPERCASE label in between. Case-sensitive
      -- ('g', not 'gi') so "3% very likely" never reads as a 3% probability.
      select m[1] from regexp_matches(coalesce(quote, ''),
        '(?:^|[^0-9.])([0-9]{1,3}(?:\.[0-9]+)?)\s?(?:%|percent|per cent)\s*[A-Z]{1,5}\s+(?:chance|probability|odds)', 'g') as m
      union all
      -- "odds of 60%", "probability is about 25%"
      select m[1] from regexp_matches(coalesce(quote, ''),
        '(?:chance|probability|odds|likelihood)\s+(?:of\s+|is\s+|at\s+|are\s+)?(?:about\s+|around\s+|roughly\s+|~\s*)?([0-9]{1,3}(?:\.[0-9]+)?)\s?(?:%|percent|per cent)', 'gi') as m
      union all
      -- "an 84-in-100 chance", "84 out of 100 odds"
      select m[1] from regexp_matches(coalesce(quote, ''),
        '(?:^|[^0-9.])([0-9]{1,3})(?:-|\s+)(?:in|out of)(?:-|\s+)100\s*(?:chance|probability|odds|shot)', 'gi') as m
    ) stated
    where abs(stated.value::numeric - probability * 100) <= 0.5
  );
$$;

alter table public.predictions add column if not exists superseded_by uuid references public.predictions(id);

-- Same guard as 202611150001, plus: superseded_by is set once and never
-- changed, and a superseded prediction never returns to public view.
create or replace function public.guard_published_prediction()
returns trigger language plpgsql as $$
declare
  reason text;
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
    new.fingerprint_sha256 is distinct from old.fingerprint_sha256 or
    new.published_at is distinct from old.published_at or
    new.verification_mode is distinct from old.verification_mode or
    new.frozen_at is distinct from old.frozen_at or
    (old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by)
  ) then
    raise exception 'Published prediction substance is immutable; create an audited correction.'
      using errcode = 'check_violation';
  end if;

  if new.superseded_by is not null and new.status <> 'source_unavailable' then
    raise exception 'A superseded prediction stays out of public view; its correction replaces it.'
      using errcode = 'check_violation';
  end if;

  if old.published_at is null and new.published_at is not null then
    reason := public.prediction_publication_error(new.source_id, new.expert_id, new.source_quote,
      new.prediction_date, new.resolution_date, new.explicit_probability);
    if reason is not null then
      raise exception 'Prediction cannot be published: %', reason using errcode = 'check_violation';
    end if;
  end if;

  if old.status = 'source_unavailable' and new.status <> 'source_unavailable' then
    reason := public.prediction_publication_error(new.source_id, new.expert_id, new.source_quote,
      new.prediction_date, new.resolution_date, new.explicit_probability);
    if reason is not null then
      raise exception 'Quarantined prediction cannot return to public view: %', reason using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Publish a corrected copy of a visible prediction and hide the original.
-- Only explicit_probability and confidence_language can be corrected, and
-- confidence language must be the source's own words (a substring of the
-- quote). The copy passes the same publication checks as any new prediction.
create or replace function public.correct_prediction(
  p_prediction_id uuid,
  p_explicit_probability numeric,
  p_confidence_language text,
  p_reason text,
  p_actor_type text default 'admin',
  p_actor_id text default null
) returns uuid language plpgsql as $$
declare
  o public.predictions%rowtype;
  new_id uuid := gen_random_uuid();
  old_resolution uuid;
  new_resolution uuid;
  changes jsonb;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'A correction needs a reason (at least 10 characters).' using errcode = 'check_violation';
  end if;
  if p_actor_type not in ('admin', 'system') then
    raise exception 'actor_type must be admin or system.' using errcode = 'check_violation';
  end if;
  select * into o from public.predictions where id = p_prediction_id for update;
  if not found then
    raise exception 'Prediction % not found.', p_prediction_id using errcode = 'no_data_found';
  end if;
  if o.published_at is null or o.status = 'source_unavailable' or o.superseded_by is not null then
    raise exception 'Only a visible published prediction can be corrected.' using errcode = 'check_violation';
  end if;
  if p_explicit_probability is not distinct from o.explicit_probability
    and p_confidence_language is not distinct from o.confidence_language then
    raise exception 'The correction changes nothing.' using errcode = 'check_violation';
  end if;
  if p_confidence_language is not null and strpos(o.source_quote, p_confidence_language) = 0 then
    raise exception 'Confidence language must be the source''s own words (a substring of the quote).' using errcode = 'check_violation';
  end if;

  changes := jsonb_build_object(
    'explicit_probability', jsonb_build_object('before', o.explicit_probability, 'after', p_explicit_probability),
    'confidence_language', jsonb_build_object('before', o.confidence_language, 'after', p_confidence_language));

  insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
    resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
    status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note, capture_mode)
  values (new_id, o.expert_id, o.source_id, o.category_slug, o.normalized_claim, o.source_quote, o.prediction_date,
    o.resolution_date, o.resolution_criteria, p_explicit_probability, p_confidence_language, o.falsifiability_score, 'admin',
    o.status,
    encode(sha256(convert_to(o.fingerprint_sha256 || ':correction:' || changes::text, 'UTF8')), 'hex'),
    now(), now(), o.record_type, o.imputation_note, o.capture_mode);

  -- The outcome doesn't depend on the probability: carry the resolution and its evidence over.
  select id into old_resolution from public.resolutions where prediction_id = o.id;
  if old_resolution is not null then
    insert into public.resolutions (prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
    select new_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at
    from public.resolutions where id = old_resolution
    returning id into new_resolution;
    insert into public.resolution_evidence (resolution_id, source_type, source_title, source_path, publisher, excerpt, is_primary_source, observed_at)
    select new_resolution, source_type, source_title, source_path, publisher, excerpt, is_primary_source, observed_at
    from public.resolution_evidence where resolution_id = old_resolution;
  end if;
  insert into public.prediction_topics (prediction_id, topic_id, relevance_score)
    select new_id, topic_id, relevance_score from public.prediction_topics where prediction_id = o.id;
  insert into public.prediction_markets (prediction_id, market_id, semantic_match_score, market_probability_at_prediction, matched_at)
    select new_id, market_id, semantic_match_score, market_probability_at_prediction, matched_at from public.prediction_markets where prediction_id = o.id;

  update public.predictions set status = 'source_unavailable', superseded_by = new_id where id = o.id;

  insert into public.audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after, reason) values
    ('prediction', o.id, 'prediction_superseded', p_actor_type, p_actor_id,
      jsonb_build_object('status', o.status), jsonb_build_object('superseded_by', new_id, 'changes', changes), p_reason),
    ('prediction', new_id, 'correction_applied', p_actor_type, p_actor_id,
      jsonb_build_object('corrects', o.id), jsonb_build_object('changes', changes), p_reason);
  return new_id;
end;
$$;

-- Service role only. Supabase grants new functions to anon and authenticated by
-- default, so revoke those explicitly too.
revoke all on function public.correct_prediction(uuid, numeric, text, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.correct_prediction(uuid, numeric, text, text, text, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.correct_prediction(uuid, numeric, text, text, text, text) to service_role;
  end if;
end $$;
