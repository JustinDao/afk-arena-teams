#!/usr/bin/env python3
import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import time

import cv2
import numpy as np
from ultralytics import YOLO


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {name} from {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def integer_bbox(xyxy, image_shape):
    image_height, image_width = image_shape[:2]
    x1, y1, x2, y2 = xyxy
    left = max(0, min(image_width, round(x1)))
    top = max(0, min(image_height, round(y1)))
    right = max(0, min(image_width, round(x2)))
    bottom = max(0, min(image_height, round(y2)))
    if right <= left or bottom <= top:
        raise ValueError(f"Detector returned an invalid box: {xyxy}")
    return [left, top, right - left, bottom - top]


def expand_bbox(bbox, image_shape, scale):
    image_height, image_width = image_shape[:2]
    x, y, width, height = bbox
    center_x = x + width / 2
    center_y = y + height / 2
    expanded_width = width * scale
    expanded_height = height * scale
    left = max(0, round(center_x - expanded_width / 2))
    top = max(0, round(center_y - expanded_height / 2))
    right = min(image_width, round(center_x + expanded_width / 2))
    bottom = min(image_height, round(center_y + expanded_height / 2))
    return [left, top, right - left, bottom - top]


def box_iou(left, right):
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    intersection_width = max(0, min(lx + lw, rx + rw) - max(lx, rx))
    intersection_height = max(0, min(ly + lh, ry + rh) - max(ly, ry))
    intersection = intersection_width * intersection_height
    union = lw * lh + rw * rh - intersection
    return intersection / union if union > 0 else 0


def hypot_dist(x1, y1, x2, y2):
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5


def parse_level_from_state(state_str):
    match = re.search(r"level(\d+)", state_str or "")
    return int(match.group(1)) if match else 1


def mse_to_confidence(mse, runner_up_mse=None, scale=2800.0):
    if mse is None or not math.isfinite(mse):
        return 0.0
    base = math.exp(-max(0.0, float(mse)) / scale)
    if runner_up_mse is not None and math.isfinite(runner_up_mse) and runner_up_mse > 0:
        ratio = float(runner_up_mse) / max(1.0, float(mse))
        margin_bonus = min(1.12, max(0.78, 0.72 + 0.20 * min(ratio, 2.0)))
        base = base * margin_bonus
    return round(float(max(0.01, min(0.99, base))), 3)


def normalize_yolo_boxes(raw_boxes, raw_scores, img_shape, min_px=45):
    H, W = img_shape[:2]
    norm = []
    for (x1, y1, x2, y2), s in zip(raw_boxes, raw_scores):
        w, h = x2 - x1, y2 - y1
        if w < min_px or h < min_px or w > W * 0.4 or h > H * 0.4:
            continue
        ar = w / max(1.0, h)
        if ar > 1.42 or ar < 0.45:
            continue
        sq_sz = round(w) if ar < 0.92 else round((w + h) / 2.0)
        bx = max(0, min(W - sq_sz, round(x1)))
        by = max(0, min(H - sq_sz, round(y1)))
        norm.append(([bx, by, sq_sz, sq_sz], float(s)))

    norm.sort(key=lambda item: item[1], reverse=True)
    kept = []
    for bbox, score in norm:
        cx, cy = bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0
        if all(
            hypot_dist(cx, cy, kb[0] + kb[2] / 2.0, kb[1] + kb[3] / 2.0)
            > min(bbox[2], kb[2]) * 0.48
            for kb, _ in kept
        ):
            kept.append((bbox, score))
    return kept


def assemble_app_card_teams(img, norm_boxes):
    large = [b for b, _ in norm_boxes if b[2] >= 80]
    small = [b for b, _ in norm_boxes if 45 <= b[2] < 80]
    med_w = 111

    H, W = img.shape[:2]
    ys_all = sorted(b[1] + b[3] / 2.0 for b in large)
    best_gap, y_split = 0, H * 0.43
    for y1, y2 in zip(ys_all, ys_all[1:]):
        if H * 0.25 < (y1 + y2) / 2.0 < H * 0.65 and (y2 - y1) > best_gap:
            best_gap = y2 - y1
            y_split = (y1 + y2) / 2.0

    y_bounds = [(0, y_split), (y_split, H)]
    cards = []
    for row_idx in range(2):
        for col_idx in range(3):
            x_min, x_max = col_idx * (W / 3.0), (col_idx + 1) * (W / 3.0)
            y_min, y_max = y_bounds[row_idx]
            c_large = [
                b
                for b in large
                if x_min <= b[0] + b[2] / 2.0 < x_max
                and y_min <= b[1] + b[3] / 2.0 < y_max
            ]
            c_small = [
                b
                for b in small
                if x_min <= b[0] + b[2] / 2.0 < x_max
                and y_min <= b[1] + b[3] / 2.0 < y_max
            ]
            if not c_large:
                continue
            xs = sorted(b[0] for b in c_large)
            x_clusters = []
            for x in xs:
                if not x_clusters or abs(x - np.mean(x_clusters[-1])) > med_w * 0.55:
                    x_clusters.append([x])
                else:
                    x_clusters[-1].append(x)
            col_xs = [round(float(np.median(cl))) for cl in x_clusters]
            if len(col_xs) != 4:
                x0 = min(xs)
                col_xs = [
                    x0,
                    x0 + round(med_w * 1.15),
                    x0 + round(med_w * 2.57),
                    x0 + round(med_w * 3.72),
                ]

            back_ys = sorted(
                b[1]
                for b in c_large
                if abs(b[0] - col_xs[0]) < med_w * 0.55
                or abs(b[0] - col_xs[1]) < med_w * 0.55
            )
            y_clusters = []
            for y in back_ys:
                if not y_clusters or abs(y - np.mean(y_clusters[-1])) > med_w * 0.55:
                    y_clusters.append([y])
                else:
                    y_clusters[-1].append(y)
            row_ys = [round(float(np.median(cl))) for cl in y_clusters][:3]
            dy = (
                round((row_ys[-1] - row_ys[0]) / 2.0)
                if len(row_ys) >= 2
                else round(med_w * 1.74)
            )
            if len(row_ys) < 3:
                y0 = row_ys[0] if row_ys else round(y_min + 200)
                row_ys = [y0, y0 + dy, y0 + 2 * dy]
            front_ys = [round(row_ys[0] + 0.5 * dy), round(row_ys[0] + 1.5 * dy)]

            hero_slots = [
                [col_xs[2], front_ys[0], med_w, med_w],
                [col_xs[2], front_ys[1], med_w, med_w],
                [col_xs[0], row_ys[0], med_w, med_w],
                [col_xs[0], row_ys[1], med_w, med_w],
                [col_xs[0], row_ys[2], med_w, med_w],
            ]
            coll_slots = [
                [col_xs[3], front_ys[0], med_w, med_w],
                [col_xs[3], front_ys[1], med_w, med_w],
                [col_xs[1], row_ys[0], med_w, med_w],
                [col_xs[1], row_ys[1], med_w, med_w],
                [col_xs[1], row_ys[2], med_w, med_w],
            ]
            if c_small:
                pet_det = sorted(c_small, key=lambda b: b[1], reverse=True)[0]
                pet_box = [pet_det[0], pet_det[1], 64, 64]
            else:
                pet_sz = 64
                pet_x = round((col_xs[0] + col_xs[3] + med_w - pet_sz) / 2.0)
                pet_y = round(row_ys[2] + med_w * 1.72)
                pet_box = [pet_x, pet_y, pet_sz, pet_sz]

            cards.append(
                {
                    "round": len(cards) + 1,
                    "layout": "app_card_3_2",
                    "hero_boxes": hero_slots,
                    "coll_boxes": coll_slots,
                    "pet_box": pet_box,
                }
            )
    return cards


def assemble_row_5_col_team(img, norm_boxes, round_num=1):
    boxes = [b for b, _ in norm_boxes if b[2] >= 80]
    boxes.sort(key=lambda b: b[1])
    y_bands = []
    for b in boxes:
        if not y_bands or abs(b[1] - np.mean([x[1] for x in y_bands[-1]])) > 100:
            y_bands.append([b])
        else:
            y_bands[-1].append(b)
    hero_band = (
        sorted([b for b in y_bands[0] if b[2] >= 120], key=lambda b: b[0])
        if y_bands
        else []
    )
    coll_band = (
        sorted([b for b in y_bands[1] if 85 <= b[2] <= 115], key=lambda b: b[0])
        if len(y_bands) > 1
        else []
    )

    h_w = 140
    c_w = 98
    h_y = int(np.median([b[1] for b in hero_band])) if hero_band else 160
    c_y = int(np.median([b[1] for b in coll_band])) if coll_band else 400

    all_cxs = [b[0] + b[2] / 2.0 for b in hero_band + coll_band]
    best_grid = None
    for cx0 in all_cxs:
        for i0 in range(5):
            for step in range(194, 208, 2):
                start_x = cx0 - i0 * step
                grid = [start_x + k * step for k in range(5)]
                inliers = 0
                err_sum = 0.0
                for k in range(5):
                    dists = [abs(x - grid[k]) for x in all_cxs if abs(x - grid[k]) < 38.0]
                    if dists:
                        inliers += len(dists)
                        err_sum += min(dists)
                key = (inliers, -err_sum)
                if best_grid is None or key > best_grid[0]:
                    best_grid = (key, grid)

    if best_grid is not None:
        col_centers = list(best_grid[1])
        for i in range(5):
            near = [x for x in all_cxs if abs(x - col_centers[i]) < 32.0]
            if near:
                col_centers[i] = float(np.median(near))
    else:
        col_centers = [180 + i * 200 for i in range(5)]

    hero_slots = [[round(cx - h_w / 2.0), h_y, h_w, h_w] for cx in col_centers]
    coll_slots = [[round(cx - c_w / 2.0), c_y, c_w, c_w] for cx in col_centers]
    return [
        {
            "round": round_num,
            "layout": "row_5_col",
            "hero_boxes": hero_slots,
            "coll_boxes": coll_slots,
            "pet_box": None,
        }
    ]


def assemble_staggered_teams(img, norm_boxes):
    cand = [b for b, _ in norm_boxes if 50 <= b[2] <= 88]
    cand.sort(key=lambda b: b[1])
    rounds_raw = []
    for b in cand:
        if not rounds_raw or (b[1] - rounds_raw[-1][-1][1]) > 150:
            rounds_raw.append([b])
        else:
            rounds_raw[-1].append(b)

    teams = []
    for r_boxes in rounds_raw:
        if len(r_boxes) < 4:
            continue
        med_w = 70
        r_xs = sorted(b[0] for b in r_boxes)
        x_mid = (min(r_xs) + max(r_xs)) / 2.0
        left_col = sorted([b for b in r_boxes if b[0] < x_mid], key=lambda b: b[1])
        right_col = sorted([b for b in r_boxes if b[0] >= x_mid], key=lambda b: b[1])
        if not left_col or not right_col:
            continue
        x_L = round(float(np.median([b[0] for b in left_col])))
        x_R = round(float(np.median([b[0] for b in right_col])))
        if len(left_col) >= 2:
            dy = round((left_col[-1][1] - left_col[0][1]) / max(1, len(left_col) - 1))
            if dy > med_w * 2.2:
                dy = round(dy / 2.0)
        elif len(right_col) >= 3:
            dy = round(right_col[2][1] - right_col[1][1])
        else:
            dy = round(med_w * 1.65)

        y_0 = left_col[0][1]
        if (
            len(left_col) == 2
            and (left_col[1][1] - left_col[0][1]) < 1.5 * dy
            and right_col[-1][1] < left_col[-1][1]
            and y_0 > dy
        ):
            y_0 = y_0 - dy

        pet_y = (
            right_col[0][1]
            if right_col[0][1] < y_0 - 15
            else max(0, round(y_0 - 0.35 * dy))
        )
        pet_box = [x_R, pet_y, med_w, med_w]
        hero_slots = [
            [x_L, y_0, med_w, med_w],
            [x_R, round(y_0 + 0.5 * dy), med_w, med_w],
            [x_L, round(y_0 + 1.0 * dy), med_w, med_w],
            [x_R, round(y_0 + 1.5 * dy), med_w, med_w],
            [x_L, round(y_0 + 2.0 * dy), med_w, med_w],
        ]
        for idx, hb in enumerate(hero_slots):
            for det in r_boxes:
                if hypot_dist(hb[0], hb[1], det[0], det[1]) < med_w * 0.35:
                    hero_slots[idx] = [det[0], det[1], med_w, med_w]
                    break
        teams.append(
            {
                "round": len(teams) + 1,
                "layout": "staggered_3_2",
                "hero_boxes": hero_slots,
                "coll_boxes": None,
                "pet_box": pet_box,
            }
        )
    return teams


def solve_teams(
    img,
    teams_geom,
    matcher,
    type_tensors,
    node_assets,
    hero_meta,
    pet_meta,
    collections_catalog,
):
    all_hero_rankings = []
    for team in teams_geom:
        for hbox in team["hero_boxes"]:
            all_hero_rankings.append(
                matcher.rank_candidates_in_box(img, hbox, "hero", type_tensors)
            )
    assigned_heroes = matcher.assign_unique_identities(all_hero_rankings)

    pet_indices = [i for i, t in enumerate(teams_geom) if t["pet_box"] is not None]
    pet_rankings = [
        matcher.rank_candidates_in_box(img, teams_geom[i]["pet_box"], "pet", type_tensors)
        for i in pet_indices
    ]
    assigned_pets = (
        matcher.assign_unique_identities(pet_rankings) if pet_rankings else []
    )
    pet_by_team = {t_idx: assigned_pets[k] for k, t_idx in enumerate(pet_indices)}
    pet_rank_by_team = {t_idx: pet_rankings[k] for k, t_idx in enumerate(pet_indices)}

    solved_teams = []
    h_cursor = 0
    for t_idx, team in enumerate(teams_geom):
        layout = team["layout"]
        team_heroes = []
        for s_idx, hbox in enumerate(team["hero_boxes"]):
            h_choice = assigned_heroes[h_cursor]
            h_ranked = all_hero_rankings[h_cursor]
            h_top3 = [
                {"id": x["id"], "name": x["name"], "mse": x["mse"]}
                for x in h_ranked[:3]
            ]
            h_visual_alts = [
                {
                    "id": x["id"],
                    "slug": hero_meta[x["id"]]["slug"],
                    "name": hero_meta[x["id"]]["name"],
                    "class": hero_meta[x["id"]]["class"],
                    "mse": round(float(x["mse"]), 2),
                    "confidence": mse_to_confidence(
                        x["mse"],
                        h_ranked[1]["mse"] if idx == 0 and len(h_ranked) > 1 else None,
                    ),
                }
                for idx, x in enumerate(h_ranked[:5])
            ]
            h_runner_mse = h_ranked[1]["mse"] if len(h_ranked) > 1 else None
            h_conf = mse_to_confidence(h_choice["mse"], h_runner_mse)
            h_needs_review = bool(
                h_choice["mse"] > 2650.0
                or (
                    h_runner_mse is not None
                    and h_runner_mse / max(1.0, h_choice["mse"]) < 1.22
                )
            )
            h_cursor += 1
            h_info = hero_meta[h_choice["id"]]
            h_class = h_info["class"]

            coll_result = None
            nodes_found = []
            if layout in ("app_card_3_2", "row_5_col"):
                cbox = team["coll_boxes"][s_idx]
                c_ranked = matcher.rank_candidates_in_box(
                    img,
                    cbox,
                    "collection",
                    type_tensors,
                    allowed_class=h_class,
                    collections_catalog=collections_catalog,
                )
                c_top1 = c_ranked[0]
                c_runner_mse = (
                    c_ranked[1]["effective_mse"] if len(c_ranked) > 1 else None
                )
                c_conf = mse_to_confidence(
                    c_top1["effective_mse"], c_runner_mse, scale=2600.0
                )
                c_needs_review = bool(
                    c_top1["mse"] > 2500.0
                    or (
                        c_runner_mse is not None
                        and c_runner_mse / max(1.0, c_top1["effective_mse"]) < 1.18
                    )
                )
                lvl = parse_level_from_state(c_top1["state"])
                cx, cy, cw, ch = cbox
                if layout == "app_card_3_2":
                    roi_x0 = max(0, cx - 12)
                    roi_y0 = max(0, cy + ch - 6)
                    roi = img[
                        roi_y0 : min(img.shape[0], cy + ch + 56),
                        roi_x0 : min(img.shape[1], cx + cw + 12),
                    ]
                    raw_nodes = matcher.detect_nodes_in_roi(
                        roi,
                        node_assets,
                        sz_list=(40, 42, 44, 46),
                        max_nodes=2,
                        mse_thresh=1500.0,
                    )
                else:
                    roi_x0 = max(0, cx - 25)
                    roi_y0 = max(0, cy + ch - 10)
                    roi = img[
                        roi_y0 : min(img.shape[0], cy + ch + 80),
                        roi_x0 : min(img.shape[1], cx + cw + 25),
                    ]
                    raw_nodes = matcher.detect_nodes_in_roi(
                        roi,
                        node_assets,
                        sz_list=(46, 50, 54, 56),
                        max_nodes=2,
                        mse_thresh=1750.0,
                    )
                for n_idx, n in enumerate(raw_nodes):
                    n_top3 = n.get("top3", [])
                    n_runner = n_top3[1]["mse"] if len(n_top3) > 1 else None
                    nodes_found.append(
                        {
                            "slot_index": n_idx,
                            "key": n["key"],
                            "stat": n["stat"],
                            "tier": n["tier"],
                            "mse": round(float(n["mse"]), 2),
                            "confidence": mse_to_confidence(
                                n["mse"], n_runner, scale=1800.0
                            ),
                            "needs_review": bool(
                                n["mse"] > 1350.0
                                or (
                                    n_runner is not None
                                    and n_runner / max(1.0, n["mse"]) < 1.18
                                )
                            ),
                            "visual_alternatives": [
                                {
                                    "key": alt["key"],
                                    "stat": alt["stat"],
                                    "tier": alt["tier"],
                                    "mse": round(float(alt["mse"]), 2),
                                }
                                for alt in n_top3[:3]
                            ],
                            "bbox": [
                                roi_x0 + n["ox"],
                                roi_y0 + n["oy"],
                                n["sz"],
                                n["sz"],
                            ],
                        }
                    )
                coll_result = {
                    "catalog": c_top1["id"],
                    "name": c_top1["name"],
                    "level": lvl,
                    "mse": c_top1["mse"],
                    "confidence": c_conf,
                    "needs_review": c_needs_review,
                    "bbox": cbox,
                    "top3": [
                        {
                            "id": x["id"],
                            "name": x["name"],
                            "mse": x["mse"],
                            "effective_mse": x["effective_mse"],
                        }
                        for x in c_ranked[:3]
                    ],
                    "visual_alternatives": [
                        {
                            "id": x["id"],
                            "name": x["name"],
                            "class": collections_catalog.get(x["id"], {}).get("class"),
                            "level": parse_level_from_state(x.get("state")),
                            "mse": round(float(x["mse"]), 2),
                            "effective_mse": round(float(x["effective_mse"]), 2),
                            "class_match": bool(x.get("class_match", True)),
                        }
                        for x in c_ranked[:5]
                    ],
                    "nodes": nodes_found,
                }
            elif layout == "staggered_3_2":
                bx, by, bw, bh = hbox
                c_roi_box = [
                    bx + round(bw * 0.72),
                    by + round(bh * 0.65),
                    round(bw * 0.58),
                    round(bh * 0.58),
                ]
                c_ranked = matcher.rank_candidates_in_box(
                    img,
                    c_roi_box,
                    "collection",
                    type_tensors,
                    scales=(0.90, 0.96, 1.02, 1.08),
                    pad_ratio=0.35,
                    stride=1,
                    allowed_class=h_class,
                    collections_catalog=collections_catalog,
                )
                c_top1 = c_ranked[0]
                c_runner_mse = (
                    c_ranked[1]["effective_mse"] if len(c_ranked) > 1 else None
                )
                c_conf = mse_to_confidence(
                    c_top1["effective_mse"], c_runner_mse, scale=2600.0
                )
                nx0, nx1 = max(0, bx - 22), min(img.shape[1], bx + round(bw * 0.56))
                ny0, ny1 = max(0, by + round(bh * 0.44)), min(img.shape[0], by + bh + 34)
                raw_nodes = matcher.detect_nodes_in_roi(
                    img[ny0:ny1, nx0:nx1],
                    node_assets,
                    sz_list=(36, 38, 40, 42),
                    max_nodes=1,
                    mse_thresh=1800.0,
                )
                for n_idx, n in enumerate(raw_nodes):
                    n_top3 = n.get("top3", [])
                    n_runner = n_top3[1]["mse"] if len(n_top3) > 1 else None
                    nodes_found.append(
                        {
                            "slot_index": n_idx,
                            "key": n["key"],
                            "stat": n["stat"],
                            "tier": n["tier"],
                            "mse": round(float(n["mse"]), 2),
                            "confidence": mse_to_confidence(
                                n["mse"], n_runner, scale=1800.0
                            ),
                            "needs_review": bool(
                                n["mse"] > 1400.0
                                or (
                                    n_runner is not None
                                    and n_runner / max(1.0, n["mse"]) < 1.18
                                )
                            ),
                            "visual_alternatives": [
                                {
                                    "key": alt["key"],
                                    "stat": alt["stat"],
                                    "tier": alt["tier"],
                                    "mse": round(float(alt["mse"]), 2),
                                }
                                for alt in n_top3[:3]
                            ],
                            "bbox": [
                                nx0 + n["ox"],
                                ny0 + n["oy"],
                                n["sz"],
                                n["sz"],
                            ],
                        }
                    )
                c_visual_alts = [
                    {
                        "id": x["id"],
                        "name": x["name"],
                        "class": collections_catalog.get(x["id"], {}).get("class"),
                        "level": parse_level_from_state(x.get("state")),
                        "mse": round(float(x["mse"]), 2),
                        "effective_mse": round(float(x["effective_mse"]), 2),
                        "class_match": bool(x.get("class_match", True)),
                    }
                    for x in c_ranked[:5]
                ]
                if c_top1["mse"] < 2400.0:
                    lvl = parse_level_from_state(c_top1["state"])
                    coll_result = {
                        "catalog": c_top1["id"],
                        "name": c_top1["name"],
                        "level": lvl,
                        "mse": c_top1["mse"],
                        "confidence": c_conf,
                        "needs_review": bool(c_top1["mse"] > 2050.0),
                        "bbox": c_roi_box,
                        "top3": [
                            {
                                "id": x["id"],
                                "name": x["name"],
                                "mse": x["mse"],
                                "effective_mse": x["effective_mse"],
                            }
                            for x in c_ranked[:3]
                        ],
                        "visual_alternatives": c_visual_alts,
                        "nodes": nodes_found,
                    }
                else:
                    coll_result = {
                        "catalog": None,
                        "name": None,
                        "level": None,
                        "mse": c_top1["mse"],
                        "confidence": round(1.0 - c_conf, 3),
                        "needs_review": False,
                        "bbox": c_roi_box,
                        "top3": [
                            {
                                "id": x["id"],
                                "name": x["name"],
                                "mse": x["mse"],
                                "effective_mse": x["effective_mse"],
                            }
                            for x in c_ranked[:3]
                        ],
                        "visual_alternatives": c_visual_alts,
                        "nodes": nodes_found,
                    }

            team_heroes.append(
                {
                    "slot": s_idx,
                    "id": h_info["id"],
                    "slug": h_info["slug"],
                    "name": h_info["name"],
                    "class": h_class,
                    "bbox": hbox,
                    "mse": h_choice["mse"],
                    "confidence": h_conf,
                    "needs_review": h_needs_review,
                    "top3": h_top3,
                    "visual_alternatives": h_visual_alts,
                    "collection": coll_result,
                }
            )

        p_choice = pet_by_team.get(t_idx)
        p_ranked = pet_rank_by_team.get(t_idx, [])
        pet_out = None
        if p_choice is not None:
            p_info = pet_meta[p_choice["id"]]
            p_runner_mse = p_ranked[1]["mse"] if len(p_ranked) > 1 else None
            p_conf = mse_to_confidence(p_choice["mse"], p_runner_mse, scale=2600.0)
            pet_out = {
                "id": p_info["id"],
                "slug": p_info["slug"],
                "name": p_info["name"],
                "bbox": team["pet_box"],
                "mse": p_choice["mse"],
                "confidence": p_conf,
                "needs_review": bool(
                    p_choice["mse"] > 2300.0
                    or (
                        p_runner_mse is not None
                        and p_runner_mse / max(1.0, p_choice["mse"]) < 1.20
                    )
                ),
                "visual_alternatives": [
                    {
                        "id": x["id"],
                        "slug": pet_meta[x["id"]]["slug"],
                        "name": pet_meta[x["id"]]["name"],
                        "mse": round(float(x["mse"]), 2),
                        "confidence": mse_to_confidence(x["mse"], scale=2600.0),
                    }
                    for x in p_ranked[:5]
                ],
            }
        solved_teams.append(
            {
                "round": team["round"],
                "layout": layout,
                "pet": pet_out,
                "heroes": team_heroes,
            }
        )
    return solved_teams


def decode_left_panel_rounds(img, matcher, type_tensors, hero_meta, pet_meta):
    """
    Decode the left panel (x=0..1048) of a 2-column community guide (such as lydydxhxpyyh1.png):
    extracts each round's primary pet(s), primary hero slot alternatives, and all substitute/alternative teams.
    """
    left_panel = img[:, : min(1048, img.shape[1])]
    bg_color = np.median(left_panel[500:5900, 20:100], axis=(0, 1))
    hero_t_name = "hero_left" if "hero_left" in type_tensors else "hero"

    def is_bg_region(patch, thresh=0.65):
        if patch.size == 0:
            return True
        d = np.max(np.abs(patch.astype(np.float32) - bg_color), axis=2)
        return float((d < 26).mean()) > thresh

    def decode_hero_cell(x0, y0, w, h):
        s_rank = matcher.rank_candidates_in_box(
            left_panel,
            [x0, y0, w, h],
            hero_t_name,
            type_tensors,
            scales=(0.92, 0.98, 1.04),
            pad_ratio=0.16,
            stride=2,
        )
        mse_single = s_rank[0]["mse"]

        tr_patch = left_panel[y0 + 3 : y0 + 22, x0 + w - 22 : x0 + w - 3]
        bl_patch = left_panel[y0 + h - 22 : y0 + h - 3, x0 + 3 : x0 + 22]
        br_patch = left_panel[y0 + h - 24 : y0 + h - 3, x0 + w - 24 : x0 + w - 3]
        tr_empty = is_bg_region(tr_patch)
        bl_empty = is_bg_region(bl_patch)
        br_empty = is_bg_region(br_patch)

        if not tr_empty and mse_single > 1500:
            q_sz = round(min(w, h) * 0.50)
            tl_q = matcher.rank_candidates_in_box(
                left_panel,
                [x0 - 4, y0 - 4, q_sz, q_sz],
                hero_t_name,
                type_tensors,
                scales=(0.86, 0.96, 1.06),
                pad_ratio=0.24,
                stride=2,
            )[0]
            tr_q = matcher.rank_candidates_in_box(
                left_panel,
                [x0 + w - q_sz + 4, y0 - 4, q_sz, q_sz],
                hero_t_name,
                type_tensors,
                scales=(0.86, 0.96, 1.06),
                pad_ratio=0.24,
                stride=2,
            )[0]
            if bl_empty and br_empty:
                bc_q = matcher.rank_candidates_in_box(
                    left_panel,
                    [x0 + round((w - q_sz) / 2), y0 + h - q_sz + 4, q_sz, q_sz],
                    hero_t_name,
                    type_tensors,
                    scales=(0.86, 0.96, 1.06),
                    pad_ratio=0.24,
                    stride=2,
                )[0]
                q_list = [tl_q, tr_q, bc_q]
            elif br_empty:
                bl_q = matcher.rank_candidates_in_box(
                    left_panel,
                    [x0 - 4, y0 + h - q_sz + 4, q_sz, q_sz],
                    hero_t_name,
                    type_tensors,
                    scales=(0.86, 0.96, 1.06),
                    pad_ratio=0.24,
                    stride=2,
                )[0]
                q_list = [tl_q, tr_q, bl_q]
            else:
                bl_q = matcher.rank_candidates_in_box(
                    left_panel,
                    [x0 - 4, y0 + h - q_sz + 4, q_sz, q_sz],
                    hero_t_name,
                    type_tensors,
                    scales=(0.86, 0.96, 1.06),
                    pad_ratio=0.24,
                    stride=2,
                )[0]
                br_q = matcher.rank_candidates_in_box(
                    left_panel,
                    [x0 + w - q_sz + 4, y0 + h - q_sz + 4, q_sz, q_sz],
                    hero_t_name,
                    type_tensors,
                    scales=(0.86, 0.96, 1.06),
                    pad_ratio=0.24,
                    stride=2,
                )[0]
                q_list = [tl_q, tr_q, bl_q, br_q]
            mse_quad = float(np.mean([q["mse"] for q in q_list]))
            if mse_quad < mse_single * 0.78 and len({q["id"] for q in q_list}) == len(q_list):
                return f"multi_{len(q_list)}", [hero_meta[q["id"]]["slug"] for q in q_list]

        if tr_empty or bl_empty:
            d_sz = round(min(w, h) * 0.62)
            tl_box = [x0 - 5, y0 - 5, d_sz, d_sz]
            br_box = [x0 + w - d_sz + 5, y0 + h - d_sz + 5, d_sz, d_sz]
            tl_rank = matcher.rank_candidates_in_box(
                left_panel,
                tl_box,
                hero_t_name,
                type_tensors,
                scales=(0.86, 0.96, 1.06, 1.14),
                pad_ratio=0.24,
                stride=2,
            )
            br_rank = matcher.rank_candidates_in_box(
                left_panel,
                br_box,
                hero_t_name,
                type_tensors,
                scales=(0.86, 0.96, 1.06, 1.14),
                pad_ratio=0.24,
                stride=2,
            )
            mse_diag = 0.5 * (tl_rank[0]["mse"] + br_rank[0]["mse"])
            if (tr_empty and mse_diag < mse_single * 0.98) or (
                bl_empty and mse_diag < mse_single * 0.82
            ):
                return "split_2", [
                    hero_meta[tl_rank[0]["id"]]["slug"],
                    hero_meta[br_rank[0]["id"]]["slug"],
                ]

        return "single", [hero_meta[s_rank[0]["id"]]["slug"]]

    def decode_pet_cell(x_pet, y0, h):
        roi = left_panel[
            max(0, y0 - 8) : min(left_panel.shape[0], y0 + h + 22), x_pet:868
        ]
        d = np.max(np.abs(roi.astype(np.float32) - bg_color), axis=2)
        col_active = (d > 30).mean(axis=0)
        active_xs = np.where(col_active > 0.22)[0]
        span_w = int(active_xs[-1]) + 1 if len(active_xs) else h

        tr_patch = left_panel[y0 + 3 : y0 + 22, x_pet + h - 20 : x_pet + h + 15]
        tr_empty = is_bg_region(tr_patch)

        if span_w >= 150 or (x_pet + span_w) >= 862:
            p_sz = round(h * 0.58)
            boxes = [
                [x_pet - 4, y0 - 8, p_sz, p_sz],
                [x_pet + round((span_w - p_sz) * 0.48), y0 + round(h * 0.20), p_sz, p_sz],
                [x_pet + span_w - p_sz, y0 + round(h * 0.46), p_sz, p_sz],
            ]
            r3_lists = [
                matcher.rank_candidates_in_box(
                    left_panel,
                    pb,
                    "pet",
                    type_tensors,
                    scales=(0.88, 0.96, 1.04, 1.12),
                    pad_ratio=0.25,
                    stride=1,
                )
                for pb in boxes
            ]
            r3 = [lst[0] for lst in r3_lists]
            return "split_3", [pet_meta[x["id"]] for x in r3], r3_lists[0][:5]

        if span_w >= 102 or tr_empty:
            p2_sz = round(h * 0.68)
            b2 = [
                [x_pet - 2, y0 - 4, p2_sz, p2_sz],
                [x_pet + max(span_w, h + 18) - p2_sz, y0 + h - p2_sz + 6, p2_sz, p2_sz],
            ]
            r2_lists = [
                matcher.rank_candidates_in_box(
                    left_panel,
                    pb,
                    "pet",
                    type_tensors,
                    scales=(0.88, 0.96, 1.04, 1.12),
                    pad_ratio=0.25,
                    stride=1,
                )
                for pb in b2
            ]
            r2 = [lst[0] for lst in r2_lists]
            return "split_2", [pet_meta[x["id"]] for x in r2], r2_lists[0][:5]

        r1_list = matcher.rank_candidates_in_box(
            left_panel,
            [x_pet, y0, h, h],
            "pet",
            type_tensors,
            scales=(0.92, 0.98, 1.04),
            pad_ratio=0.18,
            stride=2,
        )
        r1 = r1_list[0]
        return "single", [pet_meta[r1["id"]]], r1_list[:5]

    diff = np.max(np.abs(left_panel[:, 165:760].astype(np.float32) - bg_color), axis=2)
    row_fill = (diff > 28).astype(np.float32).mean(axis=1)

    in_seg = False
    row_segs = []
    for y in range(500, min(5980, left_panel.shape[0])):
        if row_fill[y] > 0.35 and not in_seg:
            y_start = y
            in_seg = True
        elif row_fill[y] <= 0.35 and in_seg:
            if y - y_start >= 75:
                row_segs.append((y_start, y))
            in_seg = False
    if in_seg and min(5980, left_panel.shape[0]) - y_start >= 75:
        row_segs.append((y_start, min(5980, left_panel.shape[0])))

    rounds = []
    for seg in row_segs:
        if not rounds or (seg[0] - rounds[-1][-1][1]) > 50:
            rounds.append([seg])
        else:
            rounds[-1].append(seg)

    decoded_rounds = []
    for r_idx, r_rows in enumerate(rounds, start=1):
        row_masks = []
        for y0, y1 in r_rows:
            r_diff = np.max(
                np.abs(left_panel[y0:y1, :880].astype(np.float32) - bg_color), axis=2
            )
            row_masks.append((r_diff > 28).astype(np.float32).mean(axis=0))
        col_profile = np.percentile(np.stack(row_masks, axis=0), 80, axis=0)
        c_segs = []
        in_c = False
        for x in range(145, 875):
            if col_profile[x] > 0.45 and not in_c:
                x_start = x
                in_c = True
            elif col_profile[x] <= 0.45 and in_c:
                if x - x_start >= 60:
                    c_segs.append((x_start, x))
                in_c = False
        if in_c and 875 - x_start >= 60:
            c_segs.append((x_start, 875))
        if len(c_segs) < 6:
            continue

        round_teams = []
        for t_idx, (y0, y1) in enumerate(r_rows, start=1):
            h = y1 - y0
            hero_slots = []
            for c_idx in range(5):
                cx0, _ = c_segs[c_idx]
                mode, slugs = decode_hero_cell(cx0, y0, h, h)
                hero_slots.append(
                    {
                        "slot": c_idx,
                        "mode": mode,
                        "primary_slug": slugs[0],
                        "options": slugs,
                    }
                )
            pet_x0 = c_segs[5][0]
            p_mode, p_objs, p_top5 = decode_pet_cell(pet_x0, y0, h)
            p_runner = p_top5[1]["mse"] if len(p_top5) > 1 else None
            p_conf = (
                mse_to_confidence(p_top5[0]["mse"], p_runner, scale=2600.0)
                if p_top5
                else 0.85
            )
            p_visual_alts = [
                {
                    "id": x["id"],
                    "slug": pet_meta[x["id"]]["slug"],
                    "name": pet_meta[x["id"]]["name"],
                    "mse": round(float(x["mse"]), 2),
                    "confidence": mse_to_confidence(x["mse"], scale=2600.0),
                }
                for x in p_top5
            ]
            round_teams.append(
                {
                    "row_index": t_idx,
                    "is_primary": t_idx == 1,
                    "bbox": [c_segs[0][0], y0, c_segs[5][1] - c_segs[0][0], h],
                    "pet": p_objs[0]["slug"],
                    "pet_id": p_objs[0]["id"],
                    "pet_name": p_objs[0]["name"],
                    "pet_mode": p_mode,
                    "pet_options": [p["slug"] for p in p_objs],
                    "pet_confidence": p_conf,
                    "pet_visual_alternatives": p_visual_alts,
                    "hero_slots": hero_slots,
                }
            )
        decoded_rounds.append(
            {
                "round": r_idx,
                "primary_row": round_teams[0] if round_teams else None,
                "substitute_teams": round_teams[1:] if len(round_teams) > 1 else [],
            }
        )
    return decoded_rounds


def teams_to_seed_formations(solved_teams):
    formations = []
    for team in solved_teams:
        r_idx = team["round"]
        heroes_out = []
        for h in team["heroes"]:
            coll = h["collection"]
            coll_obj = None
            if coll and coll["catalog"] is not None:
                nodes_list = []
                slot_counter = 0
                lvl = coll.get("level") or 1
                for _ in range(max(0, lvl - 1)):
                    nodes_list.append(
                        {"slotIndex": slot_counter, "stat": "skill_level", "tier": "mythic"}
                    )
                    slot_counter += 1
                for n in coll.get("nodes", []):
                    nodes_list.append(
                        {"slotIndex": slot_counter, "stat": n["stat"], "tier": n["tier"]}
                    )
                    slot_counter += 1
                coll_obj = {"catalog": coll["catalog"], "nodes": nodes_list}
            hero_entry = {"slug": h["slug"], "collection": coll_obj}
            if h.get("slot_options") and len(h["slot_options"]) > 1:
                hero_entry["alternatives"] = h["slot_options"][1:]
            heroes_out.append(hero_entry)
        formation_entry = {
            "key": team.get("matched_formation_key") or f"round-{r_idx}",
            "label": team.get("matched_formation_label") or f"Round {r_idx}",
            "pet": team["pet"]["slug"] if team.get("pet") else None,
            "heroes": heroes_out,
        }
        if team.get("pet") and team["pet"].get("options") and len(team["pet"]["options"]) > 1:
            formation_entry["pet_options"] = team["pet"]["options"]
        if team.get("substitute_teams"):
            formation_entry["substitute_teams"] = [
                {
                    "sub_index": sub["row_index"] - 1,
                    "pet": sub["pet"],
                    "pet_options": sub["pet_options"],
                    "heroes": [
                        s["primary_slug"] if len(s["options"]) == 1 else s["options"]
                        for s in sub["hero_slots"]
                    ],
                }
                for sub in team["substitute_teams"]
            ]
        formations.append(formation_entry)
    return formations


def load_reference_lineups(
    repo_root, hero_meta, pet_meta, collections_catalog, formations_gt=None
):
    if formations_gt is None:
        lab_dir = Path(__file__).resolve().parent
        gt_mod = load_module(
            "lineup_identity_ground_truth",
            lab_dir / "create-lineup-identity-ground-truth.py",
        )
        seed_sql = (repo_root / "seed.sql").read_text(encoding="utf-8")
        formations_gt = gt_mod.extract_lineup(seed_sql)

    f2p_heroes = [
        [200, 234, 97, 204, 252],
        [165, 227, 228, 205, 235],
        [199, 211, 250, 218, 238],
    ]
    f2p_pets = [6029, 6030, 6023]
    f2p_colls = [
        [None, 14, 3, 9, None],
        [15, 9, 14, 3, 15],
        [15, 5, 3, None, 14],
    ]
    f2p_nodes = [
        [["def_m"], ["erosion_m"], ["full_atk_m"], ["full_atk_m"], ["full_erosion_m"]],
        [["full_atk_m"], ["full_atk_m"], ["cda_m"], ["full_atk_m"], ["is_m"]],
        [["atk_m"], [], ["full_atk_m"], ["full_atk_m"], ["is_m"]],
    ]
    nc_bosses = [
        ("molten-crystalline-worm-queen", "Molten Crystalline Worm Queen"),
        ("cindercrow-specter", "Cindercrow Specter"),
        ("demonic-puppet", "Demonic Puppet"),
        ("ashen-prophet", "Ashen Prophet"),
        ("mirror-demon", "Mirror Demon"),
        ("infernal-overlord", "Infernal Overlord"),
    ]
    f2p_formations = []
    for r_i in range(3):
        f_heroes = []
        for s_i in range(5):
            hid = f2p_heroes[r_i][s_i]
            cid = f2p_colls[r_i][s_i]
            n_keys = f2p_nodes[r_i][s_i]
            c_obj = None
            if cid is not None or n_keys:
                c_obj = {
                    "catalog": cid,
                    "nodes": [
                        {
                            "slotIndex": ni,
                            "stat": nk[:-2],
                            "tier": "mythic" if nk.endswith("_m") else "legendary",
                        }
                        for ni, nk in enumerate(n_keys)
                    ],
                }
            f_heroes.append({"slug": hero_meta[hid]["slug"], "collection": c_obj})
        f2p_formations.append(
            {
                "key": nc_bosses[r_i][0],
                "label": nc_bosses[r_i][1],
                "pet": pet_meta[f2p_pets[r_i]]["slug"],
                "heroes": f_heroes,
            }
        )

    def make_simple_formation(key, label, hero_slugs, pet_slug=None):
        return {
            "key": key,
            "label": label,
            "pet": pet_slug,
            "heroes": [{"slug": s, "collection": None} for s in hero_slugs],
        }

    return [
        {
            "id": "nc-guide-2026-10-infernal-overlord",
            "title": "Nightmare Corridor — Infernal Overlord (6-Boss Cycle Meta)",
            "mode_slug": "nightmare-corridor",
            "mode_name": "Nightmare Corridor",
            "target_slug": "infernal-overlord",
            "target_name": "Infernal Overlord",
            "source": "seed.sql",
            "formations": formations_gt,
        },
        {
            "id": "nc-f2p-retries-infernal-overlord",
            "title": "Nightmare Corridor — Infernal Overlord (F2P 1k Dias / Retries 3-Round Guide)",
            "mode_slug": "nightmare-corridor",
            "mode_name": "Nightmare Corridor",
            "target_slug": "infernal-overlord",
            "target_name": "Infernal Overlord",
            "source": "f2p-weekly-nc-guide",
            "formations": f2p_formations,
        },
        {
            "id": "nc-netherspinner-sample",
            "title": "Nightmare Corridor — Netherspinner (6-Boss Cycle Sample)",
            "mode_slug": "nightmare-corridor",
            "mode_name": "Nightmare Corridor",
            "target_slug": "netherspinner",
            "target_name": "Netherspinner",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "soulweaver",
                    "Soulweaver",
                    ["saurus", "mishka", "scarlet", "oden", "mortas"],
                    "polar-beast",
                ),
                make_simple_formation(
                    "the-devourer",
                    "The Devourer",
                    ["rowan", "lyca", "lorsan", "ezizh", "raine"],
                    "fire-breather",
                ),
                make_simple_formation(
                    "astral-devourer",
                    "Astral Devourer",
                    ["hybris", "dracula", "awakened-estrilda", "lyca", "rowan"],
                    "dreary-ball",
                ),
                make_simple_formation(
                    "dual-mantle",
                    "Dual-Mantle",
                    ["odysseus", "orthros", "liberta", "palmer", "talimar"],
                    "pandy-dumpty",
                ),
                make_simple_formation(
                    "cursed-caprihornus",
                    "Cursed Caprihornus",
                    ["elthara", "alvida", "rowan", "misha", "severin"],
                    "tufty-ears",
                ),
                make_simple_formation(
                    "netherspinner",
                    "Netherspinner",
                    ["tavriel", "gorok", "lavatune", "talimar", "highborn-lan"],
                    "grassy-orb",
                ),
            ],
        },
        {
            "id": "cr-ice-shemira-sample",
            "title": "Cursed Realm — Ice Shemira (5 Shadow Guards + Boss)",
            "mode_slug": "cursed-realm",
            "mode_name": "Cursed Realm",
            "target_slug": "ice-shemira",
            "target_name": "Ice Shemira",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "sg1", "SG1", ["rowan", "lyca", "lorsan", "ezizh", "raine"], "dreary-ball"
                ),
                make_simple_formation(
                    "sg2",
                    "SG2",
                    ["talimar", "tavriel", "gorok", "lavatune", "elthara"],
                    "tufty-ears",
                ),
                make_simple_formation(
                    "sg3",
                    "SG3",
                    ["dracula", "hybris", "lysander", "highborn-leviathan", "serenmira"],
                    "grassy-orb",
                ),
                make_simple_formation(
                    "sg4",
                    "SG4",
                    ["melion", "sion", "laios", "marcille", "velufira"],
                    "polar-beast",
                ),
                make_simple_formation(
                    "sg5",
                    "SG5",
                    ["aurelia", "knox", "highborn-lan", "jerome", "misfortis"],
                    "fire-breather",
                ),
                make_simple_formation(
                    "boss",
                    "Boss",
                    ["belinda", "shemira", "silas", "lucretia", "daimon"],
                    "blade-ridge",
                ),
            ],
        },
        {
            "id": "cr-burning-brute-sample",
            "title": "Cursed Realm — Burning Brute (5 Shadow Guards + Boss)",
            "mode_slug": "cursed-realm",
            "mode_name": "Cursed Realm",
            "target_slug": "burning-brute",
            "target_name": "Burning Brute",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "sg1", "SG1", ["saurus", "mishka", "scarlet", "oden", "mortas"], "dreary-ball"
                ),
                make_simple_formation(
                    "sg2", "SG2", ["hodgkin", "alna", "nara", "ferael", "tasi"], "tufty-ears"
                ),
                make_simple_formation(
                    "sg3", "SG3", ["gwyneth", "rosaline", "arthur", "lucius", "brutus"], "grassy-orb"
                ),
                make_simple_formation(
                    "sg4", "SG4", ["randle", "albedo", "yennefer", "shuna", "atheus"], "polar-beast"
                ),
                make_simple_formation(
                    "sg5",
                    "SG5",
                    ["veithael", "rimuru", "saitama", "cha-hae-in", "sung-jinwoo"],
                    "fire-breather",
                ),
                make_simple_formation(
                    "boss",
                    "Boss",
                    ["awakened-belinda", "raine", "rowan", "kyno", "trix"],
                    "blade-ridge",
                ),
            ],
        },
        {
            "id": "ts-fire-7-teams-meta",
            "title": "Treasure Scramble — Fire Debuff (7-Team Meta)",
            "mode_slug": "treasure-scramble",
            "mode_name": "Treasure Scramble",
            "target_slug": "fire",
            "target_name": "Fire",
            "source": "community-meta",
            "formations": [
                make_simple_formation("t1", "Team 1", ["highborn-leviathan", "misfortis", "dracula", "awakened-hybris", "velufira"]),
                make_simple_formation("t2", "Team 2", ["awakened-maetria", "kikoru-shinomiya", "shalltear-bloodfallen", "flora", "kafka-hibino"]),
                make_simple_formation("t3", "Team 3", ["awakened-shemira", "harvey", "sung-jinwoo", "awakened-envydiel", "awakened-gavus"]),
                make_simple_formation("t4", "Team 4", ["saitama", "highborn-skylan", "gorok", "valeri", "awakened-theowyn"]),
                make_simple_formation("t5", "Team 5", ["awakened-fawkes", "alvida", "awakened-lyca", "lysander", "highborn-haelia"]),
                make_simple_formation("t6", "Team 6", ["awakened-estrilda", "highborn-odysseus", "highborn-thalassa", "kyno", "highborn-lan"]),
                make_simple_formation("t7", "Team 7", ["skreg", "athena", "awakened-eluard", "medusa", "highborn-elthara"]),
            ],
        },
        {
            "id": "ts-fire-sample",
            "title": "Treasure Scramble — Fire Debuff",
            "mode_slug": "treasure-scramble",
            "mode_name": "Treasure Scramble",
            "target_slug": "fire",
            "target_name": "Fire",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "t1", "Team 1", ["mehira", "brutus", "lucilla", "thoran", "raine"], "flutterplume-owl"
                ),
                make_simple_formation(
                    "t2", "Team 2", ["albedo", "merlin", "scarlet", "oden", "mishka"], "talismane"
                ),
                make_simple_formation(
                    "t3", "Team 3", ["silas", "mortas", "haelus", "desira", "framton"], "phantasmoth"
                ),
            ],
        },
        {
            "id": "ts-frost-sample",
            "title": "Treasure Scramble — Frost Debuff",
            "mode_slug": "treasure-scramble",
            "mode_name": "Treasure Scramble",
            "target_slug": "frost",
            "target_name": "Frost",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "t1",
                    "Team 1",
                    ["highborn-kaelon", "awakened-envydiel", "gorren", "highborn-haelia", "highborn-skylan"],
                    "flutterplume-owl",
                ),
                make_simple_formation(
                    "t2",
                    "Team 2",
                    ["elijah-and-lailah", "brutus", "randle", "aurelia", "saitama"],
                    "talismane",
                ),
            ],
        },
        {
            "id": "tr-ice-shemira-sample",
            "title": "Twisted Realm — Ice Shemira",
            "mode_slug": "twisted-realm",
            "mode_name": "Twisted Realm",
            "target_slug": "ice-shemira",
            "target_name": "Ice Shemira",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "team", "Team", ["shemira", "lucretia", "silas", "daimon", "ezizh"], "dreary-ball"
                )
            ],
        },
        {
            "id": "tr-burning-brute-sample",
            "title": "Twisted Realm — Burning Brute",
            "mode_slug": "twisted-realm",
            "mode_name": "Twisted Realm",
            "target_slug": "burning-brute",
            "target_name": "Burning Brute",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "team", "Team", ["belinda", "rosaline", "rowan", "raine", "lucius"], "winged-lion"
                )
            ],
        },
        {
            "id": "tr-kane-sample",
            "title": "Twisted Realm — Kane",
            "mode_slug": "twisted-realm",
            "mode_name": "Twisted Realm",
            "target_slug": "kane",
            "target_name": "Kane",
            "source": "lineup-data.ts",
            "formations": [
                make_simple_formation(
                    "team", "Team", ["saurus", "mishka", "scarlet", "oden", "mortas"], "flutterplume-owl"
                )
            ],
        },
    ]


