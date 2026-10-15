alter table user_roster
  add column ascension text
  check (ascension in ('epic', 'legendary', 'mythic', 'ascended', 'ascended_1', 'ascended_2', 'ascended_3', 'ascended_4', 'ascended_5'));

alter table formation_heroes
  add column ascension text
  check (ascension in ('epic', 'legendary', 'mythic', 'ascended', 'ascended_1', 'ascended_2', 'ascended_3', 'ascended_4', 'ascended_5'));

alter table user_roster drop constraint user_roster_si_check;
alter table user_roster add constraint user_roster_si_check check (si between 0 and 50);
alter table user_roster drop constraint user_roster_furniture_check;
alter table user_roster add constraint user_roster_furniture_check check (furniture between 0 and 36);
alter table formation_heroes drop constraint formation_heroes_si_check;
alter table formation_heroes add constraint formation_heroes_si_check check (si between 0 and 50);
alter table formation_heroes drop constraint formation_heroes_furniture_check;
alter table formation_heroes add constraint formation_heroes_furniture_check check (furniture between 0 and 36);

create function replace_user_roster_with_ascension(p_entries jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your hero roster.';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'Roster entries must be an array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_entries) as entry(value)
    where (entry.value ->> 'hero_id')::int is null
      or not exists (select 1 from heroes where id = (entry.value ->> 'hero_id')::int)
      or coalesce((entry.value ->> 'si')::int, 0) not between 0 and 50
      or coalesce((entry.value ->> 'furniture')::int, 0) not between 0 and 36
      or coalesce((entry.value ->> 'engraving')::int, 0) not between 0 and 100
      or (
        entry.value ->> 'ascension' is not null
        and entry.value ->> 'ascension' not in (
          'epic', 'legendary', 'mythic', 'ascended',
          'ascended_1', 'ascended_2', 'ascended_3', 'ascended_4', 'ascended_5'
        )
      )
  ) then
    raise exception 'Roster contains an invalid hero, ascension rank, or investment value.';
  end if;

  delete from user_roster where user_id = v_user;
  insert into user_roster (user_id, hero_id, si, furniture, engraving, ascension)
  select v_user,
         (entry.value ->> 'hero_id')::int,
         nullif(entry.value ->> 'si', '')::smallint,
         nullif(entry.value ->> 'furniture', '')::smallint,
         nullif(entry.value ->> 'engraving', '')::smallint,
         nullif(entry.value ->> 'ascension', '')
  from jsonb_array_elements(p_entries) as entry(value);
end;
$$;
revoke all on function replace_user_roster_with_ascension(jsonb) from public;
grant execute on function replace_user_roster_with_ascension(jsonb) to authenticated;

create function submit_lineup_with_ascension(p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_submission_id bigint;
begin
  if jsonb_typeof(p_payload -> 'formations') is distinct from 'array' then
    raise exception 'Lineup formations must be an array.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'formations') as forms(value)
    where jsonb_typeof(forms.value -> 'heroes') is distinct from 'array'
  ) then
    raise exception 'Every formation must contain a hero array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'formations') as forms(value)
    cross join lateral jsonb_array_elements(coalesce(forms.value -> 'heroes', '[]'::jsonb)) as heroes(value)
    where heroes.value ->> 'ascension' is not null
      and heroes.value ->> 'ascension' not in (
        'epic', 'legendary', 'mythic', 'ascended',
        'ascended_1', 'ascended_2', 'ascended_3', 'ascended_4', 'ascended_5'
      )
  ) then
    raise exception 'Lineup contains an invalid hero ascension rank.';
  end if;

  v_submission_id := submit_lineup(p_payload);

  update formation_heroes fh
  set ascension = nullif(heroes.value ->> 'ascension', '')
  from formations f,
       jsonb_array_elements(p_payload -> 'formations') with ordinality as forms(value, form_index),
       jsonb_array_elements(coalesce(forms.value -> 'heroes', '[]'::jsonb)) as heroes(value)
  where f.submission_id = v_submission_id
    and f.slot_order = forms.form_index
    and fh.formation_id = f.id
    and fh.position = (heroes.value ->> 'position')::int;

  return v_submission_id;
end;
$$;
revoke all on function submit_lineup_with_ascension(jsonb) from public;
grant execute on function submit_lineup_with_ascension(jsonb) to authenticated;
