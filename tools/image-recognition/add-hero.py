#!/usr/bin/env python3
"""One-command new-hero onboarding helper.

Adds a newly released AFK Arena hero's portrait template into
`tools/image-recognition/extra-hero-templates/` (so image recognition matches
it immediately) and optionally upserts the hero row into Supabase `heroes`.

Example:
  python tools/image-recognition/add-hero.py \\
    --id 261 --name "New Hero" --slug new-hero \\
    --faction lightbearer --class mage --type intelligence \\
    --portrait /path/to/portrait.png --supabase
"""

from __future__ import annotations

import argparse
import json
import subprocess
import urllib.request
from pathlib import Path

import cv2

LAB_DIR = Path(__file__).resolve().parent
EXTRA_DIR = LAB_DIR / "extra-hero-templates"
SUPABASE_URL = "https://leqttkaxdsjyjsmeiqaw.supabase.co"


def get_service_key() -> str:
    out = subprocess.check_output(
        ["supabase", "projects", "api-keys", "--project-ref", "leqttkaxdsjyjsmeiqaw"],
        text=True,
    )
    for line in out.splitlines():
        if line.strip().startswith("{"):
            keys = json.loads(line)["keys"]
            return next(k["api_key"] for k in keys if k["id"] == "service_role")
    raise RuntimeError("Could not find Supabase service_role key via CLI.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Onboard a newly released AFK Arena hero.")
    parser.add_argument("--id", type=int, required=True, help="Numeric hero ID (e.g. 261)")
    parser.add_argument("--name", required=True, help="Display name (e.g. 'Brenna (Highborn)')")
    parser.add_argument("--slug", required=True, help="Slug (e.g. 'highborn-brenna')")
    parser.add_argument("--portrait", type=Path, required=True, help="Path to portrait PNG/JPG")
    parser.add_argument("--faction", default=None, help="Faction (e.g. lightbearer, celestial, draconis)")
    parser.add_argument("--hero-class", dest="hero_class", default=None, help="Class (e.g. mage, warrior, tank, ranger, support)")
    parser.add_argument("--hero-type", dest="hero_type", default=None, help="Attribute (strength, agility, intelligence)")
    parser.add_argument("--awakened", action="store_true", help="Mark as Awakened hero")
    parser.add_argument("--rec-category", default=None, help="Recommendation category (standard-4f, cele-hypo, awakened, drago-lite, dragon-highborn)")
    parser.add_argument("--supabase", action="store_true", help="Also upsert hero row into Supabase `heroes`")
    args = parser.parse_args()

    img = cv2.imread(str(args.portrait.expanduser().resolve()), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not read portrait image: {args.portrait}")

    EXTRA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EXTRA_DIR / f"{args.id}_{args.slug}.png"
    cv2.imwrite(str(out_path), img)
    print(f"Saved portrait template -> {out_path}")

    if args.supabase:
        sr = get_service_key()
        row = {
            "id": args.id,
            "name": args.name,
            "is_awakened": bool(args.awakened),
        }
        if args.faction:
            row["faction"] = args.faction
        if args.hero_class:
            row["class"] = args.hero_class
        if args.hero_type:
            row["type"] = args.hero_type
        if args.rec_category:
            row["rec_category"] = args.rec_category
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/heroes",
            data=json.dumps([row]).encode("utf-8"),
            headers={
                "apikey": sr,
                "Authorization": f"Bearer {sr}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            print("Upserted hero in Supabase:", resp.read().decode("utf-8"))


if __name__ == "__main__":
    main()
