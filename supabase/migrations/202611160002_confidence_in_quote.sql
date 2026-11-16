-- Confidence language must be the author's own words.
--
-- confidence_language is shown as what the author said about their certainty.
-- Extraction models paraphrased it ("categorical ('is not going to')"),
-- truncated it ("For what it is worth, I am in the..."), or invented it ("will
-- be" for a quote without those words). Like the quote itself, it must be an
-- exact substring of the source quote. Checked whenever a prediction becomes
-- public (published, or leaving quarantine); rows published before this guard
-- are reported by prediction_integrity_violations and fixed with
-- correct_prediction(), which already enforces the same rule.

create or replace function public.guard_confidence_language()
returns trigger language plpgsql as $$
begin
  if new.published_at is not null
    and new.status <> 'source_unavailable'
    and new.confidence_language is not null
    and strpos(new.source_quote, new.confidence_language) = 0
    and (tg_op = 'INSERT' or old.published_at is null or old.status = 'source_unavailable') then
    raise exception 'Prediction cannot be published: confidence_not_in_quote' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_confidence_language on public.predictions;
create trigger guard_confidence_language before insert or update on public.predictions
for each row execute function public.guard_confidence_language();

create or replace view public.prediction_integrity_violations
with (security_invoker = true)
as
select prediction_id, expert_id, source_id, violation from (
  select p.id as prediction_id, p.expert_id, p.source_id,
    coalesce(
      public.prediction_publication_error(p.source_id, p.expert_id, p.source_quote, p.prediction_date, p.resolution_date, p.explicit_probability),
      case when p.confidence_language is not null and strpos(p.source_quote, p.confidence_language) = 0 then 'confidence_not_in_quote' end
    ) as violation
  from public.predictions p
  where p.published_at is not null and p.status <> 'source_unavailable'
) checked
where violation is not null;

revoke all on public.prediction_integrity_violations from anon, authenticated;
