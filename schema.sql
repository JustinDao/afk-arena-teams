-- AFK Arena Team Lineups: classic server crowdsourced lineup database
-- Target: PostgreSQL 15+ on Supabase
--
-- Design goals
--   1. Game modes, targets, and heroes are database-managed reference data.
--   2. "Which lineups can I run with this roster?" can be searched efficiently.
--   3. Per-hero investment, mercenary flag, and grid position are first-class columns.
--   4. Hero level is account-wide; pet levels belong to individual pets.
--   5. Collection inventory belongs to users; lineup collection assignments are per formation/hero.

-- DESTRUCTIVE RESET: this script replaces all app tables and lineups, votes, profiles, and rosters.
-- Supabase Auth users are retained. Use collection-catalog-migration.sql to update an existing
-- installation without deleting its data.
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  votes,
  formation_collections,
  formation_heroes,
  formations,
  submissions,
  user_collection_nodes,
  user_collections,
  collection_slots,
  collection_node_tiers,
  collection_node_types,
  collection_catalog,
  user_pet_roster,
  user_roster,
  profiles,
  pets,
  heroes,
  targets,
  game_modes
  cascade;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.fill_collection_snapshot_metadata() cascade;
drop function if exists public.bump_upvotes() cascade;
drop function if exists public.search_submissions(smallint, int, int[], jsonb, int[], jsonb, int, boolean, int, int) cascade;
drop function if exists public.save_user_collection(jsonb) cascade;
drop function if exists public.submit_lineup(jsonb) cascade;
drop function if exists public.replace_user_roster(jsonb) cascade;
drop function if exists public.replace_user_pet_roster(jsonb) cascade;
drop function if exists public.set_user_hero_level(smallint) cascade;
drop function if exists public.toggle_submission_vote(bigint) cascade;
drop function if exists public.email_exists(text) cascade;
drop function if exists public.email_exists cascade;

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Reference data (maintained manually)
-- ---------------------------------------------------------------------------

create table game_modes (
  id          smallint generated always as identity primary key,
  slug        text unique not null,            -- 'twisted-realm', 'nightmare-corridor', ...
  name        text not null,
  target_kind text not null check (target_kind in ('boss', 'debuff', 'none')),
  enabled     boolean not null default false,  -- flip to true when the mode goes live
  sort_order  smallint not null default 0,
  -- Declarative mode rules read by the app, for example:
  -- {
  --   "formations": [{"key":"sg1","label":"SG1"}, ... , {"key":"boss","label":"Boss"}],
  --   "variable_formations": {"min":7,"max":7},          -- Treasure Scramble
  --   "merc_max_per_submission": 1,
  --   "unique_heroes_across_formations": true,
  --   "result_fields": [{"key":"damage","type":"damage","required":true}]
  -- }
  config      jsonb not null default '{}'::jsonb
);

-- Bosses / debuff cycles. NC swaps one boss every 28 days, so rows carry an active window.
create table targets (
  id              int generated always as identity primary key,
  mode_id         smallint not null references game_modes(id),
  slug            text not null,
  name            text not null,
  active_from     date,
  active_to       date,
  formation_count smallint,                    -- Optional mode-specific formation count metadata
  unique (mode_id, slug)
);

create table heroes (
  id           int primary key, -- AFK Mine CDN unit ID; stable reference for icon URLs and rosters
  slug         text unique not null,
  name         text not null,
  faction      text,
  class        text check (class in ('Warrior', 'Tank', 'Ranger', 'Mage', 'Support')),
  hero_type    text not null check (hero_type in ('strength', 'agility', 'intelligence')),
  role         text,
  rarity       text not null check (rarity in ('elite', 'legendary')),
  icon_url     text generated always as (
    'https://raw.githubusercontent.com/afk-mine/cdn/main/unit_icon_by_id/' || id::text || '.webp'
  ) stored,
  -- Awakened versions play differently from the base hero, so they are separate rows
  -- that point back at the base hero. "Own Lyca" and "own Awakened Lyca" are different facts.
  base_hero_id int references heroes(id),
  is_awakened  boolean not null default false,
  released_at  date
);
create index heroes_name_trgm on heroes using gin (name gin_trgm_ops);

create table pets (
  id           int primary key,
  slug         text unique not null,
  name         text not null,
  is_awakened  boolean not null default false,
  released_at  date,
  icon_url     text generated always as (
    'https://raw.githubusercontent.com/afk-mine/cdn/main/unit_icon_by_id/' || id::text || '.webp'
  ) stored
);
create index pets_name_trgm on pets using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Accounts, private rosters, and reusable collection inventories
-- ---------------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,  -- Supabase auth
  display_name text,
  hero_level   smallint check (hero_level between 1 and 1000),
  created_at   timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any pre-existing Supabase Auth users whose profile rows
-- were dropped by the schema reset above. The trigger only fires on new inserts,
-- so existing users must be seeded manually here.
insert into public.profiles (id, display_name)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

