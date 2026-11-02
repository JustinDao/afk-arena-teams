-- Recommendations are now grouped into five hero categories, and each category always gets a
-- "best next step" (build a new hero or upgrade one you own, scored on the same measure).
-- The category lives on heroes.rec_category so it can be edited by hand, for example:
--   update heroes set rec_category = 'dragon-highborn' where slug in ('hildwin', ...);

alter table heroes add column if not exists rec_category text
  check (rec_category in ('standard-4f', 'cele-hypo', 'awakened', 'drago-lite', 'dragon-highborn'));

-- Defaults only fill heroes that have no category yet, so manual edits survive a re-run.
update heroes set rec_category = case
  when is_awakened then 'awakened'
  when faction in ('Lightbearer', 'Mauler', 'Wilder', 'Graveborn') then 'standard-4f'
  when faction in ('Celestial', 'Hypogean') then 'cele-hypo'
  when faction = 'Draconis' and rarity = 'legendary' then 'dragon-highborn'
  when faction = 'Draconis' then 'drago-lite'
end
where rec_category is null;

-- No hard cutoff any more: a team further from completion just counts for less, which keeps
-- every category populated. gap_cap stops very large gaps from rounding to zero.
delete from recommendation_settings where key = 'max_gap';
insert into recommendation_settings (key, value, note) values
  ('gap_cap', 8, 'Teams needing more heroes than this count as if they needed this many.')
on conflict (key) do nothing;

drop function if exists public.recommend_builds(text[], int);
create function public.recommend_builds(p_mode_slugs text[] default null, p_limit int default 3)
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
      and (params.slugs is null or cardinality(params.slugs) = 0 or m.slug = any(params.slugs))
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
revoke all on function public.recommend_builds(text[], int) from public, anon;
grant execute on function public.recommend_builds(text[], int) to authenticated;
