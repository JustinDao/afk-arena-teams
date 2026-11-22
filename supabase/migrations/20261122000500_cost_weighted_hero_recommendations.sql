-- Cost-weighted (ROI) hero recommendations.
-- Weights each hero's raw lineup-impact score by the estimated resource cost
-- (in thousands of event-parity diamond equivalents) required to move from the
-- user's current roster state to the recommended target investment/ascension.
--
-- Formula:
--   weighted_score = raw_score * ((R + C) / (delta_cost_k + C)) ^ alpha
-- where:
--   delta_cost_k = ascension copy cost + SI cost (optimal Red/Epic mix for 31..40)
--                  + furniture cost + engraving cost
--   R = cost_reference_k (default 200.0)
--   C = cost_smoothing_k (default 30.0)
--   alpha = cost_weight_exponent (default 0.50; set 0 to disable)

insert into public.recommendation_settings (key, value, note) values
  ('cost_weight_exponent', 0.50, 'Damping exponent for ROI cost weighting (0 disables cost weighting)'),
  ('cost_smoothing_k', 30.0, 'Smoothing floor (in k diamonds) so tiny upgrades do not dominate'),
  ('cost_reference_k', 200.0, 'Reference build cost (in k diamonds) for score normalization'),
  ('cost_red_emblem_k', 0.120, 'Event-parity diamond value (in k) per Red Faction Emblem'),
  ('cost_epic_emblem_k', 0.152, 'Event-parity diamond value (in k) per Epic Faction Emblem'),
  ('cost_copy_4f_k', 6.5, 'Effective cost (in k) per standard 4F copy (HCP / wishlist)'),
  ('cost_copy_drago_lite_k', 18.0, 'Effective cost (in k) per standard Draconis copy (Dragonforge)'),
  ('cost_copy_cele_hypo_k', 21.5, 'Effective cost (in k) per Celestial/Hypogean copy (Stargazer)'),
  ('cost_copy_awakened_te_k', 32.0, 'Effective cost (in k) per Awakened Time Emblem copy (time-gated ~1.5x SG)'),
  ('cost_copy_highborn_k', 90.0, 'Effective cost (in k) per Highborn Dragon Insignia copy (~30-40 DI/mo scarcity)')
on conflict (key) do nothing;

-- Cumulative Signature Item cost (in thousands of diamond equivalents) from 0 to p_level.
-- Levels 31..40 choose the cheaper of Red vs Epic emblems at each individual level.
create or replace function public.si_cumulative_cost_k(
  p_level int,
  p_red_k numeric default 0.120,
  p_epic_k numeric default 0.152
) returns numeric
language sql immutable as $$
  with lvl as (
    select greatest(0, least(coalesce(p_level, 0), 50)) as n
  ),
  si21_30 as (
    select sum(v)::numeric * p_red_k as cost
    from unnest(array[10, 20, 20, 20, 30, 30, 30, 40, 50, 50]) with ordinality as t(v, i), lvl
    where i <= greatest(0, least(lvl.n - 20, 10))
  ),
  si31_40 as (
    select sum(least(r * p_red_k, e * p_epic_k)) as cost
    from unnest(
      array[40, 45, 50, 60, 70, 80, 90, 100, 125, 160],
      array[30, 40, 50, 55, 60, 65, 70,  80,  90, 110]
    ) with ordinality as t(r, e, i), lvl
    where i <= greatest(0, least(lvl.n - 30, 10))
  ),
  si41_50 as (
    select sum(v)::numeric * p_epic_k as cost
    from unnest(array[50, 60, 70, 80, 120, 140, 180, 200, 220, 240]) with ordinality as t(v, i), lvl
    where i <= greatest(0, least(lvl.n - 40, 10))
  )
  select
    least(lvl.n, 10) * 0.15
    + greatest(0, least(lvl.n - 10, 10)) * 0.35
    + coalesce((select cost from si21_30), 0)
    + coalesce((select cost from si31_40), 0)
    + coalesce((select cost from si41_50), 0)
  from lvl
$$;

-- Cumulative ascension copy cost (in thousands of diamond equivalents) for a hero category & rank.
create or replace function public.ascension_cumulative_cost_k(
  p_category text,
  p_ascension text
) returns numeric
language sql stable as $$
  with r as (
    select coalesce(public.ascension_rank(p_ascension), 0) as rk
  ),
  copies as (
    select
      case
        when r.rk <= 0 then 0
        when p_category in ('standard-4f', 'drago-lite') then
          (array[1, 2, 2, 4, 4, 4, 8, 10, 12, 14, 16, 18])[r.rk]
        when p_category = 'cele-hypo' then
          (array[1, 2, 4, 6, 8, 10, 14, 16, 18, 20, 22, 24])[r.rk]
        when p_category in ('awakened', 'dragon-highborn') then
          (array[0, 0, 1, 3, 6, 9, 12, 15, 18, 21, 24, 27])[r.rk]
        else
          (array[1, 2, 2, 4, 4, 4, 8, 10, 12, 14, 16, 18])[r.rk]
      end as n
    from r
  )
  select
    case p_category
      when 'standard-4f'     then copies.n * public.rec_setting('cost_copy_4f_k', 6.5)
      when 'drago-lite'      then copies.n * public.rec_setting('cost_copy_drago_lite_k', 18.0)
      when 'cele-hypo'       then copies.n * public.rec_setting('cost_copy_cele_hypo_k', 21.5)
      -- Awakened: first 12 copies via Time Emblems, stars (>12) via Stargazer
      when 'awakened'        then least(copies.n, 12) * public.rec_setting('cost_copy_awakened_te_k', 32.0)
                                + greatest(copies.n - 12, 0) * public.rec_setting('cost_copy_cele_hypo_k', 21.5)
      -- Highborn: all copies (including stars) require heavily time-gated Dragon Insignias
      when 'dragon-highborn' then copies.n * public.rec_setting('cost_copy_highborn_k', 90.0)
      else copies.n * public.rec_setting('cost_copy_4f_k', 6.5)
    end
  from copies
