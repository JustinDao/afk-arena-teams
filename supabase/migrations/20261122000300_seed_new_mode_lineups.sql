-- Seed verified Temporal Rift S16, HFC Wrizz No Earrings, and AbEx Boss Comps lineups.
-- Idempotent via submissions.seed_key.

alter table public.submissions add column if not exists seed_key text;
create unique index if not exists submissions_seed_key on public.submissions (seed_key);

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
      ('trift-s16-mugen-2026', 'temporal-rift', 's16', '{"floor": 300}'::jsonb, null::smallint, 'Source: r/afkarena Temporal Rift S16 Guide (u/Mugen_Tsukuyomi / ManuelAlcayaga & Rakudayyy). Prioritize Trait Enhancer & Indomitable Shield beacons; T1 Palmer needs MP stack, T2 Pegasus 18/27, T3 Athena over AThoran for stamina, T4 Axe badge, T5 Shields + never IS on Velufira.', '[{"key": "t1", "label": "Team 1", "heroes": [{"slug": "adrian-elyse", "si": 40, "furniture": 9, "engraving": 36, "collection": {"catalog": 1, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "misfortis", "si": 30, "furniture": 3, "engraving": 61, "collection": {"catalog": 3, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "awakened-belinda", "si": 40, "furniture": 9, "engraving": 60, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "cda", "tier": "mythic"}, {"slotIndex": 0, "stat": "atk", "tier": "mythic"}]}}, {"slug": "lavatune", "si": 40, "furniture": 12, "engraving": 62, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "err", "tier": "mythic"}, {"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}, {"slug": "shuna", "si": 30, "furniture": 9, "engraving": 36, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}], "pet": "trickery-chest", "pet_level": 18}, {"key": "t2", "label": "Team 2", "heroes": [{"slug": "alvida", "si": 40, "furniture": 9, "engraving": 36, "collection": {"catalog": 3, "nodes": [{"slotIndex": 0, "stat": "hp", "tier": "mythic"}]}}, {"slug": "awakened-gavus", "si": 30, "furniture": 9, "engraving": 60, "collection": {"catalog": 7, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "aurelia", "si": 40, "furniture": 9, "engraving": 62, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "erosion", "tier": "mythic"}]}}, {"slug": "mira", "si": 20, "furniture": 9, "engraving": 30, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "melion", "si": 40, "furniture": 9, "engraving": 61, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}], "pet": "nightfall-pegasus", "pet_level": 18}, {"key": "t3", "label": "Team 3", "heroes": [{"slug": "awakened-shemira", "si": 30, "furniture": 9, "engraving": 66, "collection": {"catalog": 3, "nodes": [{"slotIndex": 0, "stat": "hp", "tier": "mythic"}, {"slotIndex": 0, "stat": "mp", "tier": "mythic"}]}}, {"slug": "athena", "si": 30, "furniture": 12, "engraving": 33, "collection": {"catalog": 3, "nodes": [{"slotIndex": 0, "stat": "ty", "tier": "mythic"}]}}, {"slug": "highborn-elthara", "si": 40, "furniture": 9, "engraving": 60, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "erosion", "tier": "mythic"}]}}, {"slug": "tamrus", "si": 20, "furniture": 9, "engraving": 30, "collection": {"catalog": 1, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}, {"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}, {"slug": "rimuru", "si": 20, "furniture": 9, "engraving": 30, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}], "pet": "flutterplume-owl", "pet_level": 18}, {"key": "t4", "label": "Team 4", "heroes": [{"slug": "saitama", "si": 30, "furniture": 9, "engraving": 30, "collection": {"catalog": 1, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "daemia", "si": 30, "furniture": 9, "engraving": 60, "collection": {"catalog": 7, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "awakened-skriath", "si": 30, "furniture": 3, "engraving": 63, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "cda", "tier": "mythic"}, {"slotIndex": 0, "stat": "atk", "tier": "mythic"}]}}, {"slug": "selene", "si": 20, "furniture": 3, "engraving": 30, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}, {"slug": "talimar", "si": 30, "furniture": 9, "engraving": 61, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}, {"slotIndex": 0, "stat": "is", "tier": "mythic"}]}}], "pet": "twinlum-spirit", "pet_level": 18}, {"key": "t5", "label": "Team 5", "heroes": [{"slug": "awakened-hybris", "si": 40, "furniture": 9, "engraving": 68, "collection": {"catalog": 1, "nodes": [{"slotIndex": 0, "stat": "atk", "tier": "mythic"}, {"slotIndex": 0, "stat": "cda", "tier": "mythic"}]}}, {"slug": "desira", "furniture": 9, "engraving": 60, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "dracula", "si": 30, "furniture": 9, "engraving": 62, "collection": {"catalog": 14, "nodes": [{"slotIndex": 0, "stat": "full_atk", "tier": "mythic"}]}}, {"slug": "velufira", "furniture": 9, "engraving": 60, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "mp", "tier": "mythic"}]}}, {"slug": "liberta", "si": 40, "furniture": 9, "engraving": 60, "collection": {"catalog": 10, "nodes": [{"slotIndex": 0, "stat": "atk", "tier": "mythic"}]}}], "pet": "treatspector", "pet_level": 18}]'::jsonb),
      ('hfc-wrizz-no-earrings-rakudayyy-2026', 'hunting-fields-contract', 'wrizz-no-earrings', '{"damage": 71000000000}'::jsonb, null::smallint, 'Source: r/afkarena [HFC] Wrizz + No earrings buff Guide (u/Rakudayyy & SickMyDuck). Team 1 = Universal BiS (~35.5B, Treatspector or Owl), Team 2 = Buff Comp C (~35.5B, Treatspector).', '[{"key": "team-1", "label": "Team 1", "heroes": [{"slug": "awakened-envydiel"}, {"slug": "knox"}, {"slug": "aurelia"}, {"slug": "misha"}, {"slug": "randle"}], "pet": "treatspector", "pet_level": 18}, {"key": "team-2", "label": "Team 2", "heroes": [{"slug": "lucilla"}, {"slug": "gorok"}, {"slug": "liberta"}, {"slug": "daemia"}, {"slug": "tavriel"}], "pet": "treatspector", "pet_level": 18}]'::jsonb),
      ('abex-s17-xionslash-2026', 'abyssal-expedition', 's18-final-boss', '{"damage": 365000000000}'::jsonb, null::smallint, 'Source: r/afkarena S17 ABEX Boss Comps (u/Xionslash007 / Visuals by TheAFKGuys). 6 core unique comps (60B-62B each). Bonus 70B Severin comp: Lavatune, Adrian & Elyse, Tavriel, Aurelia, Severin (Twinlum Spirit).', '[{"key": "t1", "label": "Sion (62B)", "heroes": [{"slug": "velufira"}, {"slug": "sion"}, {"slug": "lucilla"}, {"slug": "highborn-leviathan"}, {"slug": "trishea"}], "pet": "flutterplume-owl", "pet_level": 18}, {"key": "t2", "label": "Envy (62B)", "heroes": [{"slug": "awakened-envydiel"}, {"slug": "awakened-lyca"}, {"slug": "knox"}, {"slug": "laios"}, {"slug": "daemia"}], "pet": "count-snickerfang", "pet_level": 18}, {"key": "t3", "label": "Solo Leveling (61B)", "heroes": [{"slug": "tavriel"}, {"slug": "cha-hae-in"}, {"slug": "sung-jinwoo"}, {"slug": "awakened-skriath"}, {"slug": "awakened-pippa"}], "pet": "aureus", "pet_level": 18}, {"key": "t4", "label": "AFawkes (60B)", "heroes": [{"slug": "awakened-fawkes"}, {"slug": "lysander"}, {"slug": "begris"}, {"slug": "saitama"}, {"slug": "talimar"}], "pet": "pearlcrest-ibis", "pet_level": 18}, {"key": "t5", "label": "Elthara (60B)", "heroes": [{"slug": "aurelia"}, {"slug": "highborn-elthara"}, {"slug": "lorsan"}, {"slug": "gorok"}, {"slug": "serenmira"}], "pet": "nightfall-pegasus", "pet_level": 18}, {"key": "t6", "label": "Hybris (60B)", "heroes": [{"slug": "highborn-lan"}, {"slug": "awakened-hybris"}, {"slug": "awakened-thoran"}, {"slug": "dracula"}, {"slug": "gorren"}], "pet": "twinlum-spirit", "pet_level": 18}]'::jsonb)
    ) as t(seed_key, mode_slug, target_slug, result, hero_level, notes, formations)
  loop
    if exists (select 1 from public.submissions where seed_key = v_seed.seed_key) then
      continue;
    end if;

    select id into v_mode_id from public.game_modes where slug = v_seed.mode_slug;
    select id into v_target_id from public.targets where mode_id = v_mode_id and slug = v_seed.target_slug;
    if v_mode_id is null or v_target_id is null then
      raise exception 'Missing mode % or target %', v_seed.mode_slug, v_seed.target_slug;
    end if;

    insert into public.submissions (seed_key, mode_id, target_id, result, hero_level, notes)
    values (v_seed.seed_key, v_mode_id, v_target_id, v_seed.result, v_seed.hero_level, v_seed.notes)
    returning id into v_submission_id;

    for v_form in
      select value, ordinality::smallint as idx
      from jsonb_array_elements(v_seed.formations) with ordinality
    loop
      v_pet_id := null;
      if nullif(v_form.value ->> 'pet', '') is not null then
        select id into v_pet_id from public.pets where slug = v_form.value ->> 'pet';
      end if;

      insert into public.formations (submission_id, slot_key, slot_label, slot_order, pet_id, pet_level)
      values (
        v_submission_id,
        v_form.value ->> 'key',
        v_form.value ->> 'label',
        v_form.idx,
        v_pet_id,
        nullif(v_form.value ->> 'pet_level', '')::smallint
      )
      returning id into v_formation_id;

      for v_hero_entry in
        select value, (ordinality - 1)::smallint as pos
        from jsonb_array_elements(v_form.value -> 'heroes') with ordinality
      loop
        v_hero := v_hero_entry.value;
        select id into v_hero_id from public.heroes where slug = v_hero ->> 'slug';
        if v_hero_id is null then
          raise exception 'Unknown hero slug: %', v_hero ->> 'slug';
        end if;

        insert into public.formation_heroes (
          formation_id, submission_id, position, hero_id, is_merc, si, furniture, engraving, ascension
        )
        values (
          v_formation_id,
          v_submission_id,
          v_hero_entry.pos,
          v_hero_id,
          false,
          nullif(v_hero ->> 'si', '')::smallint,
          nullif(v_hero ->> 'furniture', '')::smallint,
          nullif(v_hero ->> 'engraving', '')::smallint,
          case
            when nullif(v_hero ->> 'engraving', '')::smallint is not null
              or nullif(v_hero ->> 'furniture', '')::smallint is not null
              or nullif(v_hero ->> 'si', '')::smallint is not null
            then 'ascended_1'
            else 'ascended'
          end
        );

        v_collection := v_hero -> 'collection';
        if v_collection is not null then
          insert into public.formation_collections (
            submission_id, formation_id, hero_id, catalog_id, collection_class, collection_name, nodes
          )
          select v_submission_id, v_formation_id, v_hero_id, cc.id, cc.class, cc.name, v_collection -> 'nodes'
          from public.collection_catalog cc
          where cc.id = (v_collection ->> 'catalog')::smallint
          on conflict (formation_id, hero_id) do update
            set catalog_id = excluded.catalog_id,
                collection_class = excluded.collection_class,
                collection_name = excluded.collection_name,
                nodes = excluded.nodes;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
