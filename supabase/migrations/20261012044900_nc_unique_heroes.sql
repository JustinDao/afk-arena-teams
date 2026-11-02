update game_modes
set config = config || '{"unique_heroes_across_formations": true}'::jsonb
where slug = 'nightmare-corridor';
