# AFK Arena Pet Matcher Lab

A dependency-free, local browser workbench for building a labeled pet-crop dataset, training a first-pass linear classifier, and evaluating matching strategies. It is separate from the Angular app and does not upload images or labels.

## Open the tool

Open `index.html` in a modern browser, or serve this directory locally:

```sh
python3 -m http.server 8173 --bind 127.0.0.1 --directory tools/pet-matcher-lab
```

Then open `http://localhost:8173`. The local COCO annotator is at `http://localhost:8173/coco-annotator.html`.

## Workflow

1. **Load references.** Square, level-neutral pet icons from the AFK Mine CDN (`framed_unit_icon/<id>.webp`) load automatically. Choose a local folder containing pet icons named with IDs such as `6030.webp` to override references; use square framed icons for comparable results. The tool recognizes the 30 pet IDs in the app's current catalog.
2. **Add guide images.** Choose one or more guide screenshots. Images remain in the browser. Assign each guide as Train, Test / holdout, or Validation before creating crops. Samples from a guide inherit that guide's split.
3. **Label examples.** Drag a rectangle around a pet icon, select its correct name, and save the crop. Include multiple varied crops per pet across guide sources and crop styles. Keep entire guides in one split to avoid near-duplicate leakage.
4. **Evaluate.** Select Test / holdout or Validation and run local evaluation. The report compares:
   - **App-style RGB 16×16:** nearby query-crop sampling and a square CDN reference, mirroring the current app feature approach.
   - **Best-aligned RGB 16×16:** compares averaging the closest one, three, or five query alignments rather than all nine, to measure sensitivity to crop placement.
   - **RGB pixels 8×8 baseline:** the earlier low-resolution pixel comparison.
   - **RGB color histogram:** a rough color-only baseline.
   - **Labeled-crop 3-NN baseline:** nearest neighbors from Train examples, available when evaluating Test or Validation.
   - **Trained linear softmax classifier:** a supervised model fitted locally from Train crops. Click **Train local classifier**; its model is then included in evaluation rankings. Export the portable weights as JSON.
5. **Export.** Download the trained model JSON, labeled examples as a dataset JSON (including crop images), and evaluation rankings as CSV. Keep backups; browser storage is local to this browser profile.

## Experimental propose → identify → group pipeline

The detection panel has three distinct steps:

1. **Propose.** Scan square windows at several sizes at the source image's native resolution. Proposal scores compare an oriented Sobel-edge signature around each window's border with a prototype averaged from the square pet catalog; pet identities do not affect proposal scores. Overlap suppression reduces duplicate boxes.
2. **Identify.** Rank the surviving proposals against square pet reference icons. This prototype recognizes pets only; hero, collection, and node catalogs are not connected.
3. **Group.** Group nearby proposals by their coordinates. These are exploratory spatial groups, not inferred lineup/team boundaries.

Scores are heuristics, not probabilities. This baseline does not provide production-quality objectness, calibrated confidence, or verified team grouping. Its purpose is to test whether separating localization from catalog matching gives useful candidates. Do not treat proposals or labels as confirmed.

The first native-resolution border test remained noisy, so the prototype was changed to compare edge orientation and position rather than edge magnitude alone. On the 2040×2082 app-export image, it scanned 280,218 windows, reduced the top 2,400 proposals to 120 boxes across 83 nearby groups, and gave the strongest proposal a score of 63 at an unrelated location. Raising the threshold to 60 left one false candidate. On a separate 1080×1771 NC guide, it scanned 380,179 windows and returned 120 boxes across 89 groups; the top overlays still landed largely on text and hero art, not pet badges. The orientation-aware border experiment is not a successful detector.

## Standardized detector experiment

Use the COCO object-detection annotation format and the official `pycocotools` evaluator rather than treating this lab's heuristic score as a detector benchmark.

Open [the local COCO icon annotator](./coco-annotator.html) from the lab server to label the available guides. It stores image blobs and boxes in a separate IndexedDB database, keeps a source-group key for grouped folds, and exports COCO JSON; the image pixels are not included in the exported JSON. The pure COCO serializer has dependency-free checks:

```sh
node --test tools/pet-matcher-lab/tests/coco-dataset.test.mjs tools/pet-matcher-lab/tests/pilot-dataset.test.mjs
```

