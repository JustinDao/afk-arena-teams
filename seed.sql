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
  v_collection jsonb;
begin
  for v_seed in
    select * from (values
      (
        'nc-guide-2026-10-infernal-overlord',
        'nightmare-corridor',
        'infernal-overlord',
        '{}'::jsonb,
        null::smallint,
        'Source: r/afkarena Nightmare Corridor 0:53 guide (Oct 2026) by ManuelAlcayaga and Rakudayyy.

Hero notes:
R1: Alvida E36 haste; Misha E65 DEF, 15F on mid and bottom
R2: none
R3: Sion E68 ATK CRIT CDA; Pippa E61 haste
R4: Envydiel E67 ATK PP CRIT; Aurelia E62 haste; Talimar E61 haste; Thalassa E61 heal
R5: Lysander E62 PP haste; Estrilda E61 haste; Begris E41 HP haste dodge
R6: Hybris E68 ATK PP IS CRIT; Lavatune E62 IS haste; Athena E33 TY',
        '[
          {"key":"molten-crystalline-worm-queen","label":"Molten Crystalline Worm Queen","pet":"twinlum-spirit","pet_level":18,"time":6,"heroes":[
            {"slug":"highborn-elthara","si":40,"furniture":9,"engraving":60,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"erosion","tier":"mythic"},{"slotIndex":1,"stat":"mp","tier":"mythic"}]}},
            {"slug":"alvida","si":40,"furniture":9,"engraving":36,"collection":{"catalog":3,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"}]}},
            {"slug":"rowan","si":30,"furniture":0,"engraving":0,"collection":{"catalog":15,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"misha","si":40,"furniture":15,"engraving":65,"collection":{"catalog":9,"nodes":[{"slotIndex":0,"stat":"err","tier":"mythic"},{"slotIndex":1,"stat":"def","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"highborn-severin","si":40,"furniture":9,"engraving":60,"collection":{"catalog":13,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":1,"stat":"atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}}
          ]},
          {"key":"cindercrow-specter","label":"Cindercrow Specter","pet":"blazefang","pet_level":27,"time":9,"heroes":[
            {"slug":"misfortis","si":30,"furniture":9,"engraving":60,"collection":{"catalog":17,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"highborn-lan","si":40,"furniture":9,"engraving":0,"collection":{"catalog":15,"nodes":[{"slotIndex":0,"stat":"atk","tier":"mythic"},{"slotIndex":1,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"highborn-kaelon","si":40,"furniture":9,"engraving":60,"collection":{"catalog":13,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"awakened-safiya","collection":{"catalog":15,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"kyno","si":30,"furniture":9,"engraving":60,"collection":{"catalog":17,"nodes":[{"slotIndex":0,"stat":"def","tier":"mythic"},{"slotIndex":1,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}}
          ]},
          {"key":"demonic-puppet","label":"Demonic Puppet","pet":"count-snickerfang","pet_level":27,"time":7,"heroes":[
            {"slug":"sion","si":40,"furniture":12,"engraving":68,"collection":{"catalog":13,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"harvey","si":30,"furniture":9,"engraving":60,"collection":{"catalog":3,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"}]}},
            {"slug":"tavriel","si":20,"furniture":0,"engraving":60,"collection":{"catalog":15,"nodes":[{"slotIndex":0,"stat":"is","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"kafka-hibino","si":30,"furniture":9,"engraving":30,"collection":{"catalog":3,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"}]}},
            {"slug":"awakened-pippa","si":40,"furniture":12,"engraving":61,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"is","tier":"mythic"}]}}
          ]},
          {"key":"ashen-prophet","label":"Ashen Prophet","pet":"aureus","pet_level":18,"time":14,"heroes":[
            {"slug":"awakened-envydiel","si":40,"furniture":12,"engraving":67,"collection":{"catalog":13,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"aurelia","si":40,"furniture":9,"engraving":62,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"erosion","tier":"mythic"}]}},
            {"slug":"gorok","si":20,"furniture":3,"engraving":30,"collection":{"catalog":11,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":1,"stat":"buffer","tier":"mythic"}]}},
            {"slug":"talimar","si":30,"furniture":9,"engraving":61,"collection":{"catalog":15,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"highborn-thalassa","si":40,"furniture":12,"engraving":61,"collection":{"catalog":10,"nodes":[{"slotIndex":0,"stat":"heal","tier":"mythic"},{"slotIndex":1,"stat":"full_atk","tier":"mythic"}]}}
          ]},
          {"key":"mirror-demon","label":"Mirror Demon","pet":"nightfall-pegasus","pet_level":27,"time":13,"heroes":[
            {"slug":"lysander","si":30,"furniture":9,"engraving":62,"collection":{"catalog":13,"nodes":[{"slotIndex":0,"stat":"pp","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"daemia","si":30,"furniture":9,"engraving":60,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":1,"stat":"mp","tier":"mythic"}]}},
            {"slug":"awakened-eluard","si":40,"furniture":9,"engraving":60,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"awakened-estrilda","si":40,"furniture":9,"engraving":61,"collection":{"catalog":3,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"}]}},
            {"slug":"begris","si":40,"furniture":12,"engraving":41,"collection":{"catalog":11,"nodes":[{"slotIndex":0,"stat":"ty","tier":"mythic"}]}}
          ]},
          {"key":"infernal-overlord","label":"Infernal Overlord","pet":"trickery-chest","pet_level":18,"time":6,"heroes":[
            {"slug":"awakened-hybris","si":40,"furniture":9,"engraving":68,"collection":{"catalog":2,"nodes":[{"slotIndex":0,"stat":"cda","tier":"mythic"},{"slotIndex":1,"stat":"atk","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"lavatune","si":40,"furniture":12,"engraving":62,"collection":{"catalog":9,"nodes":[{"slotIndex":0,"stat":"err","tier":"mythic"},{"slotIndex":1,"stat":"is","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"awakened-theowyn","si":40,"furniture":9,"engraving":60,"collection":{"catalog":9,"nodes":[{"slotIndex":0,"stat":"err","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}},
            {"slug":"dracula","si":30,"furniture":9,"engraving":30,"collection":{"catalog":14,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":1,"stat":"ll","tier":"mythic"}]}},
            {"slug":"athena","si":30,"furniture":12,"engraving":33,"collection":{"catalog":17,"nodes":[{"slotIndex":0,"stat":"full_atk","tier":"mythic"},{"slotIndex":1,"stat":"hp","tier":"mythic"},{"slotIndex":6,"stat":"skill_level","tier":"mythic"},{"slotIndex":7,"stat":"skill_level","tier":"mythic"}]}}
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
          update formations
          set pet_id = (select id from pets where slug = v_form.value ->> 'pet'),
              pet_level = nullif(v_form.value ->> 'pet_level', '')::smallint,
              result_time_seconds = nullif(v_form.value ->> 'time', '')::int
          where id = v_formation_id and v_form.value ? 'pet';
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

            select id into v_hero_id from heroes where slug = v_hero ->> 'slug';

            v_collection := v_hero -> 'collection';
        if v_collection is not null then
          insert into formation_collections (
            submission_id, formation_id, hero_id, catalog_id, collection_class, collection_name, nodes
          )
          select v_submission_id, v_formation_id, v_hero_id, cc.id, cc.class, cc.name, v_collection -> 'nodes'
          from collection_catalog cc
          where cc.id = (v_collection ->> 'catalog')::smallint
          on conflict (formation_id, hero_id) do update
            set catalog_id = excluded.catalog_id, collection_class = excluded.collection_class,
                collection_name = excluded.collection_name, nodes = excluded.nodes;
          if not found then
            raise exception 'Cannot seed example lineup: collection "%" not found.', v_collection ->> 'catalog';
          end if;
        end if;
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

        v_collection := v_hero -> 'collection';
        if v_collection is not null then
          insert into formation_collections (
            submission_id, formation_id, hero_id, catalog_id, collection_class, collection_name, nodes
          )
          select v_submission_id, v_formation_id, v_hero_id, cc.id, cc.class, cc.name, v_collection -> 'nodes'
          from collection_catalog cc
          where cc.id = (v_collection ->> 'catalog')::smallint
          on conflict (formation_id, hero_id) do update
            set catalog_id = excluded.catalog_id, collection_class = excluded.collection_class,
                collection_name = excluded.collection_name, nodes = excluded.nodes;
          if not found then
            raise exception 'Cannot seed example lineup: collection "%" not found.', v_collection ->> 'catalog';
          end if;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;
