-- Apply to an existing AFK Arena Team Lineups database. This preserves user
-- collections and lineup snapshots while converting them to fixed Attack,
-- Defense, and Flex node slots.

create table if not exists collection_catalog (
  id        smallint primary key,
  class     text not null check (class in ('Warrior', 'Tank', 'Ranger', 'Mage', 'Support')),
  code_name text not null unique,
  name      text not null unique,
  icon_url  text not null
);

insert into collection_catalog (id, class, code_name, name, icon_url) values
  (1, 'Warrior', 'dt', 'Temporal Cover', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/1_cl.webp'),
  (2, 'Warrior', 'lizard', 'Shadow Dancer', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/2_cl.webp'),
  (3, 'Tank', 'timeg', 'Timeline Watch', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/3_cl.webp'),
  (4, 'Tank', 'dkid', 'Spell Bondage', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/4_cl.webp'),
  (5, 'Ranger', 'goda', 'Judgment Armor', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/5_cl.webp'),
  (6, 'Ranger', 'wolf', 'Sandstorm Fangs', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/6_cl.webp'),
  (7, 'Mage', 'lust', 'Captive Wings', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/7_cl.webp'),
  (8, 'Mage', 'mystic', 'Oculus Diabolus', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/8_cl.webp'),
  (9, 'Support', 'merchant', 'Trader''s Vault', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/9_cl.webp'),
  (10, 'Support', 'puck', 'Luminous Flight', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/10_cl.webp'),
  (11, 'Warrior', 'scimonster', 'Infused Mind Core', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/11_cl.webp'),
  (12, 'Tank', 'orcleader', 'Horn of Dominion', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/12_cl.webp'),
  (13, 'Ranger', 'swordmaster', 'Shadowflow Blade', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/13_cl.webp'),
  (14, 'Mage', 'thor', 'Stormwrath''s Lull', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/14_cl.webp'),
  (15, 'Support', 'nbh', 'Bounty Hunter''s Decree', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/15_cl.webp'),
  (16, 'Warrior', 'pudge', 'Reaper''s Talon', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/16_cl.webp'),
  (17, 'Tank', 'sonia', 'Sinner''s Rose', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/17_cl.webp'),
  (18, 'Ranger', 'nunassassin', 'Demon Sealer', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/18_cl.webp'),
  (19, 'Mage', 'selene', 'Crescent Wheel', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/19_cl.webp'),
  (20, 'Support', 'siren', 'Ashen Tide Relic', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/20_cl.webp')
on conflict (id) do update set
  class = excluded.class,
  code_name = excluded.code_name,
  name = excluded.name,
  icon_url = excluded.icon_url;

alter table user_collections add column if not exists catalog_id smallint references collection_catalog(id);
update user_collections uc
set catalog_id = cc.id, name = cc.name
from collection_catalog cc
where lower(trim(uc.name)) = lower(trim(cc.name)) and uc.catalog_id is null;

alter table collection_node_types drop constraint if exists collection_node_types_node_type_check;
insert into collection_node_types (node_type) values
  ('armor'), ('atk'), ('buffer'), ('cbr'), ('cda'), ('cdr'), ('crit'), ('def'), ('diss'),
  ('dmg_resist'), ('erosion'), ('err'), ('full_atk'), ('full_buffer'), ('full_def'),
  ('full_erosion'), ('full_hp'), ('heal'), ('hp'), ('is'), ('ll'), ('mp'), ('pp'), ('prf'),
  ('skill_level'), ('ty')
on conflict (node_type) do nothing;

alter table user_collection_nodes drop constraint if exists user_collection_nodes_node_type_fkey;
alter table user_collection_nodes drop constraint if exists user_collection_nodes_tier_fkey;
alter table user_collection_nodes drop constraint if exists user_collection_nodes_check;
alter table user_collection_nodes drop constraint if exists user_collection_nodes_level_check;
update user_collection_nodes set node_type = case node_type
  when 'attack' then 'atk'
  when 'defense' then 'def'
  when 'level' then 'skill_level'
  else node_type
end;
update user_collection_nodes set tier = 'elite' where tier = 'epic';
update user_collection_nodes set tier = 'mythic' where node_type = 'skill_level';
delete from collection_node_types where node_type in ('attack', 'defense', 'level');
alter table collection_node_types add constraint collection_node_types_node_type_check
  check (node_type ~ '^[a-z0-9_]+$');
alter table collection_node_tiers drop constraint if exists collection_node_tiers_tier_check;
insert into collection_node_tiers (tier) values ('elite') on conflict (tier) do nothing;
delete from collection_node_tiers where tier = 'epic';
alter table collection_node_tiers add constraint collection_node_tiers_tier_check check (tier in ('elite', 'legendary', 'mythic'));
alter table user_collection_nodes
  drop constraint if exists user_collection_nodes_check;
alter table user_collection_nodes
  add constraint user_collection_nodes_node_type_fkey foreign key (node_type) references collection_node_types(node_type),
  add constraint user_collection_nodes_tier_fkey foreign key (tier) references collection_node_tiers(tier),
  add constraint user_collection_nodes_check check (node_type <> 'skill_level' or tier = 'mythic');

alter table collection_slots drop constraint if exists collection_slots_slot_name_key;
update collection_slots set slot_name = case
  when slot_index between 0 and 2 then 'Attack ' || (slot_index + 1)
  when slot_index between 3 and 5 then 'Defense ' || (slot_index - 2)
  else 'Flex ' || (slot_index - 5)
end;
alter table collection_slots add constraint collection_slots_slot_name_key unique (slot_name);
alter table user_collection_nodes drop column if exists level;
alter table user_collections drop column if exists skill_level;

alter table formation_collections add column if not exists catalog_id smallint references collection_catalog(id);
alter table formation_collections add column if not exists collection_class text;
update formation_collections fc
set nodes = (
  select coalesce(jsonb_agg(
    case
      when coalesce(node ->> 'stat', node ->> 'stat_type', node ->> 'type') in ('skill_level', 'level')
        then (node - 'level') || jsonb_build_object('tier', 'mythic')
      else node - 'level'
    end
    order by ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(fc.nodes) with ordinality as saved(node, ordinality)
);
alter table formation_collections drop column if exists skill_level;
update formation_collections fc
set catalog_id = uc.catalog_id, collection_class = cc.class
from user_collections uc
join collection_catalog cc on cc.id = uc.catalog_id
where fc.owner_collection_id = uc.id;

alter table collection_catalog enable row level security;
drop policy if exists read_all on collection_catalog;
create policy read_all on collection_catalog for select using (true);
grant select on collection_catalog to anon, authenticated;
grant select on collection_node_types to anon, authenticated;

create or replace function fill_collection_snapshot_metadata() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.owner_collection_id is not null then
    select uc.catalog_id, cc.class
      into new.catalog_id, new.collection_class
    from user_collections uc
    join collection_catalog cc on cc.id = uc.catalog_id
    where uc.id = new.owner_collection_id;
  end if;
  return new;
end;
$$;
drop trigger if exists fill_collection_snapshot_metadata on formation_collections;
create trigger fill_collection_snapshot_metadata
before insert on formation_collections
for each row execute function fill_collection_snapshot_metadata();

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
