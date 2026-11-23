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


_INV_TEMPLATE_CACHE = None


def _load_investment_templates():
    """Load canonical SI/Furniture/Engraving badge and glyph templates from disk."""
    global _INV_TEMPLATE_CACHE
    if _INV_TEMPLATE_CACHE is not None:
        return _INV_TEMPLATE_CACHE

    tmpl_dir = Path(__file__).resolve().parent / "assets" / "investment-templates"
    if not tmpl_dir.is_dir():
        _INV_TEMPLATE_CACHE = {}
        return _INV_TEMPLATE_CACHE

    si = {}
    for val in (20, 30, 40):
        p = tmpl_dir / f"si_{val}.png"
        if p.is_file():
            si[val] = cv2.imread(str(p))

    furn = {}
    for val in (3, 9, 12):
        p = tmpl_dir / f"furn_{val}.png"
        if p.is_file():
            furn[val] = cv2.imread(str(p))

    eng = {}
    for val in (30, 60):
        p = tmpl_dir / f"eng_{val}.png"
        if p.is_file():
            eng[val] = cv2.imread(str(p))

    glyphs = {}
    for p in sorted(tmpl_dir.glob("glyph_*.png")):
        ch = p.stem.split("_", 1)[1]
        glyphs[ch] = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)

    h_t, w_t = 32, 34
    dmask = np.zeros((h_t, w_t), dtype=np.uint8)
    cv2.fillPoly(
        dmask,
        [np.array([[w_t // 2, 4], [w_t - 4, h_t // 2], [w_t // 2, h_t - 4], [4, h_t // 2]])],
        255,
    )

    _INV_TEMPLATE_CACHE = {
        "si": si,
        "furn": furn,
        "eng": eng,
        "glyphs": glyphs,
        "dmask": dmask,
    }
    return _INV_TEMPLATE_CACHE


def _white_feature(bgr):
    b = bgr[:, :, 0].astype(np.float32)
    g = bgr[:, :, 1].astype(np.float32)
    r = bgr[:, :, 2].astype(np.float32)
    lum = 0.114 * b + 0.587 * g + 0.299 * r
    return np.clip((lum - 165.0) / 90.0, 0.0, 1.0)


def _match_investment_badge(region, templates, dmask, min_score=0.45, digit_weight=0.35):
    if not templates or region.shape[0] < dmask.shape[0] or region.shape[1] < dmask.shape[1]:
        return 0, 0.0
    h_t, w_t = dmask.shape
    best_val, best_score = 0, -1.0
    for val, tmpl in templates.items():
        res_bgr = cv2.matchTemplate(region, tmpl, cv2.TM_CCOEFF_NORMED, mask=dmask)
        res_bgr = np.where(np.isfinite(res_bgr) & (res_bgr <= 1.0), res_bgr, -1.0)
        _, max_v, _, max_loc = cv2.minMaxLoc(res_bgr)
        mx, my = max_loc
        patch = region[my : my + h_t, mx : mx + w_t]
        wf_p = _white_feature(patch)
        wf_t = _white_feature(tmpl)
        if wf_p.std() > 1e-4 and wf_t.std() > 1e-4:
            mask_bool = dmask > 0
            pm = wf_p - wf_p.mean()
            tm = wf_t - wf_t.mean()
            num = float(np.sum(pm * tm * mask_bool))
            den = float(np.sqrt(np.sum((pm ** 2) * mask_bool) * np.sum((tm ** 2) * mask_bool))) + 1e-6
            w_corr = num / den
        else:
            w_corr = 0.0
        combined = (1.0 - digit_weight) * float(max_v) + digit_weight * w_corr
        if combined > best_score:
            best_score = combined
            best_val = val
    if best_score < min_score:
        return 0, best_score
    return best_val, best_score


def _extract_below_icon_engraving(img, hbox, glyphs, en_tier=0):
    """Parse E## engraving text rendered directly below a hero icon."""
    if "E" not in glyphs:
        return None
    x, y, w, bh = hbox
    if w <= 0 or bh <= 0:
        return None
    ty0 = max(0, int(y + 1.15 * bh))
    ty1 = min(img.shape[0], int(y + 1.54 * bh))
    tx0 = max(0, int(x - 0.15 * w))
    tx1 = min(img.shape[1], int(x + 1.15 * w))
    if ty1 <= ty0 or tx1 <= tx0:
        return None

    tcrop = img[ty0:ty1, tx0:tx1]
    if w != 140:
        scale = 140.0 / float(w)
        tcrop = cv2.resize(
            tcrop,
            (max(1, round(tcrop.shape[1] * scale)), max(1, round(tcrop.shape[0] * scale))),
            interpolation=cv2.INTER_LINEAR,
        )

    b, g, r = tcrop[:, :, 0], tcrop[:, :, 1], tcrop[:, :, 2]
    gray = cv2.cvtColor(tcrop, cv2.COLOR_BGR2GRAY)
    white = (
        (r > 190) & (g > 190) & (b > 190) & (np.abs(r.astype(int) - b.astype(int)) < 40)
    ).astype(np.uint8) * 255
    n_lbl, _, stats, _ = cv2.connectedComponentsWithStats(white)
    chars = []
    for k in range(1, n_lbl):
        cx, cy, cw, ch, area = stats[k]
        if 10 <= ch <= 24 and 2 <= cw <= 18 and area >= 15:
            patch = gray[cy : cy + ch, cx : cx + cw].astype(np.float32)
            pmin, pmax = float(patch.min()), float(patch.max())
            if pmax > pmin:
                patch = (patch - pmin) / (pmax - pmin)
            else:
                patch = patch / 255.0
            glyph = cv2.resize(patch, (16, 28), interpolation=cv2.INTER_CUBIC)
            chars.append((cx, cy, glyph))
    if len(chars) < 3:
        return None

    min_y = min(c[1] for c in chars)
    line1 = sorted([c for c in chars if abs(c[1] - min_y) <= 8], key=lambda c: c[0])
    if len(line1) < 3:
        return None

    def _match_ch(g_img, allowed):
        gf = g_img.astype(np.float32)
        if gf.max() > 1.5:
            gf = gf / 255.0
        gm = gf - gf.mean()
        g_norm = float(np.sum(gm ** 2))
        if g_norm < 1e-6:
            return None, 0.0
        best_c, best_s = None, -1.0
        for ch_key in allowed:
            tmpl = glyphs.get(ch_key)
            if tmpl is None:
                continue
            tf = tmpl.astype(np.float32) / 255.0
            tm = tf - tf.mean()
            den = float(np.sqrt(g_norm * np.sum(tm ** 2))) + 1e-6
            ncc = float(np.sum(gm * tm)) / den
            mse = float(np.mean((gf - tf) ** 2))
            sc = 0.60 * ncc + 0.40 * (1.0 - 2.0 * mse)
            if sc > best_s:
                best_s = sc
                best_c = ch_key
        return best_c, best_s

    c0, s0 = _match_ch(line1[0][2], ["E"])
    if c0 != "E" or s0 < 0.55:
        return None
    digits = [k for k in glyphs if k.isdigit()]
    tens_allowed = [d for d in digits if int(d) >= (6 if en_tier >= 60 else 3)]
    c1, s1 = _match_ch(line1[1][2], tens_allowed or digits)
    c2, s2 = _match_ch(line1[2][2], digits)
    if c1 is None or c2 is None or s1 < 0.50 or s2 < 0.50:
        return None
    return int(c1 + c2)


def detect_hero_investment(img, hbox):
    """Detect hero SI, furniture, and engraving from bottom badges and below-icon E## text."""
    tmpls = _load_investment_templates()
    if not tmpls:
        return None

    x, y, w, bh = hbox
    if w <= 0 or bh <= 0:
        return None

    y0 = max(0, int(y + 0.72 * bh))
    y1 = min(img.shape[0], int(y + 1.28 * bh))
    x0 = max(0, int(x - 0.18 * w))
    x1 = min(img.shape[1], int(x + 1.18 * w))
    if y1 <= y0 or x1 <= x0:
        return None

    strip = img[y0:y1, x0:x1]
    if w != 140:
        scale = 140.0 / float(w)
        strip = cv2.resize(
            strip,
            (max(1, round(strip.shape[1] * scale)), max(1, round(strip.shape[0] * scale))),
            interpolation=cv2.INTER_LINEAR,
        )

    sw = strip.shape[1]
    if sw < 160:
        return None

    # Skip layouts that never render Mugen-style portrait investment badges (e.g. Groody grids).
    img_h, img_w = img.shape[:2]
    if img_w >= 3200 and img_h >= 4000:
        return None

    dmask = tmpls["dmask"]
    si_val, si_sc = _match_investment_badge(
        strip[:, : min(82, sw)], tmpls["si"], dmask, min_score=0.52, digit_weight=0.30
    )
    fn_val, fn_sc = _match_investment_badge(
        strip[:, min(54, sw) : min(136, sw)], tmpls["furn"], dmask, min_score=0.52, digit_weight=0.50
    )
    en_tier, en_sc = _match_investment_badge(
        strip[:, min(108, sw) : sw], tmpls["eng"], dmask, min_score=0.52, digit_weight=0.30
    )

    # Require at least one high-confidence badge (>= 0.73) so non-badge screenshots
    # (Groody, mcwhare, TheAFKGuys, max ~0.71) never hallucinate fake SI 0 / 12F investments.
    best_sc = max(si_sc, fn_sc, en_sc)
    if best_sc < 0.73 or (si_val == 0 and fn_val == 0 and en_tier == 0):
        return None

    en_override = (
        _extract_below_icon_engraving(img, hbox, tmpls["glyphs"], en_tier=en_tier)
        if en_tier > 0
        else None
    )
    eng_val = en_override if en_override is not None else en_tier
    code = f"{si_val:02d}{fn_val}e{eng_val}"
    return {
        "si": si_val if si_val > 0 else None,
        "furn": fn_val,
        "eng": eng_val,
        "code": code,
        "confidence": round(best_sc, 3),
    }


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

    h_w = max(135, min(180, int(np.median([b[2] for b in hero_band])))) if hero_band else 140
    c_w = 98
    h_y = int(np.median([b[1] for b in hero_band])) if hero_band else 160
    coll_candidates = [
        b
        for b in boxes
        if 80 <= b[2] <= 120 and (h_y + 150) <= b[1] <= (h_y + 340)
    ]
    if coll_candidates:
        coll_band = sorted(coll_candidates, key=lambda b: b[0])
    c_y = int(np.median([b[1] for b in coll_band])) if coll_band else (h_y + 240)

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

    # Snap h_y upward/around detected hero_band using vertical portrait-edge contrast
    # (prevents bottom investment badges like +30 9/9 30 from pulling h_y down)
    if img is not None and len(col_centers) == 5:
        H_im, W_im = img.shape[:2]
        strips = [
            img[:, max(0, round(cx - h_w * 0.35)) : min(W_im, round(cx + h_w * 0.35))]
            for cx in col_centers
        ]
        strips = [s for s in strips if s.shape[1] > 4]
        if strips:
            row_std = cv2.cvtColor(np.concatenate(strips, axis=1), cv2.COLOR_BGR2GRAY).astype(np.float32).std(axis=1)
            win_lo = max(0, h_y - 70)
            win_hi = min(H_im - h_w - 1, h_y + 25)
            best_hy, best_score = h_y, 0.0
            for y in range(win_lo, win_hi):
                inside = float(row_std[y + 10 : y + h_w - 10].mean())
                above = float(row_std[max(0, y - 30) : max(1, y - 4)].mean())
                score = inside - 1.5 * above
                if score > best_score:
                    best_score, best_hy = score, y
            h_y = best_hy

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
    H, W = img.shape[:2]
    scale = W / 1080.0
    cand = [
        b
        for b, _ in norm_boxes
        if round(45 * scale) <= b[2] <= round(98 * scale)
        and int(W * 0.24) <= b[0] <= int(W * 0.52)
    ]
    cand.sort(key=lambda b: b[1])
    rounds_raw = []
    for b in cand:
        if not rounds_raw or (b[1] - rounds_raw[-1][-1][1]) > round(180 * scale):
            rounds_raw.append([b])
        else:
            rounds_raw[-1].append(b)

    teams = []
    for r_boxes in rounds_raw:
        if len(r_boxes) < 3:
            continue
        med_w = round(70 * scale)
        r_xs = sorted(b[0] for b in r_boxes)
        x_mid = (min(r_xs) + max(r_xs)) / 2.0
        y_tol = round(med_w * 0.55)

        def _cluster_col_by_y(col_boxes):
            clusters = []
            for b in col_boxes:
                if not clusters or (b[1] - clusters[-1][0][1]) > y_tol:
                    clusters.append([b])
                else:
                    clusters[-1].append(b)
            return [max(cl, key=lambda b: (b[2], -b[0])) for cl in clusters]

        left_col = _cluster_col_by_y(sorted([b for b in r_boxes if b[0] < x_mid], key=lambda b: b[1]))
        right_col = _cluster_col_by_y(sorted([b for b in r_boxes if b[0] >= x_mid], key=lambda b: b[1]))
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
        elif len(right_col) >= 2:
            dy = round(right_col[-1][1] - right_col[0][1])
            if dy > med_w * 2.2:
                dy = round(dy / 2.0)
        else:
            dy = round(med_w * 1.65)

        y_0 = left_col[0][1]
        if (
            len(left_col) == 1
            and len(right_col) >= 2
            and (left_col[0][1] - right_col[0][1]) > 1.7 * dy
            and y_0 > 2 * dy
        ):
            y_0 = y_0 - 2 * dy
        elif (
            len(left_col) == 2
            and (left_col[1][1] - left_col[0][1]) < 1.5 * dy
            and right_col[-1][1] < left_col[-1][1]
            and y_0 > dy
        ) or (left_col[0][1] > right_col[0][1] + 0.75 * dy and y_0 > dy):
            y_0 = y_0 - dy

        pet_y = (
            right_col[0][1]
            if right_col[0][1] < y_0 - round(15 * scale)
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


def assemble_ts_compact_7_teams(img):
    H, W = img.shape[:2]
    sx = W / 800.0
    sy = sx
    all_row_ys = [round(y * sy) for y in (481, 665, 853, 1034, 1218, 1406, 1589)]
    col_xs = [round(x * sx) for x in (159, 254, 353, 448, 545)]
    hw = round(76 * sx)
    row_ys = []
    for ry in all_row_ys:
        if ry + hw + round(8 * sy) > H:
            continue
        patches = [img[ry : ry + hw, cx : cx + hw] for cx in col_xs]
        if patches and all(p.shape[:2] == (hw, hw) for p in patches):
            if float(np.mean([p.std() for p in patches])) > 22.0:
                row_ys.append(ry)
    sub_w = round(36 * sx)
    teams = []
    for r_idx, ry in enumerate(row_ys):
        hero_boxes = [[cx, ry, hw, hw] for cx in col_xs]
        sub_hero_boxes = []
        for cx in col_xs:
            slot_subs = []
            for sub_y in (ry + round(78 * sy), ry + round(114 * sy)):
                x_left = cx
                x_mid = cx + round(19 * sx)
                x_right = cx + round(39 * sx)
                p_left = img[sub_y : sub_y + sub_w, x_left : x_left + sub_w]
                p_mid = img[sub_y : sub_y + sub_w, x_mid : x_mid + sub_w]
                p_right = img[sub_y : sub_y + sub_w, x_right : x_right + sub_w]
                if (
                    p_left.shape[:2] == (sub_w, sub_w)
                    and p_right.shape[:2] == (sub_w, sub_w)
                    and p_left.std() > 34.0
                    and p_right.std() > 34.0
                ):
                    slot_subs.append([x_left, sub_y, sub_w, sub_w])
                    slot_subs.append([x_right, sub_y, sub_w, sub_w])
                elif p_mid.shape[:2] == (sub_w, sub_w) and p_mid.std() > 34.0:
                    slot_subs.append([x_mid, sub_y, sub_w, sub_w])
            sub_hero_boxes.append(slot_subs)
        teams.append(
            {
                "round": r_idx + 1,
                "layout": "ts_compact_7",
                "hero_boxes": hero_boxes,
                "sub_hero_boxes": sub_hero_boxes,
                "coll_boxes": None,
                "pet_box": None,
                "pet_banner_box": [
                    round(82 * sx),
                    ry - round(42 * sy),
                    round(60 * sx),
                    round(30 * sy),
                ],
                "pet_banner_alt_box": [
                    round(82 * sx),
                    ry - round(10 * sy),
                    round(60 * sx),
                    round(30 * sy),
                ],
            }
        )
    return teams


def assemble_theafkguys_ts_grid(img):
    """Assemble 4x2 TheAFKGuys TS guide: 7 main teams + 1st Calculation (Whale/Dolphin/Budget 5T)."""
    H, W = img.shape[:2]
    sx = W / 3577.0
    sy = H / 2986.0
    panels = [
        (1, 68, 805, 912),
        (2, 974, 805, 912),
        (3, 1872, 805, 912),
        (4, 2770, 805, 912),
        (5, 70, 1975, 2082),
        (6, 976, 1975, 2082),
        (7, 1874, 1975, 2082),
    ]
    hw = round(88 * sx)
    pw = round(56 * sx)
    gray_full = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Detect exact top/bottom row hero bands on white background
    def _detect_row_band(y_frac_lo, y_frac_hi, default_hy):
        ya, yb = max(0, round(y_frac_lo * H)), min(H, round(y_frac_hi * H))
        sub = gray_full[ya:yb, round(0.025 * W) : round(0.16 * W)]
        if sub.size == 0:
            return default_hy, hw
        ys = np.where((sub < 215).mean(axis=1) > 0.70)[0]
        if len(ys) == 0:
            return default_hy, hw
        runs = [r for r in np.split(ys, np.where(np.diff(ys) > 3)[0] + 1) if 65 <= (r[-1] - r[0] + 1) <= 130]
        if not runs:
            return default_hy, hw
        best = runs[-1]
        return ya + int(best[0]), max(65, int(best[-1] - best[0] + 1) - 2)

    hy_top, hw_top = _detect_row_band(0.24, 0.42, round(805 * sy))
    hy_bot, hw_bot = _detect_row_band(0.60, 0.76, round(1975 * sy))

    teams = []
    for r_idx, raw_px, raw_hy, raw_py in panels:
        px = round(raw_px * sx)
        hy = hy_top if raw_hy < 1200 else hy_bot
        panel_hw = hw_top if raw_hy < 1200 else hw_bot
        # Snap x-start and stride on the actual hero bar in this panel
        x_scan_lo = max(0, px)
        x_scan_hi = min(W, px + round(610 * sx))
        bar = gray_full[hy + 8 : min(H, hy + panel_hw - 8), x_scan_lo:x_scan_hi]
        hero_boxes = None
        if bar.size > 0:
            xs_dark = np.where((bar < 225).mean(axis=0) > 0.60)[0]
            if len(xs_dark) > 0:
                x_runs = [xr for xr in np.split(xs_dark, np.where(np.diff(xs_dark) > 18)[0] + 1) if (xr[-1] - xr[0] + 1) >= panel_hw * 3.5]
                if x_runs:
                    xr = max(x_runs, key=len)
                    x_start = x_scan_lo + int(xr[0])
                    x_end = x_scan_lo + int(xr[-1]) + 1
                    stride_x = max(float(panel_hw), (x_end - x_start) / 5.0)
                    hero_boxes = [[round(x_start + i * stride_x), hy, panel_hw, panel_hw] for i in range(5)]
        if hero_boxes is None:
            hero_boxes = [[px + round((26 + i * 102) * sx), hy, panel_hw, panel_hw] for i in range(5)]
        py = round(raw_py * sy)
        pet_box = [
            hero_boxes[-1][0] + panel_hw + round(10 * sx),
            max(0, hy - round(8 * sy)),
            round(106 * sx),
            round(102 * sy),
        ]
        teams.append(
            {
                "round": r_idx,
                "layout": "theafkguys_ts_grid",
                "set_index": 0,
                "set_label": "Set 1 — 7-Team Meta (Teams 1–7)",
                "hero_boxes": hero_boxes,
                "coll_boxes": None,
                "pet_box": pet_box,
                "_panel_px": px,
                "_panel_py": py,
            }
        )

    calc_sets = [
        (1, "Set 2 — 5-Team Whale Setup (1st Calculation)", 2786, [2035, 2117, 2199, 2281, 2363], (0.62, 0.84, 0.76, 0.87)),
        (2, "Set 3 — 5-Team Dolphin Setup (1st Calculation)", 3155, [2035, 2117, 2199, 2281, 2363], (0.62, 0.84, 0.87, 0.99)),
        (3, "Set 4 — 5-Team Budget Setup (1st Calculation)", 2786, [2545, 2627, 2709, 2791, 2873], (0.82, 0.99, 0.76, 0.87)),
    ]
    cw = round(48 * sx)
    for set_idx, set_label, raw_x0, raw_ys, (yf0, yf1, xf0, xf1) in calc_sets:
        ya, yb = max(0, round(yf0 * H)), min(H, round(yf1 * H))
        xa, xb = max(0, round(xf0 * W)), min(W, round(xf1 * W))
        sub_c = gray_full[ya:yb, xa:xb]
        detected_rows = []
        if sub_c.size > 0:
            ys_c = np.where((sub_c < 215).mean(axis=1) > 0.45)[0]
            if len(ys_c) > 0:
                runs_c = [
                    r
                    for r in np.split(ys_c, np.where(np.diff(ys_c) > 3)[0] + 1)
                    if 28 <= (r[-1] - r[0] + 1) <= 66
                ]
                if len(runs_c) >= 5:
                    detected_rows = runs_c[-5:]
        x0 = round(raw_x0 * sx)
        x1 = min(W, x0 + round(256 * sx))
        strip_std = (
            cv2.cvtColor(img[:, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32).std(axis=1)
            if x1 > x0 + 10
            else None
        )
        search_r = round(45 * sy)
        for r_idx, raw_y in enumerate(raw_ys):
            row_cw = cw
            if detected_rows:
                rr = detected_rows[r_idx]
                y0 = ya + int(rr[0])
                row_cw = max(32, min(62, int(rr[-1] - rr[0] + 1) - 1))
                # Snap horizontal 5-hero bar inside [xa:xb]
                bar_c = gray_full[y0 + 4 : min(H, y0 + row_cw - 4), xa:xb]
                row_x0 = x0
                stride_c = 52.0 * sx
                if bar_c.size > 0:
                    xs_c = np.where((bar_c < 225).mean(axis=0) > 0.50)[0]
                    if len(xs_c) > 0:
                        xr_list = [
                            xr
                            for xr in np.split(xs_c, np.where(np.diff(xs_c) > 12)[0] + 1)
                            if (xr[-1] - xr[0] + 1) >= row_cw * 3.5
                        ]
                        if xr_list:
                            xr = max(xr_list, key=len)
                            row_x0 = xa + int(xr[0])
                            stride_c = max(float(row_cw), (int(xr[-1] - xr[0] + 1)) / 5.0)
                hero_boxes = [[round(row_x0 + i * stride_c), y0, row_cw, row_cw] for i in range(5)]
                pet_box = [round(row_x0 + 5 * stride_c), y0, row_cw, row_cw]
            else:
                y0 = round(raw_y * sy)
                if strip_std is not None:
                    best_y, best_s = y0, 0.0
                    for y in range(max(4, y0 - search_r), min(H - cw - 1, y0 + search_r)):
                        inside = float(strip_std[y + 4 : y + cw - 4].mean())
                        above = float(strip_std[max(0, y - 14) : max(1, y - 2)].mean())
                        s = inside - 1.2 * above
                        if s > best_s:
                            best_s, best_y = s, y
                    y0 = best_y
                hero_boxes = [[x0 + round(i * 52 * sx), y0, cw, cw] for i in range(5)]
                pet_box = [x0 + round(5 * 52 * sx), y0, cw, cw]
            teams.append(
                {
                    "round": r_idx + 1,
                    "layout": "theafkguys_ts_grid",
                    "set_index": set_idx,
                    "set_label": set_label,
                    "hero_boxes": hero_boxes,
                    "coll_boxes": None,
                    "pet_box": pet_box,
                }
            )
    return teams


_PET_CHIBI_CACHE = None


def _load_pet_chibi_templates():
    global _PET_CHIBI_CACHE
    if _PET_CHIBI_CACHE is not None:
        return _PET_CHIBI_CACHE
    tpl_dir = Path(__file__).resolve().parent / "pet-chibi-templates"
    templates = []
    if tpl_dir.is_dir():
        for p in sorted(tpl_dir.glob("*.png")):
            pid_str = p.stem.split("_", 1)[0]
            if not pid_str.isdigit():
                continue
            im = cv2.imread(str(p))
            if im is not None:
                tight = _tight_white_bg_sprite(im)
                if tight is not None:
                    templates.append((int(pid_str), tight))
                else:
                    templates.append((int(pid_str), cv2.resize(im, (48, 48), interpolation=cv2.INTER_AREA).astype(np.float32)))
    _PET_CHIBI_CACHE = templates
    return templates


def _tight_white_bg_sprite(roi_bgr):
    if roi_bgr is None or roi_bgr.size == 0:
        return None
    h, w = roi_bgr.shape[:2]
    non_white = (roi_bgr.min(axis=2) <= 230).astype(np.uint8)
    num, _, stats, _ = cv2.connectedComponentsWithStats(non_white)
    if num <= 1:
        return None
    best_lbl, best_area = None, 0
    for lbl in range(1, num):
        x, y, cw, ch, area = stats[lbl]
        if area < 40 or (cw > w * 0.85 and ch < 12):
            continue
        if area > best_area:
            best_area, best_lbl = area, lbl
    if best_lbl is None:
        return None
    x, y, cw, ch, _ = stats[best_lbl]
    x0, y0 = max(0, x - 3), max(0, y - 3)
    x1, y1 = min(w, x + cw + 3), min(h, y + ch + 3)
    patch = roi_bgr[y0:y1, x0:x1].astype(np.float32)
    ph, pw = patch.shape[:2]
    side = max(ph, pw)
    canvas = np.full((side, side, 3), 255.0, dtype=np.float32)
    cy, cx = (side - ph) // 2, (side - pw) // 2
    canvas[cy : cy + ph, cx : cx + pw] = patch
    return cv2.resize(canvas, (48, 48), interpolation=cv2.INTER_AREA)


def _match_theafkguys_chibi_pet(img, team, pet_meta):
    templates = _load_pet_chibi_templates()
    if not templates or not team.get("hero_boxes"):
        return None
    H, W = img.shape[:2]
    sx, sy = W / 3577.0, H / 2986.0
    if team.get("set_index", 0) == 0 or team.get("layout") == "abex_4x2_grid":
        px, py, pw, ph = team.get("pet_box") or [
            team["hero_boxes"][-1][0] + team["hero_boxes"][-1][2] + round(10 * sx),
            max(0, team["hero_boxes"][0][1] - round(8 * sy)),
            round(106 * sx),
            round(102 * sy),
        ]
        rx0 = max(0, px)
        ry0 = max(0, py)
        rx1 = min(W, px + pw)
        ry1 = min(H, py + ph)
    else:
        hx, hy, hw, _ = team["hero_boxes"][-1]
        rx0 = max(0, hx + hw + round(4 * sx))
        ry0 = max(0, hy - round(4 * sy))
        rx1 = min(W, rx0 + round(56 * sx))
        ry1 = min(H, ry0 + round(56 * sy))
    crop48 = _tight_white_bg_sprite(img[ry0:ry1, rx0:rx1])
    if crop48 is None:
        return None
    best_by_pid = {}
    for pid, tpl in templates:
        if pid not in pet_meta:
            continue
        d = float(np.mean((crop48 - tpl) ** 2))
        if pid not in best_by_pid or d < best_by_pid[pid]:
            best_by_pid[pid] = d
    if not best_by_pid:
        return None
    ranked = sorted((d, pid) for pid, d in best_by_pid.items())
    return ranked


def _extract_theafkguys_variants(img, solved_teams, matcher, type_tensors, hero_meta, pet_meta):
    """Extract 2-team / 4-team version rows and notes from TheAFKGuys 4x2 panels."""
    ocr = _get_ocr_engine()
    if ocr is None:
        return
    H, W = img.shape[:2]
    sx = W / 3577.0
    sy = H / 2986.0
    cw = round(48 * sx)
    panel_w = round(840 * sx)
    for t in solved_teams:
        if t.get("set_index", 0) != 0:
            continue
        r_idx = t["round"]
        px = round((68 if r_idx in (1, 5) else 974 if r_idx in (2, 6) else 1872 if r_idx in (3, 7) else 2770) * sx)
        py = round((912 if r_idx <= 4 else 2082) * sy)
        y_start = py + round(70 * sy)
        y_end = min(H, round((1830 if r_idx <= 4 else 2960) * sy))
        x_end = min(W, px + panel_w)
        roi = img[y_start:y_end, px:x_end]
        if roi.size == 0:
            continue
        try:
            res, _ = ocr(roi)
        except Exception:
            continue
        if not res:
            continue

        note_lines = []
        sub_teams = []
        seen_ys = []
        for box, txt, _sc in res:
            low = txt.lower().strip()
            if not any(k in low for k in ("version", "only")):
                continue
            bx1 = px + round(max(p[0] for p in box))
            by0 = y_start + round(min(p[1] for p in box)) - round(8 * sy)
            if any(abs(by0 - sy_prev) < round(28 * sy) for sy_prev in seen_ys):
                continue
            seen_ys.append(by0)
            x_row = bx1 + round(14 * sx)
            row_heroes = []
            row_pet = None
            for idx in range(6):
                ix = x_row + round(idx * 54 * sx)
                if ix + cw > x_end or by0 < 0 or by0 + cw > H:
                    break
                patch = img[by0 : by0 + cw, ix : ix + cw]
                if patch.shape[:2] != (cw, cw) or float(patch.std()) < 22.0:
                    break
                if idx < 5:
                    rk = matcher.rank_candidates_in_box(
                        img,
                        [ix, by0, cw, cw],
                        "hero",
                        type_tensors,
                        scales=(0.92, 0.98, 1.04),
                        pad_ratio=0.16,
                        stride=2,
                    )
                    if not rk:
                        continue
                    h_slug = hero_meta.get(rk[0]["id"], {}).get("slug")
                    if not h_slug:
                        continue
                    row_heroes.append(
                        {
                            "primary_slug": h_slug,
                            "options": [h_slug],
                        }
                    )
                else:
                    prk = matcher.rank_candidates_in_box(
                        img,
                        [ix, by0, cw, cw],
                        "pet",
                        type_tensors,
                        scales=(0.92, 0.98, 1.04),
                        pad_ratio=0.16,
                        stride=2,
                    )
                    if prk:
                        row_pet = pet_meta.get(prk[0]["id"], {}).get("slug")
            if len(row_heroes) >= 3:
                label_clean = txt.strip().rstrip(":").strip()
                hero_names = [hero_meta.get(h["primary_slug"], {}).get("name", h["primary_slug"]) for h in row_heroes]
                pet_label = pet_meta.get(row_pet, {}).get("name", row_pet) if row_pet else ""
                note_lines.append(
                    f"• {label_clean}: {', '.join(hero_names)}" + (f" ({pet_label})" if pet_label else "")
                )
                if len(row_heroes) == 5:
                    sub_teams.append(
                        {
                            "row_index": len(sub_teams) + 1,
                            "pet": row_pet or "",
                            "pet_options": [row_pet] if row_pet else [],
                            "hero_slots": row_heroes,
                        }
                    )
        if sub_teams:
            t["substitute_teams"] = sub_teams
        if note_lines:
            t["notes"] = "\n".join(note_lines)


def assemble_theafkguys_check_end():
    pass


def assemble_multi_column_nc_grid(img, norm_boxes=None):
    H, W = img.shape[:2]
    sx = W / 3888.0
    sy = H / 5955.0
    hw = round(140 * sx)
    cw = round(108 * sx)
    c_off_x = round(16 * sx)
    c_off_y = round(167 * sy)
    col_sets = [
        (0, "Set 1 — Dolphin Account", [152, 328, 504, 682, 861], 1045),
        (1, "Set 2 — Kraken Account", [1398, 1576, 1752, 1938, 2110], 2291),
        (2, "Set 3 — F2P Account", [2648, 2834, 3022, 3206, 3396], 3587),
    ]
    # Refine row_ys per image using vertical portrait-edge contrast across hero columns
    base_row_ys = (1601, 2291, 3021, 3713, 4440, 5168)
    sample_xs = [x for _, _, hxs, _ in col_sets for x in hxs[:4]]
    strip = np.concatenate(
        [img[:, round((x + 10) * sx):round((x + 130) * sx)] for x in sample_xs],
        axis=1,
    )
    row_std = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY).astype(np.float32).std(axis=1)
    pad_in = max(4, round(10 * sy))
    above_hi = max(2, round(4 * sy))
    above_lo = max(10, round(40 * sy))
    search_r = round(150 * sy)
    row_ys = []
    for base_y in base_row_ys:
        est = round(base_y * sy)
        win_start = max(0, est - search_r)
        win_end = min(H - hw - 1, est + search_r)
        best_y, best_s = est, 0.0
        for y in range(win_start, win_end):
            inside = row_std[y + pad_in : y + hw - pad_in].mean()
            above = row_std[max(0, y - above_lo) : max(1, y - above_hi)].mean()
            s = float(inside - 1.5 * above)
            if s > best_s:
                best_s, best_y = s, y
        row_ys.append(best_y)
    det_boxes = [b for b, _ in (norm_boxes or [])]
    teams = []
    for set_idx, set_label, raw_hxs, raw_px in col_sets:
        hxs = [round(x * sx) for x in raw_hxs]
        px = round(raw_px * sx)
        for r_idx, hy in enumerate(row_ys):
            hero_boxes = []
            coll_boxes = []
            for hx in hxs:
                hb = [hx, hy, hw, hw]
                for det in det_boxes:
                    if 115 <= det[2] <= 170 and hypot_dist(hb[0], hb[1], det[0], det[1]) < hw * 0.35:
                        hb = [det[0], det[1], hw, hw]
                        break
                hero_boxes.append(hb)
                cb = [hx + c_off_x, hy + c_off_y, cw, cw]
                for det in det_boxes:
                    if 85 <= det[2] <= 125 and hypot_dist(cb[0], cb[1], det[0], det[1]) < cw * 0.35:
                        cb = [det[0], det[1], cw, cw]
                        break
                coll_boxes.append(cb)
            pbox = [px, hy, hw, hw]
            for det in det_boxes:
                if 115 <= det[2] <= 170 and hypot_dist(pbox[0], pbox[1], det[0], det[1]) < hw * 0.35:
                    pbox = [det[0], det[1], hw, hw]
                    break
            teams.append(
                {
                    "round": r_idx + 1,
                    "set_index": set_idx,
                    "set_label": set_label,
                    "layout": "multi_col_nc_grid",
                    "hero_boxes": hero_boxes,
                    "coll_boxes": coll_boxes,
                    "pet_box": pbox,
                }
            )
    return teams


_LOOKUP_ASSETS_CACHE = None


def _get_lookup_assets():
    global _LOOKUP_ASSETS_CACHE
    if _LOOKUP_ASSETS_CACHE is not None:
        return _LOOKUP_ASSETS_CACHE
    arial_tmpls = {}
    node_tmpls = {}
    pet_banner_tmpls = {}
    tmpl_dir = Path(__file__).resolve().parent / "assets" / "investment-templates"
    if tmpl_dir.exists():
        for p in tmpl_dir.glob("arial_*.png"):
            ch = p.stem.split("_", 1)[1]
            im = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
            if im is not None:
                arial_tmpls[ch] = im.astype(np.float32) / 255.0
        for p in tmpl_dir.glob("lookup_node_*.png"):
            slug = p.stem[len("lookup_node_") :]
            im = cv2.imread(str(p), cv2.IMREAD_COLOR)
            if im is not None:
                node_tmpls[slug] = im.astype(np.float32)
        for p in tmpl_dir.glob("ts_pet_*.png"):
            slug = p.stem[len("ts_pet_") :]
            im = cv2.imread(str(p), cv2.IMREAD_COLOR)
            if im is not None:
                pet_banner_tmpls[slug] = im.astype(np.float32)
    _LOOKUP_ASSETS_CACHE = {
        "arial": arial_tmpls,
        "nodes": node_tmpls,
        "pet_banners": pet_banner_tmpls,
    }
    return _LOOKUP_ASSETS_CACHE


def is_hero_lookup_sheet_image(img):
    H, W = img.shape[:2]
    return 2400 <= W <= 2800 and 1600 <= H <= 1900


def _detect_lookup_grid(gray, sx, sy):
    """Detect spreadsheet row and column boundaries in a hero lookup sheet."""
    H, W = gray.shape[:2]
    margin_x = round(50 * sx)
    row_band = gray[:, margin_x : max(margin_x + 1, W - margin_x)]
    row_frac = np.mean((row_band > 175) & (row_band < 242), axis=1)
    raw_ys = np.where(row_frac > 0.5)[0]
    row_groups = []
    for y in raw_ys:
        if not row_groups or y - row_groups[-1][-1] > 5:
            row_groups.append([int(y)])
        else:
            row_groups[-1].append(int(y))
    row_ys = [round(sum(g) / len(g)) for g in row_groups]
    table_rows = [
        (row_ys[i], row_ys[i + 1])
        for i in range(len(row_ys) - 1)
        if 60 * sy <= (row_ys[i + 1] - row_ys[i]) <= 110 * sy
    ]
    if len(table_rows) < 5:
        table_rows = [
            (round((112 + r * 80.0) * sy), round((192 + r * 80.0) * sy))
            for r in range(19)
        ]

    y_top, y_bot = table_rows[0][0], table_rows[-1][1]
    col_frac = np.mean((gray[y_top:y_bot, :] > 185) & (gray[y_top:y_bot, :] < 238), axis=0)
    v_lines = np.where(col_frac > 0.85)[0]

    def _nearest_vline(approx_x):
        best = min(v_lines, key=lambda x: abs(x - approx_x), default=None)
        if best is not None and abs(best - approx_x) <= 18 * sx:
            return int(best)
        return round(approx_x)

    approx_groups = [
        (106, 279, 369, 440, 514),
        (616, 793, 883, 954, 1028),
        (1130, 1307, 1397, 1468, 1542),
        (1644, 1821, 1911, 1982, 2056),
        (2158, 2335, 2425, 2496, 2570),
    ]
    col_groups = [
        {
            "hx": round(hx0 * sx),
            "x_coll": _nearest_vline(c0 * sx),
            "x_n1": _nearest_vline(n1_0 * sx),
            "x_n2": _nearest_vline(n2_0 * sx),
            "x_end": _nearest_vline(n2_1 * sx),
        }
        for hx0, c0, n1_0, n2_0, n2_1 in approx_groups
    ]
    return table_rows, col_groups


def extract_hero_lookup_sheet(img, matcher, type_tensors, hero_meta, collections_catalog):
    H, W = img.shape[:2]
    sx = W / 2600.0
    sy = H / 1750.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    table_rows, col_groups = _detect_lookup_grid(gray, sx, sy)
    assets = _get_lookup_assets()
    arial_tmpls = assets["arial"]
    node_tmpls = assets["nodes"]

    def _read_inv_text(tcrop):
        if tcrop.size == 0 or not arial_tmpls:
            return None
        gray = cv2.cvtColor(tcrop, cv2.COLOR_BGR2GRAY)
        mask = (gray < 150).astype(np.uint8) * 255
        n_lbl, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        raw_boxes = []
        for k in range(1, n_lbl):
            cx, cy, cw, ch, area = stats[k]
            if 8 <= ch <= 22 and 3 <= cw <= 70 and area >= 8:
                n_ch = max(1, round(cw / 10.5))
                for i in range(n_ch):
                    x0 = cx + round(i * cw / n_ch)
                    x1 = cx + round((i + 1) * cw / n_ch)
                    raw_boxes.append((x0, cy, max(1, x1 - x0), ch))
        raw_boxes.sort(key=lambda b: b[0])
        if not raw_boxes:
            return None
        out = []
        for cx, cy, cw, ch in raw_boxes:
            patch = (255.0 - gray[cy : cy + ch, cx : cx + cw].astype(np.float32)) / 255.0
            if patch.max() > 0:
                patch = patch / patch.max()
            g = cv2.resize(patch, (14, 22), interpolation=cv2.INTER_CUBIC)
            gm = g - g.mean()
            best_k, best_s = None, -999.0
            for k, tmpl in arial_tmpls.items():
                tm = tmpl - tmpl.mean()
                ncc = float(
                    np.sum(gm * tm) / (np.sqrt(np.sum(gm**2) * np.sum(tm**2)) + 1e-6)
                )
                mse = float(np.mean((g - tmpl) ** 2))
                sc = 0.6 * ncc + 0.4 * (1.0 - 2.0 * mse)
                if sc > best_s:
                    best_s = sc
                    best_k = k
            if best_k:
                out.append(best_k)
        raw = "".join(out)
        if raw in ("", "E", "L"):
            return None
        si, furn, eng = 0, 0, 0
        if raw.startswith("M") and "E" not in raw:
            digits = "".join(ch for ch in raw[1:] if ch.isdigit())
            si = int(digits[:2]) if len(digits) >= 2 else 20
        elif "E" in raw:
            left, right = raw.split("E", 1)
            left_d = [ch for ch in left if ch.isdigit()]
            right_d = "".join(ch for ch in right if ch.isdigit())
            if len(left_d) >= 2:
                d0 = "0" if left_d[0] == "9" else left_d[0]
                si = int(d0) * 10 if d0 in ("0", "1", "2", "3", "4") else 30
                f_ch = left_d[-1]
                furn = 9 if f_ch == "9" else (3 if f_ch in ("2", "3", "4") else 0)
            if right_d:
                eng = int(right_d[:2])
        else:
            digits = [ch for ch in raw if ch.isdigit()]
            if len(digits) >= 3:
                d0 = "0" if digits[0] == "9" else digits[0]
                si = int(d0) * 10 if d0 in ("0", "1", "2", "3", "4") else 30
                f_ch = digits[-1]
                furn = 9 if f_ch == "9" else (3 if f_ch in ("2", "3", "4") else 0)
            else:
                return None
        if si == 0 and furn == 0 and eng == 0:
            return None
        return {
            "si": si,
            "furn": furn,
            "eng": eng,
            "code": f"{si:02d}{furn}e{eng}",
            "confidence": 0.95,
        }

    lookup_map = {}
    cell_pad = max(2, round(2 * sx))
    for grp in col_groups:
        hx = grp["hx"]
        x_coll = grp["x_coll"]
        x_n1 = grp["x_n1"]
        x_n2 = grp["x_n2"]
        x_end = grp["x_end"]
        class_x = hx - round(72 * sx)
        for y0, y1 in table_rows:
            ry = y0 + round(6 * sy)
            cp = img[
                ry + round(8 * sy) : ry + round(60 * sy),
                class_x + round(8 * sx) : class_x + round(60 * sx),
            ]
            if cp.size == 0 or (cp.mean() > 240 and cp.std() < 15):
                break
            h_rk = matcher.rank_candidates_in_box(
                img,
                [hx, ry, round(65 * sx), round(65 * sy)],
                "hero",
                type_tensors,
                scales=(0.92, 0.98, 1.04),
                pad_ratio=0.16,
                stride=2,
            )[0]
            h_info = hero_meta[h_rk["id"]]
            h_slug = h_info["slug"]
            h_class = h_info["class"]

            tcrop = img[
                ry + round(35 * sy) : ry + round(78 * sy),
                hx + round(68 * sx) : x_coll - round(4 * sx),
            ]
            inv_dict = _read_inv_text(tcrop)

            cell_gray = gray[y0 + cell_pad : y1 - cell_pad, x_coll + cell_pad : x_n1 - cell_pad]
            ys_nz, xs_nz = np.where(cell_gray < 240)
            if ys_nz.size > 0 and xs_nz.size > 0:
                bx0 = int(xs_nz.min()) + x_coll + cell_pad
                bx1 = int(xs_nz.max()) + x_coll + cell_pad
                by0 = int(ys_nz.min()) + y0 + cell_pad
                by1 = int(ys_nz.max()) + y0 + cell_pad
                bw = max(bx1 - bx0 + 1, by1 - by0 + 1, round(60 * sx))
                cx_c = (bx0 + bx1) / 2.0
                cy_c = (by0 + by1) / 2.0
                c_box = [
                    max(0, min(W - bw, round(cx_c - bw / 2.0))),
                    max(0, min(H - bw, round(cy_c - bw / 2.0))),
                    bw,
                    bw,
                ]
            else:
                c_box = [x_coll + cell_pad, y0 + cell_pad, x_n1 - x_coll - 2 * cell_pad, y1 - y0 - 2 * cell_pad]

            c_ranked = matcher.rank_candidates_in_box(
                img,
                c_box,
                "collection",
                type_tensors,
                scales=(0.92, 0.98, 1.04),
                pad_ratio=0.16,
                stride=2,
                allowed_class=h_class,
                collections_catalog=collections_catalog,
            )
            c_top1 = c_ranked[0]
            c_runner = c_ranked[1]["effective_mse"] if len(c_ranked) > 1 else None
            c_conf = mse_to_confidence(c_top1["effective_mse"], c_runner, scale=2200.0)
            lvl = parse_level_from_state(c_top1["state"])

            nodes_found = []
            for nx0, nx1 in ((x_n1, x_n2), (x_n2, x_end)):
                roi = img[y0:y1, nx0:nx1]
                if roi.size == 0 or (roi.mean() > 242 and roi.std() < 18):
                    continue
                if abs(sx - 1.0) > 0.02 or abs(sy - 1.0) > 0.02:
                    roi_norm = cv2.resize(
                        roi,
                        (max(1, round(roi.shape[1] / sx)), max(1, round(roi.shape[0] / sy))),
                    )
                else:
                    roi_norm = roi
                if roi_norm.shape[0] < 64 or roi_norm.shape[1] < 64:
                    continue
                roi_f = roi_norm.astype(np.float32)
                best_nslug, best_nmse, best_loc = None, 1e9, (0, 0)
                for nslug, ntmpl in node_tmpls.items():
                    if roi_f.shape[0] < ntmpl.shape[0] or roi_f.shape[1] < ntmpl.shape[1]:
                        continue
                    res = cv2.matchTemplate(roi_f, ntmpl, cv2.TM_SQDIFF)
                    min_val, _, min_loc, _ = cv2.minMaxLoc(res)
                    nmse = float(min_val) / (ntmpl.shape[0] * ntmpl.shape[1] * 3.0)
                    if nmse < best_nmse:
                        best_nmse = nmse
                        best_nslug = nslug
                        best_loc = min_loc
                if best_nslug and best_nmse < 1200.0:
                    nodes_found.append(
                        {
                            "slot_index": len(nodes_found),
                            "key": f"{best_nslug}_m",
                            "stat": best_nslug,
                            "tier": "mythic",
                            "mse": round(best_nmse, 2),
                            "confidence": 0.95,
                            "needs_review": False,
                            "visual_alternatives": [],
                            "bbox": [
                                nx0 + round(best_loc[0] * sx),
                                y0 + round(best_loc[1] * sy),
                                round(64 * sx),
                                round(64 * sy),
                            ],
                        }
                    )

            coll_result = {
                "catalog": c_top1["id"],
                "name": c_top1["name"],
                "level": lvl,
                "mse": c_top1["mse"],
                "confidence": c_conf,
                "needs_review": False,
                "bbox": c_box,
                "top3": [
                    {
                        "id": x["id"],
                        "name": x["name"],
                        "mse": x["mse"],
                        "effective_mse": x["effective_mse"],
                    }
                    for x in c_ranked[:3]
                ],
                "visual_alternatives": [],
                "nodes": nodes_found,
            }
            lookup_map[h_slug] = {
                "hero_slug": h_slug,
                "investment": inv_dict,
                "collection": coll_result,
            }
    return lookup_map


def solve_teams(
    img,
    teams_geom,
    matcher,
    type_tensors,
    node_assets,
    hero_meta,
    pet_meta,
    collections_catalog,
    allowed_hero_slugs=None,
):
    set_indices = sorted({t.get("set_index", 0) for t in teams_geom})
    if len(set_indices) > 1:
        combined = []
        for s_idx in set_indices:
            sub_geom = [t for t in teams_geom if t.get("set_index", 0) == s_idx]
            combined.extend(
                solve_teams(
                    img,
                    sub_geom,
                    matcher,
                    type_tensors,
                    node_assets,
                    hero_meta,
                    pet_meta,
                    collections_catalog,
                    allowed_hero_slugs=allowed_hero_slugs,
                )
            )
        return combined

    fast_grid = any(
        t.get("layout") in ("multi_col_nc_grid", "ts_compact_7") for t in teams_geom
    )
    rank_kwargs = (
        {"scales": (0.92, 0.98, 1.04), "pad_ratio": 0.16, "stride": 2}
        if fast_grid
        else {}
    )

    all_hero_rankings = []
    for team in teams_geom:
        for hbox in team["hero_boxes"]:
            rks = matcher.rank_candidates_in_box(
                img, hbox, "hero", type_tensors, **rank_kwargs
            )
            if team.get("layout") == "ts_compact_7" or allowed_hero_slugs:
                hx, hy, hw, hh = hbox
                center_patch = img[
                    hy + round(hh * 0.28) : hy + round(hh * 0.72),
                    hx + round(hw * 0.28) : hx + round(hw * 0.72),
                ]
                dark_center = center_patch.size > 0 and center_patch.mean() < 58.0
                adjusted = []
                for cand in rks:
                    c_copy = dict(cand)
                    c_slug = hero_meta[cand["id"]]["slug"]
                    if allowed_hero_slugs and c_slug in allowed_hero_slugs:
                        c_copy["mse"] = round(float(c_copy["mse"]) * 0.65, 2)
                    if (
                        team.get("layout") == "ts_compact_7"
                        and dark_center
                        and c_slug == "sung-jinwoo"
                    ):
                        c_copy["mse"] = round(float(c_copy["mse"]) * 0.82, 2)
                    adjusted.append(c_copy)
                adjusted.sort(key=lambda x: x["mse"])
                rks = adjusted
            all_hero_rankings.append(rks)
    assigned_heroes = matcher.assign_unique_identities(all_hero_rankings)

    pet_indices = [i for i, t in enumerate(teams_geom) if t["pet_box"] is not None]
    pet_rankings = [
        matcher.rank_candidates_in_box(
            img, teams_geom[i]["pet_box"], "pet", type_tensors, **rank_kwargs
        )
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
            if layout in ("app_card_3_2", "row_5_col", "multi_col_nc_grid"):
                cbox = team["coll_boxes"][s_idx]
                c_ranked = matcher.rank_candidates_in_box(
                    img,
                    cbox,
                    "collection",
                    type_tensors,
                    allowed_class=h_class,
                    collections_catalog=collections_catalog,
                    **rank_kwargs,
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
                        sz_list=(50,) if fast_grid else (46, 50, 54, 56),
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

            inv_result = (
                None
                if layout in ("ts_compact_7", "theafkguys_ts_grid", "abex_4x2_grid")
                else detect_hero_investment(img, hbox)
            )

            slot_options = None
            sub_boxes_all = team.get("sub_hero_boxes")
            if sub_boxes_all and s_idx < len(sub_boxes_all) and sub_boxes_all[s_idx]:
                opts = [h_info["slug"]]
                for sbox in sub_boxes_all[s_idx]:
                    s_rk = matcher.rank_candidates_in_box(
                        img,
                        sbox,
                        "hero",
                        type_tensors,
                        scales=(0.92, 0.98, 1.04),
                        pad_ratio=0.16,
                        stride=2,
                    )
                    if allowed_hero_slugs:
                        s_cand = next(
                            (
                                x
                                for x in s_rk[:8]
                                if hero_meta[x["id"]]["slug"] in allowed_hero_slugs
                            ),
                            s_rk[0],
                        )
                    else:
                        s_cand = s_rk[0]
                    if s_cand["mse"] < 2600.0:
                        s_slug = hero_meta[s_cand["id"]]["slug"]
                        if s_slug not in opts:
                            opts.append(s_slug)
                if len(opts) > 1:
                    slot_options = opts

            h_entry_dict = {
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
                "investment": inv_result,
            }
            if slot_options:
                h_entry_dict["slot_options"] = slot_options
            hx, hy, hw, hh = hbox
            pad_e = max(4, round(min(hw, hh) * 0.18))
            inner = img[
                max(0, hy + pad_e) : min(img.shape[0], hy + hh - pad_e),
                max(0, hx + pad_e) : min(img.shape[1], hx + hw - pad_e),
            ]
            if inner.size > 0:
                inner_gray = cv2.cvtColor(inner, cv2.COLOR_BGR2GRAY) if inner.ndim == 3 else inner
                if float(inner_gray.std()) < 16.0:
                    continue
            team_heroes.append(h_entry_dict)

        p_choice = pet_by_team.get(t_idx)
        p_ranked = pet_rank_by_team.get(t_idx, [])
        pet_out = None
        pet_warning = None
        if layout in ("theafkguys_ts_grid", "abex_4x2_grid"):
            chibi_ranked = _match_theafkguys_chibi_pet(img, team, pet_meta)
            if chibi_ranked:
                best_d, best_pid = chibi_ranked[0]
                chibi_cutoff = 3300.0 if layout == "abex_4x2_grid" else 2400.0
                if best_d <= chibi_cutoff:
                    p_info = pet_meta[best_pid]
                    runner_d = chibi_ranked[1][0] if len(chibi_ranked) > 1 else None
                    pet_out = {
                        "id": p_info["id"],
                        "slug": p_info["slug"],
                        "name": p_info["name"],
                        "bbox": team["pet_box"],
                        "mse": round(best_d, 2),
                        "confidence": mse_to_confidence(best_d, runner_d, scale=2000.0),
                        "needs_review": bool(best_d > 1400.0),
                        "visual_alternatives": [
                            {
                                "id": pid,
                                "slug": pet_meta[pid]["slug"],
                                "name": pet_meta[pid]["name"],
                                "mse": round(d, 2),
                                "confidence": mse_to_confidence(d, scale=2000.0),
                            }
                            for d, pid in chibi_ranked[:5]
                        ],
                    }
                else:
                    p_info = pet_meta[best_pid]
                    pet_warning = (
                        f"⚠️ Pet could not be recognized confidently "
                        f"(best guess {p_info['name']} had MSE {best_d:.0f}); left blank."
                    )
            else:
                pet_warning = "⚠️ Pet sprite could not be isolated; left blank."
        elif p_choice is not None:
            p_info = pet_meta[p_choice["id"]]
            p_mse_cutoff = 3800.0 if layout == "theafkguys_ts_grid" else 4200.0
            if float(p_choice["mse"]) > p_mse_cutoff:
                pet_warning = (
                    f"⚠️ Pet could not be recognized confidently "
                    f"(best guess {p_info['name']} had high MSE {p_choice['mse']:.0f}); left blank."
                )
            else:
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
                if layout in ("multi_col_nc_grid", "app_card_3_2"):
                    det_pet_lvl = _detect_pet_level(img, team["pet_box"])
                    if det_pet_lvl is not None:
                        pet_out["level"] = det_pet_lvl
        elif team.get("pet_banner_box") is not None:
            pet_banners = _get_lookup_assets()["pet_banners"]
            pb_x, pb_y, pb_w, pb_h = team["pet_banner_box"]
            pb_crop = img[max(0, pb_y) : pb_y + pb_h, max(0, pb_x) : pb_x + pb_w]
            if pb_crop.size > 0 and pet_banners:
                if pb_crop.shape[:2] != (30, 60):
                    pb_crop = cv2.resize(pb_crop, (60, 30))
                pbf = pb_crop.astype(np.float32)
                best_pslug, best_pmse = None, 1e9
                for pslug, ptmpl in pet_banners.items():
                    pmse = float(np.mean((pbf - ptmpl) ** 2))
                    if pmse < best_pmse:
                        best_pmse = pmse
                        best_pslug = pslug
                pet_by_slug = {p["slug"]: p for p in pet_meta.values()}
                if best_pslug and best_pslug in pet_by_slug and best_pmse < 1200.0:
                    p_info = pet_by_slug[best_pslug]
                    pet_opts = [best_pslug]
                    alt_box = team.get("pet_banner_alt_box")
                    if alt_box is not None:
                        ax, ay, aw, ah = alt_box
                        acrop = img[max(0, ay) : ay + ah, max(0, ax) : ax + aw]
                        if acrop.size > 0 and acrop.std() > 35.0:
                            if acrop.shape[:2] != (30, 60):
                                acrop = cv2.resize(acrop, (60, 30))
                            af = acrop.astype(np.float32)
                            alt_slug, alt_mse = None, 1e9
                            for pslug, ptmpl in pet_banners.items():
                                pmse = float(np.mean((af - ptmpl) ** 2))
                                if pmse < alt_mse:
                                    alt_mse = pmse
                                    alt_slug = pslug
                            if (
                                alt_slug
                                and alt_slug in pet_by_slug
                                and alt_mse < 1200.0
                                and alt_slug not in pet_opts
                            ):
                                pet_opts.append(alt_slug)
                    pet_out = {
                        "id": p_info["id"],
                        "slug": p_info["slug"],
                        "name": p_info["name"],
                        "options": pet_opts,
                        "bbox": team["pet_banner_box"],
                        "mse": round(best_pmse, 2),
                        "confidence": 0.95,
                        "needs_review": False,
                        "visual_alternatives": [],
                    }
        team_dict = {
            "round": team["round"],
            "layout": layout,
            "pet": pet_out,
            "heroes": team_heroes,
        }
        if pet_warning:
            team_dict["pet_warning"] = pet_warning
        if "set_index" in team:
            team_dict["set_index"] = team["set_index"]
        if "set_label" in team:
            team_dict["set_label"] = team["set_label"]
        if team_heroes:
            mean_team_mse = sum(float(h.get("mse") or 0.0) for h in team_heroes) / len(team_heroes)
            if mean_team_mse > 2900.0 and (len(team_heroes) < 5 or layout == "app_card_3_2"):
                continue
        solved_teams.append(team_dict)
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
        mse_single = r1["mse"]
        if mse_single <= 1800:
            return "single", [pet_meta[r1["id"]]], r1_list[:5]

        gap_patch = left_panel[
            max(0, y0 - 4) : min(left_panel.shape[0], y0 + h + 4),
            max(0, x_pet - 16) : max(1, x_pet - 2),
        ]
        local_bg = (
            np.median(gap_patch, axis=(0, 1)) if gap_patch.size > 0 else bg_color
        )
        roi = left_panel[
            max(0, y0 - 8) : min(left_panel.shape[0], y0 + h + 22), x_pet:868
        ]
        d = np.max(np.abs(roi.astype(np.float32) - local_bg), axis=2)
        col_active = (d > 30).mean(axis=0)
        active_xs = np.where(col_active > 0.22)[0]
        span_w = int(active_xs[-1]) + 1 if len(active_xs) else h

        tr_patch = left_panel[y0 + 3 : y0 + 22, x_pet + h - 20 : x_pet + h + 15]
        tr_d = np.max(np.abs(tr_patch.astype(np.float32) - local_bg), axis=2) if tr_patch.size else np.zeros((1, 1))
        tr_empty = float((tr_d < 26).mean()) > 0.65 if tr_patch.size else True

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
            if float(np.mean([x["mse"] for x in r3])) < mse_single * 0.95:
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
            if float(np.mean([x["mse"] for x in r2])) < mse_single * 0.95:
                return "split_2", [pet_meta[x["id"]] for x in r2], r2_lists[0][:5]

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
            inv = h.get("investment") or {}
            if inv.get("code"):
                hero_entry["investment"] = inv["code"]
            eng_val = inv.get("eng") if inv.get("eng") is not None else (inv.get("engraving") or 0)
            furn_val = inv.get("furn") if inv.get("furn") is not None else (inv.get("furniture") or 0)
            si_val = inv.get("si") or 0
            if eng_val > 0:
                hero_entry["ascension"] = "ascended_1"
            elif furn_val > 0:
                hero_entry["ascension"] = "ascended"
            elif si_val > 0:
                hero_entry["ascension"] = "mythic"
            if h.get("slot_options") and len(h["slot_options"]) > 1:
                hero_entry["alternatives"] = h["slot_options"][1:]
            heroes_out.append(hero_entry)
        formation_entry = {
            "key": team.get("matched_formation_key") or f"round-{r_idx}",
            "label": team.get("matched_formation_label") or f"Round {r_idx}",
            "pet": team["pet"]["slug"] if team.get("pet") else None,
            "heroes": heroes_out,
        }
        if team.get("pet") and team["pet"].get("level"):
            formation_entry["pet_level"] = team["pet"]["level"]
        if team.get("damage") is not None:
            formation_entry["damage"] = team["damage"]
        if team.get("kill_time_seconds") is not None:
            formation_entry["time_seconds"] = team["kill_time_seconds"]
        if team.get("sp_hero_id") is not None:
            formation_entry["sp_hero_id"] = team["sp_hero_id"]
        if team.get("notes"):
            formation_entry["notes"] = team["notes"]
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
        ("nightmare-corridor", "Nightmare Corridor", "soulchain-knight", "Soulchain Knight", 6),
        ("nightmare-corridor", "Nightmare Corridor", "infernal-overlord", "Infernal Overlord", 6),
        ("nightmare-corridor", "Nightmare Corridor", "netherspinner", "Netherspinner", 6),
        ("cursed-realm", "Cursed Realm", "ice-shemira", "Ice Shemira", 6),
        ("cursed-realm", "Cursed Realm", "burning-brute", "Burning Brute", 6),
        ("cursed-realm", "Cursed Realm", "kane", "Kane", 6),
        ("cursed-realm", "Cursed Realm", "demonic-entity", "Demonic Entity", 6),
        ("cursed-realm", "Cursed Realm", "the-unhinged", "The Unhinged", 6),
        ("cursed-realm", "Cursed Realm", "grotesque-mage", "Grotesque Mage", 6),
        ("cursed-realm", "Cursed Realm", "dune-destroyer", "Dune Destroyer", 6),
        ("treasure-scramble", "Treasure Scramble", "fire", "Fire", 4),
        ("treasure-scramble", "Treasure Scramble", "frost", "Frost", 4),
        ("treasure-scramble", "Treasure Scramble", "forest", "Forest", 4),
        ("treasure-scramble", "Treasure Scramble", "fog", "Fog", 4),
        ("treasure-scramble", "Treasure Scramble", "fountain", "Fountain", 4),
        ("heroes-of-esperia", "Heroes of Esperia", "current-season", "Current Season", 5),
        ("temporal-rift", "Temporal Rift", "s16", "S16", 5),
        ("temporal-rift", "Temporal Rift", "s17", "S17", 5),
        ("hunting-fields-contract", "Hunting Fields Contract", "wrizz-no-earrings", "Wrizz — No Earrings", 2),
        ("hunting-fields-contract", "Hunting Fields Contract", "adrax-no-earrings", "Adrax — No Earrings", 2),
        ("hunting-fields-contract", "Hunting Fields Contract", "adrax-ranger-buff", "Adrax — Ranger Buff", 2),
        ("dragonforge-trials", "Dragonforge Trials", "trial-12", "Trial 12", 3),
        ("dragonforge-trials", "Dragonforge Trials", "trial-11", "Trial 11", 3),
        ("dragonforge-trials", "Dragonforge Trials", "trial-10", "Trial 10", 3),
        ("dragonforge-trials", "Dragonforge Trials", "trial-9", "Trial 9", 3),
        ("abyssal-expedition", "Abyssal Expedition", "s18-final-boss", "S18 — Final Boss", 3),
        ("abyssal-expedition", "Abyssal Expedition", "s18-gate-bosses", "S18 — Gate Bosses", 3),
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

        is_staggered = any(t.get("layout") == "staggered_3_2" for t in solved_teams)
        is_ts_compact = any(t.get("layout") == "ts_compact_7" for t in solved_teams)
        is_multi_nc = any(t.get("layout") == "multi_col_nc_grid" for t in solved_teams)
        ocr_modes = set()
        ocr_targets = set()
        for t in solved_teams:
            hints = t.get("_ocr_hints") or {}
            ocr_modes.update(hints.get("modes") or ())
            ocr_targets.update(hints.get("targets") or ())
        reasons = []
        struct_score = 0.10
        if m_slug in ocr_modes:
            struct_score += 0.35
            reasons.append(f"Header text matched {m_name}.")
        if t_slug in ocr_targets:
            struct_score += 0.45
            reasons.append(f"Header text matched {t_name}.")
        if m_slug == "nightmare-corridor":
            if is_multi_nc or (team_count == 6 and not is_staggered):
                struct_score += 0.62 if is_multi_nc else 0.32
                reasons.append("6-round formation structure matches Nightmare Corridor 6-boss cycle.")
            elif team_count in (2, 3, 4, 5) and has_collections and not is_staggered:
                struct_score += 0.26
                reasons.append(f"{team_count}-round partial formation guide with pets & collections fits Nightmare Corridor.")
            elif team_count == 1 and has_collections:
                struct_score += 0.22
                reasons.append("Single-round crop with 5 heroes + collection badges fits a Nightmare Corridor boss round.")
            if has_substitutes:
                struct_score += 0.08
                reasons.append("Includes per-boss substitute team table typical of Nightmare Corridor community guides.")
        elif m_slug == "cursed-realm":
            if is_staggered and team_count in (3, 6):
                struct_score += 0.65 + (0.08 if t_slug == "demonic-entity" else 0.0)
                reasons.append(f"{team_count}-round staggered Cursed Realm formation layout.")
            elif team_count == 6:
                struct_score += 0.26
                reasons.append("6-team layout also fits Cursed Realm (5 Shadow Guards + 1 Boss).")
            elif team_count == 1:
                struct_score += 0.16
                reasons.append("Single-round crop could be a Cursed Realm Boss or Shadow Guard formation.")
        elif m_slug == "treasure-scramble":
            if team_count == 7 or is_ts_compact:
                struct_score += 0.72 + (0.06 if is_ts_compact and t_slug == "forest" else 0.0)
                reasons.append("7-team multi-formation layout exclusively matches Treasure Scramble (up to 7 teams).")
            elif 2 <= team_count <= 6 and not is_staggered:
                struct_score += 0.22
                reasons.append(f"{team_count}-team multi-formation layout is compatible with Treasure Scramble (2-7 teams).")
        elif m_slug == "heroes-of-esperia":
            if team_count == 5 and not is_staggered:
                struct_score += 0.24
                reasons.append("5-team PvP formation structure fits Heroes of Esperia.")
        elif m_slug == "temporal-rift":
            if 1 <= team_count <= 5 and not is_staggered:
                struct_score += 0.22
                reasons.append(f"{team_count}-team formation layout fits Temporal Rift (up to 5 teams).")
        elif m_slug == "hunting-fields-contract":
            if 1 <= team_count <= 4 and not is_staggered:
                struct_score += 0.28
                reasons.append(f"{team_count}-comp layout matches Hunting Fields Contract.")
        elif m_slug == "dragonforge-trials":
            if 1 <= team_count <= 3:
                struct_score += 0.22
                reasons.append(f"{team_count}-path formation fits a Dragonforge Trials stage.")
        elif m_slug == "abyssal-expedition":
            if 1 <= team_count <= 7 and not is_staggered:
                struct_score += 0.18
                reasons.append(f"{team_count}-team boss/relic composition layout fits Abyssal Expedition.")

        if best_ref and ref_sim >= 0.25:
            matched_h = sum(ra["hero_overlap_count"] for ra in best_ref["round_alignments"])
            total_h = 5 * len(best_ref["round_alignments"])
            reasons.insert(
                0,
                f"Matches reference lineup '{best_ref['title']}' ({matched_h}/{total_h} heroes across {len(best_ref['round_alignments'])} round(s), {round(ref_sim * 100, 1)}% round similarity).",
            )

        ocr_bonus = (0.28 if m_slug in ocr_modes else 0.0) + (0.25 if t_slug in ocr_targets else 0.0)
        combined_conf = round(
            min(0.99, max(0.02, 0.72 * ref_sim + 0.28 * min(1.0, struct_score * 2.4) + ocr_bonus)),
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


def _detect_guide_layout_kind(img):
    """Lightweight top-banner OCR to classify non-CR/NC/TS community guide layouts."""
    H, W = img.shape[:2]
    ocr = _get_ocr_engine()
    if ocr is None:
        return None, ""
    top = img[: min(H, max(220, round(H * 0.22))), :]
    if max(top.shape[:2]) > 1600:
        s = 1600.0 / max(top.shape[:2])
        top = cv2.resize(top, (round(top.shape[1] * s), round(top.shape[0] * s)))
    try:
        res, _ = ocr(top)
    except Exception:
        return None, ""
    text = " ".join(r[1] for r in (res or [])).upper()
    if "HUNTING" in text or "CONTRACT" in text or "NO EARRINGS" in text:
        return "hfc", text
    if "TEMPORAL" in text or "RIFT" in text:
        return "temporal_rift", text
    if "ABEX" in text or "AB&X" in text:
        return "abex_grid", text
    if "TRIAL" in text or "DRAGONFORGE" in text or "FIRST 3-STAR" in text:
        return "dragonforge_history", text
    return None, text


def _group_boxes_into_rows(boxes, y_tol=28):
    rows = []
    for b in sorted(boxes, key=lambda x: (x[1], x[0])):
        cy = b[1] + b[3] * 0.5
        if not rows or abs(cy - float(np.mean([r[1] + r[3] * 0.5 for r in rows[-1]]))) > y_tol:
            rows.append([b])
        else:
            rows[-1].append(b)
    return [sorted(r, key=lambda x: x[0]) for r in rows]


def assemble_hfc_cards(img, model):
    """Assemble stacked Hunting Fields Contract cards (scale-invariant across 1031w..2819w Rakudayyy guides)."""
    H, W = img.shape[:2]
    if model is None:
        return []
    raw_boxes, raw_scores = [], []
    y_start = round(H * 0.33)
    win_h = max(320, round(W * 0.46))
    step_y = max(200, round(W * 0.28))
    for y0 in range(y_start, max(y_start + 1, H - round(W * 0.08)), step_y):
        y1 = min(H, y0 + win_h)
        crop = img[y0:y1, :]
        res = model.predict(source=crop, imgsz=1280, conf=0.15, iou=0.45, max_det=100, device="cpu", verbose=False)[0]
        for (bx1, by1, bx2, by2), s in zip(res.boxes.xyxy.cpu().tolist(), res.boxes.conf.cpu().tolist()):
            raw_boxes.append([bx1, by1 + y0, bx2, by2 + y0])
            raw_scores.append(float(s))

    icon_w = round(0.112 * W)
    min_px = max(48, round(0.072 * W))
    max_px = round(0.155 * W)
    norm = normalize_yolo_boxes(raw_boxes, raw_scores, img.shape, min_px=min_px)

    # All portrait-sized icons (heroes + pets) across the card body
    all_cands = [b for b, _ in norm if W * 0.08 <= b[0] <= W * 0.88 and min_px <= b[2] <= max_px and min_px <= b[3] <= max_px]
    rows = [r for r in _group_boxes_into_rows(all_cands, y_tol=round(0.055 * W)) if len(r) >= 2]

    hero_x_fracs = (0.107, 0.232, 0.380, 0.505, 0.630)
    pet_x_frac = 0.778
    ocr = _get_ocr_engine()

    teams = []
    for idx, row in enumerate(rows):
        # Compute vertical center of the row using hero-column boxes when available
        hero_row_boxes = [b for b in row if b[0] < W * 0.72]
        ref_boxes = hero_row_boxes if hero_row_boxes else row
        ry = float(np.median([b[1] + b[3] * 0.5 for b in ref_boxes]))
        top_y = max(0, round(ry - icon_w * 0.5))

        # Snap 5 hero boxes to exact columns with canonical icon_w size,
        # gently refining (x, y) only when a well-sized YOLO box agrees.
        h_boxes = []
        for fx in hero_x_fracs:
            cx_exp = fx * W + icon_w * 0.5
            near = [
                b for b in hero_row_boxes
                if abs((b[0] + b[2] * 0.5) - cx_exp) <= 0.030 * W
                and 0.85 * icon_w <= b[2] <= 1.15 * icon_w
                and 0.85 * icon_w <= b[3] <= 1.15 * icon_w
            ]
            if near:
                best = min(near, key=lambda b: abs((b[0] + b[2] * 0.5) - cx_exp))
                bcx = best[0] + best[2] * 0.5
                bcy = best[1] + best[3] * 0.5
                bx = max(0, min(W - icon_w, round(bcx - icon_w * 0.5)))
                by = max(0, min(H - icon_w, round(bcy - icon_w * 0.5)))
                h_boxes.append([bx, by, icon_w, icon_w])
            else:
                h_boxes.append([round(fx * W), top_y, icon_w, icon_w])

        # Pet box(es) on the right (x >= 0.72 * W); reject false-positive header/empty boxes
        def _is_valid_pet_box(b):
            px, py, pw, ph = [int(round(v)) for v in b]
            pad_p = max(4, round(min(pw, ph) * 0.18))
            patch = img[max(0, py + pad_p):min(H, py + ph - pad_p), max(0, px + pad_p):min(W, px + pw - pad_p)]
            if patch.size == 0:
                return False
            g = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
            return float(g.std()) >= 18.0

        row_pets = sorted(
            [
                b for b in all_cands
                if b[0] >= W * 0.72
                and abs((b[1] + b[3] * 0.5) - ry) <= 0.068 * W
                and _is_valid_pet_box(b)
            ],
            key=lambda p: abs((p[1] + p[3] * 0.5) - ry),
        )
        pet_box = row_pets[0] if row_pets else [round(pet_x_frac * W), top_y, icon_w, icon_w]

        # OCR the card header strip directly above the hero row for comp label & damage (~35.5B)
        comp_label = f"Comp {idx + 1}"
        comp_dmg = None
        if ocr is not None:
            hy0 = max(0, round(top_y - 0.175 * W))
            hy1 = max(hy0 + 10, round(top_y - 0.045 * W))
            hx0 = max(0, round(0.08 * W))
            hx1 = min(W, round(0.92 * W))
            hdr_crop = img[hy0:hy1, hx0:hx1]
            if hdr_crop.size > 0:
                try:
                    hres, _ = ocr(hdr_crop, use_cls=False)
                except Exception:
                    hres = None
                if hres:
                    ordered = sorted(
                        ((sum(p[0] for p in b) / 4.0, txt.strip()) for b, txt, _s in hres if txt and txt.strip()),
                        key=lambda x: x[0],
                    )
                    full_hdr = " ".join(t for _, t in ordered)
                    dmg_matches = list(re.finditer(r"~?\s*(\d+(?:\.\d+)?)\s*([bBmM])\b", full_hdr))
                    # Pick the rightmost match with >= 5B (skips comp labels like "COMP 1B" / "COMP 2B")
                    for m_dmg in reversed(dmg_matches):
                        val = float(m_dmg.group(1))
                        unit = m_dmg.group(2).lower()
                        if unit == "b" and val < 5.0:
                            continue
                        mult = 1_000_000_000 if unit == "b" else 1_000_000
                        comp_dmg = round(val * mult)
                        break
                    # Clean label without trailing damage
                    clean_lbl = re.sub(r"~?\s*\d{2,}(?:\.\d+)?\s*[bBmM]\b", "", full_hdr).strip(" -~")
                    if len(clean_lbl) >= 4:
                        comp_label = clean_lbl

        # Reject spurious gap/border rows that have neither a valid card header nor >= 3 icon boxes
        has_card_hdr = bool(comp_dmg) or bool(re.search(r"comp|bis|buff|alt|variant|carry|f2p|team", comp_label, re.I))
        if len(row) < 3 and not has_card_hdr:
            continue
        if teams and abs(ry - (teams[-1]["hero_boxes"][0][1] + teams[-1]["hero_boxes"][0][3] * 0.5)) < 0.28 * W:
            continue

        teams.append({
            "round": 1,
            "layout": "hfc_cards",
            "set_index": len(teams),
            "set_label": comp_label,
            "hero_boxes": h_boxes,
            "coll_boxes": None,
            "pet_box": pet_box,
            "_hfc_pet_boxes": row_pets[:2] if row_pets else [pet_box],
            "_hfc_damage": comp_dmg,
            "_ocr_hints": {"modes": ["hunting-fields-contract"], "targets": ["wrizz-no-earrings"]},
        })

    # If a 4-card HFC sheet has one card whose y drifted off the even vertical grid
    # (e.g. YOLO missed blue-bordered portraits on that card), snap it to the grid and re-OCR its header.
    if len(teams) == 4:
        ys = [t["hero_boxes"][0][1] for t in teams]
        step = (ys[-1] - ys[0]) / 3.0
        if 0.32 * W <= step <= 0.48 * W:
            for idx in (1, 2):
                exp_y = round(ys[0] + idx * step)
                if abs(ys[idx] - exp_y) > 0.06 * W:
                    teams[idx]["hero_boxes"] = [[round(fx * W), exp_y, icon_w, icon_w] for fx in hero_x_fracs]
                    p_box = [round(pet_x_frac * W), exp_y, icon_w, icon_w]
                    teams[idx]["pet_box"] = p_box
                    teams[idx]["_hfc_pet_boxes"] = [p_box]
                    if ocr is not None:
                        hy0 = max(0, round(exp_y - 0.175 * W))
                        hy1 = max(hy0 + 10, round(exp_y - 0.045 * W))
                        hx0 = max(0, round(0.08 * W))
                        hx1 = min(W, round(0.92 * W))
                        try:
                            hres, _ = ocr(img[hy0:hy1, hx0:hx1], use_cls=False)
                        except Exception:
                            hres = None
                        if hres:
                            ordered = sorted(
                                ((sum(p[0] for p in b) / 4.0, txt.strip()) for b, txt, _s in hres if txt and txt.strip()),
                                key=lambda x: x[0],
                            )
                            full_hdr = " ".join(t for _, t in ordered)
                            comp_dmg = None
                            for m_dmg in reversed(list(re.finditer(r"~?\s*(\d+(?:\.\d+)?)\s*([bBmM])\b", full_hdr))):
                                val = float(m_dmg.group(1))
                                unit = m_dmg.group(2).lower()
                                if unit == "b" and val < 5.0:
                                    continue
                                comp_dmg = round(val * (1_000_000_000 if unit == "b" else 1_000_000))
                                break
                            clean_lbl = re.sub(r"~?\s*\d{2,}(?:\.\d+)?\s*[bBmM]\b", "", full_hdr).strip(" -~")
                            if len(clean_lbl) >= 4:
                                teams[idx]["set_label"] = clean_lbl
                            if comp_dmg:
                                teams[idx]["_hfc_damage"] = comp_dmg
    return teams


def assemble_abex_4x2_grid(img, model=None):
    """Assemble 4x2 AbEx Boss Comps grid (TheAFKGuys white-background bordered template)."""
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Detect thick horizontal and vertical black border lines dynamically
    h_lines = np.where((gray < 40).mean(axis=1) > 0.75)[0]
    h_splits = [
        int(np.mean(r))
        for r in np.split(h_lines, np.where(np.diff(h_lines) > 10)[0] + 1)
        if len(r) > 5
    ] if len(h_lines) else []
    v_lines = np.where((gray[round(H * 0.28) :, :] < 40).mean(axis=0) > 0.75)[0]
    v_splits = [
        int(np.mean(r))
        for r in np.split(v_lines, np.where(np.diff(v_lines) > 10)[0] + 1)
        if len(r) > 5
    ] if len(v_lines) else []

    if len(h_splits) >= 2:
        row_bounds = [(h_splits[0], h_splits[1]), (h_splits[1], H)]
    else:
        row_bounds = [(round(0.25 * H), round(0.63 * H)), (round(0.63 * H), H)]

    if len(v_splits) >= 3:
        xs = [0, v_splits[0], v_splits[1], v_splits[2], W]
        col_bounds = [(xs[i], xs[i + 1]) for i in range(4)]
    else:
        col_bounds = [(round(c * W / 4), round((c + 1) * W / 4)) for c in range(4)]

    teams = []
    for r_idx, (y0, y1) in enumerate(row_bounds):
        for c_idx, (x0, x1) in enumerate(col_bounds):
            if r_idx == 1 and c_idx == 3:
                continue  # Bottom-right cell is the Collections summary panel
            cell_w = x1 - x0
            # Locate the primary 5-hero bar (height ~160..240px on white bg) in the top of the cell
            scan_y0 = y0 + round((y1 - y0) * 0.08)
            scan_y1 = min(y1, y0 + round((y1 - y0) * 0.30))
            sub = gray[scan_y0:scan_y1, x0 + round(cell_w * 0.06) : x0 + round(cell_w * 0.72)]
            if sub.size == 0:
                continue
            ys = np.where((sub < 225).mean(axis=1) > 0.50)[0]
            if len(ys) == 0:
                continue
            y_runs = [
                r
                for r in np.split(ys, np.where(np.diff(ys) > 5)[0] + 1)
                if 130 <= (r[-1] - r[0] + 1) <= 280
            ]
            if not y_runs:
                continue
            best_yr = max(y_runs, key=len)
            hy = scan_y0 + int(best_yr[0])
            hh = int(best_yr[-1] - best_yr[0] + 1)

            # Snap exact x-start and stride of the 5 contiguous square hero portraits
            bar_x0 = x0 + round(cell_w * 0.03)
            bar_x1 = min(x1, x0 + round(cell_w * 0.78))
            bar = gray[hy + 12 : min(H, hy + hh - 12), bar_x0:bar_x1]
            xs_dark = np.where((bar < 225).mean(axis=0) > 0.45)[0] if bar.size else np.array([])
            if len(xs_dark) > 0:
                x_start = bar_x0 + int(xs_dark[0])
                x_end = bar_x0 + int(xs_dark[-1]) + 1
                total_w = x_end - x_start
                # If total_w spans ~5 square icons (excluding adjacent chibi pet), divide into 5 equal slots
                if hh * 4.6 <= total_w <= hh * 5.25:
                    stride = total_w / 5.0
                else:
                    stride = float(hh)
            else:
                x_start = x0 + round(cell_w * 0.095)
                stride = float(hh)

            hw = round(stride)
            hero_boxes = [[round(x_start + i * stride), hy, hw, hh] for i in range(5)]
            # Pet chibi sits immediately to the right of slot 5 on the same row; keep clear of black border
            pet_x = hero_boxes[-1][0] + hw + round(hw * 0.06)
            pet_w = min(round(hw * 1.15), max(0, (x1 - 30) - pet_x))
            pet_box = [pet_x, max(0, hy - round(hh * 0.06)), pet_w, round(hh * 1.12)] if pet_w >= 80 else None

            t_idx = len(teams)
            teams.append({
                "round": 1,
                "layout": "abex_4x2_grid",
                "set_index": t_idx,
                "set_label": f"Comp {t_idx + 1}",
                "hero_boxes": hero_boxes,
                "coll_boxes": None,
                "pet_box": pet_box,
                "_ocr_hints": {"modes": ["abyssal-expedition"], "targets": ["s18-final-boss"]},
            })
    return teams


def assemble_dragonforge_history(img, model):
    """Assemble Dragonforge Trials Battle History screenshots (single or 2-up side-by-side)."""
    H, W = img.shape[:2]
    if model is None:
        return []
    halves = [(0, W // 2, "Trial 11"), (W // 2, W, "Trial 12")] if W >= 1600 and H >= 1600 else [(0, W, "Trial")]
    teams = []
    for s_idx, (x0, x1, default_label) in enumerate(halves):
        y0, y1 = round(0.28 * H), round(0.84 * H)
        crop = img[y0:y1, x0:x1]
        res = model.predict(source=crop, imgsz=1280, conf=0.20, iou=0.45, max_det=150, device="cpu", verbose=False)[0]
        r_boxes = [[bx1 + x0, by1 + y0, bx2 + x0, by2 + y0] for bx1, by1, bx2, by2 in res.boxes.xyxy.cpu().tolist()]
        r_scores = [float(s) for s in res.boxes.conf.cpu().tolist()]
        norm = normalize_yolo_boxes(r_boxes, r_scores, img.shape, min_px=38)
        hero_cands = [b for b, _ in norm if 42 <= b[2] <= 95 and 42 <= b[3] <= 95]
        rows = [r for r in _group_boxes_into_rows(hero_cands, y_tol=20) if len(r) >= 5]
        # Keep only the 5 ally heroes to the LEFT of the play button in each row;
        # trim top Lvl bar and bottom star bar so template matching focuses on the portrait.
        for r_i, row in enumerate(rows[:3]):
            trimmed = [
                [
                    b[0] + round(b[2] * 0.06),
                    b[1] + round(b[3] * 0.16),
                    max(24, round(b[2] * 0.88)),
                    max(24, round(b[3] * 0.68)),
                ]
                for b in row[:5]
            ]
            teams.append({
                "round": r_i + 1,
                "layout": "dragonforge_history",
                "set_index": s_idx,
                "set_label": default_label,
                "hero_boxes": trimmed,
                "coll_boxes": None,
                "pet_box": None,
                "_ocr_hints": {"modes": ["dragonforge-trials"], "targets": ["trial-11", "trial-12"]},
            })
    return teams


def _attach_temporal_rift_pets(img, model, solved_teams, matcher, type_tensors, pet_meta):
    """Extract primary + alt pets from the left sub-grid column of Mugen/Rakudayyy Temporal Rift guides."""
    H, W = img.shape[:2]
    left_w = min(1048, W)
    for t in solved_teams:
        if t.get("pet") is not None:
            continue
        h_boxes = [h.get("bbox") for h in t.get("heroes", []) if h.get("bbox")]
        if not h_boxes:
            continue
        hy = float(np.median([b[1] for b in h_boxes]))
        y0 = max(0, round(hy - 220))
        y1 = min(H, round(hy + 120))
        pet_boxes = []
        if model is not None:
            res = model.predict(source=img[y0:y1, 0:left_w], imgsz=640, conf=0.20, device="cpu", verbose=False)[0]
            raw = [
                [round(b[0]), round(b[1] + y0), round(b[2] - b[0]), round(b[3] - b[1])]
                for b in res.boxes.xyxy.cpu().tolist()
            ]
            # Primary row of left sub-grid sits around y = hy - 150 .. hy - 20; pets sit at x >= 760
            row_cands = [b for b in raw if 85 <= b[2] <= 125 and 85 <= b[3] <= 125 and (hy - 165) <= b[1] <= (hy - 15)]
            pet_boxes = sorted([b for b in row_cands if b[0] >= 760], key=lambda b: b[0])
        if not pet_boxes:
            pet_boxes = [[792, max(0, round(hy - 105)), 108, 106]]

        matched = []
        for pb in pet_boxes[:2]:
            rks = matcher.rank_candidates_in_box(img, pb, "pet", type_tensors, scales=(0.92, 1.0, 1.08), pad_ratio=0.14, stride=2)
            if rks:
                best = rks[0]
                pid = best["id"]
                meta = next((v for v in pet_meta.values() if v.get("id") == pid), {})
                matched.append((pb, best, meta))
        if matched:
            pb0, best0, meta0 = matched[0]
            primary_slug = meta0.get("slug", str(best0["id"]))
            opts = [m[2].get("slug", str(m[1]["id"])) for m in matched]
            t["pet"] = {
                "id": best0["id"],
                "slug": primary_slug,
                "name": best0["name"],
                "options": list(dict.fromkeys(opts)),
                "confidence": round(max(0.1, 1.0 - best0["mse"] / 12000.0), 3),
                "needs_review": best0["mse"] > 5000,
                "visual_alternatives": [],
                "bbox": pb0,
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
    allowed_hero_slugs=None,
):
    H, W = img.shape[:2]
    if is_hero_lookup_sheet_image(img):
        return []
    guide_kind, guide_ocr_text = _detect_guide_layout_kind(img)
    if guide_kind == "hfc":
        teams_geom = assemble_hfc_cards(img, model)
    elif guide_kind == "abex_grid":
        teams_geom = assemble_abex_4x2_grid(img, model)
    elif guide_kind == "dragonforge_history":
        teams_geom = assemble_dragonforge_history(img, model)
    # 0. Multi-column 3x6 Nightmare Corridor / Cursed Realm grid (e.g. 3888x5955 5w6pegdl2o1i1.png)
    elif W >= 3400 and H >= 5000:
        teams_geom = assemble_multi_column_nc_grid(img, None)
    # 0.5. 4x2 TheAFKGuys TS grid (e.g. 3577x2986)
    elif W >= 3200 and 2400 <= H <= 3400:
        teams_geom = assemble_theafkguys_ts_grid(img)
    # 1. Tall 2-column community guide (e.g. 3000x6000 nc-mugen-2026-10 or 3000x4500 trift-s16-mugen-2026)
    elif H >= 3000 and W >= 2400:
        raw_boxes, raw_scores = [], []
        y_step = 600 if guide_kind == "temporal_rift" else 700
        y_end = H - 150 if guide_kind == "temporal_rift" else H - 300
        for y0 in range(400, y_end, y_step):
            y1 = min(H, y0 + 1100)
            x0, x1 = 1048, min(W, 2350 if guide_kind == "temporal_rift" else 2248)
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
                if 85 <= b[2] <= 118 and (h_y_med + 130) <= b[1] <= (h_y_med + 340)
            ]
            if len(h_band) < 3 or len(c_band) < 3:
                continue
            round_norm = [
                (b, s) for b, s in norm if h_y_med - 60 <= b[1] <= h_y_med + 340
            ]
            teams_geom.extend(
                assemble_row_5_col_team(img, round_norm, round_num=len(teams_geom) + 1)
            )
    # 2. Compact 5-to-7-team Treasure Scramble sheet (e.g. 800x1800 h03e45jpfk1i1.png, or 5T/6T)
    elif 740 <= W <= 860 and 1200 <= H <= 2000:
        teams_geom = assemble_ts_compact_7_teams(img)
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
                    if W * 0.24 <= b[0] <= W * 0.52 and b[2] <= round(98 * W / 1080.0)
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
        allowed_hero_slugs=allowed_hero_slugs,
    )
    if W >= 3200 and 2400 <= H <= 3400:
        _extract_theafkguys_variants(img, solved_teams, matcher, type_tensors, hero_meta, pet_meta)
    if guide_kind == "temporal_rift":
        for t in solved_teams:
            t["_ocr_hints"] = {"modes": ["temporal-rift"], "targets": ["s16"]}
        _attach_temporal_rift_pets(img, model, solved_teams, matcher, type_tensors, pet_meta)
    elif guide_kind == "hfc":
        for i, t in enumerate(solved_teams):
            t["_ocr_hints"] = {"modes": ["hunting-fields-contract"], "targets": ["wrizz-no-earrings"]}
            if i < len(teams_geom) and teams_geom[i].get("_hfc_damage"):
                dmg = teams_geom[i]["_hfc_damage"]
                t["damage"] = dmg
                t["damage_display"] = _format_damage_short(dmg)
            pet_boxes = teams_geom[i].get("_hfc_pet_boxes", []) if i < len(teams_geom) else []
            if pet_boxes:
                matched_pets = []
                for pb in pet_boxes[:2]:
                    rks = matcher.rank_candidates_in_box(img, pb, "pet", type_tensors, scales=(0.90, 0.98, 1.06), pad_ratio=0.14, stride=2)
                    if rks:
                        best = rks[0]
                        pid = best["id"]
                        meta = next((v for v in pet_meta.values() if v.get("id") == pid), {})
                        matched_pets.append((pb, best, meta))
                if matched_pets:
                    pb0, best0, meta0 = matched_pets[0]
                    opts = [m[2].get("slug", str(m[1]["id"])) for m in matched_pets]
                    t["pet"] = {
                        "id": best0["id"],
                        "slug": meta0.get("slug", str(best0["id"])),
                        "name": best0["name"],
                        "options": list(dict.fromkeys(opts)),
                        "confidence": round(max(0.1, 1.0 - best0["mse"] / 12000.0), 3),
                        "mse": round(float(best0["mse"]), 2),
                        "needs_review": best0["mse"] > 5000,
                        "visual_alternatives": [],
                        "bbox": pb0,
                    }
    elif guide_kind == "abex_grid":
        for t in solved_teams:
            t["_ocr_hints"] = {"modes": ["abyssal-expedition"], "targets": ["s18-final-boss"]}
    elif guide_kind == "dragonforge_history":
        for t in solved_teams:
            t["_ocr_hints"] = {"modes": ["dragonforge-trials"], "targets": ["trial-11", "trial-12"]}
    elif H >= 3000 and 2400 <= W < 3400:
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
        _extract_ts_guide_team_notes(img, solved_teams)
    if guide_kind != "hfc":
        _extract_guide_results_and_target_hints(img, solved_teams)
    _resolve_duplicates_and_flag_confidence(solved_teams, hero_meta)
    _detect_sp_hero(img, solved_teams)
    return solved_teams


_OCR_ENGINE_CACHE = False


def _get_ocr_engine():
    global _OCR_ENGINE_CACHE
    if _OCR_ENGINE_CACHE is not False:
        return _OCR_ENGINE_CACHE
    try:
        from rapidocr_onnxruntime import RapidOCR

        _OCR_ENGINE_CACHE = RapidOCR()
    except Exception:
        _OCR_ENGINE_CACHE = None
    return _OCR_ENGINE_CACHE


def _detect_pet_level(img, pet_box):
    """Read an optional numeric pet level badge (1..36) directly beneath a pet icon."""
    if img is None or not pet_box or len(pet_box) != 4:
        return None
    ocr = _get_ocr_engine()
    if ocr is None:
        return None
    H, W = img.shape[:2]
    px, py, pw, ph = pet_box
    y0 = max(0, py + round(ph * 0.72))
    y1 = min(H, py + round(ph * 1.45))
    x0 = max(0, px - 6)
    x1 = min(W, px + pw + 6)
    if y1 - y0 < 10 or x1 - x0 < 10:
        return None
    crop = img[y0:y1, x0:x1]
    crop2 = cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
    try:
        res, _ = ocr(crop2)
    except Exception:
        return None
    for _box, txt, score in (res or []):
        s = (txt or "").strip()
        if re.fullmatch(r"(?:lv\.?\s*)?(\d{1,2})", s, flags=re.IGNORECASE):
            m = re.search(r"(\d{1,2})", s)
            val = int(m.group(1))
            if 1 <= val <= 36 and float(score) >= 0.70:
                return val
    return None


def _format_damage_short(dmg: int) -> str:
    if dmg >= 1_000_000_000:
        return f"{dmg / 1_000_000_000:.2f}B"
    if dmg >= 1_000_000:
        return f"{dmg / 1_000_000:.2f}M"
    return str(dmg)


def _hungarian_min_cost(cost_matrix):
    """Pure-Python O(n^2 m) Kuhn-Munkres assignment for rectangular cost_matrix (n <= m)."""
    n = len(cost_matrix)
    if n == 0:
        return []
    m = len(cost_matrix[0])
    u = [0.0] * (n + 1)
    v = [0.0] * (m + 1)
    p = [0] * (m + 1)
    way = [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [float("inf")] * (m + 1)
        used = [False] * (m + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = float("inf")
            j1 = 0
            row = cost_matrix[i0 - 1]
            for j in range(1, m + 1):
                if not used[j]:
                    cur = row[j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(m + 1):
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
    ans = [-1] * n
    for j in range(1, m + 1):
        if p[j] > 0:
            ans[p[j] - 1] = j - 1
    return ans


_OFFMETA_WATCHLIST = frozenset({"oden", "warek", "talene", "kaz", "tidus"})


def _is_sp_capable_hero(h):
    slug = (h.get("slug") or "").lower()
    name = (h.get("name") or "").lower()
    return (
        slug.startswith("awakened-")
        or slug.startswith("highborn-")
        or "(awakened)" in name
        or "(highborn)" in name
    )


_SP_BADGE_TMPL = False


def _get_sp_badge_template():
    global _SP_BADGE_TMPL
    if _SP_BADGE_TMPL is not False:
        return _SP_BADGE_TMPL
    p = Path(__file__).resolve().parent / "sp-badge-template.png"
    _SP_BADGE_TMPL = cv2.imread(str(p), cv2.IMREAD_COLOR) if p.is_file() else None
    return _SP_BADGE_TMPL


def _detect_sp_hero(img, solved_teams):
    """Detect which Awakened/Highborn hero has the gold SP diamond badge enabled via template matching."""
    if img is None or not solved_teams:
        return
    tmpl = _get_sp_badge_template()
    if tmpl is None:
        return
    H, W = img.shape[:2]

    for t in solved_teams:
        sp_cands = [
            h for h in (t.get("heroes") or [])
            if h.get("id") is not None and h.get("bbox") and len(h["bbox"]) == 4 and _is_sp_capable_hero(h)
        ]
        if not sp_cands:
            continue

        layout = t.get("layout") or ""
        is_hfc = layout == "hfc_cards"
        best_h = None
        best_score = 0.0

        for h in sp_cands:
            bx, by, bw, bh = [int(round(v)) for v in h["bbox"]]
            if bw < 20 or bh < 20:
                continue
            if is_hfc:
                # Rakudayyy HFC places the gold <SP> diamond either centered below the portrait
                # (no-notes cards) OR on the bottom-right corner (cards with notes below).
                rx0 = max(0, bx + round(bw * 0.05))
                rx1 = min(W, bx + round(bw * 1.35))
                ry0 = max(0, by + round(bh * 0.50))
                ry1 = min(H, by + round(bh * 1.85))
                scale_fracs = (0.30, 0.36, 0.42, 0.48, 0.56, 0.64)
            else:
                # Groody, TheAFKGuys, and in-game screenshots place the gold <SP> diamond
                # overlapping the bottom-right corner of the portrait.
                rx0 = max(0, bx + round(bw * 0.48))
                rx1 = min(W, bx + round(bw * 1.38))
                ry0 = max(0, by + round(bh * 0.48))
                ry1 = min(H, by + round(bh * 1.38))
                scale_fracs = (0.26, 0.32, 0.38, 0.46)

            if rx1 - rx0 < 16 or ry1 - ry0 < 16:
                continue
            patch = img[ry0:ry1, rx0:rx1]
            ph, pw = patch.shape[:2]

            tmpl_aspect = tmpl.shape[1] / max(1, tmpl.shape[0])
            max_corr = 0.0
            for frac in scale_fracs:
                th = max(12, round(bh * frac))
                tw = max(12, round(th * tmpl_aspect))
                if th >= ph or tw >= pw:
                    continue
                resized = cv2.resize(tmpl, (tw, th), interpolation=cv2.INTER_AREA)
                yy, xx = np.mgrid[0:th, 0:tw]
                cy, cx = (th - 1) / 2.0, (tw - 1) / 2.0
                dmask = (
                    (np.abs(xx - cx) / max(1.0, cx) + np.abs(yy - cy) / max(1.0, cy)) <= 0.92
                ).astype(np.uint8) * 255
                dmask3 = cv2.merge([dmask, dmask, dmask])
                res = cv2.matchTemplate(patch, resized, cv2.TM_CCOEFF_NORMED, mask=dmask3)
                res = np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)
                _, max_val, _, _ = cv2.minMaxLoc(res)
                if max_val > max_corr:
                    max_corr = float(max_val)

            if max_corr >= 0.58 and max_corr > best_score:
                best_score = max_corr
                best_h = h

        if best_h is not None:
            t["sp_hero_id"] = best_h["id"]
            t["sp_hero_name"] = best_h["name"]


def _resolve_duplicates_and_flag_confidence(solved_teams, hero_meta):
    """Resolve duplicate hero assignments globally per lineup set and flag low-confidence slots."""
    by_set = {}
    for t in solved_teams:
        by_set.setdefault(t.get("set_index", 0), []).append(t)

    for set_teams in by_set.values():
        slots = []
        for t in set_teams:
            for h in t.get("heroes", []):
                if h.get("id") is not None:
                    slots.append(h)

        # 1. Global duplicate-free assignment when any hero appears more than once in the set.
        seen_ids = [h["id"] for h in slots]
        if len(seen_ids) != len(set(seen_ids)) and len(slots) <= 45:
            cand_pool = {}
            slot_cands = []
            for h in slots:
                cands = {}
                cur_mse = float(h.get("mse") if h.get("mse") is not None else 500.0)
                cands[h["id"]] = (cur_mse, h["slug"], h["name"])
                for alt in h.get("visual_alternatives") or []:
                    aid = alt.get("id")
                    amse = alt.get("mse")
                    if aid is not None and amse is not None and float(amse) <= 2600.0:
                        if aid not in cands or float(amse) < cands[aid][0]:
                            cands[aid] = (float(amse), alt.get("slug"), alt.get("name"))
                slot_cands.append(cands)
                for aid in cands:
                    if aid not in cand_pool:
                        cand_pool[aid] = len(cand_pool)

            n_slots = len(slots)
            n_real = len(cand_pool)
            inv_pool = [None] * n_real
            for aid, col in cand_pool.items():
                inv_pool[col] = aid
            # Add n_slots dummy columns (high fallback cost) so infeasible swaps never force garbage.
            n_cols = n_real + n_slots
            BIG = 1e6
            FALLBACK = 3500.0
            cost = [[BIG] * n_cols for _ in range(n_slots)]
            for i, cands in enumerate(slot_cands):
                for aid, (mse_val, _sl, _nm) in cands.items():
                    cost[i][cand_pool[aid]] = mse_val
                cost[i][n_real + i] = FALLBACK

            assignment = _hungarian_min_cost(cost)
            for i, col in enumerate(assignment):
                if 0 <= col < n_real:
                    chosen_id = inv_pool[col]
                    h = slots[i]
                    if chosen_id != h["id"] and chosen_id in slot_cands[i]:
                        new_mse, new_slug, new_name = slot_cands[i][chosen_id]
                        old_entry = {
                            "id": h["id"],
                            "slug": h["slug"],
                            "name": h["name"],
                            "mse": h.get("mse"),
                        }
                        meta = hero_meta.get(chosen_id, {})
                        h["id"] = chosen_id
                        h["slug"] = new_slug or meta.get("slug", h["slug"])
                        h["name"] = new_name or meta.get("name", h["name"])
                        h["mse"] = round(new_mse, 5)
                        alts = [a for a in (h.get("visual_alternatives") or []) if a.get("id") != chosen_id]
                        alts.insert(0, old_entry)
                        h["visual_alternatives"] = alts[:5]
                        h["reassigned_from_duplicate"] = True

        # 2. Flag low-confidence or off-meta-watchlist hero slots for quick review.
        # Note: hero MSE values are on a 0..3000+ pixel-squared scale.
        for h in slots:
            mse = float(h.get("mse") if h.get("mse") is not None else 0.0)
            alts = [a for a in (h.get("visual_alternatives") or []) if a.get("id") != h.get("id")]
            alt_mse = float(alts[0]["mse"]) if (alts and alts[0].get("mse") is not None) else None
            reasons = []
            if mse >= 2200.0:
                reasons.append(f"high visual distance ({mse:.0f})")
            if alt_mse is not None and 0.0 <= (alt_mse - mse) < 25.0 and mse >= 900.0:
                reasons.append(f"close to {alts[0].get('name', 'alt')}")
            if (h.get("slug") or "").lower() in _OFFMETA_WATCHLIST and mse >= 900.0:
                reasons.append("rarely-used hero match — verify portrait")
            if h.get("reassigned_from_duplicate"):
                reasons.append("swapped to avoid duplicate hero across teams")
            if reasons:
                h["low_confidence"] = True
                h["low_confidence_reason"] = "; ".join(reasons)


def _extract_guide_results_and_target_hints(img, solved_teams):
    """OCR header mode/target hints and left-panel NC kill times / CR damage numbers."""
    ocr = _get_ocr_engine()
    if ocr is None or not solved_teams:
        return
    H, W = img.shape[:2]
    hints = {"modes": [], "targets": []}

    # 1. Header mode/target hints
    hdr_h = min(H, 450)
    try:
        hdr_res, _ = ocr(img[:hdr_h, :])
    except Exception:
        hdr_res = None
    if hdr_res:
        hdr_text = " ".join(txt.lower() for _b, txt, _s in hdr_res if txt)
        if "cursed realm" in hdr_text:
            hints["modes"].append("cursed-realm")
        if "nightmare" in hdr_text or "corridor" in hdr_text:
            hints["modes"].append("nightmare-corridor")
        if "scramble" in hdr_text or "debuff" in hdr_text:
            hints["modes"].append("treasure-scramble")
        if (
            "demonic ne" in hdr_text
            or "dark nemora" in hdr_text
            or "demonic entity" in hdr_text
            or "nemora" in hdr_text
            or "nemorr" in hdr_text
            or "shadow fangs" in hdr_text
        ):
            hints["targets"].append("demonic-entity")
            if "nightmare-corridor" not in hints["modes"] and "cursed-realm" not in hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "soulchain" in hdr_text or "conrad" in hdr_text:
            hints["targets"].append("soulchain-knight")
            if "nightmare-corridor" not in hints["modes"]:
                hints["modes"].append("nightmare-corridor")
        if "infernal overlord" in hdr_text:
            hints["targets"].append("infernal-overlord")
            if not hints["modes"]:
                hints["modes"].append("nightmare-corridor")
        if "netherspinner" in hdr_text:
            hints["targets"].append("netherspinner")
            if not hints["modes"]:
                hints["modes"].append("nightmare-corridor")
        if "burning brute" in hdr_text or "brute" in hdr_text:
            hints["targets"].append("burning-brute")
            if not hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "ice shemira" in hdr_text or "shemira" in hdr_text:
            hints["targets"].append("ice-shemira")
            if not hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "grotesque mage" in hdr_text or "idre" in hdr_text:
            hints["targets"].append("grotesque-mage")
            if not hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "dune" in hdr_text:
            hints["targets"].append("dune-destroyer")
            if not hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "swamp" in hdr_text or "swap" in hdr_text or "factionless" in hdr_text or "fog" in hdr_text:
            hints["targets"].append("fog")
        if "forest" in hdr_text:
            hints["targets"].append("forest")
        if "frost" in hdr_text or "blizzard" in hdr_text:
            hints["targets"].append("frost")
        if "fountain" in hdr_text or "pure realm" in hdr_text:
            hints["targets"].append("fountain")
        if "kane" in hdr_text or re.search(r"\bhane\b", hdr_text):
            hints["targets"].append("kane")
            if not hints["modes"]:
                hints["modes"].append("cursed-realm")
        if "fire" in hdr_text or "volcano" in hdr_text:
            hints["targets"].append("fire")

        # Mode-aware target filtering to avoid cross-mode false OCR hits (e.g. Infernal Overlord or Fire in CR)
        mode_valid_targets = {
            "cursed-realm": {"demonic-entity", "burning-brute", "ice-shemira", "kane", "grotesque-mage", "dune-destroyer"},
            "nightmare-corridor": {"soulchain-knight", "infernal-overlord", "netherspinner"},
            "treasure-scramble": {"fire", "frost", "forest", "fog", "fountain"},
        }
        if len(hints["modes"]) == 1 and hints["modes"][0] in mode_valid_targets:
            allowed_t = mode_valid_targets[hints["modes"][0]]
            hints["targets"] = [t for t in hints["targets"] if t in allowed_t]

    for t in solved_teams:
        existing = t.get("_ocr_hints") or {}
        if existing.get("modes") or existing.get("targets"):
            t["_ocr_hints"] = {
                "modes": list(dict.fromkeys([*(existing.get("modes") or []), *hints.get("modes", [])])),
                "targets": list(dict.fromkeys([*(existing.get("targets") or []), *hints.get("targets", [])])),
            }
        else:
            t["_ocr_hints"] = hints

    # 2. Left-side per-round NC kill times & CR damage numbers
    is_tall_dual = H >= 3000 and 2400 <= W < 3400
    is_ts_compact = 740 <= W <= 860 and 1200 <= H <= 2000
    is_multi_nc = W >= 3200 and H >= 4000
    if is_tall_dual:
        team_row_bounds = []
        for t in solved_teams:
            pb = (t.get("pet") or {}).get("bbox")
            if pb and len(pb) == 4:
                row_y, row_h = float(pb[1]), float(pb[3])
            else:
                hbs = [h["bbox"] for h in t.get("heroes", []) if h.get("bbox") and len(h["bbox"]) == 4]
                if not hbs:
                    team_row_bounds.append(None)
                    continue
                row_y = float(np.median([b[1] for b in hbs]))
                row_h = float(np.median([b[3] for b in hbs]))
            x0 = max(0, round(W * 0.285))
            x1 = min(W, round(W * 0.360))
            y0 = max(0, round(row_y) - 18)
            y1 = min(H, round(row_y + row_h) + 18)
            team_row_bounds.append((x0, x1, y0, y1))
            if x1 <= x0 + 10 or y1 <= y0 + 10:
                continue
            crop = img[y0:y1, x0:x1]
            # Stretch tall condensed white numerals horizontally and disable angle classifier
            # so single digits ("6") and narrow pairs ("43") aren't misread or flipped.
            stretched = cv2.resize(crop, (0, 0), fx=1.6, fy=0.8, interpolation=cv2.INTER_CUBIC)
            ocr_candidates = []
            for img_variant in (stretched, crop):
                try:
                    res, _ = ocr(img_variant, use_cls=False)
                except Exception:
                    res = None
                if res:
                    ocr_candidates.append(res)
            parsed = False
            for res in ocr_candidates:
                for _box, txt, _sc in res:
                    clean = txt.strip()
                    m_dmg = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([bBmM])", clean)
                    if m_dmg:
                        val = float(m_dmg.group(1))
                        mult = 1_000_000_000 if m_dmg.group(2).lower() == "b" else 1_000_000
                        dmg = round(val * mult)
                        t["damage"] = dmg
                        t["damage_display"] = _format_damage_short(dmg)
                        parsed = True
                        break
                    m_sec = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)\s*s", clean, re.I)
                    if m_sec:
                        val = float(m_sec.group(1))
                        if 1 <= val <= 120:
                            t["kill_time_seconds"] = val
                            t["kill_time"] = f"{m_sec.group(1)}s"
                            parsed = True
                            break
                    m_num = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)", clean)
                    if m_num:
                        val = float(m_num.group(1))
                        if "cursed-realm" in hints["modes"] and 1 <= val <= 500:
                            dmg = round(val * 1_000_000_000)
                            t["damage"] = dmg
                            t["damage_display"] = _format_damage_short(dmg)
                            parsed = True
                            break
                        if 1 <= val <= 120:
                            t["kill_time_seconds"] = val
                            t["kill_time"] = f"{m_num.group(1)}s"
                            parsed = True
                            break
                if parsed:
                    break

        # Outlier sanity check & multi-scale re-OCR for Mugen CR damage / NC kill time.
        def _reocr_mugen_numbers(bounds):
            bx0, bx1, by0, by1 = bounds
            wx0 = max(0, round(W * 0.270))
            wx1 = min(W, round(W * 0.362))
            c = img[max(0, by0 - 4):min(H, by1 + 4), wx0:wx1]
            if c.size == 0:
                return []
            gray = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
            _, bw = cv2.threshold(gray, 185, 255, cv2.THRESH_BINARY_INV)
            bw3 = cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR)
            variants = [
                c,
                cv2.resize(c, (0, 0), fx=1.4, fy=0.9, interpolation=cv2.INTER_CUBIC),
                cv2.resize(c, (0, 0), fx=1.2, fy=1.0, interpolation=cv2.INTER_CUBIC),
                bw3,
            ]
            nums = []
            for v in variants:
                try:
                    r, _ = ocr(v, use_cls=False)
                except Exception:
                    r = None
                for _b, txt, _sc in (r or []):
                    m = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)[bBsS]?", txt.strip())
                    if m:
                        nums.append(float(m.group(1)))
            return nums

        cr_dmgs = [t["damage"] for t in solved_teams if isinstance(t.get("damage"), (int, float))]
        if len(cr_dmgs) >= 3:
            med_b = float(np.median(cr_dmgs)) / 1_000_000_000.0
            for idx, t in enumerate(solved_teams):
                d = t.get("damage")
                if not isinstance(d, (int, float)):
                    continue
                db = d / 1_000_000_000.0
                if db < med_b * 0.45 or db > med_b * 2.2:
                    bounds = team_row_bounds[idx] if idx < len(team_row_bounds) else None
                    cands = [v for v in (_reocr_mugen_numbers(bounds) if bounds else []) if med_b * 0.45 <= v <= med_b * 2.0]
                    if cands:
                        best_b = min(cands, key=lambda v: abs(v - med_b))
                        dmg = round(best_b * 1_000_000_000)
                        t["damage"] = dmg
                        t["damage_display"] = _format_damage_short(dmg)
                    else:
                        t["result_warning"] = f"Outlier CR damage ({t['damage_display']} vs median {med_b:.1f}B)"

        nc_times = [t["kill_time_seconds"] for t in solved_teams if isinstance(t.get("kill_time_seconds"), (int, float))]
        if len(nc_times) >= 3:
            med_s = float(np.median(nc_times))
            for idx, t in enumerate(solved_teams):
                ts = t.get("kill_time_seconds")
                if not isinstance(ts, (int, float)):
                    continue
                if ts < 4.0 or ts > max(22.0, med_s * 2.1):
                    bounds = team_row_bounds[idx] if idx < len(team_row_bounds) else None
                    cands = [v for v in (_reocr_mugen_numbers(bounds) if bounds else []) if 4.0 <= v <= max(22.0, med_s * 1.9)]
                    if cands:
                        best_s = min(cands, key=lambda v: abs(v - med_s))
                        t["kill_time_seconds"] = best_s
                        t["kill_time"] = f"{int(best_s) if best_s == int(best_s) else best_s}s"
                    else:
                        t["result_warning"] = f"Outlier NC kill time ({t['kill_time']} vs median {med_s:.1f}s)"

        # Also extract per-row CR damage / NC kill time for Mugen substitute rows on the left panel.
        for t in solved_teams:
            for sub in t.get("substitute_teams") or []:
                sb = sub.get("bbox")
                if not sb or len(sb) != 4:
                    continue
                sx0 = max(0, round(W * 0.285))
                sx1 = min(W, round(W * 0.360))
                sy0 = max(0, round(sb[1]) - 14)
                sy1 = min(H, round(sb[1] + sb[3]) + 14)
                if sx1 <= sx0 + 10 or sy1 <= sy0 + 10:
                    continue
                scrop = img[sy0:sy1, sx0:sx1]
                sstretch = cv2.resize(scrop, (0, 0), fx=1.6, fy=0.8, interpolation=cv2.INTER_CUBIC)
                for variant in (sstretch, scrop):
                    try:
                        sres, _ = ocr(variant, use_cls=False)
                    except Exception:
                        sres = None
                    matched_sub = False
                    for _b, txt, _sc in (sres or []):
                        clean = txt.strip()
                        m_dmg = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([bBmM])", clean)
                        if m_dmg:
                            val = float(m_dmg.group(1))
                            dmg = round(val * (1_000_000_000 if m_dmg.group(2).lower() == "b" else 1_000_000))
                            sub["damage"] = dmg
                            sub["damage_display"] = _format_damage_short(dmg)
                            matched_sub = True
                            break
                        m_sec = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)\s*s", clean, re.I)
                        if m_sec:
                            val = float(m_sec.group(1))
                            if 1 <= val <= 120:
                                sub["kill_time_seconds"] = val
                                sub["kill_time"] = f"{m_sec.group(1)}s"
                                matched_sub = True
                                break
                        m_num = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)", clean)
                        if m_num:
                            val = float(m_num.group(1))
                            if "cursed-realm" in hints["modes"] and 1 <= val <= 500:
                                dmg = round(val * 1_000_000_000)
                                sub["damage"] = dmg
                                sub["damage_display"] = _format_damage_short(dmg)
                                matched_sub = True
                                break
                            if 1 <= val <= 120:
                                sub["kill_time_seconds"] = val
                                sub["kill_time"] = f"{m_num.group(1)}s"
                                matched_sub = True
                                break
                    if matched_sub:
                        break
        return
    if is_multi_nc:
        # Groody multi-column CR/NC guides show "Damage: 48b" or "Time: 13.6s"
        # inside the notes box footer directly below each team's hero + pet row.
        for t in solved_teams:
            hbs = [h["bbox"] for h in t.get("heroes", []) if h.get("bbox") and len(h["bbox"]) == 4]
            if not hbs:
                continue
            hy = float(np.median([b[1] for b in hbs]))
            hw = float(np.median([b[2] for b in hbs]))
            hx0 = min(b[0] for b in hbs)
            pb = (t.get("pet") or {}).get("bbox")
            right_x = (pb[0] + pb[2]) if (pb and len(pb) == 4) else (max(b[0] + b[2] for b in hbs) + round(hw * 1.4))
            x0 = max(0, round(hx0) - 30)
            x1 = min(W, round(right_x) + 40)
            y0 = max(0, round(hy + hw * 2.80))
            y1 = min(H, round(hy + hw * 5.30))
            if x1 <= x0 + 20 or y1 <= y0 + 20:
                continue
            try:
                res, _ = ocr(img[y0:y1, x0:x1], use_cls=False)
            except Exception:
                continue
            if not res:
                continue
            items = [
                (sum(p[1] for p in b) / 4.0, sum(p[0] for p in b) / 4.0, txt.strip())
                for b, txt, _s in res
                if txt and txt.strip()
            ]
            # Match "Damage:" or "Time:" either inline or paired with the value box on the same row.
            found = False
            for ly, lx, ltxt in items:
                m_inline_dmg = re.search(r"damage\s*:?\s*(\d+(?:\.\d+)?)\s*([bBmM])?\b", ltxt, re.I)
                if m_inline_dmg:
                    val = float(m_inline_dmg.group(1))
                    unit = (m_inline_dmg.group(2) or "b").lower()
                    dmg = round(val * (1_000_000_000 if unit == "b" else 1_000_000))
                    t["damage"] = dmg
                    t["damage_display"] = _format_damage_short(dmg)
                    found = True
                    break
                if re.search(r"\bdamage\b", ltxt, re.I):
                    same_row = sorted(
                        ((vx, vtxt) for vy, vx, vtxt in items if vx > lx and abs(vy - ly) <= 28),
                        key=lambda p: p[0],
                    )
                    for _vx, vtxt in same_row:
                        m_val = re.search(r"(\d+(?:\.\d+)?)\s*([bBmM])?\b", vtxt, re.I)
                        if m_val:
                            val = float(m_val.group(1))
                            unit = (m_val.group(2) or "b").lower()
                            dmg = round(val * (1_000_000_000 if unit == "b" else 1_000_000))
                            t["damage"] = dmg
                            t["damage_display"] = _format_damage_short(dmg)
                            found = True
                            break
                    if found:
                        break
                m_inline_time = re.search(r"time\s*:?\s*(\d{1,3}(?:\.\d+)?)\s*s?\b", ltxt, re.I)
                if m_inline_time:
                    val = float(m_inline_time.group(1))
                    if 1 <= val <= 120:
                        t["kill_time_seconds"] = val
                        t["kill_time"] = f"{m_inline_time.group(1)}s"
                        found = True
                        break
                if re.search(r"\btime\b", ltxt, re.I):
                    same_row = sorted(
                        ((vx, vtxt) for vy, vx, vtxt in items if vx > lx and abs(vy - ly) <= 28),
                        key=lambda p: p[0],
                    )
                    for _vx, vtxt in same_row:
                        m_val = re.search(r"(\d{1,3}(?:\.\d+)?)\s*s?\b", vtxt, re.I)
                        if m_val:
                            val = float(m_val.group(1))
                            if 1 <= val <= 120:
                                t["kill_time_seconds"] = val
                                t["kill_time"] = f"{m_val.group(1)}s"
                                found = True
                                break
                    if found:
                        break
        return
    if is_ts_compact:
        return

    left_w = min(W, int(W * 0.44))
    try:
        left_res, _ = ocr(img[:, :left_w])
    except Exception:
        left_res = None
    if not left_res:
        return

    team_hys = []
    for t in solved_teams:
        ys = [h["bbox"][1] for h in t.get("heroes", []) if h.get("bbox")]
        team_hys.append(float(np.median(ys)) if ys else None)

    sorted_hys = sorted(h for h in team_hys if h is not None)
    for idx, t in enumerate(solved_teams):
        hy = team_hys[idx]
        if hy is None:
            continue
        prev_hy = max((h for h in sorted_hys if h < hy - 20), default=None)
        next_hy = min((h for h in sorted_hys if h > hy + 20), default=None)
        y0 = max(0, round((prev_hy + hy) / 2) - 60 if prev_hy is not None else round(hy - 280))
        y1 = min(H, round((hy + next_hy) / 2) - 60 if next_hy is not None else round(hy + 420))

        band_texts = []
        for box, txt, _sc in left_res:
            ymid = sum(p[1] for p in box) / 4.0
            if y0 <= ymid <= y1 and txt:
                band_texts.append((ymid, txt.strip()))
        band_texts.sort(key=lambda item: item[0])

        actual_time = None
        goal_time = None
        actual_dmg = None
        goal_dmg = None

        for _ymid, txt in band_texts:
            m_killed = re.search(r"kil+ed\s*\d*\s*boss(?:es)?\s*within\s*(\d+(?:[.:]\d+)?)\s*s", txt, re.I)
            if m_killed and actual_time is None:
                actual_time = m_killed.group(1).replace(":", ".")
                continue
            m_peak_s = re.search(r"peak[:\s]*(\d+(?:[.:]\d+)?)\s*s\b", txt, re.I)
            if m_peak_s and goal_time is None:
                goal_time = m_peak_s.group(1).replace(":", ".")
                continue
            m_goal_s = re.search(r"goal[:\s]*(\d+(?:[.:]\d+)?)\s*s\b", txt, re.I)
            if m_goal_s and goal_time is None:
                goal_time = m_goal_s.group(1).replace(":", ".")
                continue
            m_squad = re.search(r"squad\s*damage[:\s]*([\d,]+)", txt, re.I)
            if m_squad and actual_dmg is None:
                digits = m_squad.group(1).replace(",", "")
                if digits.isdigit():
                    actual_dmg = int(digits)
                continue
            m_goal_dmg = re.search(r"goal[:\s]*(\d+(?:\.\d+)?)\s*([bBmMkK])\b", txt, re.I)
            if m_goal_dmg and goal_dmg is None:
                val = float(m_goal_dmg.group(1))
                unit = m_goal_dmg.group(2).lower()
                mult = 1_000_000_000 if unit == "b" else (1_000_000 if unit == "m" else 1_000)
                goal_dmg = round(val * mult)

        chosen_time = actual_time or goal_time
        if chosen_time is not None:
            t["kill_time_seconds"] = float(chosen_time)
            t["kill_time"] = f"{chosen_time}s"
        chosen_dmg = actual_dmg or goal_dmg
        if chosen_dmg is not None:
            t["damage"] = chosen_dmg
            t["damage_display"] = _format_damage_short(chosen_dmg)


def _extract_ts_guide_team_notes(img, solved_teams):
    """OCR the right-side 'Notes / Tips' box for each team in tall guides."""
    ocr = _get_ocr_engine()
    if ocr is None or not solved_teams:
        return
    H, W = img.shape[:2]
    x0, x1 = round(W * 0.76), W - 10
    team_hys = []
    for t in solved_teams:
        ys = [h["bbox"][1] for h in t.get("heroes", []) if h.get("bbox")]
        team_hys.append(float(np.median(ys)) if ys else None)

    for idx, t in enumerate(solved_teams):
        hy = team_hys[idx]
        if hy is None:
            continue
        next_hy = next((h for h in team_hys[idx + 1 :] if h is not None), None)
        y0 = max(0, round(hy - 280))
        y1 = min(H, round(next_hy - 180) if next_hy is not None else round(hy + 700))
        if y1 <= y0 + 40:
            continue
        roi = img[y0:y1, x0:x1]
        if roi.size == 0:
            continue
        try:
            res, _ = ocr(roi)
        except Exception:
            continue
        if not res:
            continue
        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        raw_items = []
        for box, txt, _sc in res:
            bxs = [p[0] for p in box]
            bys = [p[1] for p in box]
            raw_items.append((min(bys), max(bys), min(bxs), txt.strip()))
        raw_items.sort()
        # Group same-line OCR fragments and sort each line left-to-right by xmin
        lines = []
        for ymin, ymax, xmin, txt in raw_items:
            if not txt:
                continue
            if lines and abs(ymin - lines[-1]["ymin"]) <= 12:
                lines[-1]["parts"].append((xmin, txt))
                lines[-1]["ymin"] = min(lines[-1]["ymin"], ymin)
                lines[-1]["ymax"] = max(lines[-1]["ymax"], ymax)
                lines[-1]["xmin"] = min(lines[-1]["xmin"], xmin)
            else:
                lines.append({"ymin": ymin, "ymax": ymax, "xmin": xmin, "parts": [(xmin, txt)]})
        items = [
            (
                ln["ymin"],
                ln["ymax"],
                ln["xmin"],
                " ".join(t for _x, t in sorted(ln["parts"], key=lambda p: p[0])),
            )
            for ln in lines
        ]
        y_start, y_end = None, 1e9
        for ymin, ymax, _xmin, txt in items:
            low = txt.lower()
            is_header = (
                "tips" in low
                or "invest" in low
                or low in ("notes", "notes:")
            )
            if is_header:
                if y_start is None or ymin - y_start < 120:
                    y_start = ymax
                else:
                    y_end = min(y_end, ymin)
            elif y_start is not None and (
                "appearances" in low
                or "total" in low
                or (ymin > y_start + 60 and (ymax - ymin) >= 48)
            ):
                y_end = min(y_end, ymin)
        if y_start is None:
            continue
        body = [
            (ymin, ymax, xmin, txt)
            for ymin, ymax, xmin, txt in items
            if ymin > y_start and ymax < y_end and txt
        ]
        if not body:
            continue
        bullets = []
        for ymin, ymax, xmin, txt in body:
            clean_txt = txt.lstrip("•·- ").strip() if txt[:1] in ("•", "·", "-") else txt
            if not clean_txt:
                continue
            if not bullets:
                bullets.append([ymin, ymax, clean_txt])
                continue
            if abs(ymin - bullets[-1][0]) <= 12:
                bullets[-1][1] = max(bullets[-1][1], ymax)
                bullets[-1][2] += " " + clean_txt
                continue
            dot_strip = roi_gray[
                max(0, round(ymin)) : min(roi_gray.shape[0], round(ymax)),
                max(0, round(xmin - 30)) : max(0, round(xmin - 3)),
            ]
            has_dot = (
                txt[:1] in ("•", "·")
                or (dot_strip.size > 0 and int(np.sum(dot_strip > 170)) >= 4)
            )
            if has_dot or (ymin - bullets[-1][1]) >= 20:
                bullets.append([ymin, ymax, clean_txt])
            else:
                bullets[-1][1] = max(bullets[-1][1], ymax)
                bullets[-1][2] += " " + clean_txt
        t["notes"] = "\n".join("• " + b[2] for b in bullets)


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


def _resolve_image_path(repo_root: Path, name: str) -> Path:
    raw = Path(name)
    if raw.is_file():
        return raw.resolve()
    for base in [
        repo_root,
        repo_root / "tools" / "image-recognition" / "sample-images",
        repo_root / "tools" / "image-recognition" / "pilot-images",
    ]:
        p = (base / name).resolve()
        if p.is_file():
            return p
        p_name = (base / raw.name).resolve()
        if p_name.is_file():
            return p_name
    return (repo_root / "tools" / "image-recognition" / "sample-images" / raw.name).resolve()


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
    p_app = _resolve_image_path(repo_root, "afk-nightmare-corridor-infernal-overlord-9.png")
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
    p_lyd = _resolve_image_path(repo_root, "nc-mugen-2026-10-infernal-overlord.png")
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
    p_f2p = _resolve_image_path(repo_root, "nc-mcwhare-f2p-3round-staggered.webp")
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
        default=_resolve_image_path(repo_root, "afk-nightmare-corridor-infernal-overlord-9.png"),
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

    known_image_path = _resolve_image_path(repo_root, "afk-nightmare-corridor-infernal-overlord-9.png")
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
