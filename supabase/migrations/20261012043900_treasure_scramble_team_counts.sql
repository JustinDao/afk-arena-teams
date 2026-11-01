-- Treasure Scramble lineups can use between two and seven teams, depending on the division.
update game_modes
set config = jsonb_set(
      jsonb_set(config, '{variable_formations}', '{"min":2,"max":7,"default":7}'::jsonb),
      '{rules}',
      to_jsonb('A lineup contains two to seven teams, depending on the division, for one debuff cycle. Heroes are level 360 with no artifact bonuses, mercenaries are not allowed, and a hero can only appear once per run.'::text)
    )
where slug = 'treasure-scramble';
