-- Per-round CR damage / NC kill-time scoring and weighted substitute formations in recommendations.
-- 1. Add is_substitute + parent_slot_key to formations (substitutes stay hidden from primary lineup cards
--    but contribute discounted, performance-scaled weight to recommendation_pool).
-- 2. Score each formation in recommendation_pool using per-round result_damage / result_time_seconds
--    (blended with submission-level score) and discount substitute formations by:
--      substitute_weight (default 0.40) * (sub_perf / primary_perf) / sqrt(sub_count_for_round).

alter table public.formations
  add column if not exists is_substitute boolean not null default false,
  add column if not exists parent_slot_key text;

create index if not exists formations_sub_parent_idx
  on public.formations (submission_id, is_substitute, parent_slot_key);

insert into public.recommendation_settings (key, value)
values ('substitute_weight', 0.40)
on conflict (key) do nothing;

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
           greatest(0, 1 - (b.placement - 1) / 99),
           min(b.total_time) over w / nullif(b.total_time, 0),
           0.5
         )::numeric as sub_result_score
  from base b
  window w as (partition by b.mode_id, b.target_id)
),
ranked as (
  select sc.*,
         (
           public.rec_setting('weight_floor', 0.05)
           + (1 - public.rec_setting('weight_floor', 0.05))
             * (public.rec_setting('upvote_weight', 0.65) * sc.upvote_score
                + public.rec_setting('result_weight', 0.35) * sc.sub_result_score)
             / nullif(public.rec_setting('upvote_weight', 0.65) + public.rec_setting('result_weight', 0.35), 0)
         ) as sub_weight,
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
         round(
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
             end,
           6
         ) as weight
  from forms_scored fs
)
select fw.submission_id, fw.formation_id, fw.mode_id, fw.target_id, fw.weight,
       fh.hero_id, fh.si, fh.furniture, fh.engraving, fh.ascension
from forms_weighted fw
join public.formation_heroes fh on fh.formation_id = fw.formation_id and not fh.is_merc
with data;

create unique index recommendation_pool_key on recommendation_pool (formation_id, hero_id);
create index recommendation_pool_mode on recommendation_pool (mode_id);
revoke all on recommendation_pool from public, anon, authenticated;

create materialized view recommendation_collection_pool as
select p.submission_id, p.formation_id, p.hero_id, p.mode_id, p.weight, fc.catalog_id,
       (count(*) filter (where n.value ->> 'stat' = 'skill_level'))::int as level_nodes,
       coalesce(
         array_agg(n.value ->> 'stat' order by n.value ->> 'stat')
           filter (where n.value ->> 'tier' = 'mythic' and n.value ->> 'stat' <> 'skill_level'),
         '{}'::text[]
       ) as mythic_stats
from public.recommendation_pool p
join public.formation_collections fc
  on fc.formation_id = p.formation_id and fc.hero_id = p.hero_id and fc.catalog_id is not null
left join lateral jsonb_array_elements(fc.nodes) as n(value) on true
group by p.submission_id, p.formation_id, p.hero_id, p.mode_id, p.weight, fc.catalog_id;

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
