-- Recommended next hero to build / invest in.
--
-- Design: a nightly-refreshed materialized view (recommendation_pool) holds the top lineups per
-- mode + target with a weight (upvotes weighted above results). recommend_builds() compares that
-- small pool against the signed-in user's roster, so per-user cost does not grow with total
-- submissions or user count.

alter table profiles add column if not exists recommendation_modes text[];

-- Tunable weights, editable by hand like the rest of the reference data.
create table if not exists recommendation_settings (
  key   text primary key,
  value numeric not null,
  note  text
);
insert into recommendation_settings (key, value, note) values
  ('upvote_weight',        0.65, 'Share of a lineup weight that comes from upvotes (log-scaled within its mode/target).'),
  ('result_weight',        0.35, 'Share that comes from the result: damage vs best, placement, or NC kill time vs fastest.'),
  ('weight_floor',         0.05, 'Minimum weight so lineups without votes or results still count a little.'),
  ('near_miss_decay',      0.40, 'Each extra missing hero or under-invested hero multiplies a lineup contribution by this.'),
  ('max_gap',              3,    'Ignore lineups needing more than this many heroes built or upgraded.'),
  ('pool_size_per_target', 100,  'Top lineups kept per mode + target in the nightly pool.')
on conflict (key) do nothing;

create table if not exists recommendation_meta (
  id           boolean primary key default true check (id),
  refreshed_at timestamptz
);
insert into recommendation_meta (id, refreshed_at) values (true, null) on conflict (id) do nothing;

alter table recommendation_settings enable row level security;
alter table recommendation_meta enable row level security;
drop policy if exists read_all on recommendation_settings;
drop policy if exists read_all on recommendation_meta;
create policy read_all on recommendation_settings for select using (true);
create policy read_all on recommendation_meta for select using (true);

create or replace function public.rec_setting(p_key text, p_default numeric) returns numeric
language sql stable set search_path = public as $$
  select coalesce((select value from recommendation_settings where key = p_key), p_default)
$$;

create or replace function public.ascension_rank(p_value text) returns int
language sql immutable as $$
  select array_position(
    array['epic','legendary','mythic','ascended','ascended_1','ascended_2','ascended_3','ascended_4','ascended_5'],
    p_value)
$$;

drop materialized view if exists recommendation_pool;
create materialized view recommendation_pool as
with base as (
  select s.id as submission_id, s.mode_id, s.target_id, s.upvotes,
         nullif(s.result ->> 'damage', '')::numeric as damage,
         nullif(s.result ->> 'placement', '')::numeric as placement,
         (select sum(f.result_time_seconds) from public.formations f where f.submission_id = s.id) as total_time
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
         )::numeric as result_score
  from base b
  window w as (partition by b.mode_id, b.target_id)
),
weighted as (
  select sc.*,
         public.rec_setting('weight_floor', 0.05)
           + (1 - public.rec_setting('weight_floor', 0.05))
             * (public.rec_setting('upvote_weight', 0.65) * sc.upvote_score + public.rec_setting('result_weight', 0.35) * sc.result_score)
             / nullif(public.rec_setting('upvote_weight', 0.65) + public.rec_setting('result_weight', 0.35), 0) as weight
  from scored sc
),
ranked as (
  select w.*,
         row_number() over (partition by w.mode_id, w.target_id order by w.weight desc, w.upvotes desc, w.submission_id) as rn
  from weighted w
)
select r.submission_id, r.mode_id, r.target_id, round(r.weight, 6) as weight,
       fh.hero_id,
       max(fh.si) as si,
       max(fh.furniture) as furniture,
       max(fh.engraving) as engraving,
       (array_agg(fh.ascension order by public.ascension_rank(fh.ascension) desc nulls last))[1] as ascension
from ranked r
join public.formation_heroes fh on fh.submission_id = r.submission_id and not fh.is_merc
where r.rn <= public.rec_setting('pool_size_per_target', 100)
group by r.submission_id, r.mode_id, r.target_id, r.weight, fh.hero_id
with data;

create unique index recommendation_pool_key on recommendation_pool (submission_id, hero_id);
create index recommendation_pool_mode on recommendation_pool (mode_id);
revoke all on recommendation_pool from public, anon, authenticated;

create or replace function public.refresh_recommendation_pool() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently recommendation_pool;
  update recommendation_meta set refreshed_at = now() where id;
end;
$$;
revoke all on function public.refresh_recommendation_pool() from public, anon, authenticated;

select public.refresh_recommendation_pool();

-- Nightly refresh at 10:00 UTC. Skipped with a notice if pg_cron cannot be enabled; in that case
-- run `select public.refresh_recommendation_pool();` on whatever schedule you prefer.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('refresh-recommendation-pool', '0 10 * * *', 'select public.refresh_recommendation_pool()');
exception when others then
  raise notice 'pg_cron not scheduled (%). Refresh recommendation_pool manually.', sqlerrm;
