-- Tighten the noise floor on global_search.
--
-- The previous definition only required the trigram % operator, which is
-- pg_trgm's default similarity threshold (0.3). Common tokens like "the"
-- or short queries pull long tails of low-signal matches that all end up
-- adjacent to the real hits under a `order by similarity desc` sort,
-- because the sort tolerates ties.
--
-- The new definition:
--   * Uses an explicit similarity(...) >= floor per branch instead of `%`,
--     so we can tune each surface independently (experts and topics are
--     tighter than predictions, which have longer text).
--   * Adds a final HAVING-style predicate on the composite score so a
--     match that only barely clears the floor doesn't outrank a strong
--     match on a different branch.
--   * Filters predictions and markets to record_type='prediction' /
--     public visibility. Takes never surface via search — same rule as
--     the leaderboard.

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
    where e.is_active
      and greatest(similarity(e.display_name, q.value), similarity(coalesce(e.x_handle,''), regexp_replace(q.value, '^@', ''))) >= 0.30
    union all
    select 'topic', t.id::text, t.title, c.name, '/topics/' || t.slug,
      (case when lower(t.title) = lower(q.value) then 3 else 0 end + similarity(t.title, q.value))::real
    from public.topics t cross join q left join public.categories c on c.slug = t.category_slug
    where t.status = 'active' and similarity(t.title, q.value) >= 0.28
    union all
    select 'prediction', p.id::text, p.normalized_claim, e.display_name, '/predictions/' || p.id,
      similarity(p.normalized_claim, q.value)::real
    from public.predictions p cross join q join public.experts e on e.id = p.expert_id
    where p.published_at is not null
      and p.status <> 'source_unavailable'
      and p.record_type = 'prediction'
      and similarity(p.normalized_claim, q.value) >= 0.22
    union all
    select 'market', m.id::text, m.question, 'Polymarket', '/topics/' || coalesce(t.slug, ''),
      similarity(m.question, q.value)::real
    from public.markets m cross join q left join public.topics t on t.id = m.topic_id
    where t.id is not null and similarity(m.question, q.value) >= 0.28
  ) results(result_type, result_id, title, subtitle, href, score)
  where results.score >= 0.30
  order by results.score desc
  limit greatest(1, least(result_limit, 25));
$$;

grant execute on function public.global_search(text, integer) to anon, authenticated;
