-- correct_prediction() can also correct a deadline (resolution_date).
--
-- A deadline that is plainly wrong (e.g. set before the scheduled event the
-- claim names) would score the prediction against the wrong moment. Like the
-- other corrections, it publishes a corrected copy, hides and links the
-- original, and audits both; the copy passes the normal publication checks
-- (so a deadline before the statement is still refused).
--
-- p_resolution_date: null keeps the original deadline.

drop function if exists public.correct_prediction(uuid, numeric, text, text, text, text);

create or replace function public.correct_prediction(
  p_prediction_id uuid,
  p_explicit_probability numeric,
  p_confidence_language text,
  p_reason text,
  p_actor_type text default 'admin',
  p_actor_id text default null,
  p_resolution_date timestamptz default null
) returns uuid language plpgsql as $$
declare
  o public.predictions%rowtype;
  new_id uuid := gen_random_uuid();
  new_resolution_date timestamptz;
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
  new_resolution_date := coalesce(p_resolution_date, o.resolution_date);
  if p_explicit_probability is not distinct from o.explicit_probability
    and p_confidence_language is not distinct from o.confidence_language
    and new_resolution_date is not distinct from o.resolution_date then
    raise exception 'The correction changes nothing.' using errcode = 'check_violation';
  end if;
  if p_confidence_language is not null and strpos(o.source_quote, p_confidence_language) = 0 then
    raise exception 'Confidence language must be the source''s own words (a substring of the quote).' using errcode = 'check_violation';
  end if;

  changes := jsonb_build_object(
    'explicit_probability', jsonb_build_object('before', o.explicit_probability, 'after', p_explicit_probability),
    'confidence_language', jsonb_build_object('before', o.confidence_language, 'after', p_confidence_language),
    'resolution_date', jsonb_build_object('before', o.resolution_date, 'after', new_resolution_date));

  insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
    resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
    status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note, capture_mode)
  values (new_id, o.expert_id, o.source_id, o.category_slug, o.normalized_claim, o.source_quote, o.prediction_date,
    new_resolution_date, o.resolution_criteria, p_explicit_probability, p_confidence_language, o.falsifiability_score, 'admin',
    -- A later deadline reopens a prediction that was only due because of the wrong one.
    case when o.status = 'due' and new_resolution_date > now() then 'open' else o.status end,
    encode(sha256(convert_to(o.fingerprint_sha256 || ':correction:' || changes::text, 'UTF8')), 'hex'),
    now(), now(), o.record_type, o.imputation_note, o.capture_mode);

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

revoke all on function public.correct_prediction(uuid, numeric, text, text, text, text, timestamptz) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.correct_prediction(uuid, numeric, text, text, text, text, timestamptz) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.correct_prediction(uuid, numeric, text, text, text, text, timestamptz) to service_role;
  end if;
end $$;
