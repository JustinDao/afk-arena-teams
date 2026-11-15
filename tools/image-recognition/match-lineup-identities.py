#!/usr/bin/env python3
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import re

import cv2
import numpy as np
import requests


CDN_BASE = "https://raw.githubusercontent.com/afk-mine/cdn/main"
CENTER = slice(12, 84)
OUTPUT_NAME = "lineup-9-full-catalog-identity-results.json"
APP_EXPORT_SOURCE_WIDTH = 1558
HERO_STATE_TEMPLATE_SIZE = 98
COLLECTION_BADGE_TEMPLATE_SIZE = 111
COLLECTION_BADGE_REGISTRATION_PADDING = 5
COLLECTION_BADGE_ROI = (8, 82, 30, 27)
COLLECTION_LEVELS = (1, 2, 3)
COLLECTION_MYTHIC_COUNTS = range(1, 9)
METHODS = {
    "hero_base_icon": ("hero", "unit_icon_by_id/{id}.webp"),
    "hero_framed_icon": ("hero", "framed_unit_icon/{id}_a1.webp"),
    "pet_framed_icon": ("pet", "framed_unit_icon/{id}.webp"),
    "collection_level_1_icon": ("collection", "collection_icon/{id}_lvl1_cl.webp"),
}
HERO_ASCENSIONS = (
    ("epic", "e"),
    ("legendary", "l"),
    ("mythic", "m"),
    ("ascended", "a"),
    ("ascended_1", "a1"),
    ("ascended_2", "a2"),
    ("ascended_3", "a3"),
    ("ascended_4", "a4"),
    ("ascended_5", "a5"),
)
COLLECTION_STAT_CODES = (
    "hp",
    "atk",
    "def",
    "crit",
    "cda",
    "cbr",
    "cd_dr",
    "acc",
    "dodge",
    "ll",
    "heal",
    "prf",
    "ty",
    "is",
    "diss",
    "pp",
    "mp",
    "prm",
    "mrm",
    "erosion",
    "buffer",
    "err",
    "full_hp",
    "full_atk",
    "full_def",
    "full_erosion",
    "skill_level",
)
COLLECTION_NODE_TIERS = (
    ("elite", "e"),
    ("legendary", "l"),
    ("mythic", "m"),
)
TENSOR_TEMPLATE_SIZE = 64
_TENSOR_CACHE = {}
_NODE_ASSET_CACHE = {}


