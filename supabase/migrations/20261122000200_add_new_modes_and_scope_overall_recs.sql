-- Add Heroes of Esperia, Temporal Rift, Hunting Fields Contract, Dragonforge Trials,
-- and Abyssal Expedition, and scope Overall recommendations to NC / CR / TS.

alter table public.game_modes
  drop constraint if exists game_modes_target_kind_check;

alter table public.game_modes
  add constraint game_modes_target_kind_check
  check (target_kind in ('boss', 'debuff', 'stage', 'none'));

alter table public.game_modes
  add column if not exists include_in_overall_recommendations boolean not null default false;

update public.game_modes
set include_in_overall_recommendations = (slug in ('nightmare-corridor', 'cursed-realm', 'treasure-scramble'));

update public.game_modes
set enabled = false
where slug in ('twisted-realm', 'arena-of-heroes', 'legends-challenger');

insert into public.game_modes (slug, name, target_kind, enabled, include_in_overall_recommendations, sort_order, config) values
  ('heroes-of-esperia', 'Heroes of Esperia', 'none', true, false, 5,
   '{"target_label":"Season","target_all":"All seasons","variable_formations":{"min":1,"max":7,"default":7},"collections_enabled":true,"merc_max_per_submission":0,"unique_heroes_across_formations":true,"allow_partial_formations":true,"rules":"Up to seven PvP teams for Heroes of Esperia. Mercenaries are not allowed and a hero can only appear once per lineup.","result_fields":[]}'),
  ('temporal-rift', 'Temporal Rift', 'none', true, false, 6,
   '{"target_label":"Season","target_all":"All seasons","variable_formations":{"min":1,"max":5,"default":5},"collections_enabled":true,"merc_max_per_submission":0,"unique_heroes_across_formations":true,"allow_partial_formations":true,"rules":"Season-long run using up to five teams. Record the floor reached and any beacon/trait enhancer notes.","result_fields":[{"key":"floor","label":"Floor reached","type":"int","placeholder":"e.g. 300"}]}'),
  ('hunting-fields-contract', 'Hunting Fields Contract', 'boss', true, false, 7,
   '{"target_label":"Contract","target_all":"All contracts","formations":[{"key":"team-1","label":"Team 1"},{"key":"team-2","label":"Team 2"}],"collections_enabled":true,"merc_max_per_submission":0,"unique_heroes_across_formations":true,"allow_partial_formations":true,"rules":"Always two teams under the active Hunting Fields Contract buff or trait restriction (e.g. No Earrings, Ranger Buff). Record per-team or total boss damage.","result_fields":[{"key":"damage","label":"Total damage","type":"damage","placeholder":"e.g. 72B"}]}'),
  ('dragonforge-trials', 'Dragonforge Trials', 'stage', false, false, 8,
   '{"target_label":"Stage","target_all":"All stages","variable_formations":{"min":1,"max":3,"default":1},"collections_enabled":true,"merc_max_per_submission":1,"unique_heroes_across_formations":true,"allow_partial_formations":true,"rules":"1 team for Trials 1-2, 2 teams (paths) for Trials 3-6, and 3 teams for Trials 7-12. Record stars earned (1-3) and Resonating Crystal level for low-RC clears.","result_fields":[{"key":"stars","label":"Stars earned","type":"select","options":[1,2,3]}]}'),
  ('abyssal-expedition', 'Abyssal Expedition', 'boss', true, false, 9,
   '{"target_label":"Boss / Phase","target_all":"All bosses","variable_formations":{"min":1,"max":6,"default":3},"collections_enabled":true,"merc_max_per_submission":0,"unique_heroes_across_formations":false,"allow_partial_formations":true,"rules":"Boss and gate compositions grouped by relic branch or phase. Heroes may repeat across competing compositions.","result_fields":[{"key":"damage","label":"Boss damage","type":"damage","placeholder":"e.g. 120B"}]}')
on conflict (slug) do update set
  name = excluded.name,
  target_kind = excluded.target_kind,
  enabled = excluded.enabled,
  include_in_overall_recommendations = excluded.include_in_overall_recommendations,
  sort_order = excluded.sort_order,
  config = excluded.config;

