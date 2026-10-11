-- Add public example lineups after schema.sql.
-- Safe to run more than once: each example is inserted only once by seed_key.
-- These are illustrative examples, not current-cycle recommendations.

alter table submissions add column if not exists seed_key text;
create unique index if not exists submissions_seed_key on submissions (seed_key);

do $$
declare
  v_seed record;
  v_mode_id smallint;
  v_target_id int;
  v_submission_id bigint;
  v_form record;
  v_hero jsonb;
  v_formation_id bigint;
  v_hero_id int;
  v_pet_id int;
begin
  for v_seed in
    select * from (values
      (
        'example-twisted-realm-ice-shemira',
        'twisted-realm',
        'ice-shemira',
        '{"damage":1840000000}'::jsonb,
        450::smallint,
        'Illustrative seeded example; verify the current boss rotation and results before using.',
        '[
          {"key":"team","label":"Team","pet":"dreary-ball","pet_level":18,"time":null,"heroes":[
            {"slug":"shemira","si":30,"furniture":9,"engraving":60},
            {"slug":"lucretia","si":30,"furniture":9,"engraving":60},
            {"slug":"silas","si":30,"furniture":9,"engraving":30},
            {"slug":"daimon","si":20,"furniture":9,"engraving":30},
            {"slug":"ezizh","si":30,"furniture":9,"engraving":60}
          ]}
        ]'::jsonb
      ),
      (
        'example-nightmare-corridor-cindercrow',
        'nightmare-corridor',
        'cindercrow-specter',
        '{}'::jsonb,
        null::smallint,
        'Illustrative seeded example; verify the current cycle and results before using.',
        '[
          {"key":"astral-devourer","label":"Astral Devourer","pet":"dreary-ball","pet_level":18,"time":142,"heroes":["rowan","lyca","lorsan","ezizh","raine"]},
          {"key":"dual-mantle","label":"Dual-Mantle","pet":"pandy-dumpty","pet_level":18,"time":171,"heroes":["odysseus","orthros","liberta","palmer","talimar"]},
          {"key":"cursed-capricornus","label":"Cursed Capricornus","pet":"tufty-ears","pet_level":18,"time":205,"heroes":["belinda","silas","rosaline","daimon","scarlet"]},
          {"key":"netherspinner","label":"Netherspinner","pet":"grassy-orb","pet_level":18,"time":189,"heroes":["tavriel","gorok","lavatune","lan","mortas"]},
          {"key":"molten-crystaline-worm","label":"Molten Crystaline Worm","pet":"polar-beast","pet_level":18,"time":196,"heroes":["saurus","mishka","scarlet","oden","mortas"]},
          {"key":"cindercrow-specter","label":"Cindercrow Specter","pet":"fire-breather","pet_level":18,"time":178,"heroes":["rowan","lyca","lorsan","ezizh","raine"]}
        ]'::jsonb
      ),
      (
        'example-cursed-realm-ice-shemira',
        'cursed-realm',
        'ice-shemira',
        '{"damage":5600000000}'::jsonb,
        null::smallint,
        'Illustrative seeded example; verify the current boss rotation and results before using.',
        '[
          {"key":"sg1","label":"SG1","pet":"dreary-ball","pet_level":18,"heroes":["rowan","lyca","lorsan","ezizh","raine"]},
          {"key":"sg2","label":"SG2","pet":"tufty-ears","pet_level":18,"heroes":["talimar","tavriel","gorok","lavatune","elthara"]},
          {"key":"sg3","label":"SG3","pet":"grassy-orb","pet_level":18,"heroes":["dracula","awakened-hybris","lysander","leviathan","serenmira"]},
          {"key":"sg4","label":"SG4","pet":"polar-beast","pet_level":18,"heroes":["melion","sion","laios","marcille","velufira"]},
          {"key":"sg5","label":"SG5","pet":"fire-breather","pet_level":18,"heroes":["aurelia","knox","lan","jerome","misfortis"]},
          {"key":"boss","label":"Boss","pet":"blade-ridge","pet_level":18,"heroes":[
            {"slug":"belinda","si":30,"furniture":9,"engraving":60},
            {"slug":"shemira","si":30,"furniture":9,"engraving":60,"merc":true},
            {"slug":"silas","si":30,"furniture":9,"engraving":30},
            {"slug":"lucretia","si":30,"furniture":9,"engraving":60},
            {"slug":"daimon","si":30,"furniture":9,"engraving":30}
          ]}
        ]'::jsonb
      ),
      (
        'example-treasure-scramble-fire',
        'treasure-scramble',
        'fire',
        '{"placementType":"percent","placement":1}'::jsonb,
        null::smallint,
        'Illustrative seeded example; verify the current debuff cycle and results before using.',
        '[
          {"key":"t1","label":"Team 1","pet":"flutterplume-owl","pet_level":18,"heroes":["rowan","lyca","lorsan","ezizh","raine"]},
          {"key":"t2","label":"Team 2","pet":"talismane","pet_level":18,"heroes":["belinda","silas","rosaline","lucius","shemira"]},
          {"key":"t3","label":"Team 3","pet":"phantasmoth","pet_level":18,"heroes":["saurus","mishka","scarlet","oden","mortas"]},
          {"key":"t4","label":"Team 4","pet":"savage-souffle","pet_level":18,"heroes":["brutus","thoran","daimon","ferael","tasi"]},
          {"key":"t5","label":"Team 5","pet":"slumber-seal","pet_level":18,"heroes":["albedo","merlin","arthur","mehira","zolrath"]},
          {"key":"t6","label":"Team 6","pet":"fox-fatale","pet_level":18,"heroes":["eironn","grezhul","nara","talene","athalia"]},
          {"key":"t7","label":"Team 7","pet":"shroom-spooder","pet_level":18,"heroes":["palmer","liberta","veithael","anasta","hodgkin"]}
        ]'::jsonb
      )
    ) as seeds(seed_key, mode_slug, target_slug, result, hero_level, notes, formations)
  loop
    if exists (select 1 from submissions where seed_key = v_seed.seed_key) then
      continue;
    end if;

    select id into v_mode_id from game_modes
    where slug = v_seed.mode_slug and enabled;
    if not found then
      raise exception 'Cannot seed example lineup: enabled mode "%" not found.', v_seed.mode_slug;
    end if;

    select id into v_target_id from targets
    where mode_id = v_mode_id and slug = v_seed.target_slug;
    if not found then
      raise exception 'Cannot seed example lineup: target "%" not found for mode "%".',
        v_seed.target_slug, v_seed.mode_slug;
    end if;

    insert into submissions (seed_key, mode_id, target_id, result, hero_level, notes)
    values (v_seed.seed_key, v_mode_id, v_target_id, v_seed.result, v_seed.hero_level, v_seed.notes)
    returning id into v_submission_id;

    for v_form in
      select value, ordinality::smallint as slot_order
      from jsonb_array_elements(v_seed.formations) with ordinality
    loop
      v_pet_id := null;
      if v_form.value ? 'pet' then
        select id into v_pet_id from pets where slug = v_form.value ->> 'pet';
        if not found then
          raise exception 'Cannot seed example lineup: pet "%" not found.', v_form.value ->> 'pet';
        end if;
      end if;

      insert into formations (
        submission_id, slot_key, slot_label, slot_order, pet_id, pet_level, result_time_seconds
      ) values (
        v_submission_id,
        v_form.value ->> 'key',
        v_form.value ->> 'label',
        v_form.slot_order,
        v_pet_id,
        nullif(v_form.value ->> 'pet_level', '')::smallint,
        nullif(v_form.value ->> 'time', '')::int
      )
      returning id into v_formation_id;

      for v_hero in select value from jsonb_array_elements(v_form.value -> 'heroes')
      loop
        if jsonb_typeof(v_hero) = 'string' then
          v_hero := jsonb_build_object('slug', v_hero #>> '{}');
        end if;
        select id into v_hero_id from heroes where slug = v_hero ->> 'slug';
        if not found then
          raise exception 'Cannot seed example lineup: hero "%" not found.', v_hero ->> 'slug';
        end if;

        insert into formation_heroes (
          formation_id, submission_id, position, hero_id, is_merc, si, furniture, engraving
        ) values (
          v_formation_id,
          v_submission_id,
          (select count(*)::smallint from formation_heroes where formation_id = v_formation_id),
          v_hero_id,
          coalesce((v_hero ->> 'merc')::boolean, false),
          nullif(v_hero ->> 'si', '')::smallint,
          nullif(v_hero ->> 'furniture', '')::smallint,
          nullif(v_hero ->> 'engraving', '')::smallint
        );
      end loop;
    end loop;
  end loop;
end;
$$;
