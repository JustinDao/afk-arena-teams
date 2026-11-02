-- Ashen Prophet boss and the October 2026 Nightmare Corridor cycle, anchored on Infernal Overlord.
insert into targets (mode_id, slug, name)
select id, 'ashen-prophet', 'Ashen Prophet' from game_modes where slug = 'nightmare-corridor'
on conflict (mode_id, slug) do update set name = excluded.name;

insert into nightmare_corridor_cycle_bosses (cycle_anchor_id, boss_target_id, position)
select anchor.id, boss.id, cycle.position
from game_modes gm
join targets anchor on anchor.mode_id = gm.id and anchor.slug = 'infernal-overlord'
cross join (values
  (1, 'molten-crystalline-worm-queen'),
  (2, 'cindercrow-specter'),
  (3, 'demonic-puppet'),
  (4, 'ashen-prophet'),
  (5, 'mirror-demon'),
  (6, 'infernal-overlord')
) as cycle(position, boss_slug)
join targets boss on boss.mode_id = gm.id and boss.slug = cycle.boss_slug
where gm.slug = 'nightmare-corridor'
on conflict (cycle_anchor_id, position) do update set boss_target_id = excluded.boss_target_id;