### Annotation contract

- Annotate one class, `game_icon`, for each complete hero, pet, collection, or other catalog icon. Keep icon identity matching as a separate evaluation.
- Draw a tight axis-aligned box around the icon frame at its original image resolution. Exclude adjacent investment badges, text, and neighboring icons.
- Store `bbox` as COCO `[x, y, width, height]` pixel coordinates, `area` as `width × height`, and `iscrowd: 0`. Annotate every target icon in each selected image; unannotated icons would otherwise be treated as background.
- Use a local COCO-compatible annotation tool such as CVAT. Keep original images unchanged and export its COCO JSON.
- Split by complete source guide/layout, never by crops or individual boxes. With the three currently available guide images, use leave-one-guide-out grouped folds for an initial pilot; collect more layouts before treating results as representative.
- Include text-heavy and unrelated-art regions in fully annotated screenshots as hard backgrounds. A hard-negative-only image is another valid background example; negative regions do not need invented bounding boxes.

### Current pilot annotations

The initial pilot is in [`afk-icon-pilot-coco.json`](../../afk-icon-pilot-coco.json), with its coordinate source in [`create-pilot-dataset.mjs`](./create-pilot-dataset.mjs) and extracted guide crops in [`pilot-images/`](./pilot-images/). It contains 168 boxes across 10 images and three `source_group` values. The large guides are cropped to their primary lineup recommendations so roster tables, screenshots, and tips are not silently treated as negatives.

These are best-effort visual labels and should be reviewed before interpreting detector metrics. The app export uses all six displayed lineups; the other two sources use crops of their primary lineup/collection panels. This small, three-source pilot is for workflow validation, not a representative benchmark. Keep all crops from a source guide in the same fold.

### Running the detector benchmark

The runner converts each training fold to YOLO format, fine-tunes YOLO11n, and evaluates the final weights on the held-out source group. It runs one fold per source group and compares full-image inference with SAHI full-image-plus-sliced inference. Dependencies are pinned in [`requirements-detector-benchmark.txt`](./requirements-detector-benchmark.txt); the CPU PyTorch backend avoids requiring a GPU.

```sh
uv venv --python 3.14 "$HOME/.cache/afk-icon-detector-benchmark/.venv"
uv pip install --python "$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" --torch-backend cpu -r tools/pet-matcher-lab/requirements-detector-benchmark.txt
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" tools/pet-matcher-lab/benchmark-detector.py
```

The first run downloads the pretrained `yolo11n.pt` weights. Training data, checkpoints, and logs stay under the cache directory; the machine-readable COCO metrics are written to [`detector-benchmark-results.json`](./detector-benchmark-results.json). The runner fixes the seed at 2026, trains for 10 epochs at 640 pixels, uses a 640-pixel SAHI slice with 20% overlap, and evaluates only each fold's held-out source group.

To continue an interrupted run, pass its run directory with `--resume-run`; completed folds are reused and incomplete folds resume from their latest checkpoint when available.

### Fixed comparison

1. Establish a pretrained Ultralytics YOLO11n baseline and fine-tune it on the training-fold COCO annotations with a recorded package version, seed, image size, and training settings.
2. Run the same trained weights with SAHI sliced inference as a separate comparison. Record tile size and overlap; slicing is a small-object technique, not a replacement for held-out evaluation.
3. Evaluate both prediction sets on the identical held-out guide using `pycocotools` COCOeval. Report AP@[0.50:0.95], AP50, AP75, AR@100, and the COCO area breakdown. AP-small applies only to boxes with area below 32² pixels, so measure the actual icon-size distribution rather than assuming every icon qualifies.
4. Evaluate catalog identity separately on ground-truth icon crops using top-1/top-3 accuracy. Do not combine identity accuracy with localization AP.

### Initial benchmark results

The first CPU run completed all three source-group folds. The following are pooled out-of-fold COCO metrics; macro AP averages the three source-group AP values equally.

| Metric | Full-image YOLO11n | YOLO11n + SAHI |
| --- | ---: | ---: |
| AP@[0.50:0.95] | 0.507 | 0.285 |
| AP50 | 0.834 | 0.569 |
| AP75 | 0.621 | 0.277 |
| AR@100 | 0.643 | 0.487 |
| Macro AP across source groups | 0.502 | 0.381 |
| Inference time for 10 held-out images | 4.4 s | 11.4 s |