def infer_mode_and_lineup_matches(
    solved_teams,
    img_shape,
    hero_meta,
    pet_meta,
    collections_catalog,
    repo_root,
    formations_gt=None,
):
    hero_by_slug = {v["slug"]: v for v in hero_meta.values()}
    pet_by_slug = {v["slug"]: v for v in pet_meta.values()}
    references = load_reference_lineups(
        repo_root, hero_meta, pet_meta, collections_catalog, formations_gt=formations_gt
    )

    team_count = len(solved_teams)
    has_collections = any(
        (h.get("collection") or {}).get("catalog") is not None
        for t in solved_teams
        for h in t.get("heroes", [])
    )
    has_substitutes = any(bool(t.get("substitute_teams")) for t in solved_teams)

    def compare_team_to_formation(team, ref_form):
        pred_heroes = team.get("heroes", [])
        ref_heroes = ref_form.get("heroes", [])
        pred_slugs = [h["slug"] for h in pred_heroes]
        ref_slugs = [h["slug"] for h in ref_heroes]

        expanded_slugs = set(pred_slugs)
        for h in pred_heroes:
            expanded_slugs.update(h.get("slot_options") or [])
        for sub in team.get("substitute_teams") or []:
            for hs in sub.get("hero_slots") or []:
                expanded_slugs.update(hs.get("options") or [])

        n_slots = max(1, len(ref_slugs))
        primary_overlap = len(set(pred_slugs) & set(ref_slugs)) / n_slots
        exact_slots = (
            sum(1 for a, b in zip(pred_slugs, ref_slugs) if a == b) / n_slots
        )
        expanded_overlap = len(expanded_slugs & set(ref_slugs)) / n_slots
        hero_sim = (
            0.55 * primary_overlap + 0.30 * exact_slots + 0.15 * expanded_overlap
        )

        pred_pet = (team.get("pet") or {}).get("slug")
        pred_pet_opts = set(
            (team.get("pet") or {}).get("options")
            or ([pred_pet] if pred_pet else [])
        )
        for sub in team.get("substitute_teams") or []:
            pred_pet_opts.update(sub.get("pet_options") or [])
        ref_pet = ref_form.get("pet")
        if ref_pet and pred_pet == ref_pet:
            pet_sim = 1.0
        elif ref_pet and ref_pet in pred_pet_opts:
            pet_sim = 0.90
        elif not ref_pet and not pred_pet:
            pet_sim = 1.0
        else:
            pet_sim = 0.0

        ref_has_colls = any(h.get("collection") is not None for h in ref_heroes)
        coll_matches, coll_total = 0, 0
        node_matches, node_total = 0, 0
        diffs = []

        for s_idx, (ph, rh) in enumerate(zip(pred_heroes, ref_heroes)):
            if ph["slug"] != rh["slug"]:
                if rh["slug"] in (ph.get("slot_options") or []):
                    diffs.append(
                        {
                            "type": "hero_slot_variant",
                            "slot": s_idx,
                            "image_value": ph["slug"],
                            "reference_value": rh["slug"],
                            "note": f"Slot {s_idx + 1}: image primary is {ph['slug']} (includes {rh['slug']} as slot alternative).",
                        }
                    )
                else:
                    diffs.append(
                        {
                            "type": "hero_mismatch",
                            "slot": s_idx,
                            "image_value": ph["slug"],
                            "reference_value": rh["slug"],
                            "note": f"Slot {s_idx + 1}: image has {ph['name']} ({ph['slug']}), reference lineup has {hero_by_slug.get(rh['slug'], {}).get('name', rh['slug'])} ({rh['slug']}).",
                        }
                    )

            if ref_has_colls:
                coll_total += 1
                p_cat = (ph.get("collection") or {}).get("catalog")
                r_cat = (rh.get("collection") or {}).get("catalog")
                if p_cat == r_cat:
                    coll_matches += 1
                else:
                    p_cname = (ph.get("collection") or {}).get("name") or "None"
                    r_cname = (
                        collections_catalog.get(r_cat, {}).get("name", str(r_cat))
                        if r_cat
                        else "None"
                    )
                    diffs.append(
                        {
                            "type": "collection_mismatch",
                            "slot": s_idx,
                            "hero_slug": ph["slug"],
                            "image_value": p_cat,
                            "reference_value": r_cat,
                            "note": f"Slot {s_idx + 1} ({ph['name']}): image collection is {p_cname}, reference has {r_cname}.",
                        }
                    )

                r_nodes = [
                    f"{n['stat']}_{n['tier'][0]}"
                    for n in ((rh.get("collection") or {}).get("nodes") or [])
                    if n["stat"] != "skill_level"
                ]
                p_nodes = [
                    n["key"]
                    for n in ((ph.get("collection") or {}).get("nodes") or [])
                ]
                if r_nodes or p_nodes:
                    node_total += max(len(r_nodes), len(p_nodes))
                    matched_n = sum(1 for a, b in zip(p_nodes, r_nodes) if a == b)
                    node_matches += matched_n
                    if p_nodes != r_nodes:
                        diffs.append(
                            {
                                "type": "collection_node_diff",
                                "slot": s_idx,
                                "hero_slug": ph["slug"],
                                "image_value": p_nodes,
                                "reference_value": r_nodes,
                                "note": f"Slot {s_idx + 1} ({ph['name']}) nodes: image shows {p_nodes or ['none']}, reference has {r_nodes or ['none']}.",
                            }
                        )

        if ref_pet and pred_pet and pred_pet != ref_pet:
            if ref_pet in pred_pet_opts:
                diffs.append(
                    {
                        "type": "pet_option_variant",
                        "slot": "pet",
                        "image_value": pred_pet,
                        "reference_value": ref_pet,
                        "note": f"Pet: image primary is {pred_pet} (includes {ref_pet} in pet cascade options).",
                    }
                )
            else:
                diffs.append(
                    {
                        "type": "pet_mismatch",
                        "slot": "pet",
                        "image_value": pred_pet,
                        "reference_value": ref_pet,
                        "note": f"Pet: image has {pred_pet}, reference has {ref_pet}.",
                    }
                )

        if ref_has_colls and has_collections:
            coll_sim = coll_matches / max(1, coll_total)
            node_sim = node_matches / max(1, node_total) if node_total else 1.0
            total_sim = (
                0.56 * hero_sim
                + 0.14 * pet_sim
                + 0.20 * coll_sim
                + 0.10 * node_sim
            )
        else:
            coll_sim = coll_matches / max(1, coll_total) if coll_total else None
            node_sim = None
            total_sim = 0.82 * hero_sim + 0.18 * pet_sim

        return {
            "similarity": round(float(total_sim), 4),
            "hero_overlap_count": len(set(pred_slugs) & set(ref_slugs)),
            "hero_exact_slot_count": sum(
                1 for a, b in zip(pred_slugs, ref_slugs) if a == b
            ),
            "pet_matched": bool(ref_pet and (pred_pet == ref_pet or ref_pet in pred_pet_opts)),
            "collection_match_count": coll_matches if ref_has_colls else None,
            "differences": diffs,
        }

    ranked_lineups = []
    for ref in references:
        ref_forms = ref["formations"]
        used_ref = set()
        round_alignments = []
        for t in solved_teams:
            best_f_idx = None
            best_cmp = None
            for f_idx, rf in enumerate(ref_forms):
                if f_idx in used_ref:
                    continue
                cmp_res = compare_team_to_formation(t, rf)
                if best_cmp is None or cmp_res["similarity"] > best_cmp["similarity"]:
                    best_cmp = cmp_res
                    best_f_idx = f_idx
            if best_f_idx is not None and best_cmp is not None:
                used_ref.add(best_f_idx)
                rf = ref_forms[best_f_idx]
                round_alignments.append(
                    {
                        "image_round": t["round"],
                        "matched_formation_key": rf["key"],
                        "matched_formation_label": rf["label"],
                        "similarity": best_cmp["similarity"],
                        "hero_overlap_count": best_cmp["hero_overlap_count"],
                        "hero_exact_slot_count": best_cmp["hero_exact_slot_count"],
                        "pet_matched": best_cmp["pet_matched"],
                        "collection_match_count": best_cmp["collection_match_count"],
                        "differences": best_cmp["differences"],
                    }
                )

        if round_alignments:
            mean_sim = float(np.mean([ra["similarity"] for ra in round_alignments]))
            count_ratio = min(team_count, len(ref_forms)) / max(
                team_count, len(ref_forms), 1
            )
            overall_sim = round(
                min(1.0, mean_sim * (0.94 + 0.06 * count_ratio)), 4
            )
        else:
            mean_sim = 0.0
            overall_sim = 0.0

        ranked_lineups.append(
            {
                "id": ref["id"],
                "title": ref["title"],
                "mode_slug": ref["mode_slug"],
                "mode_name": ref["mode_name"],
                "target_slug": ref["target_slug"],
                "target_name": ref["target_name"],
                "source": ref["source"],
                "reference_team_count": len(ref_forms),
                "similarity": overall_sim,
                "mean_round_similarity": round(mean_sim, 4),
                "round_alignments": round_alignments,
            }
        )

    ranked_lineups.sort(
        key=lambda x: (x["similarity"], x["mean_round_similarity"]), reverse=True
    )
    best_lineup = ranked_lineups[0] if ranked_lineups else None

    if best_lineup and best_lineup["mean_round_similarity"] >= 0.60:
        align_by_round = {
            ra["image_round"]: ra for ra in best_lineup["round_alignments"]
        }
        for t in solved_teams:
            ra = align_by_round.get(t["round"])
            if ra and ra["similarity"] >= 0.60:
                t["matched_formation_key"] = ra["matched_formation_key"]
                t["matched_formation_label"] = ra["matched_formation_label"]
                t["reference_similarity"] = ra["similarity"]

    # Build Mode & Target candidates combining lineup similarity and structural priors
    mode_catalog = [
        ("nightmare-corridor", "Nightmare Corridor", "infernal-overlord", "Infernal Overlord", 6),
        ("nightmare-corridor", "Nightmare Corridor", "netherspinner", "Netherspinner", 6),
        ("cursed-realm", "Cursed Realm", "ice-shemira", "Ice Shemira", 6),
        ("cursed-realm", "Cursed Realm", "burning-brute", "Burning Brute", 6),
        ("cursed-realm", "Cursed Realm", "kane", "Kane", 6),
        ("cursed-realm", "Cursed Realm", "demonic-entity", "Demonic Entity", 6),
        ("cursed-realm", "Cursed Realm", "the-unhinged", "The Unhinged", 6),
        ("cursed-realm", "Cursed Realm", "grotesque-mage", "Grotesque Mage", 6),
        ("treasure-scramble", "Treasure Scramble", "fire", "Fire", 4),
        ("treasure-scramble", "Treasure Scramble", "frost", "Frost", 4),
        ("treasure-scramble", "Treasure Scramble", "forest", "Forest", 4),
        ("treasure-scramble", "Treasure Scramble", "fog", "Fog", 4),
        ("treasure-scramble", "Treasure Scramble", "fountain", "Fountain", 4),
        ("twisted-realm", "Twisted Realm", "ice-shemira", "Ice Shemira", 1),
        ("twisted-realm", "Twisted Realm", "burning-brute", "Burning Brute", 1),
        ("twisted-realm", "Twisted Realm", "kane", "Kane", 1),
        ("twisted-realm", "Twisted Realm", "grotesque-mage", "Grotesque Mage", 1),
    ]

    mode_candidates = []
    for m_slug, m_name, t_slug, t_name, expected_teams in mode_catalog:
        matching_refs = [
            rl
            for rl in ranked_lineups
            if rl["mode_slug"] == m_slug and rl["target_slug"] == t_slug
        ]
        best_ref = matching_refs[0] if matching_refs else None
        ref_sim = best_ref["mean_round_similarity"] if best_ref else 0.0

        reasons = []
        struct_score = 0.10
        if m_slug == "nightmare-corridor":
            if team_count == 6:
                struct_score += 0.32
                reasons.append("6-round formation structure matches Nightmare Corridor 6-boss cycle.")
            elif team_count in (2, 3, 4, 5) and has_collections:
                struct_score += 0.26
                reasons.append(f"{team_count}-round partial formation guide with pets & collections fits Nightmare Corridor.")
            elif team_count == 1 and has_collections:
                struct_score += 0.22
                reasons.append("Single-round crop with 5 heroes + collection badges fits a Nightmare Corridor boss round.")
            if has_substitutes:
                struct_score += 0.08
                reasons.append("Includes per-boss substitute team table typical of Nightmare Corridor community guides.")
        elif m_slug == "cursed-realm":
            if team_count == 6:
                struct_score += 0.26
                reasons.append("6-team layout also fits Cursed Realm (5 Shadow Guards + 1 Boss).")
            elif team_count == 1:
                struct_score += 0.16
                reasons.append("Single-round crop could be a Cursed Realm Boss or Shadow Guard formation.")
        elif m_slug == "treasure-scramble":
            if team_count == 7:
                struct_score += 0.72
                reasons.append("7-team multi-formation layout exclusively matches Treasure Scramble (up to 7 teams).")
            elif 2 <= team_count <= 6:
                struct_score += 0.22
                reasons.append(f"{team_count}-team multi-formation layout is compatible with Treasure Scramble (2-7 teams).")
        elif m_slug == "twisted-realm":
            if team_count == 1:
                struct_score += 0.25
                reasons.append("Single 5-hero + pet formation matches Twisted Realm single-boss format.")

        if best_ref and ref_sim >= 0.25:
            matched_h = sum(ra["hero_overlap_count"] for ra in best_ref["round_alignments"])
            total_h = 5 * len(best_ref["round_alignments"])
            reasons.insert(
                0,
                f"Matches reference lineup '{best_ref['title']}' ({matched_h}/{total_h} heroes across {len(best_ref['round_alignments'])} round(s), {round(ref_sim * 100, 1)}% round similarity).",
            )

        combined_conf = round(
            min(0.99, max(0.02, 0.72 * ref_sim + 0.28 * min(1.0, struct_score * 2.4))),
            3,
        )
        if not reasons:
            reasons.append(f"Alternative {m_name} ({t_name}) candidate.")

        mode_candidates.append(
            {
                "mode_slug": m_slug,
                "mode_name": m_name,
                "target_slug": t_slug,
                "target_name": t_name,
                "confidence": combined_conf,
                "reference_lineup_id": best_ref["id"] if best_ref else None,
                "reference_similarity": round(ref_sim, 4),
                "reasons": reasons,
            }
        )

    mode_candidates.sort(
        key=lambda x: (x["confidence"], x["reference_similarity"]), reverse=True
    )
    best_mode = mode_candidates[0]
    mode_alternatives = mode_candidates[1:6]

    # Prioritize reference lineups from the best matching mode
    mode_matching_lineups = [
        rl for rl in ranked_lineups if rl["mode_slug"] == best_mode["mode_slug"]
    ]
    if mode_matching_lineups:
        best_lineup = mode_matching_lineups[0]
        lineup_alternatives = [rl for rl in ranked_lineups if rl["id"] != best_lineup["id"]][:5]
    else:
        best_lineup = ranked_lineups[0] if ranked_lineups else None
        lineup_alternatives = ranked_lineups[1:6]

    # Compile actionable review_suggestions (both visual uncertainty and reference diffs)
    review_suggestions = []
    align_map = (
        {ra["image_round"]: ra for ra in best_lineup["round_alignments"]}
        if best_lineup and best_lineup["mean_round_similarity"] >= 0.55
        else {}
    )

    for t in solved_teams:
        r_num = t["round"]
        f_label = t.get("matched_formation_label") or f"Round {r_num}"
        ra = align_map.get(r_num)

        # 1. Reference diffs for this round
        if ra and ra["differences"]:
            for diff in ra["differences"]:
                slot_idx = diff["slot"]
                if slot_idx == "pet":
                    p_alts = [
                        a["slug"]
                        for a in ((t.get("pet") or {}).get("visual_alternatives") or [])[:4]
                    ]
                    if diff["reference_value"] and diff["reference_value"] not in p_alts:
                        p_alts.insert(0, diff["reference_value"])
                    review_suggestions.append(
                        {
                            "round": r_num,
                            "formation_label": f_label,
                            "slot": "pet",
                            "field": "pet",
                            "type": diff["type"],
                            "current_value": diff["image_value"],
                            "reference_value": diff["reference_value"],
                            "suggested_alternatives": p_alts,
                            "reason": diff["note"],
                        }
                    )
                else:
                    h_obj = t["heroes"][slot_idx]
                    if "hero" in diff["type"]:
                        h_alts = [
                            a["slug"]
                            for a in (h_obj.get("visual_alternatives") or [])[:4]
                        ]
                        if diff["reference_value"] and diff["reference_value"] not in h_alts:
                            h_alts.insert(0, diff["reference_value"])
                        review_suggestions.append(
                            {
                                "round": r_num,
                                "formation_label": f_label,
                                "slot": slot_idx + 1,
                                "field": "hero",
                                "type": diff["type"],
                                "current_value": diff["image_value"],
                                "reference_value": diff["reference_value"],
                                "suggested_alternatives": h_alts,
                                "reason": diff["note"],
                            }
                        )
                    elif "collection_node" in diff["type"]:
                        n_alts = [
                            [a["key"] for a in (n.get("visual_alternatives") or [])[:3]]
                            for n in ((h_obj.get("collection") or {}).get("nodes") or [])
                        ]
                        review_suggestions.append(
                            {
                                "round": r_num,
                                "formation_label": f_label,
                                "slot": slot_idx + 1,
                                "field": "collection_nodes",
                                "type": diff["type"],
                                "current_value": diff["image_value"],
                                "reference_value": diff["reference_value"],
                                "suggested_alternatives": [diff["reference_value"]] + n_alts,
                                "reason": diff["note"],
                            }
                        )
                    elif "collection" in diff["type"]:
                        c_alts = [
                            {"id": a["id"], "name": a["name"]}
                            for a in ((h_obj.get("collection") or {}).get("visual_alternatives") or [])[:4]
                        ]
                        review_suggestions.append(
                            {
                                "round": r_num,
                                "formation_label": f_label,
                                "slot": slot_idx + 1,
                                "field": "collection",
                                "type": diff["type"],
                                "current_value": diff["image_value"],
                                "reference_value": diff["reference_value"],
                                "suggested_alternatives": c_alts,
                                "reason": diff["note"],
                            }
                        )

        # 2. Visual uncertainty flags
        for s_idx, h_obj in enumerate(t["heroes"]):
            if h_obj.get("needs_review"):
                v_alts = h_obj.get("visual_alternatives") or []
                runner = v_alts[1] if len(v_alts) > 1 else None
                review_suggestions.append(
                    {
                        "round": r_num,
                        "formation_label": f_label,
                        "slot": s_idx + 1,
                        "field": "hero",
                        "type": "visual_uncertainty",
                        "current_value": h_obj["slug"],
                        "reference_value": None,
                        "suggested_alternatives": [a["slug"] for a in v_alts[1:5]],
                        "reason": (
                            f"Round {r_num} Slot {s_idx + 1} hero ({h_obj['name']}, MSE {round(h_obj['mse'], 1)}) has a close visual runner-up: "
                            f"{runner['name']} ({runner['slug']}, MSE {runner['mse']})."
                            if runner
                            else f"Round {r_num} Slot {s_idx + 1} hero ({h_obj['name']}) has elevated visual MSE ({round(h_obj['mse'], 1)})."
                        ),
                    }
                )
            coll = h_obj.get("collection") or {}
            if coll.get("needs_review") and coll.get("catalog") is not None:
                c_alts = coll.get("visual_alternatives") or []
                c_runner = c_alts[1] if len(c_alts) > 1 else None
                review_suggestions.append(
                    {
                        "round": r_num,
                        "formation_label": f_label,
                        "slot": s_idx + 1,
                        "field": "collection",
                        "type": "visual_uncertainty",
                        "current_value": coll["name"],
                        "reference_value": None,
                        "suggested_alternatives": [a["name"] for a in c_alts[1:4]],
                        "reason": (
                            f"Round {r_num} Slot {s_idx + 1} collection ({coll['name']}, MSE {round(coll['mse'], 1)}) has a close visual alternative: "
                            f"{c_runner['name']} (MSE {c_runner['mse']})."
                            if c_runner
                            else f"Round {r_num} Slot {s_idx + 1} collection ({coll['name']}) has elevated MSE ({round(coll['mse'], 1)})."
                        ),
                    }
                )

        if (t.get("pet") or {}).get("needs_review"):
            p_obj = t["pet"]
            p_alts = p_obj.get("visual_alternatives") or []
            p_runner = p_alts[1] if len(p_alts) > 1 else None
            review_suggestions.append(
                {
                    "round": r_num,
                    "formation_label": f_label,
                    "slot": "pet",
                    "field": "pet",
                    "type": "visual_uncertainty",
                    "current_value": p_obj["slug"],
                    "reference_value": None,
                    "suggested_alternatives": [a["slug"] for a in p_alts[1:5]],
                    "reason": (
                        f"Round {r_num} pet ({p_obj['name']}, MSE {round(p_obj['mse'], 1)}) has a close visual alternative: "
                        f"{p_runner['name']} ({p_runner['slug']}, MSE {p_runner['mse']})."
                        if p_runner
                        else f"Round {r_num} pet ({p_obj['name']}) has elevated visual MSE ({round(p_obj['mse'], 1)})."
                    ),
                }
            )

    return {
        "best_mode": best_mode,
        "mode_alternatives": mode_alternatives,
        "best_lineup_match": best_lineup,
        "lineup_alternatives": ranked_lineups[1:5],
        "review_suggestions": review_suggestions,
    }


