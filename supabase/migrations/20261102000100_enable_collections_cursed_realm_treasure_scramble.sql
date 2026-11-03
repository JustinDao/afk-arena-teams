update public.game_modes
set config = jsonb_set(config, '{collections_enabled}', 'true'::jsonb, true)
where slug in ('cursed-realm', 'treasure-scramble');
