-- New heroes found on the CDN: Gwyneth and Awakened Theowyn.
insert into heroes (id, slug, name, faction, class, hero_type, role, rarity, is_awakened) values
  (186, 'highborn-gwyneth', 'Gwyneth (Highborn)', 'Draconis', 'Tank', 'strength', 'Continuous Damage', 'legendary', false),
  (258, 'awakened-theowyn', 'Theowyn (Awakened)', 'Graveborn', 'Mage', 'intelligence', 'Buffer', 'legendary', true)
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, faction = excluded.faction, class = excluded.class,
  hero_type = excluded.hero_type, role = excluded.role, rarity = excluded.rarity, is_awakened = excluded.is_awakened;

update heroes set rec_category = case
  when is_awakened then 'awakened'
  else 'dragon-highborn'
end
where id in (186, 258) and rec_category is null;
