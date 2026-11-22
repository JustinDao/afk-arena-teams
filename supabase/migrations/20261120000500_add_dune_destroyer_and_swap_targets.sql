-- Add Dune Destroyer (Cursed Realm) and Swap (Treasure Scramble) targets.
insert into targets (mode_id, slug, name)
select gm.id, v.slug, v.name
from game_modes gm
cross join (values
  ('cursed-realm', 'dune-destroyer', 'Dune Destroyer'),
  ('treasure-scramble', 'swap', 'Swap')
) as v(mode_slug, slug, name)
where gm.slug = v.mode_slug
on conflict (mode_id, slug) do update set
  name = excluded.name;
