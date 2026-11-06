# AFK Arena Pet Matcher Lab

A dependency-free, local browser workbench for building a labeled pet-crop dataset, training a first-pass linear classifier, and evaluating matching strategies. It is separate from the Angular app and does not upload images or labels.

## Open the tool

Open `index.html` in a modern browser, or serve this directory locally:

```sh
python3 -m http.server 8173 --directory tools/pet-matcher-lab
```

Then open `http://localhost:8173`.

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

## Experimental full-image pet scan

The detection panel scans a downscaled image at several square window sizes against the loaded pet icons, reports the strongest class at each window, filters by a heuristic confidence score, and applies overlap suppression. Results include coordinates and an overlay. This is a deliberately crude baseline, not a validated detector: the confidence is not a probability, and an above-threshold result is only a candidate, not confirmed presence.

In the initial check, it returned many false candidates on both the app export and a different Nightmare Corridor guide; raising the threshold reduced the count but did not make the top hits reliable. Do not use the detector output as labels or valid matches yet. It is included to visualize the failure mode and motivate a better detector trained on labeled boxes.

## What this does not do

The trainer fits a multiclass linear softmax classifier over 16×16 RGB features in the browser. It is a real learned model with an exportable weight file, but it is not a deep neural network and a small dataset will overfit. Collect several varied crops per pet from multiple guides, keep entire guides in one split, and use Test / holdout results before treating it as useful. Exported model weights are not wired into the production Angular matcher; integration is a separate step after the model demonstrates improvement.

## Notes

- Catalog icons are loaded only from the directory selected by the user. The tool does not silently download references.
- Browser storage is IndexedDB. Export the dataset JSON before clearing site data or switching browsers.
- Exported examples include the square crop used for evaluation plus its normalized selection rectangle and original guide dimensions, so a later training pipeline can recover the crop context.
- Missing reference icons are excluded from catalog rankings and counted in the evaluation warning.
- The catalog list in `app.js` should be kept in sync with `PETS` in `src/app/features/lineups/lineup-data.ts` when the app adds or renames pets.