def detect_and_assemble_teams_for_image(
    img,
    model,
    matcher,
    type_tensors,
    node_assets,
    hero_meta,
    pet_meta,
    collections_catalog,
    detector_boxes=None,
    detector_scores=None,
):
    H, W = img.shape[:2]
    # 1. Tall 2-column community guide (e.g. 3000x6000 lydydxhxpyyh1.png)
    if H >= 3000 and W >= 2400:
        raw_boxes, raw_scores = [], []
        for y0 in range(400, H - 300, 700):
            y1 = min(H, y0 + 1100)
            x0, x1 = 1048, min(W, 2248)
            crop = img[y0:y1, x0:x1]
            res = model.predict(
                source=crop,
                imgsz=640,
                conf=0.25,
                iou=0.45,
                max_det=300,
                device="cpu",
                verbose=False,
            )[0]
            for (bx1, by1, bx2, by2), s in zip(
                res.boxes.xyxy.cpu().tolist(), res.boxes.conf.cpu().tolist()
            ):
                raw_boxes.append([bx1 + x0, by1 + y0, bx2 + x0, by2 + y0])
                raw_scores.append(float(s))
        norm = normalize_yolo_boxes(raw_boxes, raw_scores, img.shape, min_px=75)
        hero_boxes = sorted([b for b, _ in norm if b[2] >= 120], key=lambda b: b[1])
        hero_bands = []
        for b in hero_boxes:
            if not hero_bands or abs(b[1] - np.mean([x[1] for x in hero_bands[-1]])) > 200:
                hero_bands.append([b])
            else:
                hero_bands[-1].append(b)
        teams_geom = []
        for h_band in hero_bands:
            h_y_med = float(np.median([b[1] for b in h_band]))
            c_band = [
                b
                for b, _ in norm
                if 85 <= b[2] <= 115 and (h_y_med + 180) <= b[1] <= (h_y_med + 320)
            ]
            if len(h_band) < 3 or len(c_band) < 3:
                continue
            round_norm = [
                (b, s) for b, s in norm if h_y_med - 60 <= b[1] <= h_y_med + 340
            ]
            teams_geom.extend(
                assemble_row_5_col_team(img, round_norm, round_num=len(teams_geom) + 1)
            )
    else:
        if detector_boxes is None or detector_scores is None:
            imgsz = 2080 if (W >= 1800 and H >= 1800) else (1600 if H >= 1400 else 640)
            conf = 0.996 if (W >= 1800 and H >= 1800) else 0.22
            res = model.predict(
                source=img,
                imgsz=imgsz,
                conf=conf,
                iou=0.45,
                max_det=300,
                device="cpu",
                verbose=False,
            )[0]
            detector_boxes = res.boxes.xyxy.cpu().tolist() if res.boxes is not None else []
            detector_scores = res.boxes.conf.cpu().tolist() if res.boxes is not None else []

        norm = normalize_yolo_boxes(detector_boxes, detector_scores, img.shape, min_px=48)
        if W >= 1800 and H >= 1800:
            teams_geom = assemble_app_card_teams(img, norm)
        elif W >= 1000 and H <= 1150:
            teams_geom = assemble_row_5_col_team(img, norm, round_num=1)
        else:
            if W >= 900 and H >= 1400:
                norm = [
                    (b, s)
                    for b, s in norm
                    if W * 0.25 <= b[0] <= W * 0.52 and b[2] <= 88
                ]
            teams_geom = assemble_staggered_teams(img, norm)

    solved_teams = solve_teams(
        img,
        teams_geom,
        matcher,
        type_tensors,
        node_assets,
        hero_meta,
        pet_meta,
        collections_catalog,
    )
    if H >= 3000 and W >= 2400:
        left_rounds = decode_left_panel_rounds(
            img, matcher, type_tensors, hero_meta, pet_meta
        )
        for i, t in enumerate(solved_teams):
            if i < len(left_rounds):
                lr = left_rounds[i]
                p_row = lr["primary_row"]
                t["pet"] = {
                    "id": p_row["pet_id"],
                    "slug": p_row["pet"],
                    "name": p_row["pet_name"],
                    "mode": p_row["pet_mode"],
                    "options": p_row["pet_options"],
                    "confidence": p_row.get("pet_confidence", 0.9),
                    "needs_review": False,
                    "visual_alternatives": p_row.get("pet_visual_alternatives", []),
                    "bbox": p_row["bbox"],
                }
                for s_idx, h_entry in enumerate(t["heroes"]):
                    if s_idx < len(p_row["hero_slots"]):
                        slot_opts = p_row["hero_slots"][s_idx]["options"]
                        if len(slot_opts) > 1:
                            h_entry["slot_options"] = slot_opts
                t["substitute_teams"] = lr["substitute_teams"]
    return solved_teams


