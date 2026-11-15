-- Database integrity guards: run against a database built from the
-- migrations (see supabase/tests/run.sh). Every block raises on failure, and
-- everything runs in one transaction that is rolled back.
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

insert into public.experts (id, slug, display_name, x_handle, x_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'test-alice', 'Alice Test', 'alice_test', '111'),
  ('00000000-0000-0000-0000-0000000000b2', 'test-bob', 'Bob Test', 'bob_test', '222');

insert into public.sources (id, source_type, external_id, author_handle, author_external_id, published_at, exact_text) values
  ('00000000-0000-0000-0000-00000000005a', 'x', 'test-1', 'alice_test', '111', '2026-01-15 12:34:56.123456+00',
   'I think there is a 70% chance rates fall below 3% by 2027. Also, the Fed will cut twice this year.');

-- Valid publish (probability stated, deadline on the same day is fine).
insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
  resolution_date, resolution_criteria, explicit_probability, verification_mode, status, fingerprint_sha256, published_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000005a',
  'economy-rates', 'Rates fall below 3% by 2027.', 'there is a 70% chance rates fall below 3% by 2027', '2026-01-15 12:34:56.123456+00',
  '2027-12-31', 'Fed funds upper bound below 3%.', 0.7, 'auto', 'open', 'fp-1', now());

insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
  resolution_date, resolution_criteria, verification_mode, status, fingerprint_sha256, published_at)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000005a',
  'economy-rates', 'The Fed cuts twice in 2026.', 'the Fed will cut twice this year', '2026-01-15 12:34:56.123456+00',
  '2026-01-15', 'Two FOMC cuts in 2026.', 'auto', 'open', 'fp-2', now());

-- Template for rejected publishes: %s is replaced per case.
create temp table cases (label text, columns text, expected text);
insert into cases values
  ('quote not in source', $$'invented words', '2026-01-15 12:34:56.123456+00', '2027-12-31', null, '00000000-0000-0000-0000-0000000000a1'$$, 'quote_not_in_source'),
  ('date not source date', $$'the Fed will cut twice this year', '2026-01-14 00:00:00+00', '2027-12-31', null, '00000000-0000-0000-0000-0000000000a1'$$, 'prediction_date_not_source_date'),
  ('deadline before statement', $$'the Fed will cut twice this year', '2026-01-15 12:34:56.123456+00', '2026-01-14', null, '00000000-0000-0000-0000-0000000000a1'$$, 'resolution_before_prediction'),
  ('probability not in quote', $$'the Fed will cut twice this year', '2026-01-15 12:34:56.123456+00', '2027-12-31', 0.8, '00000000-0000-0000-0000-0000000000a1'$$, 'probability_not_stated_in_quote'),
  ('wrong probability', $$'there is a 70% chance rates fall below 3% by 2027', '2026-01-15 12:34:56.123456+00', '2027-12-31', 0.03, '00000000-0000-0000-0000-0000000000a1'$$, 'probability_not_stated_in_quote'),
  ('wrong expert', $$'the Fed will cut twice this year', '2026-01-15 12:34:56.123456+00', '2027-12-31', null, '00000000-0000-0000-0000-0000000000b2'$$, 'source_not_attributed_to_expert');

do $$
declare c record;
begin
  for c in select * from cases loop
    perform pg_temp.expect_error(format($f$
      insert into public.predictions (source_id, category_slug, normalized_claim, source_quote, prediction_date, resolution_date,
        explicit_probability, expert_id, resolution_criteria, verification_mode, status, fingerprint_sha256, published_at)
      values ('00000000-0000-0000-0000-00000000005a', 'economy-rates', 'claim', %s, 'criteria', 'auto', 'open', %L, now())
    $f$, c.columns, 'fp-' || c.label), c.expected);
  end loop;
end $$;

-- Unpublished drafts are not checked until they are published.
insert into public.predictions (id, expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
  resolution_date, resolution_criteria, verification_mode, status, fingerprint_sha256)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000005a',
  'economy-rates', 'Draft.', 'not in the source', '2026-01-15 12:34:56.123456+00', '2027-12-31', 'criteria', 'admin', 'open', 'fp-3');
select pg_temp.expect_error($$update public.predictions set published_at = now() where id = '00000000-0000-0000-0000-0000000000f3'$$, 'quote_not_in_source');

-- Published substance, publication time and existence are frozen.
select pg_temp.expect_error($$update public.predictions set normalized_claim = 'edited' where id = '00000000-0000-0000-0000-0000000000f1'$$, 'immutable');
select pg_temp.expect_error($$update public.predictions set published_at = null where id = '00000000-0000-0000-0000-0000000000f1'$$, 'immutable');
select pg_temp.expect_error($$update public.predictions set verification_mode = 'admin' where id = '00000000-0000-0000-0000-0000000000f1'$$, 'immutable');
select pg_temp.expect_error($$delete from public.predictions where id = '00000000-0000-0000-0000-0000000000f1'$$, 'never deleted');
update public.predictions set status = 'due' where id = '00000000-0000-0000-0000-0000000000f1';

