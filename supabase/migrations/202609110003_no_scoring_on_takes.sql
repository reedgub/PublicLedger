-- DB-enforce "takes are never scored".
--
-- The rule lives in code comments (scripts/process-sources.ts, lib/data/
-- public.ts) and is trusted by the leaderboard math and the LLM auto-approver.
-- One stray admin action or a future refactor could violate it without any
-- validator noticing. Move the invariant into the database, where it holds
-- against every write path — CLI import, admin action, service-role update
-- outside the app entirely.
--
-- A CHECK constraint can't reference another table's column, so we use a
-- trigger. On insert/update of resolutions, if the referenced prediction has
-- record_type = 'take' AND scoring_eligible is true, raise. Also block the
-- reverse: a prediction that already has a scoring-eligible resolution can't
-- be re-typed to a take without first clearing the resolution.

create or replace function public.guard_take_never_scored()
returns trigger language plpgsql as $$
declare
  linked_record_type text;
begin
  if tg_table_name = 'resolutions' then
    if new.scoring_eligible then
      select p.record_type into linked_record_type
      from public.predictions p
      where p.id = new.prediction_id;
      if linked_record_type = 'take' then
        raise exception 'Takes cannot have scoring_eligible resolutions; downgrade the prediction or mark the resolution non-scoring.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'predictions' then
    if new.record_type = 'take' and (old.record_type is distinct from 'take') then
      if exists (
        select 1 from public.resolutions r
        where r.prediction_id = new.id and r.scoring_eligible = true
      ) then
        raise exception 'Cannot re-type prediction to take while a scoring-eligible resolution exists.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists resolutions_no_take_scoring on public.resolutions;
create trigger resolutions_no_take_scoring
before insert or update on public.resolutions
for each row execute function public.guard_take_never_scored();

drop trigger if exists predictions_no_retype_take on public.predictions;
create trigger predictions_no_retype_take
before update of record_type on public.predictions
for each row execute function public.guard_take_never_scored();
