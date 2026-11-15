-- Integrity guards enforced by the database itself, so no code path (cron
-- script, admin action, one-off SQL through the service role) can publish or
-- keep showing a prediction that breaks the product rules.
--
-- Invariants:
--   1. A published prediction's quote is an exact substring of its source's
--      stored text, the source is not deleted, the prediction date is the
--      source's own timestamp, the source belongs to the attributed expert,
--      and the deadline is not before the statement.
--   2. A probability is stored only when the quote states it as a percentage.
--   3. Once published, a prediction stays published: published_at,
--      verification_mode and frozen_at are frozen alongside its substance, and
--      it can't be deleted. Quarantine is status = 'source_unavailable'.
--   4. A quarantined prediction can only return to public view if its source
--      is live again and still contains the quote.
--   5. A source's text can't be changed or removed out from under a visible
--      prediction: quarantine the prediction first.
--   6. audit_log is append-only.
--   7. Nothing behind a quarantined prediction (source text, resolution,
--      evidence) is readable through the public API.

-- ---- Helpers -----------------------------------------------------------------

-- True when `quote` states `probability` as a percentage phrased as a
-- probability ("70% chance", "90 percent confident", "odds of 60%"). A bare
-- number ("rates fall below 3%") is a threshold, not a probability. Mirrors
-- probabilityIsStated() in lib/predictions/validation.ts.
create or replace function public.probability_is_stated(quote text, probability numeric)
returns boolean language sql immutable as $$
  select probability is null or exists (
    select 1
    from (
      select m[1] as value from regexp_matches(coalesce(quote, ''),
        '(?:^|[^0-9.])([0-9]{1,3}(?:\.[0-9]+)?)\s?(?:%|percent|per cent)\s*(?:chance|probability|odds|likely|likelihood|confident|confidence|sure|certain)', 'gi') as m
      union all
      select m[1] from regexp_matches(coalesce(quote, ''),
        '(?:chance|probability|odds|likelihood)\s+(?:of\s+|is\s+|at\s+|are\s+)?(?:about\s+|around\s+|roughly\s+|~\s*)?([0-9]{1,3}(?:\.[0-9]+)?)\s?(?:%|percent|per cent)', 'gi') as m
    ) stated
    where abs(stated.value::numeric - probability * 100) <= 0.5
  );
$$;

-- Null when the prediction may be public; otherwise the reason it may not.
create or replace function public.prediction_publication_error(
  p_source_id uuid, p_expert_id uuid, p_quote text, p_prediction_date timestamptz,
  p_resolution_date timestamptz, p_probability numeric
) returns text language plpgsql stable as $$
declare
  s record;
  e record;
begin
  select id, expert_id, author_external_id, author_handle, published_at, exact_text, deleted_at
    into s from public.sources where id = p_source_id;
  if not found then return 'source_missing'; end if;
  if s.deleted_at is not null then return 'source_deleted'; end if;
  if s.exact_text is null then return 'source_text_missing'; end if;
  if p_quote is null or length(p_quote) = 0 or strpos(s.exact_text, p_quote) = 0 then return 'quote_not_in_source'; end if;
  -- Millisecond precision: client drivers round-trip timestamps through
  -- millisecond-resolution dates, which must not read as a different moment.
  if p_prediction_date is null
    or date_trunc('milliseconds', p_prediction_date) <> date_trunc('milliseconds', s.published_at) then
    return 'prediction_date_not_source_date';
  end if;
  if p_resolution_date is not null
    and (p_resolution_date at time zone 'UTC')::date < (p_prediction_date at time zone 'UTC')::date then
    return 'resolution_before_prediction';
  end if;
  if not public.probability_is_stated(p_quote, p_probability) then return 'probability_not_stated_in_quote'; end if;
  select id, x_user_id, x_handle into e from public.experts where id = p_expert_id;
  if not found then return 'expert_missing'; end if;
  -- coalesce: a NULL comparison must count as "not attributed", never pass.
  if not (
    coalesce(s.expert_id = e.id, false)
    or coalesce(s.author_external_id = e.x_user_id, false)
    or (s.expert_id is null and coalesce(lower(s.author_handle) = lower(e.x_handle), false))
  ) then
    return 'source_not_attributed_to_expert';
  end if;
  return null;
end;
$$;

-- ---- Repair rows quarantined by the old "published_at = null" path ------------
-- Earlier compliance refreshes quarantined by clearing published_at, which also
-- lifted the immutability guard. Restore the original publication time (kept
-- in frozen_at) so those rows are protected again; status stays
-- 'source_unavailable', so they remain hidden and unscored.
update public.predictions
set published_at = frozen_at
where published_at is null and status = 'source_unavailable';