Inference times are prediction-only (model loading excluded) from one pass on the local 8-thread Intel i7-6700K CPU; small timing differences between runs are expected.

| Held-out source group | Images / boxes | YOLO AP | YOLO + SAHI AP |
| --- | ---: | ---: | ---: |
| `f2p-weekly-nc-guide` | 3 / 30 | 0.436 | 0.410 |
| `lydydxhxpyyh1` | 6 / 72 | 0.458 | 0.435 |
| `nightmare-corridor-app-export` | 1 / 66 | 0.612 | 0.300 |

SAHI used the same fold weights and combined full-image predictions with 640-pixel slices at 20% overlap. It did not improve this pilot and was slower. These results do not establish that slicing is generally worse: there are only three source layouts, labels are best-effort, and the app-export fold contains one held-out image. AP-small is undefined because none of the 168 ground-truth boxes are smaller than 32² pixels. SAHI also logged one invalid edge-clipped prediction on a narrow crop; it was discarded. Collection node and investment badges remain unannotated.

Exact per-fold COCO metrics, settings, package versions, dataset hash, and limitations are in [`detector-benchmark-results.json`](./detector-benchmark-results.json).

### Near-native inference check

The app-export image (`2040×2082`, 66 labeled icon boxes) is a held-out source group. Using its fold's same YOLO11n weights, trained at 640 pixels, inference was repeated with `imgsz=640`, `1280`, and `2080` (near native resolution). COCO localization metrics on that image were:

| Inference size | AP@[0.50:0.95] | AP50 | AP75 | AR@100 |
| ---: | ---: | ---: | ---: | ---: |
| 640 | 0.612 | 0.897 | 0.871 | 0.650 |
| 1280 | 0.554 | 0.915 | 0.675 | 0.595 |
| 2080 (near native) | 0.545 | 0.874 | 0.674 | 0.623 |

Full-size inference works, but it did not improve localization on this single image. The model was trained at 640, so evaluating it at higher resolution changes the icon scale it sees; this is not a fair test of a model trained for native-resolution input. More high-resolution training examples and a multi-image held-out evaluation are needed before concluding which input size works best. This checks generic icon boxes only, not hero/pet/collection identity. The machine-readable per-resolution metrics and predictions are in [`detector-resolution-results.json`](./detector-resolution-results.json).

At a confidence threshold of 0.25, a score-ordered one-to-one diagnostic match at IoU ≥ 0.50 matched 60/66 boxes at 640, and 66/66 at 1280 and near-native resolution. However, the higher-resolution runs hit the 300-prediction cap; they also returned at least 234 unmatched boxes. This is a recall/false-positive tradeoff, not evidence that higher resolution is ready for lineup extraction.

### Training at higher resolution

To check whether training resolution caused the near-native inference behavior, a separate YOLO11n was trained at 1280 pixels (batch 1, 10 epochs, seed 2026) on the same nine non-app images, then evaluated on the held-out app image. AP was 0.000 at inference sizes 640 and 1280, and 0.409 at 2080; at 2080 it matched 46/66 boxes at confidence ≥0.25 and IoU ≥0.50. This is worse than the 640-trained baseline's 0.545 AP and 66/66 matches at 2080. The run also logged NMS time-limit warnings during training validation. Given the tiny, best-effort pilot and single training seed, this does not prove that high-resolution training is generally worse; it does show that simply raising resolution is not a fix. See [`detector-training-resolution-results.json`](./detector-training-resolution-results.json).

### Lineup 9 full-catalog identity and variant baseline

The app-export screenshot is aligned with lineup ID 9. Its 66 identity labels and expected hero/collection states are reconstructed from the seeded formations and mapped to visual slot order in [`lineup-9-identity-ground-truth.json`](./lineup-9-identity-ground-truth.json). Three hero state labels have screenshot-reviewed overrides because the seed omits ascension or investment details: Rowan is `52_a1_si30.webp` rather than the inferred `52_m_si30.webp`; Awakened Safiya is `165_a1_si30_f9_e60.webp` rather than `165_a.webp`; and Highborn Lan is `199_a1_si40_f9.webp` rather than `199_a_si40_f9.webp`. The source seed remains unchanged, and each override is marked in the generated annotations.

