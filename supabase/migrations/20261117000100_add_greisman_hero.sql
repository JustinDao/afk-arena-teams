-- Add new hero Greisman (id 259, Graveborn Mage).
insert into heroes (id, slug, name, faction, class, hero_type, role, rarity, is_awakened) values
  (259, 'greisman', 'Greisman', 'Graveborn', 'Mage', 'intelligence', 'Debuffer', 'elite', false)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, faction = excluded.faction, class = excluded.class,
  hero_type = excluded.hero_type, role = excluded.role, rarity = excluded.rarity, is_awakened = excluded.is_awakened;

update heroes
set rec_category = 'standard-4f'
where id = 259
  and rec_category is null;