def evaluate_assembled_teams(solved_teams, formations_gt):
    team_count = len(solved_teams)
    expected_team_count = len(formations_gt)
    hero_ok, hero_tot = 0, 0
    coll_ok, coll_tot = 0, 0
    pet_ok, pet_tot = 0, 0
    node_ok, node_tot = 0, 0
    sub_teams_count = sum(len(t.get("substitute_teams", [])) for t in solved_teams)
    for team, gt_f in zip(solved_teams, formations_gt):
        if gt_f.get("pet"):
            pet_tot += 1
            if team.get("pet") and (
                team["pet"]["slug"] == gt_f["pet"]
                or gt_f["pet"] in team["pet"].get("options", [])
            ):
                pet_ok += 1
        for h_pred, h_gt in zip(team["heroes"], gt_f["heroes"]):
            hero_tot += 1
            if h_pred["slug"] == h_gt["slug"]:
                hero_ok += 1
            coll_tot += 1
            exp_cat = h_gt["collection"]["catalog"] if h_gt.get("collection") else None
            pred_cat = h_pred["collection"]["catalog"] if h_pred.get("collection") else None
            if pred_cat == exp_cat:
                coll_ok += 1
            exp_nodes = [
                f"{n['stat']}_{n['tier'][0]}"
                for n in (h_gt.get("collection") or {}).get("nodes", [])
                if n["stat"] != "skill_level"
            ]
            pred_nodes = [
                n["key"] for n in (h_pred.get("collection") or {}).get("nodes", [])
            ]
            node_tot += len(exp_nodes)
            if pred_nodes == exp_nodes:
                node_ok += len(exp_nodes)
            else:
                node_ok += sum(p == e for p, e in zip(pred_nodes, exp_nodes))
    return {
        "teams_assembled": team_count,
        "expected_teams": expected_team_count,
        "substitute_teams_count": sub_teams_count,
        "hero_correct": hero_ok,
        "hero_total": hero_tot,
        "hero_accuracy": hero_ok / hero_tot if hero_tot else 0,
        "collection_correct": coll_ok,
        "collection_total": coll_tot,
        "collection_accuracy": coll_ok / coll_tot if coll_tot else 0,
        "collection_node_correct": node_ok,
        "collection_node_total": node_tot,
        "collection_node_accuracy": node_ok / node_tot if node_tot else 0,
        "pet_correct": pet_ok,
        "pet_total": pet_tot,
        "pet_accuracy": pet_ok / pet_tot if pet_tot else 0,
    }


