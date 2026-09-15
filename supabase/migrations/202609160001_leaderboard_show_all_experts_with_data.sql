-- Show every expert who has ANY published data on the leaderboard, not just
-- experts with ≥5 resolved predictions. Under the old rule only 3 of 81
-- active experts appeared — 38 have published predictions and 24 have
-- published takes, so the leaderboard was hiding almost all of the corpus
-- behind a threshold that was only meaningful once we had years of history.
--
-- New rule: an expert is leaderboard-eligible if they have at least one
-- published prediction OR at least one published take. Accuracy/Brier/Wilson
-- still show "—" for experts with 0 scored resolutions, and the table's
-- default Wilson sort naturally sinks them to the bottom, so unresolved
-- experts appear without contaminating the ranking of resolved ones.
--
-- The `provisional` flag (<20 resolved) stays, so the UI can still badge
-- small-sample scorecards distinctly from full-sample ones.

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
  (
    count(p.id) > 0
    or exists (
      select 1 from public.predictions t
      where t.expert_id = e.id and t.published_at is not null
        and t.status <> 'source_unavailable' and t.record_type = 'take'
    )
  ) as leaderboard_eligible,
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
