-- Per-event normalization, recency decay, multi-mode breadth bonus, and rotation coverage in recommendations:
-- 1. Recency decay (45-day half-life) keeps recent meta guides fresher than older ones.
-- 2. Recurring-event modes (CR bosses, TS debuffs, HFC contracts) split each mode's 100-unit
--    budget equally across distinct events so high-volume targets do not drown out rarer ones.
--    NC (cycle-based) uses recency decay across its 6 active boss rounds normalized to 100.
-- 3. Thresholded multi-mode breadth bonus (+15% per additional active mode with >=10% of that
--    mode's top hero score) rewards true cross-mode versatility without inflating fringe subs.
-- 4. recommend_builds returns by_mode_events jsonb ({ slug: { used, total } }) for rotation badges.

insert into public.recommendation_settings (key, value, note) values
  ('recency_half_life_days', 45.0, 'Half-life in days for recency decay on submissions in recommendation_pool'),
  ('mode_breadth_bonus', 0.15, 'Score multiplier added per additional active mode (1 + bonus * (active_modes - 1))'),
  ('mode_breadth_min_share', 0.10, 'Minimum fraction of top hero score in a mode to count as an active mode for breadth bonus')
on conflict (key) do nothing;

drop materialized view if exists recommendation_pet_pool;
drop materialized view if exists recommendation_collection_pool;
drop materialized view if exists recommendation_pool;

create materialized view recommendation_pool as
with base as (
  select s.id as submission_id, s.mode_id, m.slug as mode_slug, s.target_id, s.upvotes, s.created_at,
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
         )::numeric as sub_result_score,
         power(
           0.5::numeric,
           greatest(0::numeric, extract(epoch from (now() - b.created_at)) / 86400.0)
             / greatest(1.0::numeric, public.rec_setting('recency_half_life_days', 45.0))
         ) as recency_factor
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
  select r.submission_id, r.mode_id, r.mode_slug, r.target_id, r.upvote_score, r.sub_result_score,
         r.recency_factor,
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
         case
           when fb.mode_slug = 'nightmare-corridor' then fb.base_slot_key
           else fb.target_id::text
         end as event_key,
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
  select fs.submission_id, fs.formation_id, fs.mode_id, fs.mode_slug, fs.target_id, fs.event_key,
         (
           public.rec_setting('weight_floor', 0.05)
           + (1 - public.rec_setting('weight_floor', 0.05))
             * (
                 public.rec_setting('upvote_weight', 0.65) * fs.upvote_score
                 + public.rec_setting('result_weight', 0.35) * ((fs.sub_result_score + fs.round_result_score) / 2.0)
               )
             / nullif(public.rec_setting('upvote_weight', 0.65) + public.rec_setting('result_weight', 0.35), 0)
         )
         * fs.recency_factor
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
mode_event_counts as (
  select mode_id, count(distinct event_key)::numeric as event_count
  from forms_weighted
  group by mode_id
),
forms_normalized as (
  select fw.submission_id, fw.formation_id, fw.mode_id, fw.target_id, fw.event_key,
         round(
           case
             -- NC rotates historical cycle anchors; normalize across the mode using recency-decayed weights
             when fw.mode_slug = 'nightmare-corridor' then
               fw.raw_weight * 100.0 / nullif(sum(fw.raw_weight) over (partition by fw.mode_id), 0)
             -- CR bosses, TS debuffs, HFC contracts recur equally: give every distinct event an equal share of 100
             else
               (fw.raw_weight / nullif(sum(fw.raw_weight) over (partition by fw.mode_id, fw.event_key), 0))
               * (100.0 / greatest(1.0, mec.event_count))
           end,
           6
         ) as weight
  from forms_weighted fw
  join mode_event_counts mec on mec.mode_id = fw.mode_id
)
select fn.submission_id, fn.formation_id, fn.mode_id, fn.target_id, fn.event_key, fn.weight,
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

drop function if exists public.recommend_builds(text[], int);

create or replace function public.recommend_builds(p_mode_slugs text[] default null, p_limit int default 3)
returns table (
  hero_id int,
  category text,
  rank int,
  kind text,
  score numeric,
  complete_count int,
  near_count int,
  rec_si smallint,
  rec_furniture smallint,
  rec_engraving smallint,
  rec_ascension text,
  by_mode jsonb,
  by_mode_events jsonb,
  submission_ids bigint[]
)
language sql stable security definer set search_path = public as $$
  with params as (
    select coalesce(p_mode_slugs, (select recommendation_modes from profiles where id = auth.uid())) as slugs,
           public.rec_setting('near_miss_decay', 0.4) as decay,
           public.rec_setting('gap_cap', 8) as gap_cap,
           public.rec_setting('cost_weight_exponent', 0.50) as cost_exp,
           public.rec_setting('cost_smoothing_k', 30.0) as cost_smooth,
           public.rec_setting('cost_reference_k', 200.0) as cost_ref,
           public.rec_setting('cost_red_emblem_k', 0.120) as red_k,
           public.rec_setting('cost_epic_emblem_k', 0.152) as epic_k,
           public.rec_setting('mode_breadth_bonus', 0.15) as breadth_bonus,
           public.rec_setting('mode_breadth_min_share', 0.10) as breadth_min_share
  ),
  sel as (
    select m.id, m.slug
    from game_modes m, params
    where m.enabled
      and (
        ((params.slugs is null or cardinality(params.slugs) = 0) and m.include_in_overall_recommendations)
        or m.slug = any(params.slugs)
      )
  ),
  me as (select * from user_roster where user_id = auth.uid()),
  pool as (select p.* from recommendation_pool p join sel on sel.id = p.mode_id),
  mode_totals as (
    select p.mode_id,
           sel.slug,
           case
             when sel.slug = 'nightmare-corridor' then least(6, count(distinct p.event_key))::int
             else count(distinct p.event_key)::int
           end as total_events
    from pool p
    join sel on sel.id = p.mode_id
    group by p.mode_id, sel.slug
  ),
  team_counts as (
    select p.submission_id, count(distinct p.formation_id) as n from pool p group by p.submission_id
  ),
  gaps as (
    select p.submission_id, p.formation_id, p.mode_id, p.event_key,
           p.weight / sqrt(tc.n::numeric) as weight, p.hero_id,
           p.si, p.furniture, p.engraving, p.ascension,
           r.hero_id is null as is_missing,
           (r.hero_id is not null and (
              (p.si is not null and r.si is not null and r.si < p.si)
              or (p.furniture is not null and r.furniture is not null and r.furniture < p.furniture)
              or (p.engraving is not null and r.engraving is not null and r.engraving < p.engraving)
              or (p.ascension is not null and r.ascension is not null
                  and public.ascension_rank(r.ascension) < public.ascension_rank(p.ascension))
           )) as is_under
    from pool p
    join team_counts tc on tc.submission_id = p.submission_id
    left join me r on r.hero_id = p.hero_id
  ),
  teams as (
    select g.formation_id,
           count(*) filter (where g.is_missing or g.is_under) as gap
    from gaps g
    group by g.formation_id
  ),
  rows_for_roster as (
    select g.hero_id, g.is_missing, g.submission_id, g.mode_id, g.event_key, t.gap,
           g.weight * power(params.decay, least(t.gap, params.gap_cap) - 1) as pts,
           g.si, g.furniture, g.engraving, g.ascension
    from gaps g
    join teams t on t.formation_id = g.formation_id
    cross join params
    where (g.is_missing or g.is_under)
      and exists (select 1 from me)
  ),
  rows_for_popular as (
    select p.hero_id, true as is_missing, p.submission_id, p.mode_id, p.event_key, 99::bigint as gap,
           p.weight / sqrt(tc.n::numeric) as pts, p.si, p.furniture, p.engraving, p.ascension
    from pool p
    join team_counts tc on tc.submission_id = p.submission_id
    where not exists (select 1 from me)
  ),
  all_rows as (
    select * from rows_for_roster
    union all
    select * from rows_for_popular
  ),
  per_mode as (
    select a.hero_id, a.mode_id,
           count(*)::int as n,
           sum(a.pts) as mode_pts,
           count(distinct a.event_key)::int as used_events
    from all_rows a
    group by a.hero_id, a.mode_id
  ),
  per_mode_ranked as (
    select pm.*,
           max(pm.mode_pts) over (partition by pm.mode_id) as max_mode_pts
    from per_mode pm
  ),
  hero_breadth as (
    select pmr.hero_id,
           count(*) filter (
             where pmr.max_mode_pts > 0
               and pmr.mode_pts >= pmr.max_mode_pts * params.breadth_min_share
           )::int as active_modes
    from per_mode_ranked pmr
    cross join params
    group by pmr.hero_id
  ),
  mode_json as (
    select pm.hero_id,
           jsonb_object_agg(mt.slug, pm.n) as by_mode,
           jsonb_object_agg(
             mt.slug,
             jsonb_build_object(
               'used', least(pm.used_events, mt.total_events),
               'total', mt.total_events
             )
           ) as by_mode_events
    from per_mode pm
    join mode_totals mt on mt.mode_id = pm.mode_id
    group by pm.hero_id
  ),
  agg_raw as (
    select a.hero_id, h.rec_category,
           case when bool_or(a.is_missing) then 'build' else 'invest' end as kind,
           sum(a.pts) * (1.0 + params.breadth_bonus * greatest(0, coalesce(hb.active_modes, 1) - 1)) as raw_score,
           (count(*) filter (where a.gap = 1))::int as complete_count,
           (count(*) filter (where a.gap > 1 and a.gap < 99))::int as near_count,
           (array_agg(a.si order by a.pts desc) filter (where a.si is not null))[1] as rec_si,
           (array_agg(a.furniture order by a.pts desc) filter (where a.furniture is not null))[1] as rec_furniture,
           (array_agg(a.engraving order by a.pts desc) filter (where a.engraving is not null))[1] as rec_engraving,
           (array_agg(a.ascension order by a.pts desc) filter (where a.ascension is not null))[1] as raw_rec_ascension,
           mj.by_mode,
           mj.by_mode_events,
           (array_agg(distinct a.submission_id))[1:5] as submission_ids
    from all_rows a
    join heroes h on h.id = a.hero_id and h.rec_category is not null
    join mode_json mj on mj.hero_id = a.hero_id
    left join hero_breadth hb on hb.hero_id = a.hero_id
    cross join params
    group by a.hero_id, h.rec_category, mj.by_mode, mj.by_mode_events, hb.active_modes, params.breadth_bonus
  ),
  agg_clamped as (
    select ar.*,
           case
             when ar.raw_rec_ascension is null then
               case
                 when coalesce(ar.rec_engraving, 0) > 0 then 'ascended_1'
                 when coalesce(ar.rec_furniture, 0) > 0 then 'ascended'
                 when coalesce(ar.rec_si, 0) > 0 then 'mythic'
                 else null
               end
             when coalesce(ar.rec_engraving, 0) > 0
                  and public.ascension_rank(ar.raw_rec_ascension) < public.ascension_rank('ascended_1')
               then 'ascended_1'
             when coalesce(ar.rec_furniture, 0) > 0
                  and public.ascension_rank(ar.raw_rec_ascension) < public.ascension_rank('ascended')
               then 'ascended'
             when coalesce(ar.rec_si, 0) > 0
                  and public.ascension_rank(ar.raw_rec_ascension) < public.ascension_rank('mythic')
               then 'mythic'
             else ar.raw_rec_ascension
           end as rec_ascension
    from agg_raw ar
  ),
  agg as (
    select ac.hero_id, ac.rec_category, ac.kind,
           round(
             case
               when exists (select 1 from me) and params.cost_exp > 0 then
                 ac.raw_score * power(
                   (params.cost_ref + params.cost_smooth)
                   / (
                     public.hero_upgrade_cost_k(
                       ac.rec_category,
                       r.ascension, r.si, r.furniture, r.engraving,
                       ac.rec_ascension, ac.rec_si, ac.rec_furniture, ac.rec_engraving,
                       params.red_k, params.epic_k
                     ) + params.cost_smooth
                   ),
                   params.cost_exp
                 )
               else ac.raw_score
             end,
             6
           ) as score,
           ac.complete_count, ac.near_count,
           ac.rec_si, ac.rec_furniture, ac.rec_engraving,
           case when ac.raw_rec_ascension is null then null else ac.rec_ascension end as rec_ascension,
           ac.by_mode, ac.by_mode_events, ac.submission_ids
    from agg_clamped ac
    left join me r on r.hero_id = ac.hero_id
    cross join params
  ),
  limited as (
    select agg.*, (row_number() over (partition by agg.rec_category order by agg.score desc, agg.hero_id))::int as rn
    from agg
  )
  select l.hero_id, l.rec_category, l.rn, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_si, l.rec_furniture, l.rec_engraving, l.rec_ascension, l.by_mode, l.by_mode_events, l.submission_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by l.rec_category, l.rn
$$;

revoke all on function public.recommend_builds(text[], int) from public, anon;
grant execute on function public.recommend_builds(text[], int) to authenticated;

select public.refresh_recommendation_pool();