def match_ground_truth(predictions, annotations, minimum_iou):
    used_annotations = set()
    matched_count = 0
    for prediction in sorted(
        predictions,
        key=lambda item: item["detector_score"],
        reverse=True,
    ):
        candidates = [
            (box_iou(prediction["bbox"], annotation["bbox"]), annotation)
            for annotation in annotations
            if annotation["annotation_id"] not in used_annotations
        ]
        best_iou, best_annotation = max(candidates, default=(0, None), key=lambda x: x[0])
        if best_annotation is None or best_iou < minimum_iou:
            continue
        used_annotations.add(best_annotation["annotation_id"])
        matched_count += 1
        prediction["ground_truth_annotation_id"] = best_annotation["annotation_id"]
        prediction["ground_truth_type"] = best_annotation["identity_type"]
        prediction["ground_truth_id"] = best_annotation["catalog_id"]
        prediction["box_iou"] = best_iou
        prediction["identity_correct"] = (
            prediction.get("predicted_type") == best_annotation["identity_type"]
            and prediction.get("predicted_id") == best_annotation["catalog_id"]
        )
        prediction["type_correct"] = (
            prediction.get("predicted_type") == best_annotation["identity_type"]
        )
        prediction["identity_in_top3"] = (
            prediction.get("predicted_type") == best_annotation["identity_type"]
            and any(
                item["id"] == best_annotation["catalog_id"]
                for item in prediction.get("identity_top3", [])
            )
        )

    matched_predictions = [
        item for item in predictions if "ground_truth_annotation_id" in item
    ]
    return {
        "ground_truth_count": len(annotations),
        "true_positive_boxes": matched_count,
        "false_positive_boxes": len(predictions) - matched_count,
        "missed_boxes": len(annotations) - matched_count,
        "detection_recall": matched_count / len(annotations) if annotations else 0,
        "identity_correct": sum(item["identity_correct"] for item in matched_predictions),
        "type_correct": sum(item["type_correct"] for item in matched_predictions),
        "type_accuracy_on_matched_boxes": (
            sum(item["type_correct"] for item in matched_predictions) / matched_count
            if matched_count
            else 0
        ),
        "identity_accuracy_on_matched_boxes": (
            sum(item["identity_correct"] for item in matched_predictions)
            / matched_count
            if matched_count
            else 0
        ),
        "identity_in_top3": sum(
            item["identity_in_top3"] for item in matched_predictions
        ),
    }


