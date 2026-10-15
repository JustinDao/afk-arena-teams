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
  v_hero_entry record;
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
            {"slug":"shemira","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lucretia","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"silas","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"daimon","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"ezizh","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]}
        ]'::jsonb
      ),
      (
        'example-nightmare-corridor-netherspinner',
        'nightmare-corridor',
        'netherspinner',
        '{}'::jsonb,
        null::smallint,
        'Illustrative seeded example; verify the current cycle and results before using.',
        '[
          {"key":"soulweaver","label":"Soulweaver","pet":"polar-beast","pet_level":18,"time":196,"heroes":[
            {"slug":"saurus","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"mishka","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"scarlet","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"oden","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"mortas","ascension":"ascended","si":20,"furniture":9,"engraving":0}
          ]},
          {"key":"the-devourer","label":"The Devourer","pet":"fire-breather","pet_level":18,"time":178,"heroes":[
            {"slug":"rowan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lyca","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lorsan","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"ezizh","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"raine","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]},
          {"key":"astral-devourer","label":"Astral Devourer","pet":"dreary-ball","pet_level":18,"time":142,"heroes":[
            {"slug":"dracula","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"awakened-hybris","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"awakened-estrilda","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lyca","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"rowan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"dual-mantle","label":"Dual-Mantle","pet":"pandy-dumpty","pet_level":18,"time":171,"heroes":[
            {"slug":"odysseus","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"orthros","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"liberta","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"palmer","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"talimar","ascension":"ascended_1","si":30,"furniture":9,"engraving":60,"merc":true}
          ]},
          {"key":"cursed-caprihornus","label":"Cursed Caprihornus","pet":"tufty-ears","pet_level":18,"time":205,"heroes":[
            {"slug":"elthara","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"alvida","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"rowan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"misha","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"severin","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]},
          {"key":"netherspinner","label":"Netherspinner","pet":"grassy-orb","pet_level":18,"time":189,"heroes":[
            {"slug":"tavriel","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"gorok","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lavatune","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"talimar","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lan","ascension":"ascended_1","si":20,"furniture":9,"engraving":30}
          ]}
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
          {"key":"sg1","label":"SG1","pet":"dreary-ball","pet_level":18,"heroes":[
            {"slug":"rowan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lyca","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lorsan","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"ezizh","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"raine","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]},
          {"key":"sg2","label":"SG2","pet":"tufty-ears","pet_level":18,"heroes":[
            {"slug":"talimar","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"tavriel","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"gorok","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lavatune","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"elthara","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"sg3","label":"SG3","pet":"grassy-orb","pet_level":18,"heroes":[
            {"slug":"dracula","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"awakened-hybris","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lysander","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"leviathan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"serenmira","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"sg4","label":"SG4","pet":"polar-beast","pet_level":18,"heroes":[
            {"slug":"melion","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"sion","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"laios","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"marcille","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"velufira","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"sg5","label":"SG5","pet":"fire-breather","pet_level":18,"heroes":[
            {"slug":"aurelia","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"knox","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lan","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"jerome","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"misfortis","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"boss","label":"Boss","pet":"blade-ridge","pet_level":18,"heroes":[
            {"slug":"belinda","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"shemira","ascension":"ascended_1","si":30,"furniture":9,"engraving":60,"merc":true},
            {"slug":"silas","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lucretia","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"daimon","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
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
          {"key":"t1","label":"Team 1","pet":"flutterplume-owl","pet_level":18,"heroes":[
            {"slug":"rowan","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"lyca","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lorsan","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"ezizh","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"raine","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]},
          {"key":"t2","label":"Team 2","pet":"talismane","pet_level":18,"heroes":[
            {"slug":"belinda","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"silas","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"rosaline","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"lucius","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"shemira","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"t3","label":"Team 3","pet":"phantasmoth","pet_level":18,"heroes":[
            {"slug":"saurus","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"mishka","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"scarlet","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"oden","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"mortas","ascension":"ascended","si":20,"furniture":9,"engraving":0}
          ]},
          {"key":"t4","label":"Team 4","pet":"savage-souffle","pet_level":18,"heroes":[
            {"slug":"brutus","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"thoran","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"daimon","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"ferael","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"tasi","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]},
          {"key":"t5","label":"Team 5","pet":"slumber-seal","pet_level":18,"heroes":[
            {"slug":"albedo","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"merlin","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"arthur","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"mehira","ascension":"ascended","si":30,"furniture":9,"engraving":0},
            {"slug":"zolrath","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"t6","label":"Team 6","pet":"fox-fatale","pet_level":18,"heroes":[
            {"slug":"eironn","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"grezhul","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"nara","ascension":"ascended_1","si":30,"furniture":9,"engraving":30},
            {"slug":"talene","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"athalia","ascension":"ascended_1","si":30,"furniture":9,"engraving":60}
          ]},
          {"key":"t7","label":"Team 7","pet":"shroom-spooder","pet_level":18,"heroes":[
            {"slug":"palmer","ascension":"ascended_1","si":20,"furniture":9,"engraving":30},
            {"slug":"liberta","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"veithael","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"anasta","ascension":"ascended_1","si":30,"furniture":9,"engraving":60},
            {"slug":"hodgkin","ascension":"ascended_1","si":30,"furniture":9,"engraving":30}
          ]}
        ]'::jsonb
      )
    ) as seeds(seed_key, mode_slug, target_slug, result, hero_level, notes, formations)
  loop
    if exists (select 1 from submissions where seed_key = v_seed.seed_key) then
      -- Update existing seeded formation_heroes with latest investments and ascensions
      select id into v_submission_id from submissions where seed_key = v_seed.seed_key;
      for v_form in
        select value, ordinality::smallint as slot_order
        from jsonb_array_elements(v_seed.formations) with ordinality
      loop
        select id into v_formation_id from formations
        where submission_id = v_submission_id and slot_key = (v_form.value ->> 'key');

        if found then
          for v_hero_entry in select value, (ordinality - 1)::smallint as pos
                             from jsonb_array_elements(v_form.value -> 'heroes') with ordinality
          loop
            v_hero := v_hero_entry.value;
            if jsonb_typeof(v_hero) = 'string' then
              v_hero := jsonb_build_object('slug', v_hero #>> '{}');
            end if;

            update formation_heroes
            set si = nullif(v_hero ->> 'si', '')::smallint,
                furniture = nullif(v_hero ->> 'furniture', '')::smallint,
                engraving = nullif(v_hero ->> 'engraving', '')::smallint,
                ascension = coalesce(
                  nullif(v_hero ->> 'ascension', ''),
                  case
                    when nullif(v_hero ->> 'engraving', '')::smallint is not null or nullif(v_hero ->> 'furniture', '')::smallint is not null or nullif(v_hero ->> 'si', '')::smallint is not null then 'ascended_1'
                    else 'ascended'
                  end
                ),
                is_merc = coalesce((v_hero ->> 'merc')::boolean, false)
            where formation_id = v_formation_id and position = v_hero_entry.pos;
          end loop;
        end if;
      end loop;
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
          formation_id, submission_id, position, hero_id, is_merc, si, furniture, engraving, ascension
        ) values (
          v_formation_id,
          v_submission_id,
          (select count(*)::smallint from formation_heroes where formation_id = v_formation_id),
          v_hero_id,
          coalesce((v_hero ->> 'merc')::boolean, false),
          nullif(v_hero ->> 'si', '')::smallint,
          nullif(v_hero ->> 'furniture', '')::smallint,
          nullif(v_hero ->> 'engraving', '')::smallint,
          coalesce(
            nullif(v_hero ->> 'ascension', ''),
            case
              when nullif(v_hero ->> 'engraving', '')::smallint is not null or nullif(v_hero ->> 'furniture', '')::smallint is not null or nullif(v_hero ->> 'si', '')::smallint is not null then 'ascended_1'
              else 'ascended'
            end
          )
        );
      end loop;
    end loop;
  end loop;
end;
$$;