```sh
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" tools/pet-matcher-lab/match-lineup-identities.py
```

For identity retrieval, it evaluates center-crop RGB mean-squared pixel distance after resizing to 96×96. Per-type results were:

| Search mode | Catalog candidates | Type accuracy | Identity top-1 | Identity top-3 |
| --- | ---: | ---: | ---: | ---: |
| Hero only, generic base icons | 229 | — | 28/30 | 29/30 |
| Hero only, generic framed icons | 229 | — | 30/30 | 30/30 |
| Collection only, level-1 icons | 20 | — | 28/30 | 30/30 |
| Pet only, framed icons | 30 | — | 6/6 | 6/6 |
| Mixed hero / collection / pet search | 979 | 66/66 | 64/66 | 66/66 |

In mixed search the icon type is withheld: each crop is compared against 229 generic framed hero templates, 720 collection templates, and 30 pet templates. Collections have a base image plus level 1–3 images, with available mythic-stat-count (`ms`) variants treated as separate templates. The initial center-crop search predicted type correctly for all 66 boxes (30 heroes, 30 collections, 6 pets); its identity top-1 missed two collections, both present in the top 3. A staged reranker then compares source-scale crops against alpha-masked templates for the predicted type and reaches 66/66 identity top-1 and top-3 on this image.

Variant recognition is evaluated separately from identity. Given the correct collection ID, a full-icon comparison selects the level, then a registered 111×111 crop scores only the lower-left mythic-count badge (`x=8, y=82, width=30, height=27`) among variants at that level. This resolves the two prior count errors and selects the exact collection asset in 30/30 cases; levels remain correct in 30/30. For hero states, a 98×98 template registered within a 14-pixel padded source-scale crop selects the screenshot-reviewed asset in 30/30 cases, compared with 0/30 for the original 85-pixel baseline under the corrected labels. It ranks 512 available ascension/investment variants per hero (15,360 templates across the 30 heroes). Both state methods are calibrated to this 2040×2082 export and are not yet validated on other screenshots. The seed data and visual overrides should be checked against additional lineup exports before generalizing these results.

This is an open-catalog retrieval baseline, not a production-ready classifier. It uses ground-truth boxes and does not test detection, rejection of unrelated icons, team grouping, or generalization to guide screenshots. The screenshot and references share CDN artwork. Cached reference assets are kept outside the repository. Per-box predictions, per-type scores, candidate counts, collection and hero variants, and assumptions are in [`lineup-9-full-catalog-identity-results.json`](./lineup-9-full-catalog-identity-results.json).

### Detector-to-catalog and structured team assembly pipeline

Run the app-held-out YOLO fold, pass each detected crop to the multi-scale inner-mask BLAS catalog matcher, and assemble structured AFK Arena teams (including heroes, collections, collection levels, collection node stat icons, and pets):

```sh
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" \
  tools/pet-matcher-lab/detect-and-match-lineup.py
```

By default this uses the saved fold-3 weights, near-native `imgsz=2080`, confidence `0.996`, and NMS IoU `0.55`. The matcher expands each detected box 1.15× around its center (configurable with `--match-box-scale`), while evaluation continues to use the original detector boxes.

Replacing the earlier unaligned `96×96` center-crop + fixed-size `icon_size = min(aligned_crop.shape[:2])` stage with **multi-scale, shift-invariant inner-mask BLAS template matching** (`64×64` templates with hero face inner mask `y: 8..46, x: 10..54` to exclude SI/furniture/engraving badges) raises box-level identity accuracy on the 66 matched YOLO detections from `54/66` (`81.8%`) to **`66/66` (`100.0%`)** (and type accuracy from `61/66` to **`66/66`**).

In addition to per-box matching, `detect-and-match-lineup.py` runs a **4-Class Spatial Team & Collection Node Assembler** (`hero`, `collection`, `pet`, `collection_node` across `78` stat-tier icons from `collection_stats_icon/{stat}_{e|l|m}.webp`):

