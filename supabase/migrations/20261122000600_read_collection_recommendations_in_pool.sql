-- Include formation_collections.recommendation builds (catalogId, level, attackStats, defenseStats)
-- in recommendation_collection_pool alongside legacy formation_collections.nodes rows.

drop materialized view if exists recommendation_collection_pool;

create materialized view recommendation_collection_pool as
with base as (
  select p.submission_id, p.formation_id, p.hero_id, p.mode_id, p.weight,
         coalesce(
           fc.catalog_id,
           nullif(fc.recommendation ->> 'catalogId', '')::smallint,
           nullif(fc.recommendation ->> 'catalog_id', '')::smallint
         ) as catalog_id,
         fc.nodes,
         fc.recommendation
  from public.recommendation_pool p
  join public.formation_collections fc
    on fc.formation_id = p.formation_id and fc.hero_id = p.hero_id
  where coalesce(
          fc.catalog_id,
          nullif(fc.recommendation ->> 'catalogId', '')::smallint,
          nullif(fc.recommendation ->> 'catalog_id', '')::smallint
        ) is not null
),
from_nodes as (
  select b.submission_id, b.formation_id, b.hero_id, b.mode_id, b.weight, b.catalog_id,
         (count(*) filter (where n.value ->> 'stat' = 'skill_level'))::int as level_nodes,
         coalesce(
           array_agg(n.value ->> 'stat' order by n.value ->> 'stat')
             filter (where n.value ->> 'tier' = 'mythic' and n.value ->> 'stat' <> 'skill_level'),
           '{}'::text[]
         ) as mythic_stats
  from base b
  left join lateral jsonb_array_elements(coalesce(b.nodes, '[]'::jsonb)) as n(value) on true
  where jsonb_array_length(coalesce(b.nodes, '[]'::jsonb)) > 0
  group by b.submission_id, b.formation_id, b.hero_id, b.mode_id, b.weight, b.catalog_id
),
from_rec as (
  select b.submission_id, b.formation_id, b.hero_id, b.mode_id, b.weight, b.catalog_id,
         greatest(0, coalesce(nullif(b.recommendation ->> 'level', '')::int, 1) - 1)::int as level_nodes,
         coalesce(
           (
             select array_agg(s.stat order by s.stat)
             from (
               select jsonb_array_elements_text(
                 coalesce(b.recommendation -> 'attackStats', b.recommendation -> 'attack_stats', '[]'::jsonb)
               ) as stat
               union all
               select jsonb_array_elements_text(
                 coalesce(b.recommendation -> 'defenseStats', b.recommendation -> 'defense_stats', '[]'::jsonb)
               ) as stat
             ) s
             where s.stat is not null and s.stat <> ''
           ),
           '{}'::text[]
         ) as mythic_stats
  from base b
  where jsonb_array_length(coalesce(b.nodes, '[]'::jsonb)) = 0
)
select * from from_nodes
union all
select * from from_rec
with data;

create unique index recommendation_collection_pool_key on recommendation_collection_pool (formation_id, hero_id);
create index recommendation_collection_pool_mode on recommendation_collection_pool (mode_id);
revoke all on recommendation_collection_pool from public, anon, authenticated;

select public.refresh_recommendation_pool();