def run_all_guides_benchmark(
    repo_root,
    lab_dir,
    matcher,
    type_tensors,
    node_assets,
    hero_meta,
    pet_meta,
    collections_catalog,
    formations_gt,
):
    runs_dir = (
        Path.home()
        / ".cache/afk-icon-detector-benchmark/run-20261108T031214Z-1901092/runs"
    )
    results = {}

    # 1. App Export (held-out fold-3)
    t0 = time.time()
    m3 = YOLO(str(runs_dir / "fold-3/weights/last.pt"))
    p_app = repo_root / "afk-nightmare-corridor-infernal-overlord-9.png"
    img_app = cv2.imread(str(p_app))
    teams_app = detect_and_assemble_teams_for_image(
        img_app,
        m3,
        matcher,
        type_tensors,
        node_assets,
        hero_meta,
        pet_meta,
        collections_catalog,
    )
    eval_app = evaluate_assembled_teams(teams_app, formations_gt)
    inf_app = infer_mode_and_lineup_matches(
        teams_app,
        img_app.shape,
        hero_meta,
        pet_meta,
        collections_catalog,
        repo_root,
        formations_gt=formations_gt,
    )
    results["app_export_lineup_9"] = {
        "image": str(p_app),
        "held_out_fold": "fold-3",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": eval_app,
        "best_mode": inf_app["best_mode"],
        "mode_alternatives": inf_app["mode_alternatives"],
        "best_lineup_match": inf_app["best_lineup_match"],
        "review_suggestions": inf_app["review_suggestions"],
        "formations": teams_to_seed_formations(teams_app),
    }

    # 2. 6-Round Community Guide (lydydxhxpyyh1, held-out fold-2)
    t0 = time.time()
    m2 = YOLO(str(runs_dir / "fold-2/weights/best.pt"))
    p_lyd = repo_root / "lydydxhxpyyh1.png"
    img_lyd = cv2.imread(str(p_lyd))
    teams_lyd = detect_and_assemble_teams_for_image(
        img_lyd,
        m2,
        matcher,
        type_tensors,
        node_assets,
        hero_meta,
        pet_meta,
        collections_catalog,
    )
    # In lydydxhxpyyh1 R3 C2 (Harvey), the screenshot shows two node icons: full_atk_m and atk_m
    formations_lyd_gt = json.loads(json.dumps(formations_gt))
    for f in formations_lyd_gt:
        if f["key"] == "demonic-puppet":
            for h in f["heroes"]:
                if h["slug"] == "harvey":
                    h["collection"]["nodes"].append(
                        {"slotIndex": 2, "stat": "atk", "tier": "mythic"}
                    )
    eval_lyd = evaluate_assembled_teams(teams_lyd, formations_lyd_gt)
    inf_lyd = infer_mode_and_lineup_matches(
        teams_lyd,
        img_lyd.shape,
        hero_meta,
        pet_meta,
        collections_catalog,
        repo_root,
        formations_gt=formations_gt,
    )
    results["community_guide_lydydxhxpyyh1"] = {
        "image": str(p_lyd),
        "held_out_fold": "fold-2",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": eval_lyd,
        "best_mode": inf_lyd["best_mode"],
        "mode_alternatives": inf_lyd["mode_alternatives"],
        "best_lineup_match": inf_lyd["best_lineup_match"],
        "review_suggestions": inf_lyd["review_suggestions"],
        "formations": teams_to_seed_formations(teams_lyd),
    }

    # 3. Full F2P Staggered Guide (held-out fold-1)
    t0 = time.time()
    m1 = YOLO(str(runs_dir / "fold-1/weights/best.pt"))
    p_f2p = repo_root / "f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp"
    img_f2p = cv2.imread(str(p_f2p))
    teams_f2p = detect_and_assemble_teams_for_image(
        img_f2p,
        m1,
        matcher,
        type_tensors,
        node_assets,
        hero_meta,
        pet_meta,
        collections_catalog,
    )
    f2p_exp_heroes = [
        [200, 234, 97, 204, 252],
        [165, 227, 228, 205, 235],
        [199, 211, 250, 218, 238],
    ]
    f2p_exp_pets = [6029, 6030, 6023]
    f2p_exp_colls = [
        [None, 14, 3, 9, None],
        [15, 9, 14, 3, 15],
        [15, 5, 3, None, 14],
    ]
    f2p_exp_nodes = [
        [["def_m"], ["erosion_m"], ["full_atk_m"], ["full_atk_m"], ["full_erosion_m"]],
        [["full_atk_m"], ["full_atk_m"], ["cda_m"], ["full_atk_m"], ["is_m"]],
        [["atk_m"], [], ["full_atk_m"], ["full_atk_m"], ["is_m"]],
    ]
    h_ok3, c_ok3, p_ok3, n_ok3, n_tot3 = 0, 0, 0, 0, 0
    for r_idx, t in enumerate(teams_f2p):
        if t["pet"] and t["pet"]["id"] == f2p_exp_pets[r_idx]:
            p_ok3 += 1
        for s_idx, h_pred in enumerate(t["heroes"]):
            if h_pred["id"] == f2p_exp_heroes[r_idx][s_idx]:
                h_ok3 += 1
            if h_pred["collection"]["catalog"] == f2p_exp_colls[r_idx][s_idx]:
                c_ok3 += 1
            exp_n = f2p_exp_nodes[r_idx][s_idx]
            pred_n = [n["key"] for n in h_pred["collection"]["nodes"]]
            n_tot3 += len(exp_n)
            if pred_n == exp_n:
                n_ok3 += len(exp_n)
    inf_f2p = infer_mode_and_lineup_matches(
        teams_f2p,
        img_f2p.shape,
        hero_meta,
        pet_meta,
        collections_catalog,
        repo_root,
        formations_gt=formations_gt,
    )
    results["f2p_staggered_guide"] = {
        "image": str(p_f2p),
        "held_out_fold": "fold-1",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": {
            "teams_assembled": len(teams_f2p),
            "expected_teams": 3,
            "substitute_teams_count": 0,
            "hero_correct": h_ok3,
            "hero_total": 15,
            "hero_accuracy": h_ok3 / 15.0,
            "collection_correct": c_ok3,
            "collection_total": 15,
            "collection_accuracy": c_ok3 / 15.0,
            "collection_node_correct": n_ok3,
            "collection_node_total": n_tot3,
            "collection_node_accuracy": n_ok3 / n_tot3 if n_tot3 else 1.0,
            "pet_correct": p_ok3,
            "pet_total": 3,
            "pet_accuracy": p_ok3 / 3.0,
        },
        "best_mode": inf_f2p["best_mode"],
        "mode_alternatives": inf_f2p["mode_alternatives"],
        "best_lineup_match": inf_f2p["best_lineup_match"],
        "review_suggestions": inf_f2p["review_suggestions"],
        "formations": teams_to_seed_formations(teams_f2p),
    }

    out_path = lab_dir / "multi-guide-team-recognition-results.json"
    out_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    for k, v in results.items():
        m = v["metrics"]
        bm = v["best_mode"]
        bl = v["best_lineup_match"]
        sub_str = (
            f" | Substitute Teams={m['substitute_teams_count']}"
            if m.get("substitute_teams_count")
            else ""
        )
        print(
            f"[{k}] ({v['held_out_fold']}, {v['elapsed_seconds']}s): "
            f"Mode={bm['mode_name']} ({bm['target_name']}, conf={bm['confidence']}) | "
            f"Best Lineup={bl['id']} ({round(bl['similarity'] * 100, 1)}%) | "
            f"Teams={m['teams_assembled']}/{m['expected_teams']}{sub_str} | "
            f"Heroes={m['hero_correct']}/{m['hero_total']} | "
            f"Collections={m['collection_correct']}/{m['collection_total']} | "
            f"Collection Nodes={m['collection_node_correct']}/{m['collection_node_total']} | "
            f"Pets={m['pet_correct']}/{m['pet_total']}"
        )
    print(f"Wrote multi-guide benchmark to {out_path}")


