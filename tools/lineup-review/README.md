# Batch Lineup Review Tool

Lightweight local HTML reviewer for auditing recognized Reddit guide lineups side-by-side with cropped team screenshots.

## Usage

1. Build a review bundle from any recognized JSONL file and start the local server:

```bash
# Review only flagged (low-confidence / warning) teams:
python3 tools/lineup-review/build-review-bundle.py \
  --jsonl path/to/recognized.jsonl \
  --images-dir path/to/downloaded-images \
  --flagged-only \
  --serve --port 8766

# Or review every team:
python3 tools/lineup-review/build-review-bundle.py \
  --jsonl path/to/recognized.jsonl \
  --images-dir path/to/downloaded-images \
  --serve --port 8766
```

2. Open `http://127.0.0.1:8766` in your browser.
3. Mark each card as **Real / Correct** or **False / Needs Fix** (with optional notes), then click **Export JSON** to save your corrections.

> Generated `data.json` and `crops/` are gitignored so temporary review bundles stay out of version control.
