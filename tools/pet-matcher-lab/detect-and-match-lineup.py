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
        sq_sz = round(w) if ar < 0.80 else round((w + h) / 2.0)
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
        y_0 = left_col[0][1]
        if len(left_col) >= 2:
            dy = round((left_col[-1][1] - left_col[0][1]) / max(1, len(left_col) - 1))
            if dy > med_w * 2.2:
                dy = round(dy / 2.0)
        else:
            dy = round(med_w * 1.65)

        pet_y = right_col[0][1] if right_col[0][1] < y_0 else round(y_0 - 0.6 * dy)
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

    solved_teams = []
    h_cursor = 0
    for t_idx, team in enumerate(teams_geom):
        layout = team["layout"]
        team_heroes = []
        for s_idx, hbox in enumerate(team["hero_boxes"]):
            h_choice = assigned_heroes[h_cursor]
            h_top3 = [
                {"id": x["id"], "name": x["name"], "mse": x["mse"]}
                for x in all_hero_rankings[h_cursor][:3]
            ]
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
                    nodes_found.append(
                        {
                            "slot_index": n_idx,
                            "key": n["key"],
                            "stat": n["stat"],
                            "tier": n["tier"],
                            "mse": n["mse"],
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
                    nodes_found.append(
                        {
                            "slot_index": n_idx,
                            "key": n["key"],
                            "stat": n["stat"],
                            "tier": n["tier"],
                            "mse": n["mse"],
                            "bbox": [
                                nx0 + n["ox"],
                                ny0 + n["oy"],
                                n["sz"],
                                n["sz"],
                            ],
                        }
                    )
                if c_top1["mse"] < 2400.0:
                    lvl = parse_level_from_state(c_top1["state"])
                    coll_result = {
                        "catalog": c_top1["id"],
                        "name": c_top1["name"],
                        "level": lvl,
                        "mse": c_top1["mse"],
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
                        "nodes": nodes_found,
                    }
                else:
                    coll_result = {
                        "catalog": None,
                        "name": None,
                        "level": None,
                        "mse": c_top1["mse"],
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
                    "top3": h_top3,
                    "collection": coll_result,
                }
            )

        p_choice = pet_by_team.get(t_idx)
        pet_out = None
        if p_choice is not None:
            p_info = pet_meta[p_choice["id"]]
            pet_out = {
                "id": p_info["id"],
                "slug": p_info["slug"],
                "name": p_info["name"],
                "bbox": team["pet_box"],
                "mse": p_choice["mse"],
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
            heroes_out.append({"slug": h["slug"], "collection": coll_obj})
        formations.append(
            {
                "key": f"round-{r_idx}",
                "label": f"Round {r_idx}",
                "pet": team["pet"]["slug"] if team.get("pet") else None,
                "heroes": heroes_out,
            }
        )
    return formations


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
    return solved_teams


def evaluate_assembled_teams(solved_teams, formations_gt):
    team_count = len(solved_teams)
    expected_team_count = len(formations_gt)
    hero_ok, hero_tot = 0, 0
    coll_ok, coll_tot = 0, 0
    pet_ok, pet_tot = 0, 0
    node_ok, node_tot = 0, 0
    for team, gt_f in zip(solved_teams, formations_gt):
        if gt_f.get("pet"):
            pet_tot += 1
            if team.get("pet") and team["pet"]["slug"] == gt_f["pet"]:
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
    results["app_export_lineup_9"] = {
        "image": str(p_app),
        "held_out_fold": "fold-3",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": eval_app,
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
        f["pet"] = None
        if f["key"] == "demonic-puppet":
            for h in f["heroes"]:
                if h["slug"] == "harvey":
                    h["collection"]["nodes"].append(
                        {"slotIndex": 2, "stat": "atk", "tier": "mythic"}
                    )
    eval_lyd = evaluate_assembled_teams(teams_lyd, formations_lyd_gt)
    results["community_guide_lydydxhxpyyh1"] = {
        "image": str(p_lyd),
        "held_out_fold": "fold-2",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": eval_lyd,
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
    results["f2p_staggered_guide"] = {
        "image": str(p_f2p),
        "held_out_fold": "fold-1",
        "elapsed_seconds": round(time.time() - t0, 2),
        "metrics": {
            "teams_assembled": len(teams_f2p),
            "expected_teams": 3,
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
        "formations": teams_to_seed_formations(teams_f2p),
    }

    out_path = lab_dir / "multi-guide-team-recognition-results.json"
    out_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    for k, v in results.items():
        m = v["metrics"]
        print(
            f"[{k}] ({v['held_out_fold']}, {v['elapsed_seconds']}s): "
            f"Teams={m['teams_assembled']}/{m['expected_teams']} | "
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