$$;

-- Estimated delta resource cost (in thousands of diamond equivalents) to move a hero
-- from current roster state to recommended target state.
create or replace function public.hero_upgrade_cost_k(
  p_category text,
  p_cur_asc text,
  p_cur_si int,
  p_cur_furn int,
  p_cur_eng int,
  p_tgt_asc text,
  p_tgt_si int,
  p_tgt_furn int,
  p_tgt_eng int,
  p_red_k numeric default 0.120,
  p_epic_k numeric default 0.152
) returns numeric
language sql stable as $$
  with vals as (
    select
      coalesce(p_cur_si, 0) as cur_si,
      coalesce(p_cur_furn, 0) as cur_f,
      coalesce(p_cur_eng, 0) as cur_e,
      greatest(coalesce(p_cur_si, 0), coalesce(p_tgt_si, 0)) as tgt_si,
      greatest(coalesce(p_cur_furn, 0), coalesce(p_tgt_furn, 0)) as tgt_f,
      greatest(coalesce(p_cur_eng, 0), coalesce(p_tgt_eng, 0)) as tgt_e
  ),
  furn as (
    select
      (least(tgt_f, 3) * 2.5 + greatest(0, least(tgt_f - 3, 6)) * 3.0 + greatest(0, tgt_f - 9) * 3.5)
      - (least(cur_f, 3) * 2.5 + greatest(0, least(cur_f - 3, 6)) * 3.0 + greatest(0, cur_f - 9) * 3.5) as cost
    from vals
  ),
  eng as (
    select
      (least(tgt_e, 30) * 0.3125 + greatest(0, least(tgt_e - 30, 30)) * 1.8 + greatest(0, least(tgt_e - 60, 20)) * 3.6 + greatest(0, tgt_e - 80) * 5.4)
      - (least(cur_e, 30) * 0.3125 + greatest(0, least(cur_e - 30, 30)) * 1.8 + greatest(0, least(cur_e - 60, 20)) * 3.6 + greatest(0, cur_e - 80) * 5.4) as cost
    from vals
  )
  select round(
    greatest(0::numeric,
      public.ascension_cumulative_cost_k(p_category, p_tgt_asc)
      - public.ascension_cumulative_cost_k(p_category, p_cur_asc)
    )
    + greatest(0::numeric,
      public.si_cumulative_cost_k(vals.tgt_si, p_red_k, p_epic_k)
      - public.si_cumulative_cost_k(vals.cur_si, p_red_k, p_epic_k)
    )
    + greatest(0::numeric, furn.cost)
    + greatest(0::numeric, eng.cost),
    3
  )
  from vals, furn, eng
$$;

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
           public.rec_setting('gap_cap', 8) as gap_cap,
           public.rec_setting('cost_weight_exponent', 0.50) as cost_exp,
           public.rec_setting('cost_smoothing_k', 30.0) as cost_smooth,
           public.rec_setting('cost_reference_k', 200.0) as cost_ref,
           public.rec_setting('cost_red_emblem_k', 0.120) as red_k,
           public.rec_setting('cost_epic_emblem_k', 0.152) as epic_k
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
  agg_raw as (
    select a.hero_id, h.rec_category,
           case when bool_or(a.is_missing) then 'build' else 'invest' end as kind,
           sum(a.pts) as raw_score,
           (count(*) filter (where a.gap = 1))::int as complete_count,
           (count(*) filter (where a.gap > 1 and a.gap < 99))::int as near_count,
           (array_agg(a.si order by a.pts desc) filter (where a.si is not null))[1] as rec_si,
           (array_agg(a.furniture order by a.pts desc) filter (where a.furniture is not null))[1] as rec_furniture,
           (array_agg(a.engraving order by a.pts desc) filter (where a.engraving is not null))[1] as rec_engraving,
           (array_agg(a.ascension order by a.pts desc) filter (where a.ascension is not null))[1] as raw_rec_ascension,
           mj.by_mode,
           (array_agg(distinct a.submission_id))[1:5] as submission_ids
    from all_rows a
    join heroes h on h.id = a.hero_id and h.rec_category is not null
    join mode_json mj on mj.hero_id = a.hero_id
    group by a.hero_id, h.rec_category, mj.by_mode
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
           ac.by_mode, ac.submission_ids
    from agg_clamped ac
    left join me r on r.hero_id = ac.hero_id
    cross join params
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

revoke all on function public.si_cumulative_cost_k(int, numeric, numeric) from public, anon;
grant execute on function public.si_cumulative_cost_k(int, numeric, numeric) to authenticated;

revoke all on function public.ascension_cumulative_cost_k(text, text) from public, anon;
grant execute on function public.ascension_cumulative_cost_k(text, text) to authenticated;

revoke all on function public.hero_upgrade_cost_k(text, text, int, int, int, text, int, int, int, numeric, numeric) from public, anon;
grant execute on function public.hero_upgrade_cost_k(text, text, int, int, int, text, int, int, int, numeric, numeric) to authenticated;

revoke all on function public.recommend_builds(text[], int) from public, anon;
grant execute on function public.recommend_builds(text[], int) to authenticated;

select public.refresh_recommendation_pool();