def parse_args(repo_root, lab_dir):
    parser = argparse.ArgumentParser(
        description="Detect generic game icons, classify each crop, and assemble structured AFK Arena teams with collection nodes."
    )
    parser.add_argument(
        "--image",
        type=Path,
        default=repo_root / "afk-nightmare-corridor-infernal-overlord-9.png",
        help="Image to detect and match.",
    )
    parser.add_argument(
        "--weights",
        type=Path,
        help="YOLO weights; defaults to the saved app-held-out 640px detector.",
    )
    parser.add_argument(
        "--detector-report",
        type=Path,
        default=lab_dir / "detector-resolution-results.json",
        help="Report containing the default held-out detector weights path.",
    )
    parser.add_argument("--imgsz", type=int, default=2080)
    parser.add_argument("--confidence", type=float, default=0.996)
    parser.add_argument("--nms-iou", type=float, default=0.55)
    parser.add_argument("--max-det", type=int, default=300)
    parser.add_argument("--match-iou", type=float, default=0.5)
    parser.add_argument(
        "--match-box-scale",
        type=float,
        default=1.15,
        help="Expand each detector box around its center for matching; must be at least 1.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=lab_dir / "lineup-9-detection-matches.json",
        help="Path for the detections, catalog predictions, and assembled teams JSON.",
    )
    parser.add_argument(
        "--eval-all-guides",
        action="store_true",
        help="Run out-of-fold end-to-end team & collection-node evaluation across all 3 guide images.",
    )
    return parser.parse_args()


