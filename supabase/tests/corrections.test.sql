-- Audited corrections (correct_prediction) and the widened probability rule.
-- One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.expect_error(statement text, fragment text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(fragment in sqlerrm) = 0 then
      raise exception 'Expected error containing "%" but got: %', fragment, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected error containing "%" but the statement succeeded: %', fragment, statement;
end;
$$;

-- Widened rule, matching lib/predictions/validation.ts.
do $$ begin
  if not public.probability_is_stated('Republicans have an 84-in-100 chance of taking control', 0.84) then raise exception 'N-in-100'; end if;
  if not public.probability_is_stated('about 30 out of 100 odds', 0.3) then raise exception 'out of 100'; end if;
  if not public.probability_is_stated('72% D probability of House majority', 0.72) then raise exception 'label between'; end if;
  if not public.probability_is_stated('Kamala Harris won in 40,012 (50.015%) cases. She did not win in 39,988 simulations (49.985%).', 0.50015) then raise exception 'simulation share'; end if;
  if not public.probability_is_stated('Democrats win the House in 72% of our simulations', 0.72) then raise exception 'of simulations'; end if;
  if public.probability_is_stated('inflation falls below 3% very likely', 0.03) then raise exception 'lowercase word must not count'; end if;
  if public.probability_is_stated('more likely than not', 0.5) then raise exception 'qualitative'; end if;
  if public.probability_is_stated('Biden 6535, approaching 7030.', 0.65) then raise exception 'odds shorthand'; end if;
end $$;

-- A published, resolved prediction whose probability was inferred from words.
insert into public.experts (id, slug, display_name, x_handle) values
  ('00000000-0000-0000-0000-0000000001a1', 'test-carol', 'Carol Test', 'carol_test');
insert into public.sources (id, source_type, external_id, author_handle, expert_id, published_at, exact_text) values
  ('00000000-0000-0000-0000-00000000015a', 'web', 'test-c1', null, '00000000-0000-0000-0000-0000000001a1', '2023-01-10 09:00:00+00',
   'It''s more likely than not that we''re going to have a recession next year.');
-- Inserted as an unpublished draft, then given the bad probability the way an
-- old import would have (before the guards existed, this was possible).
alter table public.predictions disable trigger guard_prediction_insert;
insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
  resolution_date, resolution_criteria, explicit_probability, verification_mode, status, fingerprint_sha256, published_at, capture_mode)
values ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000015a',
  'economy-rates', 'A US recession starts in 2023.', 'It''s more likely than not that we''re going to have a recession', '2023-01-10 09:00:00+00',
  '2023-12-31', 'NBER dates a recession starting in 2023.', 0.5, 'admin', 'resolved', 'fp-c1', '2023-01-11', 'backfill');
alter table public.predictions enable trigger guard_prediction_insert;
insert into public.resolutions (id, prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
values ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001f1', 'incorrect', 'No recession in 2023.', 1, 'admin', true, '2024-01-05', '2024-01-05');
insert into public.resolution_evidence (resolution_id, source_type, source_path, excerpt, is_primary_source)
values ('00000000-0000-0000-0000-0000000001e1', 'web', 'https://www.nber.org/research/business-cycle-dating', 'No peak announced.', true);

do $$ begin
  if not exists (select 1 from public.prediction_integrity_violations where prediction_id = '00000000-0000-0000-0000-0000000001f1' and violation = 'probability_not_stated_in_quote') then
    raise exception 'the bad row should be reported';
  end if;
end $$;

-- Rejected corrections.
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', null, null, 'short')$$, 'needs a reason');
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', 0.5, null, 'Nothing actually changes here.')$$, 'changes nothing');
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', null, 'quite likely', 'Invented confidence language.')$$, 'own words');
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', 0.6, null, 'Still a probability the quote does not state.')$$, 'probability_not_stated_in_quote');

-- The correction.
create temp table corrected as
select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', null, 'more likely than not',
  'Probability 0.5 was inferred from "more likely than not"; the source states no number.') as id;

do $$
declare
  new_id uuid := (select id from corrected);
  n record;
  o record;