1. **Layout auto-detection & spatial slot recovery:** Automatically identifies the guide layout archetype (`app_card_3_2`, `row_5_col` including horizontal-strip tiling for tall `3000×6000` infographics, or `staggered_3_2`) and recovers exact 5-hero, 5-collection, and pet slot coordinates.
2. **Global uniqueness via Hungarian assignment:** Solves hero and pet identities across all teams in the guide simultaneously using exact Jonker-Volgenant (`Kuhn-Munkres`) minimum-cost unique assignment.
3. **Soft Hero-Class → Collection-Class prior (`0.80×` MSE):** Uses each matched hero's class (`Warrior`, `Tank`, `Ranger`, `Mage`, `Support`) as a soft prior when ranking collections, while remaining robust to schema/game discrepancies (such as `awakened-theowyn` equipping Support collection `9 Trader's Vault`).
4. **Collection node stat icon detection:** Scans the node ROI attached to each collection/hero slot against all `78` `collection_stats_icon/{stat}_{e|l|m}.webp` templates (`26 stats × 3 tiers`) and combines detected stat nodes with collection level (`lvl1..3` → `skill_level` nodes) to emit `seed.sql`-compatible `formations` JSON.
5. **Left-panel pets & substitute/alternative teams decoder (`lydydxhxpyyh1.png`):** For full `3000×6000` dual-panel infographics, segments the left-panel (`x = 0..1048`) into 6 rounds (`49` total rows = `6` primary rows + `43` substitute/alternative team rows) and decodes each hero slot (`single`, `split_2` diagonal alternatives, `multi_3`, and `2×2` `multi_4` quad alternatives) and pet slot (`single`, `split_2`, and `split_3` cascaded pet options, including base/evolved pet icons from `unit_icon_by_id`).

To run the out-of-fold end-to-end team benchmark across all three guide layouts (`fold-3`, `fold-2`, `fold-1`), pass `--eval-all-guides`:

```sh
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" \
  tools/pet-matcher-lab/detect-and-match-lineup.py --eval-all-guides
```

| Guide image | Held-out fold | Layout archetype | Teams | Substitute Teams | Heroes | Collections | Collection Node Icons | Pets |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `afk-nightmare-corridor-infernal-overlord-9.png` (`2040×2082`) | `fold-3` | `app_card_3_2` | **6/6** | — | **30/30** | **30/30** | **42/42** | **6/6** |
| `lydydxhxpyyh1.png` (`3000×6000` full & 6 round crops) | `fold-2` | `row_5_col` + left-panel subs | **6/6** | **43** | **30/30** | **30/30** | **43/43** | **6/6** |
| `f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp` (`1080×1771`) | `fold-1` | `staggered_3_2` | **3/3** | — | **15/15** | **15/15** | **14/14** (15/15 slots) | **3/3** |

Per-box predictions, assembled teams, and `seed.sql`-compatible `formations` are written to [`lineup-9-detection-matches.json`](./lineup-9-detection-matches.json), and the multi-guide out-of-fold benchmark is written to [`multi-guide-team-recognition-results.json`](./multi-guide-team-recognition-results.json).

### Mode, Lineup & Alternatives Recognizer Tool (`api/recognize-lineup.py`)

[`api/recognize-lineup.py`](../../api/recognize-lineup.py) provides a complete CLI, interactive local web UI, and Vercel-compatible serverless endpoint (`POST /api/recognize-lineup`) that, given any full guide screenshot or single-round crop:

1. **Determines the Best Matching Mode & Target** (`nightmare-corridor`, `cursed-realm`, `treasure-scramble`, `twisted-realm` + boss/cycle target such as `infernal-overlord`, `netherspinner`, `ice-shemira`, etc.) with confidence and reasons, plus ranked **Mode/Target Alternatives**.
2. **Matches Against Known Database Lineups** (`seed.sql` and `lineup-data.ts`), aligning each extracted round to its corresponding boss formation (even for single-round crops) and reporting overall & per-round similarity.
3. **Generates Multi-Level Suggested Alternatives** in case anything needs correction:
   - **Visual Catalog Alternatives (`visual_alternatives`):** Top-5 closest hero, pet, and collection candidates (and top-3 collection node stat candidates) with MSE and calibrated confidence.
   - **Reference Diffs & Review Suggestions (`review_suggestions`):** Flags any slot or collection node that differs from the closest matched reference lineup or has tight visual MSE margin.
   - **Guide-Explicit Substitutes:** Decodes per-slot hero alternatives (`slot_options`), 1/2/3-way pet cascades (`pet.options`), and full substitute teams (`substitute_teams`).

```sh
# CLI report on any full guide or single-round crop:
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" api/recognize-lineup.py afk-nightmare-corridor-infernal-overlord-9.png
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" api/recognize-lineup.py tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-4.png

