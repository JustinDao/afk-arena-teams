-- Add new Highborn Draconis hero Brenna (id 260, Draconis Warrior, Strength, Tank).
insert into heroes (id, slug, name, faction, class, hero_type, role, rarity, is_awakened) values
  (260, 'highborn-brenna', 'Brenna (Highborn)', 'Draconis', 'Warrior', 'strength', 'Tank', 'legendary', false)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, faction = excluded.faction, class = excluded.class,
  hero_type = excluded.hero_type, role = excluded.role, rarity = excluded.rarity, is_awakened = excluded.is_awakened;

update heroes
set rec_category = 'dragon-highborn'
where id = 260
  and rec_category is null;
