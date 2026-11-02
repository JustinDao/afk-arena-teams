-- Investment limits: SI 0-50, furniture 0-36. Re-applied because 20261012043700 was edited
-- after it had already run on some databases, so they kept the older 40 / 12 limits.
alter table user_roster drop constraint if exists user_roster_si_check;
alter table user_roster add constraint user_roster_si_check check (si between 0 and 50);
alter table user_roster drop constraint if exists user_roster_furniture_check;
alter table user_roster add constraint user_roster_furniture_check check (furniture between 0 and 36);

alter table formation_heroes drop constraint if exists formation_heroes_si_check;
alter table formation_heroes add constraint formation_heroes_si_check check (si between 0 and 50);
alter table formation_heroes drop constraint if exists formation_heroes_furniture_check;
alter table formation_heroes add constraint formation_heroes_furniture_check check (furniture between 0 and 36);

-- Widen the same range checks inside the roster and lineup functions.
do $$
declare
  v_fn record;
  v_def text;
begin
  for v_fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('replace_user_roster', 'replace_user_roster_with_ascension', 'submit_lineup', 'submit_lineup_with_ascension')
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if v_def ~ '''si''\)::int, 0\) not between 0 and (30|40)\M'
       or v_def ~ '''furniture''\)::int, 0\) not between 0 and (9|12)\M' then
      v_def := regexp_replace(v_def, '(''si''\)::int, 0\) not between 0 and )(30|40)\M', '\150', 'g');
      v_def := regexp_replace(v_def, '(''furniture''\)::int, 0\) not between 0 and )(9|12)\M', '\136', 'g');
      execute v_def;
    end if;
  end loop;
end;
$$;