def load_ground_truth_module(path):
    spec = importlib.util.spec_from_file_location("lineup_identity_ground_truth", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load identity-ground-truth helpers from {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_catalogs(schema_sql, ground_truth_module):
    heroes = ground_truth_module.simple_catalog(schema_sql, "heroes")
    pets = ground_truth_module.simple_catalog(schema_sql, "pets")
    collections = ground_truth_module.collection_catalog(schema_sql)
    return {
        "hero": [
            {"id": entry["id"], "name": entry["name"]}
            for entry in heroes.values()
        ],
        "pet": [
            {"id": entry["id"], "name": entry["name"]}
            for entry in pets.values()
        ],
        "collection": [
            {"id": catalog_id, "name": entry["name"]}
            for catalog_id, entry in collections.items()
        ],
    }


def get_image(url, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.webp"
    if cache_path.is_file():
        image = cv2.imread(str(cache_path), cv2.IMREAD_UNCHANGED)
        if image is not None:
            return image

    response = requests.get(url, timeout=30)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    image = cv2.imdecode(
        np.frombuffer(response.content, dtype=np.uint8),
        cv2.IMREAD_UNCHANGED,
    )
    if image is None:
        raise ValueError(f"CDN returned an unreadable image: {url}")
    cache_path.write_bytes(response.content)
    return image


def normalized_center(image):
    resized = cv2.resize(image[:, :, :3], (96, 96), interpolation=cv2.INTER_AREA)
    return resized[CENTER, CENTER].astype(np.float32)


def source_scale_image(screenshot):
    scale = screenshot.shape[1] / APP_EXPORT_SOURCE_WIDTH
    source_height = round(screenshot.shape[0] / scale)
    source = cv2.resize(
        screenshot,
        (APP_EXPORT_SOURCE_WIDTH, source_height),
        interpolation=cv2.INTER_AREA,
    )
    return source, scale


def source_scale_crop(source, bbox, scale, padding=0):
    x, y, width, height = bbox
    source_bbox = tuple(round(value / scale) for value in (x, y, width, height))
    x, y, width, height = source_bbox
    left = max(0, x - padding)
    top = max(0, y - padding)
    right = min(source.shape[1], x + width + padding)
    bottom = min(source.shape[0], y + height + padding)
    crop = source[top:bottom, left:right]
    if crop.size == 0:
        raise ValueError(f"Annotation bbox {bbox} falls outside the source-scale image.")
    return crop


def aligned_alpha_mse(target, reference, identity_type, icon_size=None):
    icon_size = icon_size or (49 if identity_type == "pet" else 85)
    channels = reference[:, :, :3]
    if reference.ndim == 3 and reference.shape[2] == 4:
        alpha = reference[:, :, 3].astype(np.float32) / 255
    else:
        alpha = np.ones(reference.shape[:2], dtype=np.float32)
    template = cv2.resize(
        channels,
        (icon_size, icon_size),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    mask = cv2.resize(
        alpha,
        (icon_size, icon_size),
        interpolation=cv2.INTER_AREA,
    )
    target_height, target_width = target.shape[:2]
    if target_height < icon_size or target_width < icon_size:
        return float("inf")

    weight = mask[:, :, None]
    denominator = float(weight.sum() * 3)
    if denominator <= 0:
        return float("inf")
    best = float("inf")
    for top in range(target_height - icon_size + 1):
        for left in range(target_width - icon_size + 1):
            patch = target[top : top + icon_size, left : left + icon_size].astype(np.float32)
            score = float(np.sum((patch - template) ** 2 * weight) / denominator)
            best = min(best, score)
    return best


def registered_alpha_crop(target, reference, identity_type, icon_size=None):
    icon_size = icon_size or (49 if identity_type == "pet" else 85)
    channels = reference[:, :, :3]
    if reference.ndim == 3 and reference.shape[2] == 4:
        alpha = reference[:, :, 3].astype(np.float32) / 255
    else:
        alpha = np.ones(reference.shape[:2], dtype=np.float32)
    template = cv2.resize(
        channels,
        (icon_size, icon_size),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    weight = cv2.resize(
        alpha,
        (icon_size, icon_size),
        interpolation=cv2.INTER_AREA,
    )[:, :, None]
    target_height, target_width = target.shape[:2]
    if target_height < icon_size or target_width < icon_size:
        raise ValueError("Registration target is smaller than the reference icon.")
    denominator = float(weight.sum() * 3)
    if denominator <= 0:
        raise ValueError("Registration reference has no opaque pixels.")
    best = (float("inf"), 0, 0)
    for top in range(target_height - icon_size + 1):
        for left in range(target_width - icon_size + 1):
            patch = target[top : top + icon_size, left : left + icon_size].astype(np.float32)
            score = float(np.sum((patch - template) ** 2 * weight) / denominator)
            if score < best[0]:
                best = (score, left, top)
    _, left, top = best
    return target[top : top + icon_size, left : left + icon_size], (left, top)


def alpha_masked_region_mse(target, reference, region, icon_size):
    if target.shape[:2] != (icon_size, icon_size):
        raise ValueError(f"Region target must be {icon_size}×{icon_size} pixels.")
    x, y, width, height = region
    if (
        x < 0
        or y < 0
        or width <= 0
        or height <= 0
        or x + width > icon_size
        or y + height > icon_size
    ):
        raise ValueError("Region must fit inside the registered icon.")

    template = cv2.resize(
        reference[:, :, :3],
        (icon_size, icon_size),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    if reference.ndim == 3 and reference.shape[2] == 4:
        alpha = reference[:, :, 3].astype(np.float32) / 255
    else:
        alpha = np.ones(reference.shape[:2], dtype=np.float32)
    mask = cv2.resize(alpha, (icon_size, icon_size), interpolation=cv2.INTER_AREA)
    target_region = target[y : y + height, x : x + width].astype(np.float32)
    template_region = template[y : y + height, x : x + width]
    weight = mask[y : y + height, x : x + width, None]
    denominator = float(weight.sum() * 3)
    if denominator <= 0:
        raise ValueError("Region reference has no opaque pixels.")
    return float(np.sum((target_region - template_region) ** 2 * weight) / denominator)


def hero_state_urls(hero_id):
    urls = set()
    si_levels = (None, 0, 10, 20, 30, 40)
    furniture_levels = (None, 3, 9, 36)
    engraving_levels = (None, 30, 60, 80)
    for rank_index, (_, ascension_code) in enumerate(HERO_ASCENSIONS):
        si_options = si_levels if rank_index >= 2 else (None,)
        furniture_options = furniture_levels if rank_index >= 3 else (None,)
        engraving_options = engraving_levels if rank_index >= 4 else (None,)
        for si in si_options:
            for furniture in furniture_options:
                for engraving in engraving_options:
                    parts = [f"{hero_id}_{ascension_code}"]
                    if si is not None:
                        parts.append(f"si{si}")
                    if furniture is not None:
                        parts.append(f"f{furniture}")
                    if engraving is not None:
                        parts.append(f"e{engraving}")
                    urls.add(
                        f"{CDN_BASE}/framed_unit_icon/{'_'.join(parts)}.webp"
                    )
    return sorted(urls)


def evaluate_method(method, candidate_entries, annotations, screenshot, cache_dir):
    candidate_type, url_pattern = METHODS[method]
    relevant = [item for item in annotations if item["identity_type"] == candidate_type]
    candidate_urls = {
        entry["id"]: f"{CDN_BASE}/{url_pattern.format(id=entry['id'])}"
        for entry in candidate_entries
    }

    def fetch(item):
        catalog_id, url = item
        return catalog_id, get_image(url, cache_dir)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        references = dict(executor.map(fetch, candidate_urls.items()))

    missing = sorted(catalog_id for catalog_id, image in references.items() if image is None)
    templates = {
        catalog_id: normalized_center(image)
        for catalog_id, image in references.items()
        if image is not None
    }
    if not templates:
        raise ValueError(f"No usable reference assets were found for {method}.")

    names = {entry["id"]: entry["name"] for entry in candidate_entries}
    predictions = []
    for annotation in relevant:
        x, y, width, height = annotation["bbox"]
        crop = screenshot[y : y + height, x : x + width]
        if crop.size == 0:
            raise ValueError(
                f"Annotation {annotation['annotation_id']} has a crop outside the image."
            )
        query = normalized_center(crop)
        ranked = sorted(
            (
                (float(np.mean((query - template) ** 2)), catalog_id)
                for catalog_id, template in templates.items()
            ),
            key=lambda result: (result[0], result[1]),
        )
        ranked_ids = [catalog_id for _, catalog_id in ranked]
        true_id = annotation["catalog_id"]
        predictions.append(
            {
                "annotation_id": annotation["annotation_id"],
                "true_id": true_id,
                "true_name": annotation["catalog_name"],
                "top1_id": ranked_ids[0],
                "top1_name": names[ranked_ids[0]],
                "top3_ids": ranked_ids[:3],
                "top3_names": [names[catalog_id] for catalog_id in ranked_ids[:3]],
                "top1_correct": ranked_ids[0] == true_id,
                "top3_correct": true_id in ranked_ids[:3],
                "top1_mse": ranked[0][0],
            }
        )

    count = len(predictions)
    return {
        "identity_type": candidate_type,
        "reference": url_pattern,
        "candidate_count": len(templates),
        "missing_candidate_ids": missing,
        "query_count": count,
        "top1_correct": sum(item["top1_correct"] for item in predictions),
        "top1_accuracy": sum(item["top1_correct"] for item in predictions) / count,
        "top3_correct": sum(item["top3_correct"] for item in predictions),
        "top3_accuracy": sum(item["top3_correct"] for item in predictions) / count,
        "predictions": predictions,
    }


def evaluate_hero_visual_states(
    annotations,
    predictions,
    source_screenshot,
    source_scale,
    cache_root,
):
    annotation_by_id = {item["annotation_id"]: item for item in annotations}
    hero_queries = {}
    for prediction in predictions:
        if prediction["predicted_type"] == "hero":
            hero_queries.setdefault(prediction["top1_id"], []).append(
                annotation_by_id[prediction["annotation_id"]]
            )

    state_predictions = []
    available_candidate_count = 0
    missing_candidate_count = 0
    for hero_id, queries in hero_queries.items():
        urls = hero_state_urls(hero_id)

        def fetch(url):
            image = get_image(url, cache_root / "hero_investment_variants")
            return url, image

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            references = [
                (url, image)
                for url, image in executor.map(fetch, urls)
                if image is not None
            ]
        available_candidate_count += len(references)
        missing_candidate_count += len(urls) - len(references)
        if not references:
            raise ValueError(f"No investment-state CDN assets found for hero {hero_id}.")
        alignment_anchor_url = f"{CDN_BASE}/framed_unit_icon/{hero_id}_a1.webp"
        alignment_anchor = next(
            (image for url, image in references if url == alignment_anchor_url),
            None,
        )
        if alignment_anchor is None:
            raise ValueError(
                f"No Ascended-1 alignment asset found for hero {hero_id}."
            )
        for annotation in queries:
            baseline_query = source_scale_crop(
                source_screenshot,
                annotation["bbox"],
                source_scale,
            )
            baseline_ranked = sorted(
                (
                    (aligned_alpha_mse(baseline_query, image, "hero"), url)
                    for url, image in references
                ),
                key=lambda result: (result[0], result[1]),
            )
            registration_target = source_scale_crop(
                source_screenshot,
                annotation["bbox"],
                source_scale,
                padding=14,
            )
            registered_query, registration_offset = registered_alpha_crop(
                registration_target,
                alignment_anchor,
                "hero",
                icon_size=HERO_STATE_TEMPLATE_SIZE,
            )
            ranked_distances = sorted(
                (
                    (
                        aligned_alpha_mse(
                            registered_query,
                            image,
                            "hero",
                            icon_size=HERO_STATE_TEMPLATE_SIZE,
                        ),
                        url,
                    )
                    for url, image in references
                ),
                key=lambda result: (result[0], result[1]),
            )
            score, predicted_url = ranked_distances[0]
            baseline_score, baseline_url = baseline_ranked[0]
            expected_url = annotation["asset_url"]
            baseline_expected_rank = next(
                (
                    rank
                    for rank, (_, url) in enumerate(baseline_ranked, start=1)
                    if url == expected_url
                ),
                None,
            )
            expected_rank = next(
                (
                    rank
                    for rank, (_, url) in enumerate(ranked_distances, start=1)
                    if url == expected_url
                ),
                None,
            )
            if baseline_expected_rank is None or expected_rank is None:
                raise ValueError(
                    f"Expected hero state is not in the candidate set: {expected_url}"
                )
            expected_score = ranked_distances[expected_rank - 1][0]
            expected_filename = expected_url.rsplit("/", 1)[-1]
            predicted_filename = predicted_url.rsplit("/", 1)[-1]
            baseline_filename = baseline_url.rsplit("/", 1)[-1]
            state_predictions.append(
                {
                    "annotation_id": annotation["annotation_id"],
                    "hero_id": hero_id,
                    "true_hero_id": annotation["catalog_id"],
                    "identity_correct": hero_id == annotation["catalog_id"],
                    "expected_asset": expected_filename,
                    "predicted_asset": predicted_filename,
                    "correct": (
                        hero_id == annotation["catalog_id"]
                        and predicted_filename == expected_filename
                    ),
                    "top1_mse": score,
                    "expected_mse": expected_score,
                    "expected_rank": expected_rank,
                    "baseline_predicted_asset": baseline_filename,
                    "baseline_correct": (
                        hero_id == annotation["catalog_id"]
                        and baseline_filename == expected_filename
                    ),
                    "baseline_top1_mse": baseline_score,
                    "baseline_expected_rank": baseline_expected_rank,
                    "registration_offset": list(registration_offset),
                    "available_state_candidates": len(references),
                }
            )

    return {
        "query_count": len(state_predictions),
        "correct": sum(item["correct"] for item in state_predictions),
        "baseline_correct": sum(item["baseline_correct"] for item in state_predictions),
        "accuracy": (
            sum(item["correct"] for item in state_predictions) / len(state_predictions)
            if state_predictions
            else 0
        ),
        "baseline_accuracy": (
            sum(item["baseline_correct"] for item in state_predictions)
            / len(state_predictions)
            if state_predictions
            else 0
        ),
        "template_size": HERO_STATE_TEMPLATE_SIZE,
        "registration_padding": 14,
        "available_candidate_count": available_candidate_count,
        "missing_candidate_count": missing_candidate_count,
        "state_candidates_per_hero": len(hero_state_urls(1)),
        "predictions": state_predictions,
    }


def build_identity_candidate_assets(catalogs, cache_root):
    methods = ("hero_framed_icon", "pet_framed_icon")
    candidate_assets = []
    for method in methods:
        identity_type, url_pattern = METHODS[method]

        def fetch(entry):
            url = f"{CDN_BASE}/{url_pattern.format(id=entry['id'])}"
            image = get_image(url, cache_root / method)
            if image is None:
                raise ValueError(f"Missing candidate asset for {identity_type} {entry['id']}: {url}")
            return {
                "type": identity_type,
                "id": entry["id"],
                "name": entry["name"],
                "url": url,
                "state": "generic",
                "template": normalized_center(image),
                "image": image,
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            candidate_assets.extend(executor.map(fetch, catalogs[identity_type]))

    collection_urls = []
    for entry in catalogs["collection"]:
        catalog_id = entry["id"]
        collection_urls.append((entry, f"{catalog_id}_cl.webp", "base"))
        for mythic_count in COLLECTION_MYTHIC_COUNTS:
            collection_urls.append(
                (entry, f"{catalog_id}_ms{mythic_count}_cl.webp", f"base_ms{mythic_count}")
            )
        for level in COLLECTION_LEVELS:
            collection_urls.append((entry, f"{catalog_id}_lvl{level}_cl.webp", f"level{level}"))
            for mythic_count in COLLECTION_MYTHIC_COUNTS:
                collection_urls.append(
                    (
                        entry,
                        f"{catalog_id}_lvl{level}_ms{mythic_count}_cl.webp",
                        f"level{level}_ms{mythic_count}",
                    )
                )

    def fetch_collection(item):
        entry, filename, state = item
        url = f"{CDN_BASE}/collection_icon/{filename}"
        image = get_image(url, cache_root / "collection_state_variants")
        if image is None:
            return None
        return {
            "type": "collection",
            "id": entry["id"],
            "name": entry["name"],
            "url": url,
            "state": state,
            "template": normalized_center(image),
            "image": image,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        collection_results = list(executor.map(fetch_collection, collection_urls))
    missing_collection_assets = [
        filename for (_, filename, _), result in zip(collection_urls, collection_results)
        if result is None
    ]
    candidate_assets.extend(result for result in collection_results if result is not None)
    return candidate_assets, missing_collection_assets


def load_hero_and_pet_metadata(schema_sql, ground_truth_module):
    hero_vals = ground_truth_module.insert_values(schema_sql, "heroes")
    hero_rows = re.findall(
        r"^\s*\((\d+),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'",
        hero_vals,
        flags=re.MULTILINE,
    )
    hero_meta = {
        int(hid): {
            "id": int(hid),
            "slug": slug,
            "name": name.replace("''", "'"),
            "faction": faction,
            "class": hclass,
        }
        for hid, slug, name, faction, hclass in hero_rows
    }
    pets_by_slug = ground_truth_module.simple_catalog(schema_sql, "pets")
    pet_meta = {
        entry["id"]: {"id": entry["id"], "slug": slug, "name": entry["name"]}
        for slug, entry in pets_by_slug.items()
    }
    collections_meta = ground_truth_module.collection_catalog(schema_sql)
    return hero_meta, pet_meta, collections_meta


def build_collection_node_assets(cache_root):
    cache_key = str(cache_root.resolve())
    if cache_key in _NODE_ASSET_CACHE:
        return _NODE_ASSET_CACHE[cache_key]

    node_dir = cache_root / "collection_stats_icon"
    node_dir.mkdir(parents=True, exist_ok=True)
    node_items = [
        (stat, tier_name, tier_code, f"{stat}_{tier_code}")
        for stat in COLLECTION_STAT_CODES
        for tier_name, tier_code in COLLECTION_NODE_TIERS
    ]

    def fetch_node(item):
        stat, tier_name, tier_code, key = item
        named_path = node_dir / f"{key}.webp"
        url = f"{CDN_BASE}/collection_stats_icon/{key}.webp"
        if named_path.is_file():
            image = cv2.imread(str(named_path), cv2.IMREAD_UNCHANGED)
            if image is not None:
                return key, {
                    "key": key,
                    "stat": stat,
                    "tier": tier_name,
                    "tier_code": tier_code,
                    "url": url,
                    "image": image,
                }
        image = get_image(url, node_dir)
        if image is not None and not named_path.is_file():
            cv2.imwrite(str(named_path), image)
        if image is None:
            return key, None
        return key, {
            "key": key,
            "stat": stat,
            "tier": tier_name,
            "tier_code": tier_code,
            "url": url,
            "image": image,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        loaded = dict(executor.map(fetch_node, node_items))
    result = {k: v for k, v in loaded.items() if v is not None}
    _NODE_ASSET_CACHE[cache_key] = result
    return result


def build_type_tensors(candidate_assets, cache_root=None):
    cache_key = id(candidate_assets)
    if cache_key in _TENSOR_CACHE:
        return _TENSOR_CACHE[cache_key]

    if cache_root is None:
        cache_root = Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    expanded_assets = list(candidate_assets)
    seen_hero_base = {
        c["id"] for c in expanded_assets if c["type"] == "hero" and c.get("state") == "base"
    }
    hero_entries = [
        {"id": c["id"], "name": c["name"]}
        for c in candidate_assets
        if c["type"] == "hero" and c["id"] not in seen_hero_base
    ]
    for entry in hero_entries:
        url = f"{CDN_BASE}/unit_icon_by_id/{entry['id']}.webp"
        im = get_image(url, cache_root / "hero_base_icon")
        if im is not None:
            expanded_assets.append(
                {
                    "type": "hero",
                    "id": entry["id"],
                    "name": entry["name"],
                    "url": url,
                    "state": "base",
                    "template": normalized_center(im),
                    "image": im,
                }
            )

    seen_pet_base = {
        c["id"] for c in expanded_assets if c["type"] == "pet" and str(c.get("state", "")).startswith("base")
    }
    pet_entries = [
        {"id": c["id"], "name": c["name"]}
        for c in candidate_assets
        if c["type"] == "pet" and c["id"] >= 6007 and c["id"] not in seen_pet_base
    ]
    for entry in pet_entries:
        url = f"{CDN_BASE}/unit_icon_by_id/{entry['id']}.webp"
        im = get_image(url, cache_root / "pet_base_icon")
        if im is not None:
            h_im, w_im = im.shape[:2]
            sq1 = im[:w_im, :w_im]
            sq2 = im[max(0, (h_im - w_im) // 2) : max(0, (h_im - w_im) // 2) + w_im, :w_im]
            for idx_s, sq in enumerate((sq1, sq2)):
                expanded_assets.append(
                    {
                        "type": "pet",
                        "id": entry["id"],
                        "name": entry["name"],
                        "url": url,
                        "state": f"base_{idx_s}",
                        "template": normalized_center(sq),
                        "image": sq,
                    }
                )

    sz = TENSOR_TEMPLATE_SIZE
    by_type = {}
    for c in expanded_assets:
        im = c["image"]
        rgb = cv2.resize(im[:, :, :3], (sz, SZ := sz), interpolation=cv2.INTER_AREA).astype(np.float32)
        alpha = (
            cv2.resize(im[:, :, 3], (sz, sz), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
            if (im.ndim == 3 and im.shape[2] == 4)
            else np.ones((sz, sz), dtype=np.float32)
        )
        m2 = np.zeros_like(alpha)
        if c["type"] == "hero":
            m2[8:46, 10:54] = 1.0
            m_left = np.zeros_like(alpha)
            m_left[6:56, 6:56] = 1.0
            m_left[40:64, 40:64] = 0.0
            by_type.setdefault("hero_left", []).append((c, rgb, (alpha * m_left)[:, :, None]))
        else:
            m2[6:58, 6:58] = 1.0
        mask = alpha * m2
        by_type.setdefault(c["type"], []).append((c, rgb, mask[:, :, None]))

    type_tensors = {}
    for t_name, items in by_type.items():
        T = np.stack([x[1] for x in items], axis=0)
        M = np.stack([x[2] for x in items], axis=0)
        D = np.sum(M, axis=(1, 2, 3)) * 3.0
        m_single = M[0]
        d_single = float(D[0])
        T_flat = T.reshape(T.shape[0], -1)
        M_flat = np.repeat(m_single, 3, axis=2).reshape(1, -1)
        TM_flat = T_flat * M_flat
        T2 = np.sum(T_flat * TM_flat, axis=1, keepdims=True).T
        type_tensors[t_name] = (items, T_flat, M_flat, TM_flat, T2, d_single)

    _TENSOR_CACHE[cache_key] = type_tensors
    return type_tensors


def assign_unique_identities(slot_rankings):
    """Exact minimum-cost unique identity assignment (Jonker-Volgenant / Kuhn-Munkres)."""
    n_slots = len(slot_rankings)
    if n_slots == 0:
        return []
    cand_ids = sorted({item["id"] for rank_list in slot_rankings for item in rank_list[:8]})
    id_to_col = {cid: idx for idx, cid in enumerate(cand_ids)}
    n_cols = len(cand_ids)
    if n_cols < n_slots:
        return [r[0] for r in slot_rankings]

    cost = np.full((n_slots + 1, n_cols + 1), 1e9, dtype=np.float64)
    cost[0, :] = 0.0
    cost[:, 0] = 0.0
    for i, rank_list in enumerate(slot_rankings, start=1):
        for item in rank_list[:8]:
            j = id_to_col[item["id"]] + 1
            cost[i, j] = min(cost[i, j], float(item.get("effective_mse", item["mse"])))

    u = np.zeros(n_slots + 1, dtype=np.float64)
    v = np.zeros(n_cols + 1, dtype=np.float64)
    p = np.zeros(n_cols + 1, dtype=np.int32)
    way = np.zeros(n_cols + 1, dtype=np.int32)

    for i in range(1, n_slots + 1):
        p[0] = i
        j0 = 0
        minv = np.full(n_cols + 1, np.inf, dtype=np.float64)
        used = np.zeros(n_cols + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = np.inf
            j1 = 0
            for j in range(1, n_cols + 1):
                if not used[j]:
                    cur = cost[i0, j] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(n_cols + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break

    assigned_col = np.zeros(n_slots + 1, dtype=np.int32)
    for j in range(1, n_cols + 1):
        if p[j] > 0:
            assigned_col[p[j]] = j - 1

    results = []
    for i, rank_list in enumerate(slot_rankings):
        chosen_id = cand_ids[assigned_col[i + 1]]
        chosen = next((item for item in rank_list if item["id"] == chosen_id), rank_list[0])
        results.append(chosen)
    return results


def rank_candidates_in_box(
    img,
    bbox,
    t_name,
    type_tensors,
    scales=(0.88, 0.94, 1.0, 1.06, 1.12),
    pad_ratio=0.25,
    stride=2,
    allowed_class=None,
    collections_catalog=None,
):
    bx, by, bw, bh = bbox
    est_sz = min(bw, bh)
    cx, cy = bx + bw / 2.0, by + bh / 2.0
    items, T_flat, M_flat, TM_flat, T2, d_single = type_tensors[t_name]
    sz = TENSOR_TEMPLATE_SIZE

    best_per_idx = np.full(len(items), np.inf, dtype=np.float32)
    for scale_mult in scales:
        s_px = est_sz * scale_mult
        if s_px < 24:
            continue
        pad_px = s_px * pad_ratio
        half = s_px / 2.0 + pad_px
        x0, y0 = max(0, round(cx - half)), max(0, round(cy - half))
        x1, y1 = min(img.shape[1], round(cx + half)), min(img.shape[0], round(cy + half))
        if x1 - x0 < 20 or y1 - y0 < 20:
            continue
        roi = img[y0:y1, x0:x1].astype(np.float32)
        sf = sz / float(s_px)
        r_w, r_h = max(sz, round(roi.shape[1] * sf)), max(sz, round(roi.shape[0] * sf))
        roi_r = cv2.resize(roi, (r_w, r_h), interpolation=cv2.INTER_AREA)
        patches = [
            roi_r[oy : oy + sz, ox : ox + sz]
            for oy in range(0, r_h - sz + 1, stride)
            for ox in range(0, r_w - sz + 1, stride)
        ]
        if not patches:
            continue
        P = np.stack(patches, axis=0)
        P_flat = P.reshape(P.shape[0], -1)
        P2 = np.sum((P_flat**2) * M_flat, axis=1, keepdims=True)
        dist = (P2 + T2 - 2.0 * (P_flat @ TM_flat.T)) / d_single
        min_d = dist.min(axis=0)
        best_per_idx = np.minimum(best_per_idx, min_d)

    scored_items = []
    for idx in range(len(items)):
        c = items[idx][0]
        cid = c["id"]
        mse_val = float(best_per_idx[idx])
        eff_mse = mse_val
        if (
            allowed_class is not None
            and t_name == "collection"
            and collections_catalog is not None
            and cid in collections_catalog
        ):
            if collections_catalog[cid]["class"] == allowed_class:
                eff_mse = mse_val * 0.80
        scored_items.append((eff_mse, mse_val, cid, c["name"], c["state"], c["url"], c))
    scored_items.sort(key=lambda x: (x[0], x[2], x[5]))

    seen = {}
    for eff_mse, mse_val, cid, cname, cstate, curl, cand in scored_items:
        if cid not in seen:
            seen[cid] = {
                "id": cid,
                "name": cname,
                "state": cstate,
                "url": curl,
                "mse": mse_val,
                "effective_mse": eff_mse,
                "candidate": cand,
            }
    return list(seen.values())


def detect_nodes_in_roi(
    roi_bgr,
    node_assets,
    sz_list=(40, 42, 44, 46),
    max_nodes=2,
    mse_thresh=1500.0,
    include_skill_level=False,
):
    if roi_bgr is None or roi_bgr.size == 0:
        return []
    roi = roi_bgr.astype(np.float32)
    keys = [
        k
        for k in sorted(node_assets.keys())
        if include_skill_level or not k.startswith("skill_level")
    ]
    if not keys:
        return []

    candidates = []
    for sz in sz_list:
        if roi.shape[0] < sz or roi.shape[1] < sz:
            continue
        T_list, M_list = [], []
        for k in keys:
            im = node_assets[k]["image"]
            t = cv2.resize(im[:, :, :3], (sz, sz), interpolation=cv2.INTER_AREA).astype(np.float32)
            m = (
                cv2.resize(im[:, :, 3], (sz, sz), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
            )[:, :, None]
            T_list.append(t)
            M_list.append(m)
        T = np.stack(T_list, axis=0)
        M = np.stack(M_list, axis=0)
        m_single = M[0]
        d_single = float(m_single.sum() * 3.0)
        H_r, W_r = roi.shape[:2]
        coords = [(ox, oy) for oy in range(0, H_r - sz + 1, 2) for ox in range(0, W_r - sz + 1, 2)]
        if not coords:
            continue
        patches = np.stack([roi[oy : oy + sz, ox : ox + sz] for ox, oy in coords], axis=0)
        P_flat = patches.reshape(patches.shape[0], -1)
        T_flat = T.reshape(T.shape[0], -1)
        M_flat = np.repeat(m_single, 3, axis=2).reshape(1, -1)
        TM_flat = T_flat * M_flat
        P2 = np.sum((P_flat**2) * M_flat, axis=1, keepdims=True)
        T2 = np.sum(T_flat * TM_flat, axis=1, keepdims=True).T
        dist = (P2 + T2 - 2.0 * (P_flat @ TM_flat.T)) / d_single
        best_tmpl = np.argmin(dist, axis=1)
        best_mse = dist[np.arange(dist.shape[0]), best_tmpl]
        for p_idx in np.where(best_mse < mse_thresh)[0]:
            ox, oy = coords[p_idx]
            order = np.argsort(dist[p_idx])[:3]
            top3 = [
                {
                    "key": keys[idx],
                    "stat": node_assets[keys[idx]]["stat"],
                    "tier": node_assets[keys[idx]]["tier"],
                    "mse": float(dist[p_idx, idx]),
                }
                for idx in order
            ]
            k = keys[best_tmpl[p_idx]]
            meta = node_assets[k]
            candidates.append(
                {
                    "mse": float(best_mse[p_idx]),
                    "ox": int(ox),
                    "oy": int(oy),
                    "sz": int(sz),
                    "key": k,
                    "stat": meta["stat"],
                    "tier": meta["tier"],
                    "asset_url": meta["url"],
                    "top3": top3,
                }
            )

    candidates.sort(key=lambda x: x["mse"])
    picked = []
    for cand in candidates:
        cx = cand["ox"] + cand["sz"] / 2.0
        if all(
            abs(cx - (p["ox"] + p["sz"] / 2.0)) > max(cand["sz"], p["sz"]) * 0.65
            for p in picked
        ):
            picked.append(cand)
            if len(picked) >= max_nodes:
                break
    picked.sort(key=lambda x: x["ox"])
    return picked


def rank_icon_box(bbox, screenshot, source_screenshot, source_scale, candidate_assets):
    x, y, width, height = bbox
    crop = screenshot[y : y + height, x : x + width]
    if crop.size == 0:
        raise ValueError(f"Detection box {bbox} falls outside the image.")
    query = normalized_center(crop)
    ranked = sorted(
        (
            (
                float(np.mean((query - candidate["template"]) ** 2)),
                candidate["type"],
                candidate["id"],
                candidate["name"],
                candidate["url"],
                candidate["state"],
            )
            for candidate in candidate_assets
        ),
        key=lambda result: (result[0], result[1], result[2], result[4]),
    )
    best_by_identity = {}
    for item in ranked:
        best_by_identity.setdefault((item[1], item[2]), item)
    identity_ranking = list(best_by_identity.values())
    best_by_type = {}
    for item in identity_ranking:
        best_by_type.setdefault(item[1], item)
    type_ranking = sorted(
        best_by_type.values(),
        key=lambda result: (result[0], result[1], result[2]),
    )

    aligned_crop = source_scale_crop(
        source_screenshot,
        bbox,
        source_scale,
    )
    icon_size = min(aligned_crop.shape[:2])
    if icon_size < 32:
        raise ValueError(f"Detection box {bbox} is too small to match reliably.")

    type_tensors = build_type_tensors(candidate_assets)
    if max(width, height) < 88:
        predicted_type = "pet"
        nominal_box = [x, y, 64, 64]
        blas_ranked = rank_candidates_in_box(screenshot, nominal_box, "pet", type_tensors)
    else:
        nominal_box = [x, y, 111, 111]
        h_ranked = rank_candidates_in_box(screenshot, nominal_box, "hero", type_tensors)
        c_ranked = rank_candidates_in_box(screenshot, nominal_box, "collection", type_tensors)
        if h_ranked[0]["mse"] <= c_ranked[0]["mse"]:
            predicted_type = "hero"
            blas_ranked = h_ranked
        else:
            predicted_type = "collection"
            blas_ranked = c_ranked

    aligned_identity_ranking = [
        (item["mse"], item["candidate"]) for item in blas_ranked
    ]
    aligned_best_score, aligned_best_candidate = aligned_identity_ranking[0]
    return {
        "ranked": ranked,
        "identity_ranking": identity_ranking,
        "type_ranking": type_ranking,
        "predicted_type": predicted_type,
        "best_identity": identity_ranking[0],
        "aligned_identity_ranking": aligned_identity_ranking,
        "aligned_best_score": aligned_best_score,
        "aligned_best_candidate": aligned_best_candidate,
        "aligned_icon_size": icon_size,
    }


def evaluate_collection_node_stat_icons(annotations, screenshot, cache_root):
    node_assets = build_collection_node_assets(cache_root)
    collection_annotations = [
        item for item in annotations if item["identity_type"] == "collection"
    ]
    slot_predictions = []
    node_query_count = 0
    node_exact_correct = 0
    node_stat_correct = 0
    for annotation in collection_annotations:
        cx, cy, cw, ch = annotation["bbox"]
        roi = screenshot[
            max(0, cy + ch - 6) : min(screenshot.shape[0], cy + ch + 56),
            max(0, cx - 12) : min(screenshot.shape[1], cx + cw + 12),
        ]
        detected_nodes = detect_nodes_in_roi(
            roi,
            node_assets,
            sz_list=(40, 42, 44, 46),
            max_nodes=2,
            mse_thresh=1500.0,
        )
        expected_nodes = annotation.get("visible_stat_nodes", [])
        expected_keys = [item["key"] for item in expected_nodes]
        predicted_keys = [item["key"] for item in detected_nodes]
        expected_stats = [item["stat"] for item in expected_nodes]
        predicted_stats = [item["stat"] for item in detected_nodes]
        node_query_count += len(expected_keys)
        if predicted_keys == expected_keys:
            node_exact_correct += len(expected_keys)
        else:
            node_exact_correct += sum(
                p == e for p, e in zip(predicted_keys, expected_keys)
            )
        if predicted_stats == expected_stats:
            node_stat_correct += len(expected_stats)
        else:
            node_stat_correct += sum(
                p == e for p, e in zip(predicted_stats, expected_stats)
            )
        slot_predictions.append(
            {
                "collection_annotation_id": annotation["annotation_id"],
                "collection_id": annotation["catalog_id"],
                "assigned_hero_slug": annotation.get("assigned_hero_slug"),
                "expected_nodes": expected_keys,
                "predicted_nodes": predicted_keys,
                "exact_slot_match": predicted_keys == expected_keys,
                "detected_details": [
                    {
                        "key": item["key"],
                        "stat": item["stat"],
                        "tier": item["tier"],
                        "mse": item["mse"],
                        "bbox": [
                            max(0, cx - 12) + item["ox"],
                            max(0, cy + ch - 6) + item["oy"],
                            item["sz"],
                            item["sz"],
                        ],
                        "top3": item["top3"],
                    }
                    for item in detected_nodes
                ],
            }
        )
    return {
        "candidate_count": len(
            [k for k in node_assets if not k.startswith("skill_level")]
        ),
        "total_cached_node_icons": len(node_assets),
        "collection_slot_count": len(slot_predictions),
        "slot_exact_correct": sum(item["exact_slot_match"] for item in slot_predictions),
        "slot_exact_accuracy": (
            sum(item["exact_slot_match"] for item in slot_predictions)
            / len(slot_predictions)
            if slot_predictions
            else 0
        ),
        "node_query_count": node_query_count,
        "node_exact_correct": node_exact_correct,
        "node_exact_accuracy": (
            node_exact_correct / node_query_count if node_query_count else 0
        ),
        "node_stat_correct": node_stat_correct,
        "node_stat_accuracy": (
            node_stat_correct / node_query_count if node_query_count else 0
        ),
        "predictions": slot_predictions,
    }


def evaluate_unknown_type(annotations, catalogs, screenshot, cache_root):
    source_screenshot, source_scale = source_scale_image(screenshot)
    candidate_assets, missing_collection_assets = build_identity_candidate_assets(
        catalogs,
        cache_root,
    )

    type_order = ("hero", "collection", "pet")
    confusion = {actual: {predicted: 0 for predicted in type_order} for actual in type_order}
    by_type = {
        identity_type: {"query_count": 0, "type_correct": 0, "identity_correct": 0}
        for identity_type in type_order
    }
    predictions = []
    aligned_identity_predictions = []
    collection_state_predictions = []
    for annotation in annotations:
        box_match = rank_icon_box(
            annotation["bbox"],
            screenshot,
            source_screenshot,
            source_scale,
            candidate_assets,
        )
        identity_ranking = box_match["identity_ranking"]
        type_ranking = box_match["type_ranking"]
        actual_type = annotation["identity_type"]
        actual_id = annotation["catalog_id"]
        predicted_type = box_match["predicted_type"]
        best_identity = box_match["best_identity"]
        identity_correct = (
            best_identity[1] == actual_type and best_identity[2] == actual_id
        )
        type_correct = predicted_type == actual_type
        confusion[actual_type][predicted_type] += 1
        by_type[actual_type]["query_count"] += 1
        by_type[actual_type]["type_correct"] += int(type_correct)
        by_type[actual_type]["identity_correct"] += int(identity_correct)
        aligned_identity_ranking = box_match["aligned_identity_ranking"]
        aligned_best_score = box_match["aligned_best_score"]
        aligned_best_candidate = box_match["aligned_best_candidate"]
        aligned_icon_size = box_match["aligned_icon_size"]
        aligned_identity_correct = (
            predicted_type == actual_type
            and aligned_best_candidate["id"] == actual_id
        )
        aligned_identity_predictions.append(
            {
                "annotation_id": annotation["annotation_id"],
                "true_type": actual_type,
                "true_id": actual_id,
                "predicted_type": predicted_type,
                "predicted_id": aligned_best_candidate["id"],
                "predicted_name": aligned_best_candidate["name"],
                "top1_mse": aligned_best_score,
                "aligned_icon_size": aligned_icon_size,
                "correct": aligned_identity_correct,
                "top3": [
                    {
                        "id": candidate["id"],
                        "name": candidate["name"],
                        "asset": candidate["url"],
                    }
                    for _, candidate in aligned_identity_ranking[:3]
                ],
                "in_top3": any(
                    candidate["id"] == actual_id
                    for _, candidate in aligned_identity_ranking[:3]
                )
                and predicted_type == actual_type,
            }
        )
        exact_state_prediction = None
        if actual_type == "collection":
            collection_candidates = [
                candidate
                for candidate in candidate_assets
                if candidate["type"] == actual_type and candidate["id"] == actual_id
            ]
            if not collection_candidates:
                raise ValueError(
                    f"No collection templates found for catalog ID {actual_id}."
                )
            alignment_anchor = next(
                (
                    candidate
                    for candidate in collection_candidates
                    if candidate["state"] == "level1"
                ),
                None,
            )
            if alignment_anchor is None:
                raise ValueError(
                    f"No level-1 collection template found for catalog ID {actual_id}."
                )
            registration_target = source_scale_crop(
                source_screenshot,
                annotation["bbox"],
                source_scale,
                padding=3,
            )
            registered_crop, registration_offset = registered_alpha_crop(
                registration_target,
                alignment_anchor["image"],
                "collection",
            )
            collection_state_ranking = sorted(
                (
                    (
                        aligned_alpha_mse(
                            registered_crop,
                            candidate["image"],
                            "collection",
                        ),
                        candidate,
                    )
                    for candidate in collection_candidates
                ),
                key=lambda result: (result[0], result[1]["url"]),
            )
            full_icon_mse, full_icon_prediction = collection_state_ranking[0]
            expected_filename = annotation["asset_url"].rsplit("/", 1)[-1]
            full_icon_expected_rank = next(
                (
                    rank
                    for rank, (_, candidate) in enumerate(
                        collection_state_ranking,
                        start=1,
                    )
                    if candidate["url"] == annotation["asset_url"]
                ),
                None,
            )
            if full_icon_expected_rank is None:
                raise ValueError(
                    "Expected collection state is not in the candidate set: "
                    f"{annotation['asset_url']}"
                )
            full_icon_expected_mse = collection_state_ranking[
                full_icon_expected_rank - 1
            ][0]
            predicted_level_match = re.match(
                r"level(\d+)",
                full_icon_prediction["state"],
            )
            predicted_level = (
                int(predicted_level_match.group(1)) if predicted_level_match else 0
            )
            badge_target = source_scale_crop(
                screenshot,
                annotation["bbox"],
                1,
                padding=COLLECTION_BADGE_REGISTRATION_PADDING,
            )
            registered_badge_crop, badge_registration_offset = registered_alpha_crop(
                badge_target,
                alignment_anchor["image"],
                "collection",
                icon_size=COLLECTION_BADGE_TEMPLATE_SIZE,
            )
            same_level_candidates = []
            for candidate in collection_candidates:
                candidate_level_match = re.match(
                    r"level(\d+)",
                    candidate["state"],
                )
                candidate_level = (
                    int(candidate_level_match.group(1)) if candidate_level_match else 0
                )
                if candidate_level == predicted_level:
                    same_level_candidates.append(candidate)
            badge_state_ranking = sorted(
                (
                    (
                        alpha_masked_region_mse(
                            registered_badge_crop,
                            candidate["image"],
                            COLLECTION_BADGE_ROI,
                            COLLECTION_BADGE_TEMPLATE_SIZE,
                        ),
                        candidate,
                    )
                    for candidate in same_level_candidates
                ),
                key=lambda result: (result[0], result[1]["url"]),
            )
            if not badge_state_ranking:
                raise ValueError(
                    f"No collection variants found for predicted level {predicted_level} "
                    f"and catalog ID {actual_id}."
                )
            exact_state_mse, exact_state_prediction = badge_state_ranking[0]
            badge_expected_rank = next(
                (
                    rank
                    for rank, (_, candidate) in enumerate(
                        badge_state_ranking,
                        start=1,
                    )
                    if candidate["url"] == annotation["asset_url"]
                ),
                None,
            )
            badge_expected_mse = (
                badge_state_ranking[badge_expected_rank - 1][0]
                if badge_expected_rank is not None
                else None
            )
            state_correct = (
                exact_state_prediction["url"].rsplit("/", 1)[-1] == expected_filename
            )
            expected_level_match = re.search(r"_lvl(\d+)", expected_filename)
            expected_level = int(expected_level_match.group(1)) if expected_level_match else 0
            collection_state_predictions.append(
                {
                    "annotation_id": annotation["annotation_id"],
                    "true_id": actual_id,
                    "true_name": annotation["catalog_name"],
                    "expected_asset": expected_filename,
                    "predicted_asset": exact_state_prediction["url"].rsplit("/", 1)[-1],
                    "full_icon_predicted_asset": full_icon_prediction["url"].rsplit(
                        "/", 1
                    )[-1],
                    "predicted_state": exact_state_prediction["state"],
                    "top1_mse": full_icon_mse,
                    "expected_mse": full_icon_expected_mse,
                    "expected_rank": full_icon_expected_rank,
                    "badge_top1_mse": exact_state_mse,
                    "badge_expected_mse": badge_expected_mse,
                    "badge_expected_rank": badge_expected_rank,
                    "badge_template_size": COLLECTION_BADGE_TEMPLATE_SIZE,
                    "badge_roi": list(COLLECTION_BADGE_ROI),
                    "badge_registration_offset": list(badge_registration_offset),
                    "correct": state_correct,
                    "expected_level": expected_level,
                    "predicted_level": predicted_level,
                    "level_correct": predicted_level == expected_level,
                    "registration_offset": list(registration_offset),
                }
            )
        predictions.append(
            {
                "annotation_id": annotation["annotation_id"],
                "true_type": actual_type,
                "true_id": actual_id,
                "true_name": annotation["catalog_name"],
                "predicted_type": predicted_type,
                "type_correct": type_correct,
                "type_top3": [item[1] for item in type_ranking],
                "type_ranking": [
                    {
                        "type": item[1],
                        "best_id": item[2],
                        "best_name": item[3],
                        "best_mse": item[0],
                    }
                    for item in type_ranking
                ],
                "top1_type": best_identity[1],
                "top1_id": best_identity[2],
                "top1_name": best_identity[3],
                "top1_mse": best_identity[0],
                "top1_asset": best_identity[4],
                "top1_variant": best_identity[5],
                "identity_correct": identity_correct,
                "top3": [
                    {
                        "type": item[1],
                        "id": item[2],
                        "name": item[3],
                        "asset": item[4],
                        "variant": item[5],
                    }
                    for item in identity_ranking[:3]
                ],
                "identity_in_top3": any(
                    item[1] == actual_type and item[2] == actual_id
                    for item in identity_ranking[:3]
                ),
            }
        )

    query_count = len(predictions)
    type_correct_count = sum(item["type_correct"] for item in predictions)
    identity_correct_count = sum(item["identity_correct"] for item in predictions)
    collection_state_correct = sum(item["correct"] for item in collection_state_predictions)
    collection_level_correct = sum(
        item["level_correct"] for item in collection_state_predictions
    )
    for identity_type, metrics in by_type.items():
        count = metrics["query_count"]
        metrics["type_accuracy"] = metrics["type_correct"] / count if count else 0
        metrics["identity_top1_accuracy"] = (
            metrics["identity_correct"] / count if count else 0
        )
    hero_visual_state = evaluate_hero_visual_states(
        annotations,
        predictions,
        source_screenshot,
        source_scale,
        cache_root,
    )
    collection_node_stat_icons = evaluate_collection_node_stat_icons(
        annotations,
        screenshot,
        cache_root,
    )
    return {
        "candidate_count": len(candidate_assets),
        "candidate_counts_by_type": {
            "hero": len(catalogs["hero"]),
            "collection": sum(
                candidate["type"] == "collection" for candidate in candidate_assets
            ),
            "pet": len(catalogs["pet"]),
            "collection_node": collection_node_stat_icons["candidate_count"],
        },
        "collection_catalog_assets_requested": sum(
            candidate["type"] == "collection" for candidate in candidate_assets
        )
        + len(missing_collection_assets),
        "missing_collection_assets": missing_collection_assets,
        "query_count": query_count,
        "type_correct": type_correct_count,
        "type_accuracy": type_correct_count / query_count,
        "identity_top1_correct": identity_correct_count,
        "identity_top1_accuracy": identity_correct_count / query_count,
        "identity_top3_correct": sum(item["identity_in_top3"] for item in predictions),
        "identity_top3_accuracy": sum(
            item["identity_in_top3"] for item in predictions
        ) / query_count,
        "aligned_identity_top1_correct": sum(
            item["correct"] for item in aligned_identity_predictions
        ),
        "aligned_identity_top1_accuracy": sum(
            item["correct"] for item in aligned_identity_predictions
        ) / query_count,
        "aligned_identity_top3_correct": sum(
            item["in_top3"] for item in aligned_identity_predictions
        ),
        "aligned_identity_top3_accuracy": sum(
            item["in_top3"] for item in aligned_identity_predictions
        ) / query_count,
        "aligned_identity_predictions": aligned_identity_predictions,
        "type_confusion_matrix": confusion,
        "per_type": by_type,
        "collection_visual_state": {
            "query_count": len(collection_state_predictions),
            "correct": collection_state_correct,
            "accuracy": collection_state_correct / len(collection_state_predictions),
            "level_correct": collection_level_correct,
            "level_accuracy": collection_level_correct / len(collection_state_predictions),
            "predictions": collection_state_predictions,
        },
        "collection_node_stat_icons": collection_node_stat_icons,
        "hero_visual_state": hero_visual_state,
        "predictions": predictions,
    }


def main():
    repo_root = Path(__file__).resolve().parents[2]
    lab_dir = Path(__file__).resolve().parent
    helper = load_ground_truth_module(
        lab_dir / "create-lineup-identity-ground-truth.py"
    )
    schema_sql = (repo_root / "schema.sql").read_text(encoding="utf-8")
    catalogs = load_catalogs(schema_sql, helper)
    ground_truth_path = lab_dir / "lineup-9-identity-ground-truth.json"
    ground_truth = json.loads(ground_truth_path.read_text(encoding="utf-8"))
    image_path = repo_root / ground_truth["image"]["file_name"]
    screenshot = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if screenshot is None:
        raise ValueError(f"Could not read app screenshot: {image_path}")
    if (screenshot.shape[1], screenshot.shape[0]) != (
        ground_truth["image"]["width"],
        ground_truth["image"]["height"],
    ):
        raise ValueError("Screenshot dimensions do not match identity ground truth.")

    cache_root = Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    results = {}
    for method, (identity_type, _) in METHODS.items():
        results[method] = evaluate_method(
            method,
            catalogs[identity_type],
            ground_truth["annotations"],
            screenshot,
            cache_root / method,
        )

    unknown_type = evaluate_unknown_type(
        ground_truth["annotations"],
        catalogs,
        screenshot,
        cache_root,
    )
    report = {
        "lineup_id": ground_truth["lineup_id"],
        "image": ground_truth["image"],
        "method": "Per-type baselines use center-crop RGB mean-squared pixel distance; the mixed baseline first predicts type with that metric, then uses source-scale alpha-masked template matching for identity.",
        "assumptions": [
            "Ground-truth icon boxes are supplied; this does not evaluate detection.",
            "Per-type results assume the icon type is known; global_unknown_type ranks the three types together.",
            "The mixed search uses one generic framed hero and pet template per identity, plus all available base/level/mythic-count collection variants.",
            "The staged identity metric withholds type: it predicts type from the mixed center-crop search, then reranks only that predicted type with source-scale alpha-masked matching.",
            "Expected hero and collection states use seeded lineup metadata plus screenshot-reviewed overrides for three heroes whose ascension or investment metadata is incomplete.",
            "Hero investment-state recognition is evaluated in a second stage after the hero identity is predicted, using available CDN render variants for that hero.",
            "Collection level is selected by full-icon matching; mythic-stat count is reranked within the predicted level using a native-resolution badge region.",
            "The screenshot and templates use the same CDN art family, so this is a retrieval baseline rather than evidence of cross-source generalization.",
        ],
        "catalog_sizes": {identity_type: len(entries) for identity_type, entries in catalogs.items()},
        "global_unknown_type": unknown_type,
        "collection_variant_space": {
            "base_icons": "collection_icon/{id}_cl.webp and {id}_ms1..8_cl.webp",
            "leveled_icons": "collection_icon/{id}_lvl1..3[_ms1..8]_cl.webp",
            "available_candidates": unknown_type["candidate_counts_by_type"]["collection"],
            "missing_candidate_assets": len(unknown_type["missing_collection_assets"]),
        },
        "results": results,
    }
    output_path = lab_dir / OUTPUT_NAME
    output_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    for method, result in results.items():
        print(
            f"{method}: top-1 {result['top1_correct']}/{result['query_count']}, "
            f"top-3 {result['top3_correct']}/{result['query_count']}, "
            f"candidates {result['candidate_count']}, "
            f"missing {len(result['missing_candidate_ids'])}"
        )
        if result["missing_candidate_ids"]:
            print(f"  missing IDs: {result['missing_candidate_ids']}")
        for prediction in result["predictions"]:
            if not prediction["top1_correct"]:
                print(
                    f"  miss: {prediction['true_name']} ({prediction['true_id']}) "
                    f"-> {prediction['top1_name']} ({prediction['top1_id']}); "
                    f"top 3: {prediction['top3_names']}"
                )
    print(
        "unknown-type global search: "
        f"type {unknown_type['type_correct']}/{unknown_type['query_count']}, "
        f"identity top-1 {unknown_type['identity_top1_correct']}/{unknown_type['query_count']}, "
        f"identity top-3 {unknown_type['identity_top3_correct']}/{unknown_type['query_count']}"
    )
    print(
        "staged source-scale identity: "
        f"top-1 {unknown_type['aligned_identity_top1_correct']}/{unknown_type['query_count']}, "
        f"top-3 {unknown_type['aligned_identity_top3_correct']}/{unknown_type['query_count']}"
    )
    print("type confusion matrix:")
    for actual_type, predictions_by_type in unknown_type["type_confusion_matrix"].items():
        print(f"  {actual_type}: {predictions_by_type}")
    collection_state = unknown_type["collection_visual_state"]
    print(
        "collection variant accuracy (known collection ID): "
        f"exact {collection_state['correct']}/{collection_state['query_count']}, "
        f"level {collection_state['level_correct']}/{collection_state['query_count']}"
    )
    node_stats = unknown_type["collection_node_stat_icons"]
    print(
        "collection node stat icon accuracy: "
        f"nodes {node_stats['node_exact_correct']}/{node_stats['node_query_count']} "
        f"(slots {node_stats['slot_exact_correct']}/{node_stats['collection_slot_count']}, "
        f"{node_stats['candidate_count']} stat-tier candidates)"
    )
    hero_state = unknown_type["hero_visual_state"]
    print(
        "hero investment variant accuracy (predicted hero ID): "
        f"{hero_state['correct']}/{hero_state['query_count']} "
        f"(85px baseline {hero_state['baseline_correct']}/{hero_state['query_count']}; "
        f"registered {hero_state['template_size']}px templates), "
        f"across {hero_state['available_candidate_count']} available state assets "
        f"({hero_state['missing_candidate_count']} unavailable)"
    )
    print(f"Wrote identity results to {output_path}")


if __name__ == "__main__":
    main()