insert into public.targets (mode_id, slug, name)
select m.id, t.slug, t.name
from public.game_modes m
join (values
  ('heroes-of-esperia','current-season','Current Season'),
  ('temporal-rift','s16','S16'),
  ('temporal-rift','s17','S17'),
  ('hunting-fields-contract','wrizz-no-earrings','Wrizz — No Earrings'),
  ('hunting-fields-contract','adrax-no-earrings','Adrax — No Earrings'),
  ('hunting-fields-contract','adrax-ranger-buff','Adrax — Ranger Buff'),
  ('hunting-fields-contract','adrax-mage-buff','Adrax — Mage Buff'),
  ('hunting-fields-contract','adrax-tank-buff','Adrax — Tank Buff'),
  ('dragonforge-trials','trial-1','Trial 1'), ('dragonforge-trials','trial-2','Trial 2'),
  ('dragonforge-trials','trial-3','Trial 3'), ('dragonforge-trials','trial-4','Trial 4'),
  ('dragonforge-trials','trial-5','Trial 5'), ('dragonforge-trials','trial-6','Trial 6'),
  ('dragonforge-trials','trial-7','Trial 7'), ('dragonforge-trials','trial-8','Trial 8'),
  ('dragonforge-trials','trial-9','Trial 9'), ('dragonforge-trials','trial-10','Trial 10'),
  ('dragonforge-trials','trial-11','Trial 11'), ('dragonforge-trials','trial-12','Trial 12'),
  ('abyssal-expedition','s18-final-boss','S18 — Final Boss'),
  ('abyssal-expedition','s18-gate-bosses','S18 — Gate Bosses')
) as t(mode_slug, slug, name) on t.mode_slug = m.slug
on conflict (mode_id, slug) do update set name = excluded.name;

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
  submission_ids bigint[]
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
      and (
        ((params.slugs is null or cardinality(params.slugs) = 0) and m.include_in_overall_recommendations)
        or m.slug = any(params.slugs)
      )
  ),
  me as (select * from user_roster where user_id = auth.uid()),
  pool as (select p.* from recommendation_pool p join sel on sel.id = p.mode_id),
  team_counts as (
    select p.submission_id, count(distinct p.formation_id) as n from pool p group by p.submission_id
  ),
  gaps as (
    select p.submission_id, p.formation_id, p.mode_id, p.weight / sqrt(tc.n::numeric) as weight, p.hero_id,
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
    select g.hero_id, g.is_missing, g.submission_id, g.mode_id, t.gap,
           g.weight * power(params.decay, least(t.gap, params.gap_cap) - 1) as pts,
           g.si, g.furniture, g.engraving, g.ascension
    from gaps g
    join teams t on t.formation_id = g.formation_id
    cross join params
    where (g.is_missing or g.is_under)
      and exists (select 1 from me)
  ),
  rows_for_popular as (
    select p.hero_id, true as is_missing, p.submission_id, p.mode_id, 99::bigint as gap,
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
    select a.hero_id, a.mode_id, count(*) as n from all_rows a group by a.hero_id, a.mode_id
  ),
  mode_json as (
    select pm.hero_id, jsonb_object_agg(sel.slug, pm.n) as by_mode
    from per_mode pm join sel on sel.id = pm.mode_id
    group by pm.hero_id
  ),
  agg as (
    select a.hero_id, h.rec_category,
           case when bool_or(a.is_missing) then 'build' else 'invest' end as kind,
           round(sum(a.pts), 6) as score,
           (count(*) filter (where a.gap = 1))::int as complete_count,
           (count(*) filter (where a.gap > 1 and a.gap < 99))::int as near_count,
           (array_agg(a.si order by a.pts desc) filter (where a.si is not null))[1] as rec_si,
           (array_agg(a.furniture order by a.pts desc) filter (where a.furniture is not null))[1] as rec_furniture,
           (array_agg(a.engraving order by a.pts desc) filter (where a.engraving is not null))[1] as rec_engraving,
           (array_agg(a.ascension order by a.pts desc) filter (where a.ascension is not null))[1] as rec_ascension,
           mj.by_mode,
           (array_agg(distinct a.submission_id))[1:5] as submission_ids
    from all_rows a
    join heroes h on h.id = a.hero_id and h.rec_category is not null
    join mode_json mj on mj.hero_id = a.hero_id
    group by a.hero_id, h.rec_category, mj.by_mode
  ),
  limited as (
    select agg.*, (row_number() over (partition by agg.rec_category order by agg.score desc, agg.hero_id))::int as rn
    from agg
  )
  select l.hero_id, l.rec_category, l.rn, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_si, l.rec_furniture, l.rec_engraving, l.rec_ascension, l.by_mode, l.submission_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by l.rec_category, l.rn
$$;