-- A source can't change or vanish under a visible prediction...
select pg_temp.expect_error($$update public.sources set exact_text = 'rewritten' where id = '00000000-0000-0000-0000-00000000005a'$$, 'quarantine the prediction');
select pg_temp.expect_error($$update public.sources set deleted_at = now() where id = '00000000-0000-0000-0000-00000000005a'$$, 'quarantine the prediction');
select pg_temp.expect_error($$update public.sources set published_at = now() where id = '00000000-0000-0000-0000-00000000005a'$$, 'quarantine the prediction');
-- ...but an edit that keeps every visible quote is allowed.
update public.sources set exact_text = exact_text || ' Edited footer.' where id = '00000000-0000-0000-0000-00000000005a';

-- Quarantined records are invisible to the public role, including their source.
-- (Supabase grants anon table privileges; RLS decides the rows.)
grant usage on schema public to anon;
grant select on all tables in schema public to anon;
insert into public.resolutions (prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
values ('00000000-0000-0000-0000-0000000000f2', 'correct', 'Two cuts happened.', 1, 'admin', true, now(), now());
update public.predictions set status = 'source_unavailable' where id = '00000000-0000-0000-0000-0000000000f2';
set local role anon;
do $$ begin
  if exists (select 1 from public.resolutions where prediction_id = '00000000-0000-0000-0000-0000000000f2') then raise exception 'resolution of a quarantined prediction visible to anon'; end if;
end $$;
do $$ begin
  if not exists (select 1 from public.predictions where id = '00000000-0000-0000-0000-0000000000f1') then raise exception 'visible prediction hidden from anon'; end if;
  if exists (select 1 from public.predictions where id = '00000000-0000-0000-0000-0000000000f2') then raise exception 'quarantined prediction visible to anon'; end if;
  if not exists (select 1 from public.sources where id = '00000000-0000-0000-0000-00000000005a') then raise exception 'source of a visible prediction hidden'; end if;
end $$;
reset role;
update public.predictions set status = 'source_unavailable' where id = '00000000-0000-0000-0000-0000000000f1';
set local role anon;
do $$ begin
  if exists (select 1 from public.sources where id = '00000000-0000-0000-0000-00000000005a') then raise exception 'source of quarantined predictions visible to anon'; end if;
end $$;
reset role;

-- After quarantine the source may change; the prediction can't come back while its quote is gone.
update public.predictions set status = 'source_unavailable' where source_id = '00000000-0000-0000-0000-00000000005a' and published_at is not null;
update public.sources set exact_text = null, deleted_at = now() where id = '00000000-0000-0000-0000-00000000005a';
select pg_temp.expect_error($$update public.predictions set status = 'open' where id = '00000000-0000-0000-0000-0000000000f1'$$, 'cannot return to public view');
select pg_temp.expect_error($$update public.predictions set status = 'resolved' where id = '00000000-0000-0000-0000-0000000000f2'$$, 'cannot return to public view');

-- audit_log is append-only.
insert into public.audit_log (id, entity_type, entity_id, action, actor_type) values
  ('00000000-0000-0000-0000-0000000000c1', 'prediction', '00000000-0000-0000-0000-0000000000f1', 'test', 'system');
select pg_temp.expect_error($$update public.audit_log set reason = 'x' where id = '00000000-0000-0000-0000-0000000000c1'$$, 'append-only');
select pg_temp.expect_error($$delete from public.audit_log where id = '00000000-0000-0000-0000-0000000000c1'$$, 'append-only');

-- Quarantined rows are not reported as violations; nothing visible is broken.
do $$ begin
  if exists (select 1 from public.prediction_integrity_violations) then raise exception 'unexpected integrity violations'; end if;
end $$;

-- Probability helper matches the TypeScript rule.
do $$ begin
  if not public.probability_is_stated('a 33.3 percent chance', 0.333) then raise exception 'decimal percent'; end if;
  if not public.probability_is_stated('90 per cent likely', 0.9) then raise exception 'per cent'; end if;
  if public.probability_is_stated('85-90% Dem House takeover', 0.875) then raise exception 'range must not match'; end if;
  if public.probability_is_stated('a 150% gain', 0.5) then raise exception 'substring must not match'; end if;
  if public.probability_is_stated('very likely', 0.8) then raise exception 'qualitative must not match'; end if;
  if public.probability_is_stated('rates fall below 3% by 2027', 0.03) then raise exception 'threshold must not match'; end if;
  if not public.probability_is_stated('I''d put the odds at 60%', 0.6) then raise exception 'odds at'; end if;
  if not public.probability_is_stated('roughly a 50% chance of AGI', 0.5) then raise exception 'chance'; end if;
end $$;

rollback;
\echo 'integrity tests passed'