create function public.email_exists(p_email text) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  return exists (
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
end;
$$;
revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;

-- Saved roster for logged-in users.
create table user_roster (
  user_id   uuid not null default auth.uid() references profiles(id) on delete cascade,
  hero_id   int  not null references heroes(id),
  si        smallint check (si between 0 and 30),
  furniture smallint check (furniture between 0 and 9),
  engraving smallint check (engraving between 0 and 100),
  primary key (user_id, hero_id)
);

create table user_pet_roster (
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  pet_id  int not null references pets(id),
  level   smallint not null check (level between 1 and 18),
  primary key (user_id, pet_id)
);

-- Collections are reusable inventory items. A lineup stores a snapshot of the selected item's
-- nodes, so later edits to inventory do not rewrite previously submitted team comps.
create table collection_catalog (
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
  (20, 'Support', 'siren', 'Ashen Tide Relic', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/20_cl.webp');

create table collection_node_types (
  node_type text primary key check (node_type ~ '^[a-z0-9_]+$')
);

insert into collection_node_types (node_type) values
  ('armor'), ('atk'), ('buffer'), ('cbr'), ('cda'), ('cdr'), ('crit'), ('def'), ('diss'),
  ('dmg_resist'), ('erosion'), ('err'), ('full_atk'), ('full_buffer'), ('full_def'),
  ('full_erosion'), ('full_hp'), ('heal'), ('hp'), ('is'), ('ll'), ('mp'), ('pp'), ('prf'),
  ('skill_level'), ('ty');

create table user_collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  catalog_id smallint not null references collection_catalog(id),
  name       text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_collections_owner on user_collections (user_id, name);

create table collection_slots (
  slot_index smallint primary key check (slot_index between 0 and 7),
  slot_name text unique not null
);

create table collection_node_tiers (
  tier text primary key check (tier in ('elite', 'legendary', 'mythic'))
);

insert into collection_slots (slot_index, slot_name) values
  (0, 'Attack 1'), (1, 'Attack 2'), (2, 'Attack 3'),
  (3, 'Defense 1'), (4, 'Defense 2'), (5, 'Defense 3'),
  (6, 'Flex 1'), (7, 'Flex 2');
insert into collection_node_tiers (tier) values ('elite'), ('legendary'), ('mythic');

create table user_collection_nodes (
  collection_id uuid not null references user_collections(id) on delete cascade,
  slot_index    smallint not null references collection_slots(slot_index),
  node_type     text not null references collection_node_types(node_type),
  tier          text not null references collection_node_tiers(tier),
  check (node_type <> 'skill_level' or tier = 'mythic'),
  primary key (collection_id, slot_index)
);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------

create table submissions (
  id         bigint generated always as identity primary key,
  seed_key   text,                                             -- stable key for built-in example lineups
  mode_id    smallint not null references game_modes(id),
  target_id  int references targets(id),
  author_id  uuid references profiles(id) on delete set null,   -- null = anonymous
  server     text not null default 'classic' check (server = 'classic'),  -- Companions is a different game
  result     jsonb not null default '{}'::jsonb,                -- damage for TR/CR, placement for TS; NC times live on each formation
  hero_level smallint check (hero_level between 1 and 1000),
  notes      text,
  upvotes    int not null default 0,                            -- maintained by trigger below
  created_at timestamptz not null default now()
);
create index submissions_browse on submissions (mode_id, target_id, upvotes desc);
create unique index submissions_seed_key on submissions (seed_key);

-- One row per team in a lineup. Twisted Realm: 1. Nightmare Corridor / Cursed Realm: 6. Treasure Scramble: N.
create table formations (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references submissions(id) on delete cascade,
  slot_key      text not null,             -- 'team', boss keys, 'sg1'..'sg5', 'boss', 't1'..'tN'
  slot_label    text not null,
  slot_order    smallint not null,
  beast         text, -- Legacy free-text pet name; new lineups use pet_id and pet_level.
  pet_id        int references pets(id),
  pet_level     smallint check (pet_level between 1 and 18),
  result_time_seconds int check (result_time_seconds > 0),
  check (pet_level is null or pet_id is not null),
  unique (submission_id, slot_key)
);

create table formation_heroes (
  formation_id  bigint   not null references formations(id) on delete cascade,
  submission_id bigint   not null references submissions(id) on delete cascade,  -- denormalised: search never joins formations
  position      smallint not null check (position between 0 and 4),              -- 0-1 front, 2-4 back (layout lives in the app)
  hero_id       int      not null references heroes(id),
  is_merc       boolean  not null default false,
  si            smallint check (si between 0 and 30),          -- all three optional; null = not specified
  furniture     smallint check (furniture between 0 and 9),
  engraving     smallint check (engraving between 0 and 100),
  primary key (formation_id, position),
  unique (formation_id, hero_id)
);
create index formation_heroes_hero on formation_heroes (hero_id);
create index formation_heroes_submission on formation_heroes (submission_id);

-- Collection assignment snapshots are tied to a specific hero in a specific formation.
create table formation_collections (
  submission_id       bigint not null references submissions(id) on delete cascade,
  formation_id        bigint not null references formations(id) on delete cascade,
  hero_id             int not null references heroes(id),
  owner_collection_id uuid references user_collections(id) on delete set null,
  catalog_id          smallint references collection_catalog(id),
  collection_class    text,
  collection_name     text not null,
  nodes               jsonb not null check (jsonb_typeof(nodes) = 'array'),
  primary key (formation_id, hero_id)
);
create index formation_collections_submission on formation_collections (submission_id);

create function fill_collection_snapshot_metadata() returns trigger
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
create trigger fill_collection_snapshot_metadata
before insert on formation_collections
for each row execute function fill_collection_snapshot_metadata();

-- ---------------------------------------------------------------------------
-- Votes (one per signed-in user)
-- ---------------------------------------------------------------------------

create table votes (
  submission_id bigint not null references submissions(id) on delete cascade,
  voter         text   not null,
  created_at    timestamptz not null default now(),
  primary key (submission_id, voter)
);

create function bump_upvotes() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update submissions set upvotes = upvotes + 1 where id = new.submission_id;
  else
    update submissions set upvotes = upvotes - 1 where id = old.submission_id;
  end if;
  return null;
end $$;

create trigger votes_count after insert or delete on votes
  for each row execute function bump_upvotes();

-- ---------------------------------------------------------------------------
-- The query this whole app exists for
-- ---------------------------------------------------------------------------
-- p_owned = null          -> no roster filter, just browse
-- p_strict = true         -> only lineups where every hero is owned
-- p_strict = false        -> also return near-misses, with the heroes you are missing
-- Default order: most upvoted, then fewest missing.
--
-- Whole-loadout matching only. "Single slot" matching for Cursed Realm / Treasure Scramble is the
-- same query grouped by formation_id instead of submission_id.

create function search_submissions(
  p_mode         smallint,
  p_target       int      default null,
  p_owned        int[]    default null,
  p_hero_investments jsonb default null,
  p_owned_pets   int[]    default null,
  p_pet_levels   jsonb    default null,
  p_hero_level   int      default null,
  p_strict       boolean  default true,
  p_limit        int      default 50,
  p_offset       int      default 0
) returns table (
  submission_id bigint,
  upvotes int,
  missing_count int,
  missing_heroes int[],
  under_investment_heroes int[],
  missing_pets int[],
  under_level_pets int[]
)
language sql stable set search_path = public as $$
  with candidates as (
    select s.id, s.upvotes, s.hero_level, s.created_at
    from submissions s
    where s.mode_id = p_mode
      and (p_target is null or s.target_id = p_target)
  ),
  hero_gaps as (
    select c.id,
           coalesce(array_agg(distinct fh.hero_id) filter (
             where p_owned is not null and not (fh.hero_id = any(p_owned))
           ), '{}') as missing_heroes,
           coalesce(array_agg(distinct fh.hero_id) filter (
             where p_hero_investments is not null and (
               (fh.si is not null and nullif(p_hero_investments -> (fh.hero_id::text) ->> 'si', '')::smallint < fh.si)
               or (fh.furniture is not null and nullif(p_hero_investments -> (fh.hero_id::text) ->> 'furniture', '')::smallint < fh.furniture)
               or (fh.engraving is not null and nullif(p_hero_investments -> (fh.hero_id::text) ->> 'engraving', '')::smallint < fh.engraving)
             )
           ), '{}') as under_investment_heroes
    from candidates c
    left join formation_heroes fh on fh.submission_id = c.id
    group by c.id
  ),
  pet_gaps as (
    select c.id,
           coalesce(array_agg(distinct f.pet_id) filter (
             where p_owned_pets is not null and f.pet_id is not null
               and not (f.pet_id = any(p_owned_pets))
           ), '{}') as missing_pets,
           coalesce(array_agg(distinct f.pet_id) filter (
             where p_pet_levels is not null and f.pet_id is not null
               and f.pet_level is not null
               and (p_owned_pets is null or f.pet_id = any(p_owned_pets))
               and coalesce((p_pet_levels ->> f.pet_id::text)::int, 0) < f.pet_level
           ), '{}') as under_level_pets
    from candidates c
    left join formations f on f.submission_id = c.id
    group by c.id
  ),
  ranked as (
    select c.id, c.upvotes, h.missing_heroes, p.missing_pets, p.under_level_pets,
           h.under_investment_heroes,
           cardinality(h.missing_heroes) + cardinality(p.missing_pets)
             + cardinality(h.under_investment_heroes)
             + cardinality(p.under_level_pets)
             + case when p_hero_level is not null and c.hero_level is not null
                     and p_hero_level < c.hero_level then 1 else 0 end as gap
    from candidates c
    join hero_gaps h on h.id = c.id
    join pet_gaps p on p.id = c.id
  )
  select r.id, r.upvotes, r.gap, r.missing_heroes, r.under_investment_heroes,
         r.missing_pets, r.under_level_pets
  from ranked r
  where not p_strict or (
    (p_owned is null or cardinality(r.missing_heroes) = 0)
    and (p_hero_investments is null or cardinality(r.under_investment_heroes) = 0)
    and (p_owned_pets is null or cardinality(r.missing_pets) = 0)
    and (p_pet_levels is null or cardinality(r.under_level_pets) = 0)
    and (p_hero_level is null or not exists (
      select 1 from candidates c where c.id = r.id and c.hero_level is not null
        and p_hero_level < c.hero_level
    ))
  )
  order by r.gap asc, r.upvotes desc, r.id desc
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

create index formations_pet on formations (pet_id) where pet_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security: public read, writes go through RPC / edge functions
-- ---------------------------------------------------------------------------

alter table game_modes enable row level security;
alter table targets enable row level security;
alter table heroes enable row level security;
alter table pets enable row level security;
alter table collection_slots enable row level security;
alter table collection_node_types enable row level security;
alter table collection_node_tiers enable row level security;
alter table collection_catalog enable row level security;
alter table submissions enable row level security;
alter table formations enable row level security;
alter table formation_heroes enable row level security;
alter table votes enable row level security;
alter table profiles enable row level security;
alter table user_roster enable row level security;
alter table user_pet_roster enable row level security;
alter table user_collections enable row level security;
alter table user_collection_nodes enable row level security;
alter table formation_collections enable row level security;

create policy read_all on game_modes for select using (true);
create policy read_all on targets for select using (true);
create policy read_all on heroes for select using (true);
create policy read_all on pets for select using (true);
create policy read_all on collection_slots for select using (true);
create policy read_all on collection_node_types for select using (true);
create policy read_all on collection_node_tiers for select using (true);
create policy read_all on collection_catalog for select using (true);
grant select on collection_catalog to anon, authenticated;
grant select on collection_node_types to anon, authenticated;
create policy read_all on submissions for select using (true);
create policy read_all on formations for select using (true);
create policy read_all on formation_heroes for select using (true);
create policy read_all on formation_collections for select using (true);
create policy own_profile on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy own_roster on user_roster for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_pet_roster on user_pet_roster for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_collections on user_collections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy read_own_collection_nodes on user_collection_nodes for select using (
  exists (select 1 from user_collections c where c.id = collection_id and c.user_id = auth.uid())
);
create policy own_votes on votes for select using (auth.uid()::text = voter);
-- No direct insert policy on submissions/formations/votes: authenticated writes go through
-- submit_lineup(jsonb), which validates the payload and owned collection IDs.

create function save_user_collection(p_collection jsonb) returns uuid
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

create function submit_lineup(p_payload jsonb) returns bigint
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
      end if;
    end loop;
  end loop;

  return v_submission_id;
end;
$$;
revoke all on function submit_lineup(jsonb) from public;
grant execute on function submit_lineup(jsonb) to authenticated;

create function replace_user_roster(p_entries jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your hero roster.';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Roster entries must be an array.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) as entry(value)
    where (entry.value ->> 'hero_id')::int is null
      or not exists (select 1 from heroes where id = (entry.value ->> 'hero_id')::int)
      or coalesce((entry.value ->> 'si')::int, 0) not between 0 and 30
      or coalesce((entry.value ->> 'furniture')::int, 0) not between 0 and 9
      or coalesce((entry.value ->> 'engraving')::int, 0) not between 0 and 100
  ) then
    raise exception 'Roster contains an invalid hero or investment value.';
  end if;

  delete from user_roster where user_id = v_user;
  insert into user_roster (user_id, hero_id, si, furniture, engraving)
  select v_user, (entry.value ->> 'hero_id')::int,
         nullif(entry.value ->> 'si', '')::smallint,
         nullif(entry.value ->> 'furniture', '')::smallint,
         nullif(entry.value ->> 'engraving', '')::smallint
  from jsonb_array_elements(p_entries) as entry(value);
end;
$$;
revoke all on function replace_user_roster(jsonb) from public;
grant execute on function replace_user_roster(jsonb) to authenticated;

create function replace_user_pet_roster(p_entries jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your pet roster.';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Pet roster entries must be an array.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) as entry(value)
    where (entry.value ->> 'pet_id')::int is null
      or not exists (select 1 from pets where id = (entry.value ->> 'pet_id')::int)
      or coalesce((entry.value ->> 'level')::int, 0) not between 1 and 18
  ) then
    raise exception 'Pet roster contains an invalid pet or level.';
  end if;

  delete from user_pet_roster where user_id = v_user;
  insert into user_pet_roster (user_id, pet_id, level)
  select v_user, (entry.value ->> 'pet_id')::int, (entry.value ->> 'level')::smallint
  from jsonb_array_elements(p_entries) as entry(value);
end;
$$;
revoke all on function replace_user_pet_roster(jsonb) from public;
grant execute on function replace_user_pet_roster(jsonb) to authenticated;

create function set_user_hero_level(p_level smallint) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to save your hero level.';
  end if;
  if p_level is not null and p_level not between 1 and 1000 then
    raise exception 'Hero level must be between 1 and 1000.';
  end if;
  update profiles set hero_level = p_level where id = v_user;
end;
$$;
revoke all on function set_user_hero_level(smallint) from public;
grant execute on function set_user_hero_level(smallint) to authenticated;

create function toggle_submission_vote(p_submission_id bigint) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_voter text := auth.uid()::text;
begin
  if v_voter is null then
    raise exception 'Sign in to vote on a lineup.';
  end if;
  if not exists (select 1 from submissions where id = p_submission_id) then
    raise exception 'Lineup not found.';
  end if;
  delete from votes where submission_id = p_submission_id and voter = v_voter;
  if found then
    return false;
  end if;
  insert into votes (submission_id, voter) values (p_submission_id, v_voter);
  return true;
end;
$$;
revoke all on function toggle_submission_vote(bigint) from public;
grant execute on function toggle_submission_vote(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the four phase-1 modes plus the planned ones
-- ---------------------------------------------------------------------------

-- Class, type, and role follow the AFK Arena Wiki hero list; crossover additions use their hero pages.
insert into heroes (id, slug, name, faction, class, hero_type, role, rarity, is_awakened) values
  (4, 'estrilda', 'Estrilda', 'Lightbearer', 'Warrior', 'strength', 'Burst Damage', 'elite', false),
  (5, 'nemora', 'Nemora', 'Wilder', 'Support', 'intelligence', 'Regen', 'elite', false),
  (9, 'brutus', 'Brutus', 'Mauler', 'Tank', 'strength', 'Tank', 'elite', false),
  (14, 'kaz', 'Kaz', 'Wilder', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (16, 'lyca', 'Lyca', 'Wilder', 'Ranger', 'agility', 'Buffer', 'elite', false),
  (20, 'belinda', 'Belinda', 'Lightbearer', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (25, 'grezhul', 'Grezhul', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (26, 'khasos', 'Khasos', 'Mauler', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (27, 'shemira', 'Shemira', 'Graveborn', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (28, 'tasi', 'Tasi', 'Wilder', 'Support', 'intelligence', 'Control', 'elite', false),
  (32, 'thoran', 'Thoran', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (33, 'isabella', 'Isabella', 'Graveborn', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (34, 'raine', 'Raine', 'Lightbearer', 'Support', 'agility', 'Buffer', 'elite', false),
  (35, 'vurk', 'Vurk', 'Mauler', 'Ranger', 'agility', 'AoE', 'elite', false),
  (36, 'numisu', 'Numisu', 'Mauler', 'Support', 'intelligence', 'Regen', 'elite', false),
  (37, 'fawkes', 'Fawkes', 'Lightbearer', 'Ranger', 'agility', 'Control', 'elite', false),
  (38, 'skreg', 'Skreg', 'Mauler', 'Tank', 'strength', 'Tank', 'elite', false),
  (39, 'nara', 'Nara', 'Graveborn', 'Warrior', 'strength', 'Assassin', 'elite', false),
  (41, 'ferael', 'Ferael', 'Graveborn', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (42, 'ulmus', 'Ulmus', 'Wilder', 'Tank', 'strength', 'Tank', 'elite', false),
  (43, 'warek', 'Warek', 'Mauler', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (44, 'lucius', 'Lucius', 'Lightbearer', 'Tank', 'strength', 'Regen', 'elite', false),
  (45, 'thane', 'Thane', 'Lightbearer', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (46, 'seirus', 'Seirus', 'Wilder', 'Warrior', 'strength', 'Tank', 'elite', false),
  (47, 'antandra', 'Antandra', 'Mauler', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (48, 'eironn', 'Eironn', 'Wilder', 'Ranger', 'agility', 'AoE', 'elite', false),
  (49, 'baden', 'Baden', 'Graveborn', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (50, 'hendrik', 'Hendrik', 'Lightbearer', 'Tank', 'strength', 'Tank', 'elite', false),
  (51, 'safiya', 'Safiya', 'Mauler', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (52, 'rowan', 'Rowan', 'Lightbearer', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (54, 'satrana', 'Satrana', 'Mauler', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (55, 'athalia', 'Athalia', 'Celestial', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (56, 'ezizh', 'Ezizh', 'Hypogean', 'Support', 'strength', 'Debuffer', 'elite', false),
  (57, 'gorvo', 'Gorvo', 'Wilder', 'Tank', 'strength', 'Tank', 'elite', false),
  (58, 'kelthur', 'Kelthur', 'Graveborn', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (59, 'mehira', 'Mehira', 'Hypogean', 'Mage', 'intelligence', 'Control', 'elite', false),
  (60, 'gwyneth', 'Gwyneth', 'Lightbearer', 'Ranger', 'strength', 'Continuous Damage', 'elite', false),
  (61, 'rosaline', 'Rosaline', 'Lightbearer', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (62, 'elijah-lailah', 'Elijah & Lailah', 'Celestial', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (63, 'silas', 'Silas', 'Graveborn', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (64, 'zolrath', 'Zolrath', 'Hypogean', 'Warrior', 'agility', 'Assassin', 'elite', false),
  (65, 'lorsan', 'Lorsan', 'Wilder', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (66, 'cecilia', 'Cecilia', 'Lightbearer', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (67, 'oden', 'Oden', 'Graveborn', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (68, 'rigby', 'Rigby', 'Lightbearer', 'Warrior', 'strength', 'Tank', 'elite', false),
  (69, 'orthros', 'Orthros', 'Celestial', 'Tank', 'strength', 'Tank', 'elite', false),
  (70, 'tidus', 'Tidus', 'Mauler', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (71, 'izold', 'Izold', 'Graveborn', 'Warrior', 'strength', 'Tank', 'elite', false),
  (72, 'oscar', 'Oscar', 'Lightbearer', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (73, 'talene', 'Talene', 'Celestial', 'Support', 'agility', 'Continuous Damage', 'elite', false),
  (74, 'saurus', 'Saurus', 'Wilder', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (75, 'nakoruru', 'Nakoruru', 'Dimensional', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (76, 'khazard', 'Khazard', 'Hypogean', 'Mage', 'intelligence', 'Control', 'elite', false),
  (77, 'drez', 'Drez', 'Mauler', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (78, 'arthur', 'Arthur', 'Dimensional', 'Tank', 'strength', 'Tank', 'elite', false),
  (80, 'solise', 'Solise', 'Wilder', 'Mage', 'intelligence', 'Control', 'elite', false),
  (83, 'skriath', 'Skriath', 'Mauler', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (84, 'wu-kong', 'Wu Kong', 'Celestial', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (85, 'mezoth', 'Mezoth', 'Hypogean', 'Tank', 'strength', 'Tank', 'elite', false),
  (86, 'ukyo', 'Ukyo', 'Dimensional', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (87, 'anoki', 'Anoki', 'Mauler', 'Warrior', 'strength', 'Control', 'elite', false),
  (88, 'torne', 'Torne', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (89, 'flora', 'Flora', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (90, 'daimon', 'Daimon', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (91, 'theowyn', 'Theowyn', 'Graveborn', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (92, 'ezio', 'Ezio', 'Dimensional', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (93, 'lucretia', 'Lucretia', 'Hypogean', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (94, 'pippa', 'Pippa', 'Wilder', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (95, 'prince-of-persia', 'Prince of Persia', 'Dimensional', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (96, 'zaphrael', 'Zaphrael', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (97, 'albedo', 'Albedo', 'Dimensional', 'Tank', 'strength', 'Tank', 'elite', false),
  (98, 'ainz-ooal-gown', 'Ainz Ooal Gown', 'Dimensional', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (99, 'mortas', 'Mortas', 'Hypogean', 'Support', 'agility', 'Regen', 'elite', false),
  (100, 'queen', 'QUEEN', 'Dimensional', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (101, 'joker', 'JOKER', 'Dimensional', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (102, 'alna', 'Alna', 'Celestial', 'Warrior', 'agility', 'Debuffer', 'elite', false),
  (103, 'kren', 'Kren', 'Mauler', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (104, 'respen', 'Respen', 'Wilder', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (105, 'eluard', 'Eluard', 'Lightbearer', 'Mage', 'intelligence', 'AoE', 'elite', false),
  (106, 'raku', 'Raku', 'Wilder', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (107, 'peggy', 'Peggy', 'Lightbearer', 'Support', 'intelligence', 'Regen', 'elite', false),
  (108, 'morael', 'Morael', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (109, 'desira', 'Desira', 'Graveborn', 'Support', 'intelligence', 'Regen', 'elite', false),
  (110, 'walker', 'Walker', 'Lightbearer', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (111, 'leofric', 'Leofric', 'Hypogean', 'Support', 'intelligence', 'Debuffer', 'elite', false),
  (112, 'merlin', 'Merlin', 'Dimensional', 'Support', 'intelligence', 'Regen', 'elite', false),
  (113, 'thali', 'Thali', 'Mauler', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (114, 'titus', 'Titus', 'Celestial', 'Tank', 'strength', 'Tank', 'elite', false),
  (115, 'hodgkin', 'Hodgkin', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (116, 'morrow', 'Morrow', 'Lightbearer', 'Mage', 'intelligence', 'Control', 'elite', false),
  (117, 'zikis', 'Zikis', 'Hypogean', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (118, 'granit', 'Granit', 'Mauler', 'Tank', 'strength', 'Tank', 'elite', false),
  (119, 'leonardo', 'Leonardo', 'Dimensional', 'Mage', 'intelligence', 'Control', 'elite', false),
  (120, 'mishka', 'Mishka', 'Wilder', 'Tank', 'strength', 'Control', 'elite', false),
  (121, 'haelus', 'Haelus', 'Celestial', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (122, 'treznor', 'Treznor', 'Graveborn', 'Ranger', 'agility', 'Control', 'elite', false),
  (123, 'thesku', 'Thesku', 'Mauler', 'Mage', 'intelligence', 'Control', 'elite', false),
  (124, 'awakened-talene', 'Awakened Talene', 'Celestial', 'Tank', 'intelligence', 'Buffer', 'legendary', true),
  (125, 'framton', 'Framton', 'Hypogean', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (126, 'astar', 'Astar', 'Wilder', 'Support', 'intelligence', 'Regen', 'elite', false),
  (127, 'scarlet', 'Scarlet', 'Lightbearer', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (128, 'melusina', 'Melusina', 'Dimensional', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (129, 'fane', 'Fane', 'Graveborn', 'Support', 'agility', 'Debuffer', 'elite', false),
  (130, 'awakened-ezizh', 'Awakened Ezizh', 'Hypogean', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (131, 'alaro', 'Alaro', 'Mauler', 'Support', 'agility', 'Buffer', 'elite', false),
  (132, 'audrae', 'Audrae', 'Celestial', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (133, 'oku', 'Oku', 'Wilder', 'Tank', 'strength', 'Tank', 'elite', false),
  (134, 'awakened-thane', 'Awakened Thane', 'Lightbearer', 'Ranger', 'agility', 'Burst Damage', 'legendary', true),
  (135, 'vyloris', 'Vyloris', 'Hypogean', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (136, 'sonja', 'Sonja', 'Lightbearer', 'Tank', 'agility', 'Buffer', 'elite', false),
  (137, 'anasta', 'Anasta', 'Mauler', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (138, 'kalene', 'Kalene', 'Graveborn', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (139, 'awakened-brutus', 'Awakened Brutus', 'Mauler', 'Warrior', 'strength', 'Continuous Damage', 'legendary', true),
  (140, 'joan-of-arc', 'Joan of Arc', 'Dimensional', 'Support', 'strength', 'Buffer', 'elite', false),
  (141, 'eorin', 'Eorin', 'Wilder', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (142, 'tarnos', 'Tarnos', 'Celestial', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (143, 'awakened-solise', 'Awakened Solise', 'Wilder', 'Support', 'intelligence', 'Regen', 'legendary', true),
  (144, 'geralt', 'Geralt', 'Dimensional', 'Warrior', 'agility', 'Regen', 'elite', false),
  (145, 'yennefer', 'Yennefer', 'Dimensional', 'Mage', 'intelligence', 'Regen', 'elite', false),
  (146, 'canisa-ruke', 'Canisa & Ruke', 'Hypogean', 'Tank', 'strength', 'Tank', 'elite', false),
  (147, 'nevanthi', 'Nevanthi', 'Wilder', 'Support', 'intelligence', 'Regen', 'elite', false),
  (148, 'awakened-baden', 'Awakened Baden', 'Graveborn', 'Ranger', 'strength', 'Continuous Damage', 'legendary', true),
  (149, 'salaki', 'Salaki', 'Mauler', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (150, 'palmer', 'Palmer', 'Lightbearer', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (151, 'veithael', 'Veithael', 'Celestial', 'Tank', 'agility', 'Tank', 'elite', false),
  (152, 'mulan', 'Mulan', 'Dimensional', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (153, 'awakened-belinda', 'Awakened Belinda', 'Lightbearer', 'Mage', 'intelligence', 'Burst Damage', 'legendary', true),
  (154, 'tamrus', 'Tamrus', 'Wilder', 'Warrior', 'agility', 'Control', 'elite', false),
  (155, 'olgath', 'Olgath', 'Hypogean', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (156, 'edwin', 'Edwin', 'Graveborn', 'Tank', 'strength', 'Tank', 'elite', false),
  (157, 'awakened-maetria', 'Awakened Maetria', 'Hypogean', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (158, 'crassio', 'Crassio', 'Mauler', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (159, 'emilia', 'Emilia', 'Dimensional', 'Mage', 'intelligence', 'Control', 'elite', false),
  (160, 'rem', 'Rem', 'Dimensional', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (161, 'awakened-athalia', 'Awakened Athalia', 'Celestial', 'Warrior', 'agility', 'Burst Damage', 'legendary', true),
  (162, 'ginneas', 'Ginneas', 'Lightbearer', 'Tank', 'strength', 'Tank', 'elite', false),
  (163, 'daemia', 'Daemia', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (164, 'trishea', 'Trishea', 'Wilder', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (165, 'awakened-safiya', 'Awakened Safiya', 'Mauler', 'Support', 'intelligence', 'Buffer', 'legendary', true),
  (166, 'ivan', 'Ivan', 'Graveborn', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (167, 'naroko', 'Naroko', 'Mauler', 'Tank', 'strength', 'Regen', 'elite', false),
  (168, 'lucilla', 'Lucilla', 'Hypogean', 'Support', 'strength', 'Debuffer', 'elite', false),
  (169, 'liberta', 'Liberta', 'Celestial', 'Support', 'intelligence', 'Continuous Damage', 'elite', false),
  (170, 'awakened-lyca', 'Awakened Lyca', 'Wilder', 'Ranger', 'agility', 'Continuous Damage', 'legendary', true),
  (171, 'jerome', 'Jerome', 'Lightbearer', 'Warrior', 'strength', 'Buff', 'elite', false),
  (172, 'robin-hood', 'Robin Hood', 'Dimensional', 'Ranger', 'agility', 'Debuffer', 'elite', false),
  (173, 'awakened-shemira', 'Awakened Shemira', 'Graveborn', 'Tank', 'intelligence', 'Tank', 'legendary', true),
  (174, 'lady-simona', 'Lady Simona', 'Graveborn', 'Mage', 'intelligence', 'Control', 'elite', false),
  (175, 'lavatune', 'Lavatune', 'Hypogean', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (176, 'vika', 'Vika', 'Mauler', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (177, 'awakened-gavus', 'Awakened Gavus', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (178, 'awakened-eugene', 'Awakened Eugene', 'Hypogean', 'Mage', 'intelligence', 'AoE', 'legendary', true),
  (179, 'atheus', 'Atheus', 'Wilder', 'Tank', 'intelligence', 'Tank', 'elite', false),
  (180, 'malkrie', 'Malkrie', 'Celestial', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (181, 'awakened-lucius', 'Awakened Lucius', 'Lightbearer', 'Tank', 'strength', 'Tank', 'legendary', true),
  (182, 'adrian-elyse', 'Adrian & Elyse', 'Lightbearer', 'Warrior', 'agility', 'Control', 'elite', false),
  (183, 'bronn', 'Bronn', 'Graveborn', 'Warrior', 'strength', 'Buffer', 'elite', false),
  (184, 'kalthin', 'Kalthin', 'Hypogean', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (185, 'hildwin', 'Hildwin', 'Draconis', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', false),
  (187, 'nyla', 'Nyla', 'Draconis', 'Support', 'intelligence', 'Control', 'elite', false),
  (188, 'pulina', 'Pulina', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (189, 'cassius', 'Cassius', 'Draconis', 'Tank', 'intelligence', 'Tank', 'elite', false),
  (193, 'villanelle', 'Villanelle', 'Mauler', 'Support', 'agility', 'Debuffer', 'elite', false),
  (194, 'shuna', 'Shuna', 'Dimensional', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (195, 'rimuru', 'Rimuru', 'Dimensional', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (196, 'awakened-antandra', 'Awakened Antandra', 'Mauler', 'Warrior', 'agility', 'Continuous Damage', 'legendary', true),
  (197, 'melion', 'Melion', 'Draconis', 'Support', 'intelligence', 'Control', 'elite', false),
  (198, 'raoul', 'Raoul', 'Lightbearer', 'Ranger', 'intelligence', 'Debuffer', 'elite', false),
  (199, 'lan', 'Lan', 'Draconis', 'Support', 'intelligence', 'Buffer', 'legendary', false),
  (200, 'misha', 'Misha', 'Wilder', 'Support', 'intelligence', 'Control', 'elite', false),
  (201, 'awakened-eironn', 'Awakened Eironn', 'Wilder', 'Ranger', 'agility', 'Continuous Damage', 'legendary', true),
  (202, 'aurelia', 'Aurelia', 'Celestial', 'Mage', 'intelligence', 'Buffer', 'elite', false),
  (203, 'kregor', 'Kregor', 'Draconis', 'Tank', 'strength', 'Buffer', 'elite', false),
  (204, 'randle', 'Randle', 'Graveborn', 'Support', 'agility', 'Continuous Damage', 'elite', false),
  (205, 'awakened-thoran', 'Awakened Thoran', 'Graveborn', 'Tank', 'strength', 'Tank', 'legendary', true),
  (206, 'knox', 'Knox', 'Hypogean', 'Support', 'intelligence', 'Debuffer', 'elite', false),
  (207, 'skylan', 'Skylan', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'legendary', false),
  (208, 'gorren', 'Gorren', 'Mauler', 'Ranger', 'agility', 'Buffer', 'elite', false),
  (209, 'awakened-zohra', 'Awakened Zohra', 'Celestial', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (210, 'shalltear-bloodfallen', 'Shalltear Bloodfallen', 'Dimensional', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (211, 'sion', 'Sion', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (212, 'haelia', 'Haelia', 'Draconis', 'Warrior', 'strength', 'Burst Damage', 'legendary', false),
  (213, 'mira', 'Mira', 'Graveborn', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (214, 'awakened-envydiel', 'Awakened Envydiel', 'Hypogean', 'Ranger', 'agility', 'Continuous Damage', 'legendary', true),
  (215, 'lysander', 'Lysander', 'Celestial', 'Ranger', 'agility', 'Buffer', 'elite', false),
  (216, 'velufira', 'Velufira', 'Draconis', 'Support', 'intelligence', 'Debuffer', 'elite', false),
  (217, 'marcille', 'Marcille', 'Dimensional', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (218, 'laios', 'Laios', 'Dimensional', 'Warrior', 'strength', 'Control', 'elite', false),
  (219, 'leviathan', 'Leviathan', 'Draconis', 'Tank', 'strength', 'Tank', 'legendary', false),
  (220, 'alvida', 'Alvida', 'Lightbearer', 'Tank', 'strength', 'Debuffer', 'elite', false),
  (221, 'awakened-estrilda', 'Awakened Estrilda', 'Lightbearer', 'Tank', 'strength', 'Tank', 'legendary', true),
  (222, 'umbriel', 'Umbriel', 'Draconis', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (223, 'serenmira', 'Serenmira', 'Hypogean', 'Mage', 'intelligence', 'Buffer', 'elite', false),
  (224, 'sung-jinwoo', 'Sung Jinwoo', 'Dimensional', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (225, 'cha-hae-in', 'Cha Hae-in', 'Dimensional', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (226, 'kaelon', 'Kaelon', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'legendary', false),
  (227, 'talimar', 'Talimar', 'Mauler', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (228, 'awakened-skriath', 'Awakened Skriath', 'Mauler', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (229, 'gorok', 'Gorok', 'Wilder', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (230, 'selene', 'Selene', 'Celestial', 'Mage', 'intelligence', 'Burst Damage', 'elite', false),
  (231, 'begris', 'Begris', 'Draconis', 'Warrior', 'strength', 'Buffer', 'elite', false),
  (232, 'awakened-fawkes', 'Awakened Fawkes', 'Graveborn', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (233, 'lethos', 'Lethos', 'Graveborn', 'Warrior', 'agility', 'Continuous Damage', 'elite', false),
  (234, 'elthara', 'Elthara', 'Draconis', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', false),
  (235, 'tavriel', 'Tavriel', 'Draconis', 'Support', 'intelligence', 'Buffer', 'elite', false),
  (236, 'saitama', 'Saitama', 'Dimensional', 'Warrior', 'strength', 'Continuous Damage', 'elite', false),
  (237, 'terrible-tornado', 'Terrible Tornado', 'Dimensional', 'Mage', 'intelligence', 'Buffer', 'elite', false),
  (238, 'awakened-pippa', 'Awakened Pippa', 'Wilder', 'Mage', 'intelligence', 'Continuous Damage', 'legendary', true),
  (239, 'icariel', 'Icariel', 'Wilder', 'Ranger', 'agility', 'Buffer', 'elite', false),
  (240, 'odysseus', 'Odysseus', 'Draconis', 'Tank', 'strength', 'Tank', 'legendary', false),
  (241, 'harvey', 'Harvey', 'Hypogean', 'Tank', 'strength', 'Tank', 'elite', false),
  (242, 'dracula', 'Dracula', 'Dimensional', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (243, 'serennia', 'Serennia', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'elite', false),
  (244, 'awakened-hybris', 'Awakened Hybris', 'Hypogean', 'Warrior', 'strength', 'Burst Damage', 'legendary', true),
  (245, 'misfortis', 'Misfortis', 'Celestial', 'Tank', 'intelligence', 'Tank', 'elite', false),
  (246, 'severin', 'Severin', 'Draconis', 'Ranger', 'agility', 'Continuous Damage', 'legendary', false),
  (247, 'judy-punch', 'Judy & Punch', 'Dimensional', 'Mage', 'intelligence', 'Continuous Damage', 'elite', false),
  (248, 'awakened-eluard', 'Awakened Eluard', 'Lightbearer', 'Mage', 'intelligence', 'Burst Damage', 'legendary', true),
  (249, 'trix', 'Trix', 'Hypogean', 'Ranger', 'agility', 'Assassin', 'elite', false),
  (250, 'kyno', 'Kyno', 'Draconis', 'Tank', 'strength', 'Buffer', 'elite', false),
  (251, 'athena', 'Athena', 'Dimensional', 'Tank', 'strength', 'Tank', 'elite', false),
  (252, 'medusa', 'Medusa', 'Dimensional', 'Ranger', 'agility', 'Control', 'elite', false),
  (253, 'thalassa', 'Thalassa', 'Draconis', 'Support', 'intelligence', 'Regen', 'legendary', false),
  (254, 'valeri', 'Valeri', 'Mauler', 'Tank', 'strength', 'Tank', 'elite', false),
  (255, 'oren', 'Oren', 'Lightbearer', 'Ranger', 'agility', 'Burst Damage', 'elite', false),
  (256, 'kafka-hibino', 'Kafka Hibino', 'Dimensional', 'Tank', 'strength', 'Buffer', 'elite', false),
  (257, 'kikoru-shinomiya', 'Kikoru Shinomiya', 'Dimensional', 'Warrior', 'strength', 'Burst Damage', 'elite', false)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, faction = excluded.faction,
  class = excluded.class, hero_type = excluded.hero_type, role = excluded.role, rarity = excluded.rarity,
  is_awakened = excluded.is_awakened;

update heroes awakened
set base_hero_id = base.id
from heroes base
where awakened.is_awakened
  and base.slug = regexp_replace(awakened.slug, '^awakened-', '');

insert into pets (id, slug, name, is_awakened) values
  (6001, 'dreary-ball', 'Dreary Ball', false),
  (6002, 'tufty-ears', 'Tufty Ears', false),
  (6003, 'grassy-orb', 'Grassy Orb', false),
  (6004, 'polar-beast', 'Polar Beast', false),
  (6005, 'fire-breather', 'Fire Breather', false),
  (6006, 'blade-ridge', 'Blade Ridge', false),
  (6007, 'winged-lion', 'Winged Lion', false),
  (6008, 'rock-crown-lizard', 'Rock Crown Lizard', false),
  (6009, 'feline-vesperio', 'Feline Vesperio', false),
  (6010, 'bellbellow', 'Bellbellow', false),
  (6011, 'flutterplume-owl', 'Flutterplume Owl', false),
  (6012, 'talismane', 'Talismane', false),
  (6013, 'phantasmoth', 'Phantasmoth', false),
  (6014, 'savage-souffle', 'Savage Soufflé', false),
  (6015, 'slumber-seal', 'Slumber Seal', false),
  (6016, 'fox-fatale', 'Fox Fatale', false),
  (6017, 'shroom-spooder', 'Shroom Spooder', false),
  (6018, 'radish-rotunda', 'Radish Rotunda', false),
  (6019, 'pandy-dumpty', 'Pandy Dumpty', false),
  (6020, 'ice-crown', 'Ice Crown', false),
  (6021, 'aureus', 'Aureus', false),
  (6022, 'pearlcrest-ibis', 'Pearlcrest Ibis', false),
  (6023, 'treatspector', 'Treatspector', false),
  (6024, 'joyous-roamer', 'Joyous Roamer', false),
  (6025, 'trickery-chest', 'Trickery Chest', false),
  (6026, 'thistlekin', 'Thistlekin', false),
  (6027, 'nightfall-pegasus', 'Nightfall Pegasus', false),
  (6028, 'count-snickerfang', 'Count Snickerfang', false),
  (6029, 'twinlum-spirit', 'Twinlum Spirit', false),
  (6030, 'blazefang', 'Blazefang', false)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, is_awakened = excluded.is_awakened;

insert into game_modes (slug, name, target_kind, enabled, sort_order, config) values
 ('twisted-realm',      'Twisted Realm',      'boss',   true, 1, '{"formations":[{"key":"team","label":"Team"}],"collections_enabled":true,"rules":"One team per run. Heroes are level-matched to the account Resonating Crystal level; record that shared hero level with the lineup. Gear and ascension still count. The boss rotates every couple of days.","result_fields":[{"key":"damage","label":"Damage dealt","type":"damage","placeholder":"e.g. 1.84B","required":true}]}'),
 ('nightmare-corridor', 'Nightmare Corridor', 'boss',   true, 2, '{"target_label":"Cycle anchor (6th boss)","target_all":"All cycles","formations":[{"key":"astral-devourer","label":"Astral Devourer"},{"key":"dual-mantle","label":"Dual-Mantle"},{"key":"cursed-capricornus","label":"Cursed Capricornus"},{"key":"netherspinner","label":"Netherspinner"},{"key":"molten-crystaline-worm","label":"Molten Crystaline Worm"},{"key":"cindercrow-specter","label":"Cindercrow Specter"}],"collections_enabled":true,"merc_max_per_submission":1,"rules":"Six teams, one for each boss in the cycle. Select the cycle by its 6th boss. Only Resonating Crystal heroes and up to one mercenary across the lineup. Record each boss kill time.","result_fields":[]}'),
 ('cursed-realm',       'Cursed Realm',       'boss',   true, 3, '{"formations":[{"key":"sg1","label":"SG1"},{"key":"sg2","label":"SG2"},{"key":"sg3","label":"SG3"},{"key":"sg4","label":"SG4"},{"key":"sg5","label":"SG5"},{"key":"boss","label":"Boss"}],"collections_enabled":false,"merc_max_per_submission":1,"unique_heroes_across_formations":true,"rules":"Six formations: five Shadow Guards and the boss. Heroes are level 360 with no artifact or union bonuses, up to one mercenary across the full lineup, and a hero can only appear once per run.","result_fields":[{"key":"damage","label":"Total damage across all six fights","type":"damage","placeholder":"e.g. 5.6B","required":true}]}'),
 ('treasure-scramble',  'Treasure Scramble',  'debuff', true, 4, '{"variable_formations":{"min":7,"max":7},"collections_enabled":false,"merc_max_per_submission":0,"unique_heroes_across_formations":true,"rules":"A lineup contains seven teams for one debuff cycle. Heroes are level 360 with no artifact bonuses, mercenaries are not allowed, and a hero can only appear once per run.","result_fields":[]}'),
 ('arena-of-heroes',    'Arena of Heroes',    'none',   false, 10, '{}'),
 ('legends-challenger', 'Legends'' Challenger','none',  false, 11, '{}'),
 ('temporal-rift',      'Temporal Rift',      'none',   false, 12, '{}')   -- season-long run with a hero pool; needs its own result fields (floor reached)
on conflict (slug) do update set
  name = excluded.name,
  target_kind = excluded.target_kind,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  config = excluded.config;

insert into targets (mode_id, slug, name)
select m.id, t.slug, t.name from game_modes m
join (values
  ('twisted-realm','kane','Kane'), ('twisted-realm','demonic-entity','Demonic Entity'),
  ('twisted-realm','the-unhinged','The Unhinged'), ('twisted-realm','ice-shemira','Ice Shemira'),
  ('twisted-realm','burning-brute','Burning Brute'), ('twisted-realm','grotesque-mage','Grotesque Mage'),
  ('cursed-realm','kane','Kane'), ('cursed-realm','demonic-entity','Demonic Entity'),
  ('cursed-realm','the-unhinged','The Unhinged'), ('cursed-realm','ice-shemira','Ice Shemira'),
  ('cursed-realm','burning-brute','Burning Brute'), ('cursed-realm','grotesque-mage','Grotesque Mage'),
  ('nightmare-corridor','abyssal-maestro','Abyssal Maestro'),
  ('nightmare-corridor','abyssal-murmur','Abyssal Murmur'),
  ('nightmare-corridor','abyssal-terror','Abyssal Terror'),
  ('nightmare-corridor','astral-devourer','Astral Devourer'),
  ('nightmare-corridor','blighted-seraph','Blighted Seraph'),
  ('nightmare-corridor','bloodvine-wraith','Bloodvine Wraith'),
  ('nightmare-corridor','burning-brute','Burning Brute'),
  ('nightmare-corridor','chimewarden','Chimewarden'),
  ('nightmare-corridor','clawlossus','Clawlossus'),
  ('nightmare-corridor','cruel-crow','Cruel Crow'),
  ('nightmare-corridor','cursed-caprihornus','Cursed Caprihornus'),
  ('nightmare-corridor','darkness-rising','Darkness Rising'),
  ('nightmare-corridor','demonic-nemora','Demonic Nemora'),
  ('nightmare-corridor','demonic-puppet','Demonic Puppet'),
  ('nightmare-corridor','dual-mantel','Dual-Mantel'),
  ('nightmare-corridor','dune-destroyer','Dune Destroyer'),
  ('nightmare-corridor','duskwailer','Duskwailer'),
  ('nightmare-corridor','fractured-fool','Fractured Fool'),
  ('nightmare-corridor','god-of-the-hunt','God of The Hunt'),
  ('nightmare-corridor','grotesque-mage','Grotesque Mage'),
  ('nightmare-corridor','ice-shemira','Ice Shemira'),
  ('nightmare-corridor','infernal-overlord','Infernal Overlord'),
  ('nightmare-corridor','kane','Kane'),
  ('nightmare-corridor','mask-curator','Mask Curator'),
  ('nightmare-corridor','mirror-demon','Mirror Demon'),
  ('nightmare-corridor','molten-crystalline-worm-queen','Molten Crystalline Worm Queen'),
  ('nightmare-corridor','morass-diabolus','Morass Diabolus'),
  ('nightmare-corridor','netherspinner','Netherspinner'),
  ('nightmare-corridor','nightmare-weaver','Nightmare Weaver'),
  ('nightmare-corridor','ossivorous-sphore','Ossivorous Sphore'),
  ('nightmare-corridor','pillar-of-justice','Pillar of Justice'),
  ('nightmare-corridor','raging-canon','Raging Canon'),
  ('nightmare-corridor','soulchain-night','Soulchain Night'),
  ('nightmare-corridor','soul-hound','Soul Hound'),
  ('nightmare-corridor','soulweaver','Soulweaver'),
  ('nightmare-corridor','sky-serpent','Sky Serpent'),
  ('nightmare-corridor','swamp-corrupter','Swamp Corrupter'),
  ('nightmare-corridor','the-devourer','The Devourer'),
  ('nightmare-corridor','the-fire-daemon','The Fire Daemon'),
  ('nightmare-corridor','the-light-martyr','The Light Martyr'),
  ('nightmare-corridor','the-unhinged','The Unhinged'),
  ('nightmare-corridor','wraith-reaver','Wraith Reaver'),
  ('treasure-scramble','fire','Fire'), ('treasure-scramble','frost','Frost'), ('treasure-scramble','forest','Forest'),
  ('treasure-scramble','fog','Fog'), ('treasure-scramble','fountain','Fountain')
) as t(mode_slug, slug, name) on t.mode_slug = m.slug
on conflict (mode_id, slug) do update set name = excluded.name;
