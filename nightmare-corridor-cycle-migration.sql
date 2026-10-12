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
