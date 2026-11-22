-- Remove accidental 'swap' TS target (TheAFKGuys typo for Swamp/Fog).
delete from targets
where slug = 'swap'
  and mode_id = (select id from game_modes where slug = 'treasure-scramble');