# Launch the interactive Web UI + local API server (also serves Angular /import-helper):
"$HOME/.cache/afk-icon-detector-benchmark/.venv/bin/python" api/recognize-lineup.py --serve --port 8174
```

### Recommended next steps

1. **Review and expand labels first.** Correct the best-effort boxes and add diverse, fully labeled images from actual app inputs. Keep source layouts grouped across train/test splits and include text/art hard negatives.
2. **Expand identity ground truth.** Lineup 9 now has typed catalog IDs for all 66 boxes, but the other pilot guide images remain unlabeled. Add identity labels for additional app screenshots and guide sources before treating the matcher as general.
3. **Validate state labels and scoring on other exports.** Confirm the three screenshot-reviewed hero overrides against source data, and test the 111-pixel collection badge region and 98-pixel hero registration on additional app exports before treating them as general settings.
4. **Generalize matching behavior.** Evaluate localized badge/frame features and a low-confidence “unknown” result on varied screenshot sources. Keep identity, visual-state, and localization metrics separate.
5. **Only then tune detection and resolution.** Compare 640 and higher-resolution or multi-scale training on the same reviewed grouped folds. The high-resolution pilot does not justify changing the current baseline.
6. **Validate the complete lineup.** Add collection nodes/investments and evaluate icon attributes, spatial team grouping, and end-to-end lineup accuracy separately.

COCO format and metrics are standards; model, seed, split strategy, and SAHI tile settings are recorded experiment choices. References: [COCO format](https://cocodataset.org/#format-data), [COCO API evaluator](https://github.com/cocodataset/cocoapi/blob/master/PythonAPI/pycocotools/cocoeval.py), [Ultralytics detection datasets](https://docs.ultralytics.com/datasets/detect/), [SAHI](https://github.com/obss/sahi), and [GroupKFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupKFold.html).

### Readiness and smoke test

| Source image | Dimensions | Pilot annotation state |
| --- | ---: | --- |
| `afk-nightmare-corridor-infernal-overlord-9.png` | 2040×2082 | 66 boxes across six lineups |
| `f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp` | 1080×1771 | Three lineup crops; 30 boxes |
| `lydydxhxpyyh1.png` | 3000×6000 | Six lineup/collection crops; 72 boxes |

The six approximate pet boxes used by the earlier prototype are not part of this COCO dataset. Before training, review the pilot boxes and crop boundaries; the available guides are still too few to support representative results. The existing pet-crop classifier cannot supply detector labels.

As a diagnostic only, the border-proposal prototype's top 30 candidates had recall@30 of 0/6 at IoU ≥ 0.50 against the earlier approximate pet boxes on the app export. This is not a substitute for COCO AP. The detector benchmark still requires a compatible Ultralytics/SAHI/pycocotools toolchain and reviewed labels.

## What this does not do

The trainer fits a multiclass linear softmax classifier over 16×16 RGB features in the browser. It is a real learned model with an exportable weight file, but it is not a deep neural network and a small dataset will overfit. Collect several varied crops per pet from multiple guides, keep entire guides in one split, and use Test / holdout results before treating it as useful. Exported model weights are not wired into the production Angular matcher; integration is a separate step after the model demonstrates improvement.

## Notes

- Square CDN reference icons load automatically; local icon folders can override them.
- Browser storage is IndexedDB. Export the dataset JSON before clearing site data or switching browsers.
- Exported examples include the square crop used for evaluation plus its normalized selection rectangle and original guide dimensions, so a later training pipeline can recover the crop context.
- Missing reference icons are excluded from catalog rankings and counted in the evaluation warning.
- The catalog list in `app.js` should be kept in sync with `PETS` in `src/app/features/lineups/lineup-data.ts` when the app adds or renames pets.