begin
  select * into o from public.predictions where id = '00000000-0000-0000-0000-0000000001f1';
  select * into n from public.predictions where id = new_id;
  if o.status <> 'source_unavailable' or o.superseded_by is distinct from new_id then raise exception 'original not hidden and linked'; end if;
  if o.explicit_probability <> 0.5 then raise exception 'original must stay as published'; end if;
  if n.explicit_probability is not null or n.confidence_language <> 'more likely than not' then raise exception 'correction not applied'; end if;
  if n.status <> 'resolved' or n.source_quote <> o.source_quote or n.prediction_date <> o.prediction_date
    or n.resolution_criteria <> o.resolution_criteria or n.capture_mode <> 'backfill' or n.verification_mode <> 'admin' then
    raise exception 'corrected copy must keep everything else';
  end if;
  if not exists (select 1 from public.resolutions r join public.resolution_evidence e on e.resolution_id = r.id
    where r.prediction_id = new_id and r.outcome = 'incorrect' and r.scoring_eligible and r.approved_at is not null) then
    raise exception 'resolution and evidence not carried over';
  end if;
  if (select count(*) from public.audit_log where entity_id in (o.id, new_id) and action in ('prediction_superseded', 'correction_applied')) <> 2 then
    raise exception 'both sides must be audited';
  end if;
  if exists (select 1 from public.prediction_integrity_violations where prediction_id in (o.id, new_id)) then
    raise exception 'no violations should remain';
  end if;
  -- The correction is public, with its reason; the original is not.
  if not exists (select 1 from public.prediction_history where prediction_id = new_id and action = 'correction_applied' and reason like 'Probability 0.5 was inferred%') then
    raise exception 'correction not visible in public history';
  end if;
  if exists (select 1 from public.prediction_history where prediction_id = o.id) then raise exception 'original history should be hidden'; end if;
end $$;

-- A deadline correction: a later date reopens a prediction that was only due
-- because of the wrong date; a deadline before the statement is still refused.
insert into public.sources (id, source_type, external_id, author_handle, expert_id, published_at, exact_text) values
  ('00000000-0000-0000-0000-00000000025a', 'x', 'test-c2', null, '00000000-0000-0000-0000-0000000001a1', '2026-11-13 10:00:00+00',
   'I am in the 25 bps camp regarding what the Fed will ultimately do.');
insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
  resolution_date, resolution_criteria, verification_mode, status, fingerprint_sha256, published_at, capture_mode)
values ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000025a',
  'economy-rates', 'The Fed raises rates by 25 bp at its next meeting.', 'I am in the 25 bps camp regarding what the Fed will ultimately do.',
  '2026-11-13 10:00:00+00', '2026-11-14', 'FOMC statement after the December meeting.', 'auto', 'due', 'fp-c2', now(), 'live');
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000002f1', null, null, 'Deadline before the statement is refused.', 'admin', null, '2026-11-01')$$, 'resolution_before_prediction');
do $$
declare new_id uuid;
begin
  new_id := public.correct_prediction('00000000-0000-0000-0000-0000000002f1', null, 'I am in the 25 bps camp',
    'Deadline was set before the December FOMC meeting (Dec 8-9) the claim refers to; corrected to the day after.', 'admin', null, '2099-12-10');
  if (select resolution_date::date from public.predictions where id = new_id) <> '2099-12-10' then raise exception 'deadline not corrected'; end if;
  if (select status from public.predictions where id = new_id) <> 'open' then raise exception 'later deadline should reopen a due prediction'; end if;
  if (select confidence_language from public.predictions where id = new_id) <> 'I am in the 25 bps camp' then raise exception 'confidence not corrected'; end if;
  if (select (after->'changes'->'resolution_date'->>'before') from public.audit_log where entity_id = new_id and action = 'correction_applied') is null then raise exception 'deadline change not audited'; end if;
end $$;

-- A superseded prediction can't be re-linked, revived or corrected again.
select pg_temp.expect_error($$update public.predictions set superseded_by = null where id = '00000000-0000-0000-0000-0000000001f1'$$, 'immutable');
select pg_temp.expect_error($$update public.predictions set status = 'resolved' where id = '00000000-0000-0000-0000-0000000001f1'$$, 'superseded prediction stays out');
select pg_temp.expect_error($$select public.correct_prediction('00000000-0000-0000-0000-0000000001f1', null, null, 'Second correction of the original.')$$, 'Only a visible published prediction');

-- Only the service role may call it.
do $$ begin
  if has_function_privilege('anon', 'public.correct_prediction(uuid, numeric, text, text, text, text, timestamptz)', 'execute') then raise exception 'anon can correct'; end if;
  if has_function_privilege('authenticated', 'public.correct_prediction(uuid, numeric, text, text, text, text, timestamptz)', 'execute') then raise exception 'authenticated can correct'; end if;
end $$;

rollback;
\echo 'correction tests passed'
