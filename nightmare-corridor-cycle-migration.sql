-- Add database-managed, ordered boss membership for Nightmare Corridor cycles.
-- Safe to run on an existing project; unlike schema.sql, this does not reset app data.

create table if not exists nightmare_corridor_cycle_bosses (
  cycle_anchor_id int not null references targets(id) on delete cascade,
  boss_target_id  int not null references targets(id) on delete cascade,
  position        smallint not null check (position between 1 and 6),
  primary key (cycle_anchor_id, position),
  unique (cycle_anchor_id, boss_target_id),
  check (cycle_anchor_id <> boss_target_id or position = 6)
);

alter table nightmare_corridor_cycle_bosses enable row level security;
drop policy if exists read_all on nightmare_corridor_cycle_bosses;
create policy read_all on nightmare_corridor_cycle_bosses for select using (true);
grant select on nightmare_corridor_cycle_bosses to anon, authenticated;

update game_modes
set config = config - 'formations'
where slug = 'nightmare-corridor';

insert into targets (mode_id, slug, name)
select gm.id, boss.slug, boss.name
from game_modes gm
join (values
  ('soulweaver', 'Soulweaver'),
  ('the-devourer', 'The Devourer'),
  ('astral-devourer', 'Astral Devourer'),
  ('dual-mantel', 'Dual-Mantel'),
  ('cursed-caprihornus', 'Cursed Caprihornus'),
  ('netherspinner', 'Netherspinner')
) as boss(slug, name) on true
where gm.slug = 'nightmare-corridor'
on conflict (mode_id, slug) do update set name = excluded.name;

insert into nightmare_corridor_cycle_bosses (cycle_anchor_id, boss_target_id, position)
select anchor.id, boss.id, cycle.position
from game_modes gm
join targets anchor on anchor.mode_id = gm.id and anchor.slug = 'netherspinner'
cross join (values
  (1, 'soulweaver'),
  (2, 'the-devourer'),
  (3, 'astral-devourer'),
  (4, 'dual-mantel'),
  (5, 'cursed-caprihornus'),
  (6, 'netherspinner')
) as cycle(position, boss_slug)
join targets boss on boss.mode_id = gm.id and boss.slug = cycle.boss_slug
where gm.slug = 'nightmare-corridor'
on conflict (cycle_anchor_id, position) do update set boss_target_id = excluded.boss_target_id;

do $$
declare
  cycle_count integer;
begin
  select count(*) into cycle_count
  from nightmare_corridor_cycle_bosses cycle
  join targets anchor on anchor.id = cycle.cycle_anchor_id
  join game_modes gm on gm.id = anchor.mode_id
  where gm.slug = 'nightmare-corridor' and anchor.slug = 'netherspinner';

  if cycle_count <> 6 then
    raise exception 'Nightmare Corridor Netherspinner cycle setup expected 6 bosses but found %; verify the game mode and target data.', cycle_count;
  end if;
end
$$;
