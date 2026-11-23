-- Fix CR/NC/TS weighting imbalance in recommendation_pool:
-- 1. Guard placement scoring with `case when b.placement is not null ...` because PostgreSQL's
--    greatest(0, NULL) returns 0 instead of NULL, which short-circuited coalesce() before NC
--    total_time and TS's 0.5 fallback, crushing TS to the 0.05 floor and halving NC.
-- 2. Normalize total formation weight per mode to 100.0 so CR, NC, and TS contribute equally
--    to Overall priority regardless of submission count or result-field coverage, while
--    preserving all within-mode performance, upvote, and substitute weighting.

drop materialized view if exists recommendation_pet_pool;
drop materialized view if exists recommendation_collection_pool;
drop materialized view if exists recommendation_pool;

create materialized view recommendation_pool as
with base as (
  select s.id as submission_id, s.mode_id, s.target_id, s.upvotes,
         nullif(s.result ->> 'damage', '')::numeric as damage,
         nullif(s.result ->> 'placement', '')::numeric as placement,
         (
           select sum(f.result_time_seconds)
           from public.formations f
           where f.submission_id = s.id and not f.is_substitute
         ) as total_time
  from public.submissions s
  join public.game_modes m on m.id = s.mode_id and m.enabled
),
scored as (
  select b.*,
         coalesce(ln(1 + b.upvotes) / nullif(ln(1 + max(b.upvotes) over w), 0), 0)::numeric as upvote_score,
         coalesce(
           b.damage / nullif(max(b.damage) over w, 0),
           case when b.placement is not null then greatest(0, 1 - (b.placement - 1) / 99) end,
           min(b.total_time) over w / nullif(b.total_time, 0),
           0.5
         )::numeric as sub_result_score
  from base b
  window w as (partition by b.mode_id, b.target_id)
),
ranked as (
  select sc.*,
         row_number() over (
           partition by sc.mode_id, sc.target_id
           order by sc.sub_result_score desc, sc.upvotes desc, sc.submission_id
         ) as rn
  from scored sc
),
forms_base as (
  select r.submission_id, r.mode_id, r.target_id, r.upvote_score, r.sub_result_score,
         f.id as formation_id, f.slot_key, f.is_substitute,
         coalesce(f.parent_slot_key, f.slot_key) as base_slot_key,
         f.result_damage, f.result_time_seconds,
         pf.result_damage as primary_damage,
         pf.result_time_seconds as primary_time_seconds
  from ranked r
  join public.formations f on f.submission_id = r.submission_id
  left join public.formations pf
    on pf.submission_id = f.submission_id
   and not pf.is_substitute
   and pf.slot_key = coalesce(f.parent_slot_key, f.slot_key)
  where r.rn <= public.rec_setting('pool_size_per_target', 100)
),
forms_scored as (
  select fb.*,
         coalesce(
           fb.result_damage / nullif(max(fb.result_damage) over wr, 0),
           min(fb.result_time_seconds) over wr / nullif(fb.result_time_seconds, 0),
           fb.sub_result_score
         )::numeric as round_result_score,
         greatest(
           1,
           count(*) filter (where fb.is_substitute) over (partition by fb.submission_id, fb.base_slot_key)
         ) as sub_count_for_round
  from forms_base fb
  window wr as (partition by fb.mode_id, fb.target_id, fb.base_slot_key)
),
forms_weighted as (
  select fs.submission_id, fs.formation_id, fs.mode_id, fs.target_id,
         (
           public.rec_setting('weight_floor', 0.05)
           + (1 - public.rec_setting('weight_floor', 0.05))
             * (
                 public.rec_setting('upvote_weight', 0.65) * fs.upvote_score
                 + public.rec_setting('result_weight', 0.35) * ((fs.sub_result_score + fs.round_result_score) / 2.0)
               )
             / nullif(public.rec_setting('upvote_weight', 0.65) + public.rec_setting('result_weight', 0.35), 0)
         )
         * case
             when not fs.is_substitute then 1.0
             else public.rec_setting('substitute_weight', 0.40)
                  * coalesce(
                      least(1.0, fs.result_damage / nullif(fs.primary_damage, 0)),
                      least(1.0, fs.primary_time_seconds / nullif(fs.result_time_seconds, 0)),
                      0.85
                    )
                  / sqrt(fs.sub_count_for_round::numeric)
           end as raw_weight
  from forms_scored fs
),
forms_normalized as (
  select fw.submission_id, fw.formation_id, fw.mode_id, fw.target_id,
         round(
           fw.raw_weight * 100.0 / nullif(sum(fw.raw_weight) over (partition by fw.mode_id), 0),
           6
         ) as weight
  from forms_weighted fw
)
select fn.submission_id, fn.formation_id, fn.mode_id, fn.target_id, fn.weight,
       fh.hero_id, fh.si, fh.furniture, fh.engraving, fh.ascension
from forms_normalized fn
join public.formation_heroes fh on fh.formation_id = fn.formation_id and not fh.is_merc
with data;

create unique index recommendation_pool_key on recommendation_pool (formation_id, hero_id);
create index recommendation_pool_mode on recommendation_pool (mode_id);
revoke all on recommendation_pool from public, anon, authenticated;

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

create materialized view recommendation_pet_pool as
select distinct on (p.formation_id)
  p.formation_id, p.submission_id, p.mode_id, p.weight, f.pet_id, f.pet_level::int as pet_level
from public.recommendation_pool p
join public.formations f on f.id = p.formation_id
where f.pet_id is not null and f.pet_level > 18
order by p.formation_id;

create unique index recommendation_pet_pool_key on recommendation_pet_pool (formation_id);
create index recommendation_pet_pool_mode on recommendation_pet_pool (mode_id);
revoke all on recommendation_pet_pool from public, anon, authenticated;

select public.refresh_recommendation_pool();
