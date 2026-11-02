-- Pet levels now go above 18: basic pets cap at 18, every other pet at 36.
create or replace function public.pet_max_level(p_pet_type text) returns int
language sql immutable as $$ select case when p_pet_type = 'basic' then 18 else 36 end $$;

alter table user_pet_roster drop constraint if exists user_pet_roster_level_check;
alter table user_pet_roster add constraint user_pet_roster_level_check check (level between 1 and 36);
alter table formations drop constraint if exists formations_pet_level_check;
alter table formations add constraint formations_pet_level_check check (pet_level is null or pet_level between 1 and 36);

create or replace function public.enforce_pet_level_cap() returns trigger
language plpgsql as $$
declare
  v_level int;
  v_type text;
begin
  if tg_table_name = 'user_pet_roster' then
    v_level := new.level;
  else
    v_level := new.pet_level;
  end if;
  if v_level is null or new.pet_id is null then return new; end if;
  select pet_type into v_type from pets where id = new.pet_id;
  if v_level > public.pet_max_level(v_type) then
    raise exception 'Pet levels for % pets must be between 1 and %.', v_type, public.pet_max_level(v_type);
  end if;
  return new;
end;
$$;

drop trigger if exists user_pet_roster_level_cap on user_pet_roster;
create trigger user_pet_roster_level_cap before insert or update on user_pet_roster
  for each row execute function public.enforce_pet_level_cap();
drop trigger if exists formations_pet_level_cap on formations;
create trigger formations_pet_level_cap before insert or update of pet_id, pet_level on formations
  for each row execute function public.enforce_pet_level_cap();

-- Widen the range checks inside the existing functions without restating them.
do $$
declare
  v_sig regprocedure;
  v_def text;
  v_new text;
begin
  foreach v_sig in array array['submit_lineup(jsonb)'::regprocedure, 'replace_user_pet_roster(jsonb)'::regprocedure] loop
    v_def := pg_get_functiondef(v_sig);
    v_new := replace(replace(v_def, 'not between 1 and 18', 'not between 1 and 36'), 'must be between 1 and 18.', 'must be between 1 and 36.');
    if v_new = v_def then
      raise exception 'Expected pet level range check not found in %', v_sig;
    end if;
    execute v_new;
  end loop;
end $$;

-- Pet recommendations. Only requirements above level 18 count: a team asks for one pet at a level.
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

create or replace function public.refresh_recommendation_pool() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently recommendation_pool;
  refresh materialized view concurrently recommendation_collection_pool;
  refresh materialized view concurrently recommendation_pet_pool;
  update recommendation_meta set refreshed_at = now() where id;
end;
$$;
revoke all on function public.refresh_recommendation_pool() from public, anon, authenticated;

select public.refresh_recommendation_pool();

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
      and (params.slugs is null or cardinality(params.slugs) = 0 or m.slug = any(params.slugs))
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
revoke all on function public.recommend_pets(text[], int) from public, anon;
grant execute on function public.recommend_pets(text[], int) to authenticated;
