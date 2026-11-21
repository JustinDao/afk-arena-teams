-- Add 3 new collections from AFK Mine CDN (ids 21-23).
insert into collection_catalog (id, class, code_name, name, icon_url) values
  (21, 'Support', 'cursecarrier', 'Cinder Obsidian', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/21_cl.webp'),
  (22, 'Tank', 'bdruid', 'Wild Spirit Pact', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/22_cl.webp'),
  (23, 'Warrior', 'admiral', 'Wayfinder''s Mirror', 'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/23_cl.webp')
on conflict (id) do update set
  class = excluded.class,
  code_name = excluded.code_name,
  name = excluded.name,
  icon_url = excluded.icon_url;
