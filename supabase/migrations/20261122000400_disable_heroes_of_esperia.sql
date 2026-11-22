-- Disable Heroes of Esperia mode for now (no clean infographic guides to ingest yet).
update public.game_modes
set enabled = false
where slug = 'heroes-of-esperia';
