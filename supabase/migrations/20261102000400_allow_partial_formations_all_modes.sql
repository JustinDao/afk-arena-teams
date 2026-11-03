update public.game_modes
set config = jsonb_set(config, '{allow_partial_formations}', 'true'::jsonb, true)
where slug in ('twisted-realm', 'nightmare-corridor', 'cursed-realm', 'treasure-scramble');

alter function public.submit_lineup_with_ascension(jsonb)
  rename to submit_lineup_with_optional_results_and_nc_cr_formations;

revoke all on function public.submit_lineup_with_optional_results_and_nc_cr_formations(jsonb) from public, anon, authenticated;

create function public.submit_lineup_with_ascension(p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_payload jsonb := p_payload;
  v_form jsonb;
  v_form_index int;
  v_position int;
  v_hero_id int;
  v_existing_hero jsonb;
  v_reserved_ids int[] := array[]::int[];
  v_placeholder_ids int[] := array[]::int[];
  v_rebuilt_heroes jsonb;
  v_submission_id bigint;
  v_mode_allows_partial boolean;
  v_hero_count int := 0;
begin
  if jsonb_typeof(p_payload -> 'formations') is distinct from 'array' then
    raise exception 'Lineup formations must be an array.';
  end if;

  select coalesce((config ->> 'allow_partial_formations')::boolean, false)
  into v_mode_allows_partial
  from public.game_modes
  where slug = p_payload ->> 'mode_slug' and enabled;

  if v_mode_allows_partial then
    if exists (
      select 1
      from jsonb_array_elements(p_payload -> 'formations') as forms(value)
      where jsonb_typeof(forms.value -> 'heroes') is distinct from 'array'
    ) then
      raise exception 'Every team must include a hero array.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_payload -> 'formations') as forms(value)
      where jsonb_array_length(forms.value -> 'heroes') > 5
    ) then
      raise exception 'A team can have up to five heroes.';
    end if;

    select coalesce(sum(jsonb_array_length(forms.value -> 'heroes')), 0)
    into v_hero_count
    from jsonb_array_elements(p_payload -> 'formations') as forms(value)
    where jsonb_typeof(forms.value -> 'heroes') = 'array';

    if v_hero_count = 0 then
      raise exception 'Add at least one hero to the lineup.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_payload -> 'formations') as forms(value)
      cross join lateral jsonb_array_elements(forms.value -> 'heroes') as heroes(value)
      where coalesce(heroes.value ->> 'position', '') !~ '^[0-4]$'
    ) then
      raise exception 'Invalid hero formation position.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_payload -> 'formations') with ordinality as forms(value, form_index)
      cross join lateral jsonb_array_elements(forms.value -> 'heroes') as heroes(value)
      group by forms.form_index
      having count(*) <> count(distinct (heroes.value ->> 'position')::int)
    ) then
      raise exception 'A team cannot have multiple heroes in the same position.';
    end if;
  end if;

  select coalesce(array_agg((heroes.value ->> 'hero_id')::int), array[]::int[])
  into v_reserved_ids
  from jsonb_array_elements(p_payload -> 'formations') as forms(value)
  cross join lateral jsonb_array_elements(coalesce(forms.value -> 'heroes', '[]'::jsonb)) as heroes(value)
  where nullif(heroes.value ->> 'hero_id', '') is not null;

  for v_form, v_form_index in
    select value, ordinality::int
    from jsonb_array_elements(p_payload -> 'formations') with ordinality
    where jsonb_typeof(value -> 'heroes') = 'array'
      and jsonb_array_length(value -> 'heroes') < 5
  loop
    v_rebuilt_heroes := '[]'::jsonb;
    for v_position in 0..4
    loop
      v_existing_hero := null;
      select hero.value into v_existing_hero
      from jsonb_array_elements(v_form -> 'heroes') as hero(value)
      where (hero.value ->> 'position')::int = v_position;

      if v_existing_hero is not null then
        v_rebuilt_heroes := v_rebuilt_heroes || jsonb_build_array(v_existing_hero);
      else
        select id into v_hero_id
        from public.heroes
        where not (id = any(v_reserved_ids))
        order by id
        limit 1;
        if v_hero_id is null then
          raise exception 'Could not reserve temporary heroes for a partial team.';
        end if;
        v_reserved_ids := array_append(v_reserved_ids, v_hero_id);
        v_placeholder_ids := array_append(v_placeholder_ids, v_hero_id);
        v_rebuilt_heroes := v_rebuilt_heroes || jsonb_build_array(jsonb_build_object(
          'position', v_position,
          'hero_id', v_hero_id,
          'is_merc', false,
          'ascension', 'epic'
        ));
      end if;
    end loop;

    v_payload := jsonb_set(
      v_payload,
      array['formations', (v_form_index - 1)::text, 'heroes'],
      v_rebuilt_heroes,
      false
    );
  end loop;

  v_submission_id := public.submit_lineup_with_optional_results_and_nc_cr_formations(v_payload);

  if cardinality(v_placeholder_ids) > 0 then
    delete from public.formation_heroes
    where submission_id = v_submission_id and hero_id = any(v_placeholder_ids);
  end if;

  return v_submission_id;
end;
$$;

revoke all on function public.submit_lineup_with_ascension(jsonb) from public;
grant execute on function public.submit_lineup_with_ascension(jsonb) to authenticated;
