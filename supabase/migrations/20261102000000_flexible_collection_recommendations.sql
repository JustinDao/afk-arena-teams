alter table public.formation_collections
  add column recommendation jsonb
  check (recommendation is null or jsonb_typeof(recommendation) = 'object');

create function public.submit_lineup_with_collection_recommendations(p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_submission_id bigint;
  v_formation jsonb;
  v_hero jsonb;
  v_recommendation jsonb;
  v_stat jsonb;
  v_stat_name text;
  v_stat_group text;
  v_catalog_id smallint;
  v_expected_recommendations int := 0;
  v_updated_recommendations int;
  v_attack_stats text[] := array[
    'atk', 'cda', 'crit', 'erosion', 'err', 'full_atk',
    'full_erosion', 'is', 'll', 'mp', 'pp', 'prf'
  ];
  v_defense_stats text[] := array[
    'armor', 'buffer', 'cbr', 'cdr', 'def', 'diss', 'dmg_resist',
    'full_buffer', 'full_def', 'full_hp', 'heal', 'hp', 'ty'
  ];
begin
  if jsonb_typeof(p_payload -> 'formations') is distinct from 'array' then
    raise exception 'Lineup formations must be an array.';
  end if;

  for v_formation in select value from jsonb_array_elements(p_payload -> 'formations')
  loop
    if jsonb_typeof(v_formation -> 'heroes') is distinct from 'array' then
      continue;
    end if;
    for v_hero in select value from jsonb_array_elements(v_formation -> 'heroes')
    loop
      if jsonb_typeof(v_hero -> 'collection') is distinct from 'object'
        or not ((v_hero -> 'collection') ? 'recommendation') then
        continue;
      end if;
      v_recommendation := v_hero -> 'collection' -> 'recommendation';
      if jsonb_typeof(v_recommendation) is distinct from 'object' then
        raise exception 'A flexible collection recommendation must be an object.';
      end if;
      if jsonb_typeof(v_hero -> 'collection' -> 'nodes') is distinct from 'array' then
        raise exception 'A flexible collection recommendation cannot include exact nodes.';
      end if;
      if jsonb_array_length(v_hero -> 'collection' -> 'nodes') <> 0 then
        raise exception 'A flexible collection recommendation cannot include exact nodes.';
      end if;
      if jsonb_typeof(v_recommendation -> 'level') is distinct from 'number'
        or coalesce(v_recommendation ->> 'level', '') !~ '^[1-3]$' then
        raise exception 'Collection recommendation levels must be between 1 and 3.';
      end if;
      if jsonb_typeof(v_recommendation -> 'attack_stats') is distinct from 'array'
        or jsonb_typeof(v_recommendation -> 'defense_stats') is distinct from 'array' then
        raise exception 'Collection recommendations must include Attack and Defense stat arrays.';
      end if;
      if jsonb_array_length(v_recommendation -> 'attack_stats') > 5
        or jsonb_array_length(v_recommendation -> 'defense_stats') > 5 then
        raise exception 'Choose no more than five acceptable stats for each collection node type.';
      end if;
      if jsonb_array_length(v_recommendation -> 'attack_stats') = 0
        and jsonb_array_length(v_recommendation -> 'defense_stats') = 0 then
        raise exception 'Choose at least one acceptable Mythic stat for each collection recommendation.';
      end if;
      if nullif(v_hero ->> 'collection_id', '') is not null then
        raise exception 'A flexible recommendation must use a catalog collection build.';
      end if;
      v_catalog_id := nullif(v_hero -> 'collection' ->> 'catalog_id', '')::smallint;
      if v_catalog_id is null or not exists (
        select 1 from collection_catalog where id = v_catalog_id
      ) then
        raise exception 'Choose a collection from the catalog.';
      end if;

      for v_stat_group, v_stat in
        select 'attack', value from jsonb_array_elements(v_recommendation -> 'attack_stats')
        union all
        select 'defense', value from jsonb_array_elements(v_recommendation -> 'defense_stats')
      loop
        if jsonb_typeof(v_stat) is distinct from 'string' then
          raise exception 'Collection recommendation stats must be strings.';
        end if;
        v_stat_name := v_stat #>> '{}';
        if (v_stat_group = 'attack' and not v_stat_name = any(v_attack_stats))
          or (v_stat_group = 'defense' and not v_stat_name = any(v_defense_stats)) then
          raise exception 'A collection recommendation stat is in the wrong node group.';
        end if;
        if not exists (select 1 from collection_node_types where node_type = v_stat_name) then
          raise exception 'A collection recommendation contains an invalid Mythic stat.';
        end if;
      end loop;
      if (
        select count(*) <> count(distinct value #>> '{}')
        from jsonb_array_elements(v_recommendation -> 'attack_stats')
      ) or (
        select count(*) <> count(distinct value #>> '{}')
        from jsonb_array_elements(v_recommendation -> 'defense_stats')
      ) then
        raise exception 'Collection recommendation stats must be unique within each node group.';
      end if;
      v_expected_recommendations := v_expected_recommendations + 1;
    end loop;
  end loop;

  v_submission_id := public.submit_lineup_with_ascension(p_payload);

  if v_expected_recommendations > 0 then
    update formation_collections fc
    set catalog_id = null,
        recommendation = jsonb_build_object(
          'level', (heroes.value -> 'collection' -> 'recommendation' ->> 'level')::smallint,
          'attackStats', heroes.value -> 'collection' -> 'recommendation' -> 'attack_stats',
          'defenseStats', heroes.value -> 'collection' -> 'recommendation' -> 'defense_stats',
          'catalogId', (heroes.value -> 'collection' ->> 'catalog_id')::smallint
        )
    from formations f,
         jsonb_array_elements(p_payload -> 'formations') with ordinality as forms(value, form_index),
         jsonb_array_elements(forms.value -> 'heroes') as heroes(value)
    where fc.submission_id = v_submission_id
      and f.submission_id = v_submission_id
      and f.slot_order = forms.form_index
      and fc.formation_id = f.id
      and fc.hero_id = (heroes.value ->> 'hero_id')::int
      and jsonb_typeof(heroes.value -> 'collection' -> 'recommendation') = 'object';
    get diagnostics v_updated_recommendations = row_count;
    if v_updated_recommendations <> v_expected_recommendations then
      raise exception 'Could not save all flexible collection recommendations.';
    end if;
  end if;

  return v_submission_id;
end;
$$;

revoke all on function public.submit_lineup_with_collection_recommendations(jsonb) from public;
grant execute on function public.submit_lineup_with_collection_recommendations(jsonb) to authenticated;

revoke all on function public.submit_lineup_with_ascension(jsonb) from authenticated;
revoke all on function public.submit_lineup(jsonb) from authenticated;