create or replace function public.recommend_collections(p_mode_slugs text[] default null, p_limit int default 3)
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
  submission_ids bigint[]
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
      and (
        ((params.slugs is null or cardinality(params.slugs) = 0) and m.include_in_overall_recommendations)
        or m.slug = any(params.slugs)
      )
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
               and m.level_nodes >= d.level_nodes
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
    select n.catalog_id, n.submission_id, n.mode_id, n.level_nodes, n.mythic_stats, tg.gap,
           n.weight / sqrt(tc.n::numeric) * power(params.decay, least(tg.gap, params.gap_cap) - 1) as pts
    from needs n
    join team_gaps tg on tg.formation_id = n.formation_id
    join team_counts tc on tc.submission_id = n.submission_id
    cross join params
    where n.unmet
  ),
  best_build as (
    select distinct on (s.catalog_id) s.catalog_id, s.level_nodes, s.mythic_stats
    from (
      select r.catalog_id, r.level_nodes, r.mythic_stats, sum(r.pts) as total
      from rows_unmet r
      group by r.catalog_id, r.level_nodes, r.mythic_stats
    ) s
    order by s.catalog_id, s.total desc, s.level_nodes desc, s.mythic_stats
  ),
  per_mode as (
    select r.catalog_id, r.mode_id, count(*) as n from rows_unmet r group by r.catalog_id, r.mode_id
  ),
  mode_json as (
    select pm.catalog_id, jsonb_object_agg(sel.slug, pm.n) as by_mode
    from per_mode pm join sel on sel.id = pm.mode_id
    group by pm.catalog_id
  ),
  agg as (
    select r.catalog_id, cc.class,
           case when exists (select 1 from mine m where m.catalog_id = r.catalog_id) then 'upgrade' else 'build' end as kind,
           round(sum(r.pts), 6) as score,
           (count(*) filter (where r.gap = 1))::int as complete_count,
           (count(*) filter (where r.gap > 1))::int as near_count,
           bb.level_nodes as rec_level_nodes,
           bb.mythic_stats as rec_mythic_stats,
           mj.by_mode,
           (array_agg(distinct r.submission_id))[1:5] as submission_ids
    from rows_unmet r
    join collection_catalog cc on cc.id = r.catalog_id
    join best_build bb on bb.catalog_id = r.catalog_id
    join mode_json mj on mj.catalog_id = r.catalog_id
    group by r.catalog_id, cc.class, bb.level_nodes, bb.mythic_stats, mj.by_mode
  ),
  limited as (
    select agg.*, (row_number() over (partition by agg.class order by agg.score desc, agg.catalog_id))::int as rn
    from agg
  )
  select l.catalog_id::int, l.class, l.rn, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_level_nodes, l.rec_mythic_stats, l.by_mode, l.submission_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by l.class, l.rn
$$;

create or replace function public.recommend_pets(p_mode_slugs text[] default null, p_limit int default 3)
returns table (
  pet_id int,
  pet_type text,
  rank int,
  kind text,
  score numeric,
  complete_count int,
  near_count int,
  rec_level int,
  by_mode jsonb,
  submission_ids bigint[]
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
      and (
        ((params.slugs is null or cardinality(params.slugs) = 0) and m.include_in_overall_recommendations)
        or m.slug = any(params.slugs)
      )
  ),
  me as (select * from user_roster where user_id = auth.uid()),
  my_pets as (select * from user_pet_roster where user_id = auth.uid()),
  pool as (select p.* from recommendation_pool p join sel on sel.id = p.mode_id),
  demand as (select d.* from recommendation_pet_pool d join sel on sel.id = d.mode_id),
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
  rows_unmet as (
    select d.pet_id, d.submission_id, d.mode_id, d.pet_level, 1 + coalesce(hg.gap, 0) as gap,
           d.weight / sqrt(tc.n::numeric)
             * power(params.decay, least(1 + coalesce(hg.gap, 0), params.gap_cap) - 1) as pts
    from demand d
    left join hero_gaps hg on hg.formation_id = d.formation_id
    join team_counts tc on tc.submission_id = d.submission_id
    cross join params
    where not exists (select 1 from my_pets mp where mp.pet_id = d.pet_id and mp.level >= d.pet_level)
  ),
  best_level as (
    select distinct on (s.pet_id) s.pet_id, s.pet_level
    from (
      select r.pet_id, r.pet_level, sum(r.pts) as total
      from rows_unmet r
      group by r.pet_id, r.pet_level
    ) s
    order by s.pet_id, s.total desc, s.pet_level desc
  ),
  per_mode as (
    select r.pet_id, r.mode_id, count(*) as n from rows_unmet r group by r.pet_id, r.mode_id
  ),
  mode_json as (
    select pm.pet_id, jsonb_object_agg(sel.slug, pm.n) as by_mode
    from per_mode pm join sel on sel.id = pm.mode_id
    group by pm.pet_id
  ),
  agg as (
    select r.pet_id, pt.pet_type,
           case when exists (select 1 from my_pets mp where mp.pet_id = r.pet_id) then 'upgrade' else 'build' end as kind,
           round(sum(r.pts), 6) as score,
           (count(*) filter (where r.gap = 1))::int as complete_count,
           (count(*) filter (where r.gap > 1))::int as near_count,
           bl.pet_level as rec_level,
           mj.by_mode,
           (array_agg(distinct r.submission_id))[1:5] as submission_ids
    from rows_unmet r
    join pets pt on pt.id = r.pet_id
    join best_level bl on bl.pet_id = r.pet_id
    join mode_json mj on mj.pet_id = r.pet_id
    group by r.pet_id, pt.pet_type, bl.pet_level, mj.by_mode
  ),
  limited as (
    select agg.*, (row_number() over (partition by agg.pet_type order by agg.score desc, agg.pet_id))::int as rn
    from agg
  )
  select l.pet_id::int, l.pet_type, l.rn, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_level, l.by_mode, l.submission_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by l.pet_type, l.rn
$$;
