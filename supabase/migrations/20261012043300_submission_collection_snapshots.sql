create or replace function submit_lineup(p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_mode game_modes%rowtype;
  v_target_id int;
  v_submission_id bigint;
  v_formation_id bigint;
  v_form jsonb;
  v_hero jsonb;
  v_collection user_collections%rowtype;
  v_collection_nodes jsonb;
  v_catalog_id smallint;
  v_collection_name text;
  v_collection_class text;
  v_form_count int;
  v_min_forms int;
  v_max_forms int;
  v_merc_max int;
  v_form_index int := 0;
  v_position int;
  v_hero_id int;
  v_merc_count int;
  v_result_placement numeric;
  v_hero_level int;
  v_used_heroes int[] := '{}';
  v_unique_across boolean;
  v_collections_enabled boolean;
  v_allowed_keys text[];
begin
  if v_user is null then
    raise exception 'Sign in before submitting a lineup.';
  end if;

  select * into v_mode
  from game_modes
  where slug = p_payload ->> 'mode_slug' and enabled;
  if not found then
    raise exception 'Unknown or disabled game mode.';
  end if;

  select id into v_target_id
  from targets
  where mode_id = v_mode.id and slug = p_payload ->> 'target_slug';
  if not found then
    raise exception 'Choose a valid target for this game mode.';
  end if;

  if jsonb_typeof(p_payload -> 'formations') is distinct from 'array' then
    raise exception 'Lineup formations must be an array.';
  end if;

  v_form_count := jsonb_array_length(p_payload -> 'formations');
  v_min_forms := coalesce((v_mode.config #>> '{variable_formations,min}')::int, jsonb_array_length(coalesce(v_mode.config -> 'formations', '[]'::jsonb)));
  v_max_forms := coalesce((v_mode.config #>> '{variable_formations,max}')::int, v_min_forms);
  if v_form_count < v_min_forms or v_form_count > v_max_forms then
    raise exception 'This game mode requires between % and % formations.', v_min_forms, v_max_forms;
  end if;
  select coalesce(array_agg(value ->> 'key'), '{}')
  into v_allowed_keys from jsonb_array_elements(coalesce(v_mode.config -> 'formations', '[]'::jsonb));
  v_unique_across := coalesce((v_mode.config ->> 'unique_heroes_across_formations')::boolean, false);
  v_collections_enabled := coalesce((v_mode.config ->> 'collections_enabled')::boolean, false);
  v_merc_max := coalesce((v_mode.config ->> 'merc_max_per_submission')::int, 5);
  select count(*) into v_merc_count
  from jsonb_array_elements(p_payload -> 'formations') as forms(value)
  cross join lateral jsonb_array_elements(forms.value -> 'heroes') as heroes(value)
  where coalesce((heroes.value ->> 'is_merc')::boolean, false);
  if v_merc_count > v_merc_max then
    raise exception 'This mode allows at most % mercenary per lineup.', v_merc_max;
  end if;

  if v_mode.slug = 'twisted-realm' then
    v_hero_level := nullif(p_payload ->> 'hero_level', '')::int;
    if v_hero_level is null then
      raise exception 'Set your Resonating Crystal level before submitting a Twisted Realm lineup.';
    end if;
    if coalesce((p_payload -> 'result' ->> 'damage')::numeric, 0) <= 0 then
      raise exception 'Enter positive Twisted Realm damage.';
    end if;
  elsif v_mode.slug = 'cursed-realm' then
    if coalesce((p_payload -> 'result' ->> 'damage')::numeric, 0) <= 0 then
      raise exception 'Enter positive Cursed Realm damage.';
    end if;
  elsif v_mode.slug = 'treasure-scramble' then
    if jsonb_typeof(p_payload -> 'result' -> 'placement') is distinct from 'number'
      or coalesce(p_payload -> 'result' ->> 'placementType', '') not in ('rank', 'percent') then
      raise exception 'Choose a valid Treasure Scramble placement.';
    end if;
    v_result_placement := (p_payload -> 'result' ->> 'placement')::numeric;
    if v_result_placement <= 0 or v_result_placement > 100
      or (p_payload -> 'result' ->> 'placementType' = 'rank' and v_result_placement <> trunc(v_result_placement)) then
      raise exception 'Treasure Scramble placement must be rank 1-100 or a top percentage above 0 and at most 100.';
    end if;
  end if;

  insert into submissions (mode_id, target_id, author_id, result, hero_level, notes)
  values (
    v_mode.id, v_target_id, v_user, coalesce(p_payload -> 'result', '{}'::jsonb),
    nullif(p_payload ->> 'hero_level', '')::smallint, nullif(p_payload ->> 'notes', '')
  )
  returning id into v_submission_id;

  for v_form in select value from jsonb_array_elements(p_payload -> 'formations')
  loop
    v_form_index := v_form_index + 1;
    if v_form ->> 'slot_key' is null or (cardinality(v_allowed_keys) > 0 and not ((v_form ->> 'slot_key') = any(v_allowed_keys))) then
      raise exception 'Invalid formation slot key.';
    end if;
    if cardinality(v_allowed_keys) > 0 and not exists (
      select 1 from jsonb_array_elements(v_mode.config -> 'formations') configured(value)
      where configured.value ->> 'key' = v_form ->> 'slot_key'
        and configured.value ->> 'label' = v_form ->> 'slot_label'
    ) then
      raise exception 'Formation label does not match its configured slot.';
    end if;
    if jsonb_typeof(v_form -> 'heroes') <> 'array' or jsonb_array_length(v_form -> 'heroes') <> 5 then
      raise exception 'Every formation must contain exactly five heroes.';
    end if;
    if v_unique_across and exists (
      select 1
      from jsonb_array_elements(v_form -> 'heroes') as entries(value)
      where (entries.value ->> 'hero_id')::int = any(v_used_heroes)
    ) then
      raise exception 'A hero can only appear once across this lineup.';
    end if;
    if nullif(v_form ->> 'pet_level', '') is not null
      and (v_form ->> 'pet_level')::int not between 1 and 18 then
      raise exception 'Pet levels must be between 1 and 18.';
    end if;
    if nullif(v_form ->> 'pet_id', '') is null
      and nullif(v_form ->> 'pet_level', '') is not null then
      raise exception 'A pet must be selected before specifying its level.';
    end if;
    if v_mode.slug = 'nightmare-corridor'
      and coalesce(nullif(v_form ->> 'time_seconds', '')::int, 0) <= 0 then
      raise exception 'Enter a positive kill time for every Nightmare Corridor boss.';
    end if;

    insert into formations (submission_id, slot_key, slot_label, slot_order, beast, pet_id, pet_level, result_time_seconds)
    values (
      v_submission_id, v_form ->> 'slot_key', v_form ->> 'slot_label', v_form_index, nullif(v_form ->> 'beast', ''),
      nullif(v_form ->> 'pet_id', '')::int, nullif(v_form ->> 'pet_level', '')::smallint,
      nullif(v_form ->> 'time_seconds', '')::int
    )
    returning id into v_formation_id;

    for v_hero in select value from jsonb_array_elements(v_form -> 'heroes')
    loop
      v_position := (v_hero ->> 'position')::int;
      v_hero_id := (v_hero ->> 'hero_id')::int;
      if v_position not between 0 and 4 or not exists (select 1 from heroes where id = v_hero_id) then
        raise exception 'Invalid hero or formation position.';
      end if;

      insert into formation_heroes (formation_id, submission_id, position, hero_id, is_merc, si, furniture, engraving)
      values (
        v_formation_id, v_submission_id, v_position, v_hero_id,
        case when v_mode.slug = 'twisted-realm' then false else coalesce((v_hero ->> 'is_merc')::boolean, false) end,
        nullif(v_hero ->> 'si', '')::smallint,
        nullif(v_hero ->> 'furniture', '')::smallint,
        nullif(v_hero ->> 'engraving', '')::smallint
      );
      v_used_heroes := array_append(v_used_heroes, v_hero_id);

      if nullif(v_hero ->> 'collection_id', '') is not null
        and v_hero ? 'collection'
        and jsonb_typeof(v_hero -> 'collection') <> 'null' then
        raise exception 'Choose either a saved collection or a new collection build, not both.';
      end if;
      if nullif(v_hero ->> 'collection_id', '') is not null then
        if not v_collections_enabled then
          raise exception 'This game mode does not allow collections.';
        end if;
        select * into v_collection
        from user_collections
        where id = (v_hero ->> 'collection_id')::uuid and user_id = v_user;
        if not found then
          raise exception 'A selected collection does not belong to your account.';
        end if;
        insert into formation_collections (
          submission_id, formation_id, hero_id, owner_collection_id, collection_name,
          nodes
        ) values (
          v_submission_id, v_formation_id, v_hero_id, v_collection.id, v_collection.name,
          coalesce((
            select jsonb_agg(jsonb_build_object(
                  'slotIndex', n.slot_index, 'stat', n.node_type, 'tier', n.tier
            ) order by n.slot_index)
            from user_collection_nodes n
            where n.collection_id = v_collection.id
          ), '[]'::jsonb)
        );
      elsif v_hero ? 'collection' and jsonb_typeof(v_hero -> 'collection') = 'object' then
        if not v_collections_enabled then
          raise exception 'This game mode does not allow collections.';
        end if;
        v_catalog_id := nullif(v_hero -> 'collection' ->> 'catalog_id', '')::smallint;
        select name, class into v_collection_name, v_collection_class
        from collection_catalog where id = v_catalog_id;
        if v_collection_name is null then
          raise exception 'Choose a collection from the catalog.';
        end if;
        v_collection_nodes := v_hero -> 'collection' -> 'nodes';
        if jsonb_typeof(v_collection_nodes) is distinct from 'array' then
          raise exception 'Collection nodes must be an array.';
        end if;
        if jsonb_array_length(v_collection_nodes) > 8
          or exists (
            select 1 from jsonb_array_elements(v_collection_nodes) as entry(value)
            where (entry.value ->> 'slot_index')::int not between 0 and 7
              or not exists (
                select 1 from collection_node_types
                where node_type = entry.value ->> 'stat_type'
              )
              or not exists (
                select 1 from collection_node_tiers
                where tier = entry.value ->> 'tier'
              )
              or ((entry.value ->> 'slot_index')::int < 6 and entry.value ->> 'stat_type' = 'skill_level')
              or (entry.value ->> 'stat_type' = 'skill_level' and entry.value ->> 'tier' <> 'mythic')
          )
          or (
            select count(*) <> count(distinct (entry.value ->> 'slot_index')::int)
            from jsonb_array_elements(v_collection_nodes) as entry(value)
          ) then
          raise exception 'Collection builds may have up to eight valid nodes in fixed slots; Level nodes are Flex-only and Mythic.';
        end if;
        insert into formation_collections (
          submission_id, formation_id, hero_id, catalog_id, collection_class,
          collection_name, nodes
        ) values (
          v_submission_id, v_formation_id, v_hero_id, v_catalog_id, v_collection_class,
          v_collection_name, coalesce((
            select jsonb_agg(jsonb_build_object(
              'slotIndex', (entry.value ->> 'slot_index')::smallint,
              'stat', entry.value ->> 'stat_type',
              'tier', entry.value ->> 'tier'
            ) order by (entry.value ->> 'slot_index')::smallint)
            from jsonb_array_elements(v_collection_nodes) as entry(value)
          ), '[]'::jsonb)
        );
      elsif v_hero ? 'collection' and jsonb_typeof(v_hero -> 'collection') <> 'null' then
        raise exception 'A new collection build must be an object.';
      end if;
    end loop;
  end loop;

  return v_submission_id;
end;
$$;
revoke all on function submit_lineup(jsonb) from public;
grant execute on function submit_lineup(jsonb) to authenticated;
