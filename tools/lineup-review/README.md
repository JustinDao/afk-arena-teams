# Batch Lineup Review Tool (`tools/lineup-review`)

A lightweight local web UI for reviewing recognized AFK Arena guide lineups side-by-side against cropped team screenshots before (or after) importing them into Supabase.

---

## Quick Start

1. Build a review bundle (`data.json` + `crops/`) from a recognized JSONL file and start the local server:

```bash
# Review only flagged teams (low-confidence heroes, pet warnings, or result outliers):
python3 tools/lineup-review/build-review-bundle.py \
  --jsonl path/to/recognized.jsonl \
  --images-dir path/to/downloaded-images \
  --flagged-only \
  --serve --port 8766

# Or review every recognized team:
python3 tools/lineup-review/build-review-bundle.py \
  --jsonl path/to/recognized.jsonl \
  --images-dir path/to/downloaded-images \
  --serve --port 8766
```

2. Open `http://127.0.0.1:8766` in a browser.
3. For each card, click **Real / Correct** or **False / Needs Fix**, optionally enter slot corrections in the note box (e.g. `1 is Begris, 4 is Athena`), and click **Export JSON** to copy/download the review results.

> Generated `tools/lineup-review/crops/` and `tools/lineup-review/data.json` are gitignored so temporary review artifacts are never committed.

---

## Agent & Pipeline Usage

### 1. Input JSONL format (`--jsonl`)
Each line is a JSON object produced by running `api/recognize-lineup.py` (`recognize_multiple_images`) on a guide:

```json
{
  "guide": {
    "title": "P2W - 1k dias retries enjoyers' Weekly CR",
    "author": "u/mcwhare35",
    "date": "2026-11-16T06:40:29Z",
    "post_url": "https://www.reddit.com/r/afkarena/comments/...",
    "images": ["https://i.redd.it/example.png"]
  },
  "resolved_mode": "cursed-realm",
  "resolved_target": "Kane",
  "recognition": {
    "teams": [ ... ],
    "lineup_sets": [ ... ]
  }
}
```

- `--images-dir` is searched recursively by image filename (`os.path.basename(url)`).
- With `--flagged-only`, `build-review-bundle.py` includes any team where at least one hero has `low_confidence` / `needs_review` or the team has `pet_warning` / `result_warning`.

### 2. `data.json` schema (if generating directly)
`index.html` loads `./data.json` as an array of review cards:

```json
[
  {
    "id": "rev_0_0_1",
    "crop": "crops/rev_0_0_1.jpg",
    "author": "u/mcwhare35",
    "date": "2026-11-16",
    "title": "P2W - 1k dias retries enjoyers' Weekly NC",
    "post_url": "https://www.reddit.com/r/afkarena/comments/...",
    "mode": "nightmare-corridor",
    "target": "Infernal Overlord",
    "set_label": "Primary",
    "team_num": 2,
    "sus_heroes": ["Oden"],
    "reprocessed": true,
    "heroes": [
      {
        "name": "Oden",
        "sus": true,
        "mse": 2410,
        "confidence": 0.35,
        "top3": ["Oden", "Begris", "Ferael"]
      }
    ]
  }
]
```

### 3. Applying Exported Feedback
The exported JSON array contains each reviewed item's `id`, `post_url`, `set_label`, `team_num`, `status` (`"real"` or `"false"`), and `note`.

When the user pastes back exported corrections:
1. Patch the affected team/slots in the recognized JSONL or Supabase `formation_heroes`.
2. For any misread hero portrait (new skin or newly released hero), save the cropped portrait into `tools/image-recognition/extra-hero-templates/` using `tools/image-recognition/save-extra-template.py` (or `tools/image-recognition/add-hero.py` for brand-new heroes) so future scrapes recognize it automatically.
3. Re-run `tools/image-recognition/verify-reviewed-golden.py` to confirm no regressions.
