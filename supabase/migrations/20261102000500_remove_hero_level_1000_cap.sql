alter table public.profiles
  drop constraint if exists profiles_hero_level_check;
alter table public.profiles
  add constraint profiles_hero_level_check
  check (hero_level between 1 and 32767);

alter table public.submissions
  drop constraint if exists submissions_hero_level_check;
alter table public.submissions
  add constraint submissions_hero_level_check
  check (hero_level between 1 and 32767);

create or replace function public.set_user_hero_level(p_level smallint) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your hero level.';
  end if;
  if p_level is not null and p_level not between 1 and 32767 then
    raise exception 'Hero level must be between 1 and 32767.';
  end if;
  update public.profiles set hero_level = p_level where id = v_user;
end;
$$;
