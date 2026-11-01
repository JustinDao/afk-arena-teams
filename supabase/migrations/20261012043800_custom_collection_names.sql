-- Lets users name their collections; falls back to the catalog name when blank.
create or replace function save_user_collection(p_collection jsonb) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_collection_id uuid;
  v_node jsonb;
  v_node_count int;
  v_slot_count int;
  v_catalog_id smallint;
  v_collection_name text;
begin
  if v_user is null then
    raise exception 'Sign in before saving collections.';
  end if;
  v_catalog_id := (p_collection ->> 'catalog_id')::smallint;
  if jsonb_typeof(p_collection -> 'nodes') is distinct from 'array' then
    raise exception 'Collection nodes must be an array.';
  end if;
  select name into v_collection_name from collection_catalog where id = v_catalog_id;
  if v_collection_name is null then
    raise exception 'Choose a collection from the catalog.';
  end if;
  v_collection_name := coalesce(nullif(left(trim(p_collection ->> 'name'), 80), ''), v_collection_name);

  select count(*), count(distinct (value ->> 'slot_index')::smallint)
  into v_node_count, v_slot_count
  from jsonb_array_elements(p_collection -> 'nodes');
  if v_node_count > 8 or v_node_count <> v_slot_count
     or exists (
       select 1 from jsonb_array_elements(p_collection -> 'nodes')
       where (value ->> 'slot_index')::smallint not between 0 and 7
          or ((value ->> 'slot_index')::smallint < 6 and value ->> 'stat_type' = 'skill_level')
          or (
            value ->> 'stat_type' = 'skill_level'
            and value ->> 'tier' is distinct from 'mythic'
          )
     ) then
    raise exception 'A collection can have up to eight optional nodes in fixed slots; Level nodes are Flex-only and Mythic.';
  end if;

  if p_collection ? 'id' then
    update user_collections
    set catalog_id = v_catalog_id, name = v_collection_name, updated_at = now()
    where id = (p_collection ->> 'id')::uuid and user_id = v_user
    returning id into v_collection_id;
    if v_collection_id is null then
      raise exception 'Collection not found in your account.';
    end if;
    delete from user_collection_nodes where collection_id = v_collection_id;
  else
    insert into user_collections (user_id, catalog_id, name)
    values (v_user, v_catalog_id, v_collection_name)
    returning id into v_collection_id;
  end if;

  for v_node in select value from jsonb_array_elements(p_collection -> 'nodes')
  loop
    insert into user_collection_nodes (collection_id, slot_index, node_type, tier)
    values (
      v_collection_id,
      (v_node ->> 'slot_index')::smallint,
      v_node ->> 'stat_type',
      v_node ->> 'tier'
    );
  end loop;

  return v_collection_id;
end;
$$;
revoke all on function save_user_collection(jsonb) from public;
grant execute on function save_user_collection(jsonb) to authenticated;