-- ---- predictions -------------------------------------------------------------

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
    new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception 'Published prediction substance is immutable; create an audited correction.'
      using errcode = 'check_violation';
  end if;

  -- Publishing for the first time through an update.
  if old.published_at is null and new.published_at is not null then
    reason := public.prediction_publication_error(new.source_id, new.expert_id, new.source_quote,
      new.prediction_date, new.resolution_date, new.explicit_probability);
    if reason is not null then
      raise exception 'Prediction cannot be published: %', reason using errcode = 'check_violation';
    end if;
  end if;

  -- Leaving quarantine requires a live source that still contains the quote.
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

create or replace function public.guard_prediction_insert()
returns trigger language plpgsql as $$
declare
  reason text;
begin
  if new.published_at is not null then
    reason := public.prediction_publication_error(new.source_id, new.expert_id, new.source_quote,
      new.prediction_date, new.resolution_date, new.explicit_probability);
    if reason is not null then
      raise exception 'Prediction cannot be published: %', reason using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_prediction_insert on public.predictions;
create trigger guard_prediction_insert before insert on public.predictions
for each row execute function public.guard_prediction_insert();

create or replace function public.guard_prediction_delete()
returns trigger language plpgsql as $$
begin
  if old.published_at is not null then
    raise exception 'Published predictions are never deleted; quarantine with status = source_unavailable.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_prediction_delete on public.predictions;
create trigger guard_prediction_delete before delete on public.predictions
for each row execute function public.guard_prediction_delete();

-- ---- sources -----------------------------------------------------------------

create or replace function public.guard_source_under_prediction()
returns trigger language plpgsql as $$
declare
  blocking uuid;
begin
  if new.exact_text is not distinct from old.exact_text
    and (new.deleted_at is not distinct from old.deleted_at or new.deleted_at is null)
    and new.published_at is not distinct from old.published_at then
    return new;
  end if;
  select p.id into blocking
  from public.predictions p
  where p.source_id = new.id
    and p.published_at is not null
    and p.status <> 'source_unavailable'
    and (
      new.deleted_at is not null
      or new.exact_text is null
      or strpos(new.exact_text, p.source_quote) = 0
      or date_trunc('milliseconds', new.published_at) <> date_trunc('milliseconds', p.prediction_date)
    )
  limit 1;
  if blocking is not null then
    raise exception 'Source % backs visible prediction %; quarantine the prediction before changing or removing its source.', new.id, blocking
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_source_under_prediction on public.sources;
create trigger guard_source_under_prediction before update on public.sources
for each row execute function public.guard_source_under_prediction();

-- ---- audit_log ---------------------------------------------------------------

create or replace function public.audit_log_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only.' using errcode = 'check_violation';
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only before update or delete on public.audit_log
for each row execute function public.audit_log_append_only();

-- ---- Public visibility of quarantined records ---------------------------------
-- Quarantined predictions keep published_at, so every public policy that used
-- published_at as "visible" must also exclude status = 'source_unavailable':
-- a quarantined prediction's source text and resolution must not be readable
-- through the public API either.
drop policy if exists sources_public_read on public.sources;
create policy sources_public_read on public.sources for select using (
  deleted_at is null and exists(
    select 1 from public.predictions p
    where p.source_id = sources.id and p.published_at is not null and p.status <> 'source_unavailable')
);
drop policy if exists resolutions_public_read on public.resolutions;
create policy resolutions_public_read on public.resolutions for select using (
  approved_at is not null and exists(
    select 1 from public.predictions p
    where p.id = prediction_id and p.published_at is not null and p.status <> 'source_unavailable')
);
drop policy if exists resolution_evidence_public_read on public.resolution_evidence;
create policy resolution_evidence_public_read on public.resolution_evidence for select using (
  exists(
    select 1 from public.resolutions r join public.predictions p on p.id = r.prediction_id
    where r.id = resolution_id and r.approved_at is not null and p.published_at is not null and p.status <> 'source_unavailable')
);

-- ---- Integrity report --------------------------------------------------------
-- Publicly visible predictions that violate the publication rules today (rows
-- published before these guards existed). Admin/service-role only; used by
-- `pnpm readiness`, which fails while any row is listed.
create or replace view public.prediction_integrity_violations
with (security_invoker = true)
as
select p.id as prediction_id, p.expert_id, p.source_id,
  public.prediction_publication_error(p.source_id, p.expert_id, p.source_quote, p.prediction_date, p.resolution_date, p.explicit_probability) as violation
from public.predictions p
where p.published_at is not null
  and p.status <> 'source_unavailable'
  and public.prediction_publication_error(p.source_id, p.expert_id, p.source_quote, p.prediction_date, p.resolution_date, p.explicit_probability) is not null;

revoke all on public.prediction_integrity_violations from anon, authenticated;
