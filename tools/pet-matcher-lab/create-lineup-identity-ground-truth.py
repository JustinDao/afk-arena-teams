#!/usr/bin/env python3
import json
import re
from pathlib import Path


LINEUP_ID = 9
SEED_KEY = "nc-guide-2026-10-infernal-overlord"
IMAGE_NAME = "afk-nightmare-corridor-infernal-overlord-9.png"
CDN_BASE = "https://raw.githubusercontent.com/afk-mine/cdn/main"
ASCENSION_CODES = {
    "epic": "e",
    "legendary": "l",
    "mythic": "m",
    "ascended": "a",
    "ascended_1": "a1",
    "ascended_2": "a2",
    "ascended_3": "a3",
    "ascended_4": "a4",
    "ascended_5": "a5",
}
LINEUP_9_HERO_VISUAL_OVERRIDES = {
    ("molten-crystalline-worm-queen", "rowan"): "52_a1_si30.webp",
    ("cindercrow-specter", "awakened-safiya"): "165_a1_si30_f9_e60.webp",
    ("cindercrow-specter", "highborn-lan"): "199_a1_si40_f9.webp",
}
# The app renders the three back-row slots before the two front-row slots.
DISPLAYED_HERO_POSITIONS = (2, 3, 4, 0, 1)


def insert_values(sql, table):
    match = re.search(
        rf"insert into {table}\s*\([^;]*?\)\s*values(.*?);",
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise ValueError(f"Could not find INSERT values for {table}.")
    return match.group(1)


def simple_catalog(sql, table):
    values = insert_values(sql, table)
    rows = re.findall(
        r"^\s*\((\d+),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'",
        values,
        flags=re.MULTILINE,
    )
    if not rows:
        raise ValueError(f"No catalog rows parsed for {table}.")
    return {
        slug: {"id": int(catalog_id), "name": name.replace("''", "'")}
        for catalog_id, slug, name in rows
    }


def collection_catalog(sql):
    values = insert_values(sql, "collection_catalog")
    rows = re.findall(
        r"^\s*\((\d+),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'",
        values,
        flags=re.MULTILINE,
    )
    if not rows:
        raise ValueError("No collection catalog rows parsed.")
    return {
        int(catalog_id): {
            "class": collection_class,
            "slug": code_name,
            "name": name.replace("''", "'"),
        }
        for catalog_id, collection_class, code_name, name in rows
    }


def extract_lineup(seed_sql):
    start = seed_sql.index(f"'{SEED_KEY}'")
    match = re.search(r"'(\[.*?\])'::jsonb", seed_sql[start:], flags=re.DOTALL)
    if not match:
        raise ValueError(f"Could not parse formation JSON for {SEED_KEY}.")
    formations = json.loads(match.group(1))
    if len(formations) != 6:
        raise ValueError(f"Expected six formations for lineup {LINEUP_ID}.")
    return formations


def hero_asset_url(hero, catalog_entry):
    ascension = hero.get("ascension")
    if not ascension:
        if hero.get("engraving") is not None and hero["engraving"] > 0:
            ascension = "ascended_1"
        elif hero.get("furniture") is not None and hero["furniture"] > 0:
            ascension = "ascended"
        elif hero.get("si") is not None and hero["si"] > 0:
            ascension = "mythic"
        else:
            ascension = "ascended"
    if ascension not in ASCENSION_CODES:
        raise ValueError(f'Unknown ascension "{ascension}" for {hero["slug"]}.')

    parts = [f'{catalog_entry["id"]}_{ASCENSION_CODES[ascension]}']
    si = hero.get("si")
    if si is not None and ascension in (
        "mythic",
        "ascended",
        "ascended_1",
        "ascended_2",
        "ascended_3",
        "ascended_4",
        "ascended_5",
    ):
        level = 0 if si == 0 else (si // 10) * 10
        if 0 <= level <= 40:
            parts.append(f"si{level}")

    furniture = hero.get("furniture")
    if furniture is not None and ascension in (
        "ascended",
        "ascended_1",
        "ascended_2",
        "ascended_3",
        "ascended_4",
        "ascended_5",
    ):
        level = 36 if furniture >= 36 else 9 if furniture >= 9 else 3 if furniture >= 3 else None
        if level is not None:
            parts.append(f"f{level}")

    engraving = hero.get("engraving")
    if engraving is not None and ascension in (
        "ascended_1",
        "ascended_2",
        "ascended_3",
        "ascended_4",
        "ascended_5",
    ):
        level = 80 if engraving >= 80 else 60 if engraving >= 60 else 30 if engraving >= 30 else None
        if level is not None:
            parts.append(f"e{level}")

    return f"{CDN_BASE}/framed_unit_icon/{'_'.join(parts)}.webp"


def benchmark_hero_asset(hero, catalog_entry, formation_key):
    override = LINEUP_9_HERO_VISUAL_OVERRIDES.get((formation_key, hero["slug"]))
    if override is not None:
        return f"{CDN_BASE}/framed_unit_icon/{override}", "screenshot_visual_override"
    return hero_asset_url(hero, catalog_entry), "seed_metadata"


def collection_asset_url(collection_id, nodes):
    level_nodes = sum(node["stat"] == "skill_level" for node in nodes)
    mythic_stats = sum(
        node["stat"] != "skill_level" and node["tier"] == "mythic" for node in nodes
    )
    return (
        f"{CDN_BASE}/collection_icon/{collection_id}"
        f"_lvl{level_nodes + 1}"
        f"{f'_ms{mythic_stats}' if mythic_stats else ''}_cl.webp"
    )


def main():
    repo_root = Path(__file__).resolve().parents[2]
    seed_sql = (repo_root / "seed.sql").read_text(encoding="utf-8")
    schema_sql = (repo_root / "schema.sql").read_text(encoding="utf-8")
    dataset_path = repo_root / "afk-icon-pilot-coco.json"
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    heroes = simple_catalog(schema_sql, "heroes")
    pets = simple_catalog(schema_sql, "pets")
    collections = collection_catalog(schema_sql)
    formations = extract_lineup(seed_sql)

    image = next(
        (item for item in dataset["images"] if item["file_name"] == IMAGE_NAME),
        None,
    )
    if image is None:
        raise ValueError(f"Dataset does not contain {IMAGE_NAME}.")
    image_annotations = sorted(
        (item for item in dataset["annotations"] if item["image_id"] == image["id"]),
        key=lambda item: item["id"],
    )

    expected = []
    for formation in formations:
        if len(formation["heroes"]) != 5:
            raise ValueError(f'Formation "{formation["key"]}" does not have five heroes.')
        for position in DISPLAYED_HERO_POSITIONS:
            hero = formation["heroes"][position]
            catalog_entry = heroes.get(hero["slug"])
            if catalog_entry is None:
                raise ValueError(f'Hero slug is missing from schema.sql: {hero["slug"]}')
            asset_url, state_source = benchmark_hero_asset(
                hero,
                catalog_entry,
                formation["key"],
            )
            expected.append(
                {
                    "identity_type": "hero",
                    "catalog_id": catalog_entry["id"],
                    "catalog_slug": hero["slug"],
                    "catalog_name": catalog_entry["name"],
                    "asset_url": asset_url,
                    "state_source": state_source,
                    "formation_key": formation["key"],
                    "formation_label": formation["label"],
                    "formation_position": position,
                }
            )

        for position in DISPLAYED_HERO_POSITIONS:
            hero = formation["heroes"][position]
            collection = hero.get("collection")
            if not collection:
                raise ValueError(
                    f'Hero "{hero["slug"]}" in "{formation["key"]}" has no collection.'
                )
            catalog_entry = collections.get(collection["catalog"])
            if catalog_entry is None:
                raise ValueError(
                    f'Unknown collection catalog ID: {collection["catalog"]}'
                )
            expected.append(
                {
                    "identity_type": "collection",
                    "catalog_id": collection["catalog"],
                    "catalog_slug": catalog_entry["slug"],
                    "catalog_name": catalog_entry["name"],
                    "asset_url": collection_asset_url(
                        collection["catalog"], collection["nodes"]
                    ),
                    "formation_key": formation["key"],
                    "formation_label": formation["label"],
                    "formation_position": position,
                    "assigned_hero_slug": hero["slug"],
                }
            )

        pet = pets.get(formation["pet"])
        if pet is None:
            raise ValueError(f'Pet slug is missing from schema.sql: {formation["pet"]}')
        expected.append(
            {
                "identity_type": "pet",
                "catalog_id": pet["id"],
                "catalog_slug": formation["pet"],
                "catalog_name": pet["name"],
                "asset_url": f"{CDN_BASE}/framed_unit_icon/{pet['id']}.webp",
                "formation_key": formation["key"],
                "formation_label": formation["label"],
                "formation_position": None,
            }
        )

    if len(expected) != len(image_annotations):
        raise ValueError(
            f"Lineup contains {len(expected)} identities but image has "
            f"{len(image_annotations)} annotated boxes."
        )

    annotations = []
    for identity, annotation in zip(expected, image_annotations):
        annotations.append(
            {
                "annotation_id": annotation["id"],
                "image_id": image["id"],
                "bbox": annotation["bbox"],
                "lineup_id": LINEUP_ID,
                **identity,
            }
        )

    output = {
        "lineup_id": LINEUP_ID,
        "seed_key": SEED_KEY,
        "image": {
            "id": image["id"],
            "file_name": image["file_name"],
            "width": image["width"],
            "height": image["height"],
        },
        "identity_counts": {
            identity_type: sum(
                item["identity_type"] == identity_type for item in annotations
            )
            for identity_type in ("hero", "collection", "pet")
        },
        "annotations": annotations,
    }
    output_path = (
        repo_root / "tools" / "pet-matcher-lab" / "lineup-9-identity-ground-truth.json"
    )
    output_path.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(annotations)} identities "
        f"({output['identity_counts']}) to {output_path}"
    )


if __name__ == "__main__":
    main()
