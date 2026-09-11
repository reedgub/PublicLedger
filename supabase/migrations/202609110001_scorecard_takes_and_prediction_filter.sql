-- Recreate expert_scorecards so the migrations path matches setup.sql.
--
-- Two integrity changes:
--   1. Filter the join to record_type = 'prediction'. Takes (soft, imputed
--      claims) must not enter total_predictions, open_predictions, accuracy,
--      Brier, or wilson_rank_score. Comments in code enforce this, but a
--      view without the filter still counted admin-approved takes on any
--      environment bootstrapped from migrations rather than setup.sql.
--   2. Add total_takes as a scalar subquery, so the expert page's "Takes"
--      tile has a real number instead of silently defaulting to zero.
--
-- The definition below is identical to setup.sql:329-392.

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

grant select on public.expert_scorecards to anon, authenticated;