def main():
    repo_root = Path(__file__).resolve().parents[2]
    lab_dir = Path(__file__).resolve().parent
    args = parse_args(repo_root, lab_dir)
    if not math.isfinite(args.match_box_scale) or args.match_box_scale < 1:
        raise ValueError("--match-box-scale must be a finite number at least 1.")
    image_path = args.image.expanduser().resolve()
    if not image_path.is_file():
        raise FileNotFoundError(f"Image does not exist: {image_path}")

    detector_report = json.loads(args.detector_report.read_text(encoding="utf-8"))
    weights_path = (
        args.weights.expanduser().resolve()
        if args.weights is not None
        else Path(detector_report["weights"])
    )
    if not weights_path.is_file():
        raise FileNotFoundError(
            f"Detector weights do not exist: {weights_path}. "
            "Pass --weights to a trained checkpoint."
        )

    screenshot = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if screenshot is None:
        raise ValueError(f"Could not read image: {image_path}")
    model = YOLO(str(weights_path))
    result = model.predict(
        source=str(image_path),
        imgsz=args.imgsz,
        conf=args.confidence,
        iou=args.nms_iou,
        max_det=args.max_det,
        device="cpu",
        verbose=False,
    )[0]
    detector_boxes = result.boxes.xyxy.cpu().tolist() if result.boxes is not None else []
    detector_scores = result.boxes.conf.cpu().tolist() if result.boxes is not None else []

    matcher = load_module(
        "lineup_identity_matcher",
        lab_dir / "match-lineup-identities.py",
    )
    ground_truth_module = matcher.load_ground_truth_module(
        lab_dir / "create-lineup-identity-ground-truth.py"
    )
    schema_sql = (repo_root / "schema.sql").read_text(encoding="utf-8")
    seed_sql = (repo_root / "seed.sql").read_text(encoding="utf-8")
    catalogs = matcher.load_catalogs(schema_sql, ground_truth_module)
    hero_meta, pet_meta, collections_catalog = matcher.load_hero_and_pet_metadata(
        schema_sql, ground_truth_module
    )
    formations_gt = ground_truth_module.extract_lineup(seed_sql)
    cache_root = (
        Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    )
    candidate_assets, missing_collection_assets = (
        matcher.build_identity_candidate_assets(catalogs, cache_root)
    )
    type_tensors = matcher.build_type_tensors(candidate_assets, cache_root)
    node_assets = matcher.build_collection_node_assets(cache_root)
    source_screenshot, source_scale = matcher.source_scale_image(screenshot)

    if args.eval_all_guides:
        run_all_guides_benchmark(
            repo_root,
            lab_dir,
            matcher,
            type_tensors,
            node_assets,
            hero_meta,
            pet_meta,
            collections_catalog,
            formations_gt,
        )
        return

    predictions = []
    for index, (xyxy, score) in enumerate(zip(detector_boxes, detector_scores), start=1):
        bbox = integer_bbox(xyxy, screenshot.shape)
        scaled_width = round(bbox[2] / source_scale)
        scaled_height = round(bbox[3] / source_scale)
        if min(scaled_width, scaled_height) < 32:
            predictions.append(
                {
                    "detection_id": index,
                    "bbox": bbox,
                    "detector_score": float(score),
                    "match_status": "skipped_box_too_small",
                    "predicted_type": None,
                    "predicted_id": None,
                    "predicted_name": None,
                    "matcher_mse": None,
                    "aligned_icon_size": min(scaled_width, scaled_height),
                    "identity_top3": [],
                }
            )
            continue
        match = matcher.rank_icon_box(
            expand_bbox(bbox, screenshot.shape, args.match_box_scale),
            screenshot,
            source_screenshot,
            source_scale,
            candidate_assets,
        )
        best_identity = match["aligned_best_candidate"]
        predictions.append(
            {
                "detection_id": index,
                "bbox": bbox,
                "detector_score": float(score),
                "match_status": "matched",
                "predicted_type": match["predicted_type"],
                "predicted_id": best_identity["id"],
                "predicted_name": best_identity["name"],
                "matcher_mse": match["aligned_best_score"],
                "aligned_icon_size": match["aligned_icon_size"],
                "identity_top3": [
                    {
                        "id": candidate["id"],
                        "name": candidate["name"],
                        "mse": float(score),
                    }
                    for score, candidate in match["aligned_identity_ranking"][:3]
                ],
            }
        )

    solved_teams = detect_and_assemble_teams_for_image(
        screenshot,
        model,
        matcher,
        type_tensors,
        node_assets,
        hero_meta,
        pet_meta,
        collections_catalog,
        detector_boxes=detector_boxes,
        detector_scores=detector_scores,
    )
    mode_inference = infer_mode_and_lineup_matches(
        solved_teams,
        screenshot.shape,
        hero_meta,
        pet_meta,
        collections_catalog,
        repo_root,
        formations_gt=formations_gt,
    )
    assembled_formations = teams_to_seed_formations(solved_teams)

    known_image_path = (repo_root / "afk-nightmare-corridor-infernal-overlord-9.png").resolve()
    ground_truth_path = lab_dir / "lineup-9-identity-ground-truth.json"
    known_ground_truth = (
        json.loads(ground_truth_path.read_text(encoding="utf-8"))
        if ground_truth_path.is_file()
        else None
    )
    ground_truth = None
    if known_ground_truth is not None and (
        image_path == known_image_path
        or image_path.name == known_ground_truth["image"]["file_name"]
    ):
        ground_truth = known_ground_truth

    summary = {
        "detector_box_count": len(predictions),
        "matcher_box_count": sum(
            item["match_status"] == "matched" for item in predictions
        ),
        "missing_collection_assets": len(missing_collection_assets),
    }
    if ground_truth is not None:
        if (screenshot.shape[1], screenshot.shape[0]) != (
            ground_truth["image"]["width"],
            ground_truth["image"]["height"],
        ):
            raise ValueError("Ground-truth dimensions do not match the detected image.")
        summary.update(
            match_ground_truth(
                predictions,
                ground_truth["annotations"],
                args.match_iou,
            )
        )
        summary["team_assembly"] = evaluate_assembled_teams(
            solved_teams, formations_gt
        )

    report = {
        "image": str(image_path),
        "detector": {
            "weights": str(weights_path),
            "training_checkpoint": "app-held-out 640px YOLO11n fold",
            "imgsz": args.imgsz,
            "confidence_threshold": args.confidence,
            "nms_iou": args.nms_iou,
            "max_det": args.max_det,
        },
        "matcher": {
            "method": "multi-scale shift-invariant inner-mask BLAS template matching with soft hero-class collection prior, Hungarian unique identity assignment, and collection node stat icon ROI detection",
            "match_box_scale": args.match_box_scale,
            "catalog_sizes": {
                **{
                    identity_type: len(entries)
                    for identity_type, entries in catalogs.items()
                },
                "collection_node": len(
                    [k for k in node_assets if not k.startswith("skill_level")]
                ),
            },
            "uncalibrated_score": "Lower matcher MSE is a closer template match; it is not a probability.",
        },
        "summary": summary,
        "limitations": [
            "Detector thresholds were tuned against the known pilot layouts.",
            "Ground-truth box evaluation uses one-to-one box matching at the configured IoU threshold.",
            "Team assembly uses layout-specific spatial grouping, Hungarian unique assignment for heroes and pets, soft hero-class prior (0.80x) for collections, and ROI template matching for collection node stat icons.",
        ],
        "best_mode": mode_inference["best_mode"],
        "mode_alternatives": mode_inference["mode_alternatives"],
        "best_lineup_match": mode_inference["best_lineup_match"],
        "lineup_alternatives": mode_inference["lineup_alternatives"],
        "review_suggestions": mode_inference["review_suggestions"],
        "teams": solved_teams,
        "formations": assembled_formations,
        "predictions": predictions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_output.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary_output.replace(args.output)
    print(
        f"Detected {summary['detector_box_count']} boxes; "
        f"matched {summary.get('true_positive_boxes', 'n/a')} to known icons; "
        f"identity correct {summary.get('identity_correct', 'n/a')}."
    )
    if "team_assembly" in summary:
        ta = summary["team_assembly"]
        print(
            f"Assembled {ta['teams_assembled']}/{ta['expected_teams']} teams: "
            f"heroes {ta['hero_correct']}/{ta['hero_total']}, "
            f"collections {ta['collection_correct']}/{ta['collection_total']}, "
            f"collection nodes {ta['collection_node_correct']}/{ta['collection_node_total']}, "
            f"pets {ta['pet_correct']}/{ta['pet_total']}."
        )
    print(f"Wrote detection and matching results to {args.output.resolve()}")


if __name__ == "__main__":
    main()