end;
$$;

create or replace function public.set_recommendation_modes(p_slugs text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your recommendation modes.';
  end if;
  update profiles
  set recommendation_modes = case
    when p_slugs is null or cardinality(p_slugs) = 0 then null
    else (select array_agg(m.slug order by m.sort_order) from game_modes m where m.slug = any(p_slugs))
  end
  where id = v_user;
end;
$$;
revoke all on function public.set_recommendation_modes(text[]) from public, anon;
grant execute on function public.set_recommendation_modes(text[]) to authenticated;

-- p_mode_slugs null = use the profile's saved modes (null/empty = every enabled mode).
-- Returns up to p_limit heroes to build ('build') and p_limit heroes to invest in ('invest').
-- Users with an empty hero roster get the most popular pool heroes instead.
create or replace function public.recommend_builds(p_mode_slugs text[] default null, p_limit int default 12)
returns table (
  hero_id int,
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
           public.rec_setting('max_gap', 3) as max_gap
  ),
  sel as (
    select m.id, m.slug
    from game_modes m, params
    where m.enabled
      and (params.slugs is null or cardinality(params.slugs) = 0 or m.slug = any(params.slugs))
  ),
  me as (select * from user_roster where user_id = auth.uid()),
  pool as (select p.* from recommendation_pool p join sel on sel.id = p.mode_id),
  gaps as (
    select p.submission_id, p.mode_id, p.weight, p.hero_id, p.si, p.furniture, p.engraving, p.ascension,
           r.hero_id is null as is_missing,
           (r.hero_id is not null and (
              (p.si is not null and r.si is not null and r.si < p.si)
              or (p.furniture is not null and r.furniture is not null and r.furniture < p.furniture)
              or (p.engraving is not null and r.engraving is not null and r.engraving < p.engraving)
              or (p.ascension is not null and r.ascension is not null
                  and public.ascension_rank(r.ascension) < public.ascension_rank(p.ascension))
           )) as is_under
    from pool p
    left join me r on r.hero_id = p.hero_id
  ),
  lineups as (
    select g.submission_id,
           count(*) filter (where g.is_missing or g.is_under) as gap
    from gaps g
    group by g.submission_id
  ),
  rows_for_roster as (
    select g.hero_id, g.is_missing, g.submission_id, g.mode_id, l.gap,
           g.weight * power(params.decay, l.gap - 1) as pts,
           g.si, g.furniture, g.engraving, g.ascension
    from gaps g
    join lineups l on l.submission_id = g.submission_id
    cross join params
    where (g.is_missing or g.is_under)
      and l.gap <= params.max_gap
      and exists (select 1 from me)
  ),
  rows_for_popular as (
    select p.hero_id, true as is_missing, p.submission_id, p.mode_id, 99::bigint as gap,
           p.weight as pts, p.si, p.furniture, p.engraving, p.ascension
    from pool p
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
    select a.hero_id,
           case when bool_or(a.is_missing) then 'build' else 'invest' end as kind,
           round(sum(a.pts), 4) as score,
           (count(*) filter (where a.gap = 1))::int as complete_count,
           (count(*) filter (where a.gap > 1 and a.gap < 99))::int as near_count,
           (array_agg(a.si order by a.pts desc) filter (where a.si is not null))[1] as rec_si,
           (array_agg(a.furniture order by a.pts desc) filter (where a.furniture is not null))[1] as rec_furniture,
           (array_agg(a.engraving order by a.pts desc) filter (where a.engraving is not null))[1] as rec_engraving,
           (array_agg(a.ascension order by a.pts desc) filter (where a.ascension is not null))[1] as rec_ascension,
           mj.by_mode,
           (array_agg(a.submission_id order by a.pts desc))[1:5] as submission_ids
    from all_rows a
    join mode_json mj on mj.hero_id = a.hero_id
    group by a.hero_id, mj.by_mode
  ),
  limited as (
    select agg.*, row_number() over (partition by agg.kind order by agg.score desc, agg.hero_id) as rn
    from agg
  )
  select l.hero_id, l.kind, l.score, l.complete_count, l.near_count,
         l.rec_si, l.rec_furniture, l.rec_engraving, l.rec_ascension, l.by_mode, l.submission_ids
  from limited l
  where auth.uid() is not null
    and l.rn <= least(greatest(coalesce(p_limit, 12), 1), 50)
  order by l.kind, l.score desc, l.hero_id
$$;
revoke all on function public.recommend_builds(text[], int) from public, anon;
grant execute on function public.recommend_builds(text[], int) to authenticated;
