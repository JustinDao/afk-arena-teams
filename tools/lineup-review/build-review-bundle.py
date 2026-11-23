#!/usr/bin/env python3
"""Build a local HTML review bundle (`data.json` + `crops/`) from a recognized JSONL file.

Usage:
  # Review only flagged (low-confidence / result-warning / pet-warning) teams:
  python tools/lineup-review/build-review-bundle.py \\
    --jsonl path/to/recognized.jsonl --images-dir path/to/images --flagged-only --serve

  # Review all teams:
  python tools/lineup-review/build-review-bundle.py \\
    --jsonl path/to/recognized.jsonl --images-dir path/to/images --serve --port 8766
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
from pathlib import Path

import cv2

TOOL_DIR = Path(__file__).resolve().parent


def build_bundle(jsonl_path: Path, images_dir: Path, flagged_only: bool) -> int:
    crops_dir = TOOL_DIR / "crops"
    if crops_dir.exists():
        shutil.rmtree(crops_dir)
    crops_dir.mkdir(parents=True, exist_ok=True)

    img_map = {}
    for p in images_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            img_map[p.name] = p

    items = []
    with jsonl_path.open("r", encoding="utf-8") as fh:
        for g_idx, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            guide = rec.get("guide") or {}
            recognition = rec.get("recognition") or {}
            sets = (
                recognition["lineup_sets"]
                if isinstance(recognition.get("lineup_sets"), list) and recognition["lineup_sets"]
                else [{"index": 0, "label": "Primary", "teams": recognition.get("teams") or []}]
            )
            guide_imgs = guide.get("images") or []
            img_cache = {}

            for s_idx, lset in enumerate(sets):
                for t_idx, team in enumerate(lset.get("teams") or []):
                    heroes = team.get("heroes") or []
                    sus_heroes = [h["name"] for h in heroes if h.get("low_confidence") or h.get("needs_review")]
                    has_flag = bool(sus_heroes or team.get("result_warning") or team.get("pet_warning"))
                    if flagged_only and not has_flag:
                        continue

                    ii = team.get("image_index", 0)
                    img_url = guide_imgs[ii] if ii < len(guide_imgs) else (guide_imgs[0] if guide_imgs else "")
                    bn = os.path.basename(str(img_url).split("?")[0])
                    ip = img_map.get(bn)
                    if not ip:
                        continue

                    if ip not in img_cache:
                        img_cache[ip] = cv2.imread(str(ip))
                    img = img_cache[ip]
                    if img is None:
                        continue

                    H, W = img.shape[:2]
                    hbs = [h["bbox"] for h in heroes if h.get("bbox") and len(h["bbox"]) == 4]
                    if hbs:
                        avg_hw = sum(b[2] for b in hbs) / len(hbs)
                        pb = (team.get("pet") or {}).get("bbox")
                        right_edge = max(b[0] + b[2] for b in hbs)
                        if pb and len(pb) == 4:
                            right_edge = max(right_edge, pb[0] + pb[2] + 40)
                        else:
                            right_edge += max(260, round(avg_hw * 1.8))
                        x0 = max(0, min(b[0] for b in hbs) - 40)
                        y0 = max(0, min(b[1] for b in hbs) - max(60, round(avg_hw * 0.30)))
                        x1 = min(W, right_edge)
                        y1 = min(H, max(b[1] + b[3] for b in hbs) + max(120, round(avg_hw * 0.80)))
                    else:
                        x0, y0, x1, y1 = 0, 0, W, min(H, 600)

                    item_id = f"rev_{g_idx}_{s_idx}_{t_idx}"
                    crop_rel = f"crops/{item_id}.jpg"
                    cv2.imwrite(str(TOOL_DIR / crop_rel), img[y0:y1, x0:x1], [int(cv2.IMWRITE_JPEG_QUALITY), 88])

                    sp_hero_id = team.get("sp_hero_id")
                    hero_entries = []
                    for h in heroes:
                        alts = [a.get("name") for a in (h.get("visual_alternatives") or []) if a.get("name")]
                        top3 = [h.get("name")] + [a for a in alts if a != h.get("name")][:2]
                        hero_entries.append({
                            "name": h.get("name", "Unknown"),
                            "sus": bool(h.get("low_confidence") or h.get("needs_review")),
                            "sp": bool(sp_hero_id is not None and h.get("id") == sp_hero_id),
                            "mse": round(float(h["mse"])) if h.get("mse") is not None else None,
                            "confidence": round(float(h.get("confidence") or 0.0), 2),
                            "top3": top3,
                        })

                    pet = team.get("pet") or {}
                    pet_entry = {
                        "name": pet.get("name"),
                        "options": pet.get("options") or ([pet.get("slug")] if pet.get("slug") else []),
                        "confidence": round(float(pet.get("confidence") or 0.0), 2),
                    } if pet.get("name") else None

                    items.append({
                        "id": item_id,
                        "crop": crop_rel,
                        "author": guide.get("author", ""),
                        "date": str(guide.get("date", ""))[:10],
                        "title": guide.get("title", ""),
                        "post_url": guide.get("post_url", ""),
                        "mode": rec.get("resolved_mode") or (recognition.get("best_mode") or {}).get("mode_slug", ""),
                        "target": rec.get("resolved_target") or (recognition.get("best_mode") or {}).get("target_name", ""),
                        "set_label": lset.get("label", "Primary"),
                        "team_num": t_idx + 1,
                        "sus_heroes": sus_heroes,
                        "reprocessed": True,
                        "pet": pet_entry,
                        "sp_hero": team.get("sp_hero_name"),
                        "damage": team.get("damage_display"),
                        "heroes": hero_entries,
                    })

    (TOOL_DIR / "data.json").write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} review items -> {TOOL_DIR / 'data.json'}")
    return len(items)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and optionally serve the batch lineup review UI.")
    parser.add_argument("--jsonl", type=Path, required=True, help="Path to recognized JSONL file.")
    parser.add_argument("--images-dir", type=Path, required=True, help="Directory containing downloaded guide images.")
    parser.add_argument("--flagged-only", action="store_true", help="Include only teams with low-confidence heroes or warnings.")
    parser.add_argument("--serve", action="store_true", help="Serve the review UI locally after building.")
    parser.add_argument("--port", type=int, default=8766, help="Local HTTP server port (default: 8766).")
    args = parser.parse_args()

    build_bundle(args.jsonl.expanduser().resolve(), args.images_dir.expanduser().resolve(), args.flagged_only)

    if args.serve:
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(TOOL_DIR))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
        print(f"Lineup Reviewer listening on http://127.0.0.1:{args.port}")
        server.serve_forever()


if __name__ == "__main__":
    main()
