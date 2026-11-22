#!/usr/bin/env python3
"""Save a cropped hero or chibi pet box into hero-extra-templates/ or pet-chibi-templates/."""
import argparse
import re
from pathlib import Path
import cv2

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = (REPO_ROOT / "schema.sql").read_text(encoding="utf-8")


def resolve_id(kind: str, query: str):
    q = query.strip().lower()
    for m in re.finditer(r"\((\d+),\s*'([^']+)',\s*'([^']+)',", SCHEMA):
        uid, slug, name = int(m.group(1)), m.group(2), m.group(3)
        if kind == "hero" and uid >= 6000:
            continue
        if kind == "pet" and uid < 6000:
            continue
        if q in (slug.lower(), name.lower()):
            return uid, slug, name
    raise SystemExit(f"Could not find {kind} matching {query!r} in schema.sql")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=("hero", "pet"), required=True)
    ap.add_argument("--name", required=True, help="Hero or pet name/slug from schema.sql")
    ap.add_argument("--image", required=True, help="Path to guide image")
    ap.add_argument("--bbox", required=True, help="x,y,w,h")
    ap.add_argument("--suffix", default="", help="Optional suffix (e.g. _2)")
    args = ap.parse_args()

    uid, slug, name = resolve_id(args.kind, args.name)
    x, y, w, h = [int(v) for v in args.bbox.split(",")]
    im = cv2.imread(args.image)
    if im is None:
        raise SystemExit(f"Could not read {args.image}")
    crop = im[max(0, y) : y + h, max(0, x) : x + w]
    out_dir = Path(__file__).resolve().parent / (
        "hero-extra-templates" if args.kind == "hero" else "pet-chibi-templates"
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{uid}_{slug}{args.suffix}.png"
    cv2.imwrite(str(out_path), crop)
    print(f"Saved {name} ({uid}) template to {out_path}")


if __name__ == "__main__":
    main()
