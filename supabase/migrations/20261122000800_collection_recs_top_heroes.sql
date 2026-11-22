-- Return the top 4 most common hero users (`top_hero_ids`) for each recommended
-- (catalog_id, level_nodes) collection build in recommend_collections.

drop function if exists public.recommend_collections(text[], int);

create function public.recommend_collections(p_mode_slugs text[] default null, p_limit int default 3)
returns table (
  catalog_id int,
  class text,
  rank int,
  kind text,
  score numeric,
  complete_count int,
  near_count int,
  rec_level_nodes int,
  rec_mythic_stats text[],
  by_mode jsonb,
  submission_ids bigint[],
  top_hero_ids int[]
)
language sql stable security definer set search_path = public as $$
  with params as (
    select coalesce(p_mode_slugs, (select recommendation_modes from profiles where id = auth.uid())) as slugs,
           public.rec_setting('near_miss_decay', 0.4) as decay,
           public.rec_setting('gap_cap', 8) as gap_cap
  ),
  sel as (
    select m.id, m.slug
    from game_modes m, params
    where m.enabled
      and (params.slugs is null or cardinality(params.slugs) = 0 or m.slug = any(params.slugs))
  ),
  me as (select * from user_roster where user_id = auth.uid()),
  mine as (
    select uc.id, uc.catalog_id,
           (count(*) filter (where n.node_type = 'skill_level'))::int as level_nodes,
           coalesce(
             array_agg(n.node_type order by n.node_type) filter (where n.tier = 'mythic' and n.node_type <> 'skill_level'),
             '{}'::text[]
           ) as mythic_stats
    from user_collections uc
    left join user_collection_nodes n on n.collection_id = uc.id
    where uc.user_id = auth.uid()
    group by uc.id, uc.catalog_id
  ),
  pool as (select p.* from recommendation_pool p join sel on sel.id = p.mode_id),
  demand as (select d.* from recommendation_collection_pool d join sel on sel.id = d.mode_id),
  team_counts as (
    select p.submission_id, count(distinct p.formation_id) as n from pool p group by p.submission_id
  ),
  hero_gaps as (
    select p.formation_id,
           count(*) filter (where r.hero_id is null or (
              (p.si is not null and r.si is not null and r.si < p.si)
              or (p.furniture is not null and r.furniture is not null and r.furniture < p.furniture)
              or (p.engraving is not null and r.engraving is not null and r.engraving < p.engraving)
              or (p.ascension is not null and r.ascension is not null
                  and public.ascension_rank(r.ascension) < public.ascension_rank(p.ascension))
           )) as gap
    from pool p
    left join me r on r.hero_id = p.hero_id
    group by p.formation_id
  ),
  needs as (
    select d.*,
           not exists (
             select 1 from mine m
             where m.catalog_id = d.catalog_id
               and m.level_nodes = d.level_nodes
               and public.mythic_stats_cover(m.mythic_stats, d.mythic_stats)
           ) as unmet
    from demand d
  ),
  team_gaps as (
    select n.formation_id, coalesce(hg.gap, 0) + count(*) filter (where n.unmet) as gap
    from needs n
    left join hero_gaps hg on hg.formation_id = n.formation_id
    group by n.formation_id, hg.gap
  ),
  rows_unmet as (
    select n.catalog_id, n.level_nodes, n.hero_id, n.submission_id, n.mode_id, n.mythic_stats, tg.gap,
           n.weight / sqrt(tc.n::numeric) * power(params.decay, least(tg.gap, params.gap_cap) - 1) as pts
    from needs n
    join team_gaps tg on tg.formation_id = n.formation_id
    join team_counts tc on tc.submission_id = n.submission_id
    cross join params
    where n.unmet
  ),
  best_build as (
    select distinct on (s.catalog_id, s.level_nodes)
           s.catalog_id, s.level_nodes, s.mythic_stats
    from (
      select r.catalog_id, r.level_nodes, r.mythic_stats, sum(r.pts) as total
      from rows_unmet r
      group by r.catalog_id, r.level_nodes, r.mythic_stats
    ) s
    order by s.catalog_id, s.level_nodes, (cardinality(s.mythic_stats) > 0) desc, s.total desc, s.mythic_stats
  ),
  per_mode as (
    select r.catalog_id, r.level_nodes, r.mode_id, count(*) as n
    from rows_unmet r
    group by r.catalog_id, r.level_nodes, r.mode_id
  ),
  mode_json as (
    select pm.catalog_id, pm.level_nodes, jsonb_object_agg(sel.slug, pm.n) as by_mode
    from per_mode pm join sel on sel.id = pm.mode_id
    group by pm.catalog_id, pm.level_nodes
  ),
  hero_usage as (
    select r.catalog_id, r.level_nodes, r.hero_id, count(*) as uses, sum(r.pts) as total_pts
    from rows_unmet r
    group by r.catalog_id, r.level_nodes, r.hero_id
  ),
  top_heroes as (
    select hu.catalog_id, hu.level_nodes,
           (array_agg(hu.hero_id::int order by hu.uses desc, hu.total_pts desc, hu.hero_id))[1:4] as top_hero_ids
    from hero_usage hu
    group by hu.catalog_id, hu.level_nodes
  ),
  agg as (
    select r.catalog_id, cc.class,
           case
             when exists (
               select 1 from mine m
               where m.catalog_id = r.catalog_id and m.level_nodes = r.level_nodes
             ) then 'upgrade'
             else 'build'
           end as kind,
           round(sum(r.pts), 6) as score,
           (count(*) filter (where r.gap = 1))::int as complete_count,
           (count(*) filter (where r.gap > 1))::int as near_count,
           r.level_nodes as rec_level_nodes,
           bb.mythic_stats as rec_mythic_stats,
           mj.by_mode,
           (array_agg(distinct r.submission_id))[1:5] as submission_ids,
           coalesce(th.top_hero_ids, '{}'::int[]) as top_hero_ids
    from rows_unmet r
    join collection_catalog cc on cc.id = r.catalog_id
    join best_build bb on bb.catalog_id = r.catalog_id and bb.level_nodes = r.level_nodes
    join mode_json mj on mj.catalog_id = r.catalog_id and mj.level_nodes = r.level_nodes
    left join top_heroes th on th.catalog_id = r.catalog_id and th.level_nodes = r.level_nodes
    group by r.catalog_id, cc.class, r.level_nodes, bb.mythic_stats, mj.by_mode, th.top_hero_ids
  ),
  limited as (
    select agg.*,
           (row_number() over (partition by agg.class order by agg.score desc, agg.catalog_id, agg.rec_level_nodes desc))::int as rn
    from agg
  )
  select l.catalog_id::int, l.class, l.rn, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_level_nodes, l.rec_mythic_stats, l.by_mode, l.submission_ids, l.top_hero_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by l.class, l.rn
$$;
revoke all on function public.recommend_collections(text[], int) from public, anon;
grant execute on function public.recommend_collections(text[], int) to authenticated;
