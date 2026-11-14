#!/usr/bin/env python3
"""
AFK Arena Image Recognition Tool: Mode, Lineup & Alternatives Matcher
(`api/recognize-lineup.py`)

Given any AFK Arena lineup screenshot, community guide, or single-round crop:
1. Detects and matches all Heroes, Pets, Collections, Collection Levels,
   Collection Node stat icons, and Substitute Teams (100% local & free).
2. Determines the **Best Matching Mode & Target** (e.g. Nightmare Corridor —
   Infernal Overlord, Cursed Realm — Ice Shemira, Treasure Scramble, Twisted Realm)
   and **Best Matching Known Lineup** with per-round boss alignment.
3. Provides **Suggested Alternatives in case something is wrong**:
   - Alternative modes and targets with confidence scores,
   - Alternative known database lineups with per-round similarity,
   - Top-5 visual catalog alternatives for every Hero, Pet, Collection, and
     top-3 for every Collection Node stat icon,
   - Guide-explicit slot alternatives and full substitute teams,
   - Actionable `review_suggestions` highlighting close visual matches or
     differences against the closest reference lineup.

Usage:
  # 1. CLI mode on any image:
  python api/recognize-lineup.py afk-nightmare-corridor-infernal-overlord-9.png
  python api/recognize-lineup.py lydydxhxpyyh1.png --json out.json
  python api/recognize-lineup.py tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-4.png

  # 2. Local Web UI + API server (also serves Angular /import-helper):
  python api/recognize-lineup.py --serve --port 8174
"""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import time
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
LAB_DIR = REPO_ROOT / "tools" / "pet-matcher-lab"
_STATE = {}


def _load_pipeline():
    if "initialized" in _STATE:
        return _STATE

    matcher_spec = importlib.util.spec_from_file_location(
        "lineup_identity_matcher", LAB_DIR / "match-lineup-identities.py"
    )
    matcher = importlib.util.module_from_spec(matcher_spec)
    matcher_spec.loader.exec_module(matcher)

    det_spec = importlib.util.spec_from_file_location(
        "detect_and_match_lineup", LAB_DIR / "detect-and-match-lineup.py"
    )
    det = importlib.util.module_from_spec(det_spec)
    det_spec.loader.exec_module(det)

    gt_mod = matcher.load_ground_truth_module(
        LAB_DIR / "create-lineup-identity-ground-truth.py"
    )
    schema_sql = (REPO_ROOT / "schema.sql").read_text(encoding="utf-8")
    seed_sql = (REPO_ROOT / "seed.sql").read_text(encoding="utf-8")
    catalogs = matcher.load_catalogs(schema_sql, gt_mod)
    hero_meta, pet_meta, collections_catalog = matcher.load_hero_and_pet_metadata(
        schema_sql, gt_mod
    )
    formations_gt = gt_mod.extract_lineup(seed_sql)
    cache_root = (
        Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    )
    candidate_assets, _ = matcher.build_identity_candidate_assets(catalogs, cache_root)
    type_tensors = matcher.build_type_tensors(candidate_assets, cache_root)
    node_assets = matcher.build_collection_node_assets(cache_root)

    models = {}
    default_model = None
    try:
        from ultralytics import YOLO

        runs_dir = (
            Path.home()
            / ".cache/afk-icon-detector-benchmark/run-20261108T031214Z-1901092/runs"
        )
        fold_paths = {
            "fold-1": runs_dir / "fold-1/weights/best.pt",
            "fold-2": runs_dir / "fold-2/weights/best.pt",
            "fold-3": runs_dir / "fold-3/weights/last.pt",
        }
        for fk, fp in fold_paths.items():
            if fp.is_file():
                models[fk] = YOLO(str(fp))

        detector_report_path = LAB_DIR / "detector-resolution-results.json"
        if detector_report_path.is_file():
            rep = json.loads(detector_report_path.read_text(encoding="utf-8"))
            weights_path = Path(rep.get("weights", ""))
            if weights_path.is_file():
                default_model = models.get("fold-3") or YOLO(str(weights_path))
        if default_model is None and models:
            default_model = next(iter(models.values()))
    except Exception:
        default_model = None

    _STATE.update(
        {
            "initialized": True,
            "matcher": matcher,
            "det": det,
            "type_tensors": type_tensors,
            "node_assets": node_assets,
            "hero_meta": hero_meta,
            "pet_meta": pet_meta,
            "collections_catalog": collections_catalog,
            "formations_gt": formations_gt,
            "models": models,
            "model": default_model,
        }
    )
    return _STATE


def _select_model_for_image(img, state):
    H, W = img.shape[:2]
    models = state.get("models") or {}
    if H >= 3000 and W >= 2400:
        return models.get("fold-2") or state.get("model"), "fold-2"
    if W >= 1800 and H >= 1800:
        return models.get("fold-3") or state.get("model"), "fold-3"
    if W >= 1000 and H <= 1150:
        return models.get("fold-2") or state.get("model"), "fold-2"
    return models.get("fold-1") or state.get("model"), "fold-1"


def _opencv_fallback_boxes(img):
    """Lightweight OpenCV contour/gradient square icon proposal fallback when YOLO weights are absent."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes, scores = [], []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if 48 <= w <= 165 and 48 <= h <= 185:
            ar = w / float(max(1, h))
            if 0.55 <= ar <= 1.35:
                boxes.append([float(x), float(y), float(x + w), float(y + h)])
                scores.append(0.80)
    return boxes, scores


def recognize_image_bytes(image_bytes):
    t0 = time.time()
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode input image bytes.")

    state = _load_pipeline()
    det = state["det"]
    matcher = state["matcher"]
    model, fold_name = _select_model_for_image(img, state)

    if model is not None:
        solved_teams = det.detect_and_assemble_teams_for_image(
            img,
            model,
            matcher,
            state["type_tensors"],
            state["node_assets"],
            state["hero_meta"],
            state["pet_meta"],
            state["collections_catalog"],
        )
    else:
        raw_boxes, raw_scores = _opencv_fallback_boxes(img)
        solved_teams = det.detect_and_assemble_teams_for_image(
            img,
            None,
            matcher,
            state["type_tensors"],
            state["node_assets"],
            state["hero_meta"],
            state["pet_meta"],
            state["collections_catalog"],
            detector_boxes=raw_boxes,
            detector_scores=raw_scores,
        )

    inference = det.infer_mode_and_lineup_matches(
        solved_teams,
        img.shape,
        state["hero_meta"],
        state["pet_meta"],
        state["collections_catalog"],
        REPO_ROOT,
        formations_gt=state["formations_gt"],
    )
    formations = det.teams_to_seed_formations(solved_teams)
    best_mode = inference["best_mode"]
    best_lineup = inference["best_lineup_match"]
    sub_count = sum(len(t.get("substitute_teams", [])) for t in solved_teams)

    seed_payload = {
        "key": (
            best_lineup["id"]
            if best_lineup and best_lineup["similarity"] >= 0.85
            else f"{best_mode['mode_slug']}-{best_mode['target_slug']}-imported"
        ),
        "title": f"{best_mode['mode_name']} — {best_mode['target_name']}",
        "mode": best_mode["mode_slug"],
        "target": best_mode["target_name"],
        "target_slug": best_mode["target_slug"],
        "formations": formations,
    }

    return {
        "ok": True,
        "elapsed_seconds": round(time.time() - t0, 3),
        "detector_fold": fold_name,
        "image_shape": {"width": int(img.shape[1]), "height": int(img.shape[0])},
        "team_count": len(solved_teams),
        "substitute_team_count": sub_count,
        "best_mode": best_mode,
        "mode_alternatives": inference["mode_alternatives"],
        "best_lineup_match": best_lineup,
        "lineup_alternatives": inference["lineup_alternatives"],
        "review_suggestions": inference["review_suggestions"],
        "teams": solved_teams,
        "formations": formations,
        "seed_payload": seed_payload,
    }


def _list_sample_images():
    candidates = [
        ("afk-nightmare-corridor-infernal-overlord-9.png", "App Export — 6-Round Nightmare Corridor (2040×2082)"),
        ("lydydxhxpyyh1.png", "Dual-Panel Community Guide — 6 Rounds + 43 Substitute Teams (3000×6000)"),
        ("f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp", "F2P Staggered Guide — 3-Round Nightmare Corridor (1080×1629)"),
        ("tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-1.png", "Single-Round Crop — Round 1 Worm Queen (1344×707)"),
        ("tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-3.png", "Single-Round Crop — Round 3 Demonic Puppet (1344×776)"),
        ("tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-5.png", "Single-Round Crop — Round 5 Mirror Demon (1344×917)"),
        ("tools/pet-matcher-lab/pilot-images/pilot-nc-round-2.png", "Single-Round Staggered Crop — Round 2 Cindercrow (362×397)"),
    ]
    out = []
    for rel, label in candidates:
        p = REPO_ROOT / rel
        if p.is_file():
            out.append({"path": rel, "label": label})
    return out


def format_cli_report(result, image_label=""):
    lines = []
    bm = result["best_mode"]
    bl = result["best_lineup_match"]
    lines.append("=" * 84)
    lines.append(
        f"AFK ARENA LINEUP RECOGNIZER & MODE MATCHER"
        + (f" — {image_label}" if image_label else "")
    )
    lines.append("=" * 84)
    lines.append(
        f"Image Size     : {result['image_shape']['width']}x{result['image_shape']['height']} "
        f"(processed in {result['elapsed_seconds']}s, detector={result.get('detector_fold')})"
    )
    lines.append(
        f"Best Mode      : {bm['mode_name']} [{bm['mode_slug']}] "
        f"| Target: {bm['target_name']} [{bm['target_slug']}] "
        f"| Confidence: {bm['confidence'] * 100:.1f}%"
    )
    for reason in bm.get("reasons", []):
        lines.append(f"  - {reason}")

    if result.get("mode_alternatives"):
        alt_strs = [
            f"{a['mode_name']}: {a['target_name']} ({a['confidence'] * 100:.1f}%)"
            for a in result["mode_alternatives"][:4]
        ]
        lines.append(f"Mode Alts      : {' | '.join(alt_strs)}")

    lines.append("-" * 84)
    if bl:
        lines.append(
            f"Best Lineup    : {bl['title']} [{bl['id']}] "
            f"— Similarity: {bl['similarity'] * 100:.1f}% (per-round: {bl['mean_round_similarity'] * 100:.1f}%)"
        )
        for ra in bl.get("round_alignments", []):
            coll_str = (
                f", collections={ra['collection_match_count']}/5"
                if ra.get("collection_match_count") is not None
                else ""
            )
            lines.append(
                f"  * Image Round {ra['image_round']} -> {ra['matched_formation_label']} [{ra['matched_formation_key']}] "
                f"({ra['similarity'] * 100:.1f}%: heroes={ra['hero_overlap_count']}/5{coll_str}, pet={'OK' if ra['pet_matched'] else 'diff'})"
            )
    if result.get("lineup_alternatives"):
        l_alts = [
            f"{la['title']} ({la['similarity'] * 100:.1f}%)"
            for la in result["lineup_alternatives"][:3]
        ]
        lines.append(f"Lineup Alts    : {' | '.join(l_alts)}")

    lines.append("-" * 84)
    lines.append(
        f"EXTRACTED TEAMS ({result['team_count']} primary teams, {result.get('substitute_team_count', 0)} substitute teams):"
    )
    for t in result["teams"]:
        f_label = t.get("matched_formation_label") or f"Round {t['round']}"
        p = t.get("pet") or {}
        p_opts = p.get("options") or ([p.get("slug")] if p.get("slug") else [])
        p_vis = [a["slug"] for a in (p.get("visual_alternatives") or [])[1:4]]
        lines.append(
            f"\n  [Round {t['round']}: {f_label}] "
            f"Pet: {p.get('name', 'None')} ({' > '.join(p_opts)}) "
            f"[conf={p.get('confidence', 0):.2f} | visual alts: {', '.join(p_vis)}]"
        )
        for h in t["heroes"]:
            coll = h.get("collection") or {}
            c_name = (
                f"{coll['name']} (Lv.{coll.get('level', 1)})"
                if coll.get("catalog")
                else "No Collection"
            )
            nodes = [n["key"] for n in (coll.get("nodes") or [])]
            node_str = f" [{', '.join(nodes)}]" if nodes else ""
            h_vis = [a["slug"] for a in (h.get("visual_alternatives") or [])[1:4]]
            slot_opts = h.get("slot_options") or []
            slot_alt_str = (
                f" | guide subs: {', '.join(slot_opts[1:])}"
                if len(slot_opts) > 1
                else ""
            )
            rev_flag = " [REVIEW]" if h.get("needs_review") or coll.get("needs_review") else ""
            lines.append(
                f"    Slot {h['slot'] + 1}: {h['name']:<22} ({h['slug']:<20}) "
                f"| {c_name:<26}{node_str:<22} "
                f"| visual alts: {', '.join(h_vis)}{slot_alt_str}{rev_flag}"
            )
        subs = t.get("substitute_teams") or []
        if subs:
            lines.append(f"    + {len(subs)} Substitute Teams decoded for Round {t['round']}:")
            for sub in subs[:3]:
                h_summary = ", ".join(
                    "/".join(s["options"]) for s in sub["hero_slots"]
                )
                p_summary = ">".join(sub.get("pet_options") or [sub.get("pet", "")])
                lines.append(
                    f"      Sub #{sub['row_index'] - 1}: [{h_summary}] | Pet: {p_summary}"
                )
            if len(subs) > 3:
                lines.append(f"      ... and {len(subs) - 3} more substitute teams.")

    lines.append("-" * 84)
    sugs = result.get("review_suggestions") or []
    if sugs:
        lines.append(f"SUGGESTED ALTERNATIVES / REVIEW FLAGS ({len(sugs)}):")
        for s in sugs:
            lines.append(
                f"  ! [{s['type']}] Round {s['round']} ({s['formation_label']}) {s['field']}: {s['reason']}"
            )
            lines.append(
                f"    Suggested alternatives: {s['suggested_alternatives']}"
            )
    else:
        lines.append(
            "SUGGESTED ALTERNATIVES / REVIEW FLAGS: None (all slots matched with high confidence & 100% agreement)."
        )
    lines.append("=" * 84)
    return "\n".join(lines)


WEB_UI_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AFK Arena Lineup & Mode Recognizer</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1319;
      --panel: #171d26;
      --panel-2: #1f2733;
      --border: #2d3848;
      --text: #ecf2f8;
      --muted: #9fb0c4;
      --accent: #eab308;
      --green: #22c55e;
      --warn: #f97316;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    .container { max-width: 1280px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 1.65rem; }
    .subtitle { color: var(--muted); margin: 0 0 20px; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    select, input[type="file"], button {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 9px 14px;
      border-radius: 8px;
      font-size: 0.92rem;
    }
    button.primary {
      background: var(--accent);
      color: #111;
      font-weight: 700;
      border-color: var(--accent);
      cursor: pointer;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .card h2 { margin: 0 0 10px; font-size: 1.1rem; color: var(--accent); }
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      background: var(--panel-2);
      border: 1px solid var(--border);
      margin-right: 6px;
    }
    .badge.ok { border-color: var(--green); color: #86efac; }
    .badge.warn { border-color: var(--warn); color: #fdba74; }
    .round-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .slots-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9rem;
    }
    .slots-table th, .slots-table td {
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .slots-table th { color: var(--muted); font-weight: 600; }
    .alt-pill {
      display: inline-block;
      padding: 2px 7px;
      margin: 2px 4px 2px 0;
      border-radius: 6px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      font-size: 0.78rem;
      cursor: pointer;
    }
    .alt-pill:hover { border-color: var(--accent); color: var(--accent); }
    pre {
      background: #0b0e13;
      border: 1px solid var(--border);
      padding: 12px;
      border-radius: 8px;
      overflow: auto;
      max-height: 360px;
      font-size: 0.82rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>AFK Arena Lineup, Mode & Alternatives Recognizer</h1>
    <p class="subtitle">100% local detector + template matcher: identifies the best matching Mode, Target, Known Lineup, Extracted Formations, and Visual/Guide Alternatives.</p>
    <div class="controls">
      <label>Sample Repository Image:
        <select id="sampleSelect"></select>
      </label>
      <button class="primary" id="runSampleBtn">Analyze Selected Sample</button>
      <span>or upload any image:</span>
      <input type="file" id="fileInput" accept="image/*" />
      <span id="statusText" style="color: var(--muted);"></span>
    </div>
    <div id="resultsRoot"></div>
  </div>
  <script>
    const sampleSelect = document.getElementById('sampleSelect');
    const runSampleBtn = document.getElementById('runSampleBtn');
    const fileInput = document.getElementById('fileInput');
    const statusText = document.getElementById('statusText');
    const resultsRoot = document.getElementById('resultsRoot');
    let currentResult = null;

    async function loadSamples() {
      const res = await fetch('/api/sample-images');
      const data = await res.json();
      sampleSelect.innerHTML = data.samples.map(s => `<option value="${s.path}">${s.label}</option>`).join('');
    }

    async function analyzeSample(path) {
      statusText.textContent = `Analyzing ${path}...`;
      const res = await fetch('/api/recognize-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      currentResult = data;
      statusText.textContent = data.ok ? `Done in ${data.elapsed_seconds}s` : `Error: ${data.error}`;
      renderResult();
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      statusText.textContent = `Analyzing uploaded file ${file.name}...`;
      const reader = new FileReader();
      reader.onload = async () => {
        const res = await fetch('/api/recognize-lineup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: reader.result })
        });
        const data = await res.json();
        currentResult = data;
        statusText.textContent = data.ok ? `Done in ${data.elapsed_seconds}s` : `Error: ${data.error}`;
        renderResult();
      };
      reader.readAsDataURL(file);
    });

    runSampleBtn.addEventListener('click', () => analyzeSample(sampleSelect.value));

    window.swapSlot = function(tIdx, sIdx, newSlug, newName) {
      const hero = currentResult.teams[tIdx].heroes[sIdx];
      hero.slug = newSlug;
      if (newName) hero.name = newName;
      currentResult.formations[tIdx].heroes[sIdx].slug = newSlug;
      renderResult();
    };

    window.swapPet = function(tIdx, newSlug, newName) {
      const pet = currentResult.teams[tIdx].pet;
      if (!pet) return;
      pet.slug = newSlug;
      if (newName) pet.name = newName;
      currentResult.formations[tIdx].pet = newSlug;
      renderResult();
    };

    function renderResult() {
      if (!currentResult || !currentResult.ok) return;
      const bm = currentResult.best_mode;
      const bl = currentResult.best_lineup_match;
      const modeAlts = (currentResult.mode_alternatives || []).map(a =>
        `<span class="badge">${a.mode_name} — ${a.target_name} (${(a.confidence * 100).toFixed(1)}%)</span>`
      ).join('');
      const lineupAlts = (currentResult.lineup_alternatives || []).map(l =>
        `<span class="badge">${l.title} (${(l.similarity * 100).toFixed(1)}%)</span>`
      ).join('');
      const sugs = currentResult.review_suggestions || [];

      let html = `
        <div class="grid-2">
          <div class="card">
            <h2>1. Best Matching Mode & Target</h2>
            <p style="font-size: 1.15rem; margin: 4px 0 8px;">
              <strong>${bm.mode_name}</strong> — <strong>${bm.target_name}</strong>
              <span class="badge ok">${(bm.confidence * 100).toFixed(1)}% confidence</span>
            </p>
            <ul style="margin: 0 0 10px; padding-left: 18px; color: var(--muted); font-size: 0.88rem;">
              ${(bm.reasons || []).map(r => `<li>${r}</li>`).join('')}
            </ul>
            <div style="font-size: 0.84rem; color: var(--muted);">Suggested Mode/Target Alternatives:</div>
            <div style="margin-top: 4px;">${modeAlts}</div>
          </div>
          <div class="card">
            <h2>2. Best Matching Known Lineup</h2>
            ${bl ? `
              <p style="font-size: 1.05rem; margin: 4px 0 8px;">
                <strong>${bl.title}</strong>
                <span class="badge ok">${(bl.similarity * 100).toFixed(1)}% match</span>
              </p>
              <div style="font-size: 0.84rem; color: var(--muted); margin-bottom: 8px;">
                ${(bl.round_alignments || []).map(ra =>
                  `<div>Round ${ra.image_round} &rarr; <strong>${ra.matched_formation_label}</strong> (${(ra.similarity * 100).toFixed(1)}%, ${ra.hero_overlap_count}/5 heroes)</div>`
                ).join('')}
              </div>
            ` : '<p>No reference lineup matched.</p>'}
            <div style="font-size: 0.84rem; color: var(--muted);">Other Database Lineup Candidates:</div>
            <div style="margin-top: 4px;">${lineupAlts}</div>
          </div>
        </div>
      `;

      if (sugs.length) {
        html += `
          <div class="card" style="margin-bottom: 20px; border-color: var(--warn);">
            <h2 style="color: #fdba74;">Suggested Corrections / Review Flags (${sugs.length})</h2>
            <ul style="margin: 0; padding-left: 18px; font-size: 0.9rem;">
              ${sugs.map(s => `<li><strong>Round ${s.round} (${s.formation_label}) ${s.field}:</strong> ${s.reason} — Alternatives: <code>${JSON.stringify(s.suggested_alternatives)}</code></li>`).join('')}
            </ul>
          </div>
        `;
      }

      currentResult.teams.forEach((t, tIdx) => {
        const p = t.pet || {};
        const pVis = (p.visual_alternatives || []).slice(1, 5).map(a =>
          `<span class="alt-pill" onclick="swapPet(${tIdx}, '${a.slug}', '${a.name}')">${a.name} (MSE ${a.mse})</span>`
        ).join('');
        const pOpts = (p.options || []).length > 1 ? `<span class="badge">Cascade: ${p.options.join(' &rarr; ')}</span>` : '';
        const subs = t.substitute_teams || [];

        html += `
          <div class="round-card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <div>
                <strong style="font-size:1.08rem;">Round ${t.round}: ${t.matched_formation_label || ('Round ' + t.round)}</strong>
                <span class="badge">${t.layout}</span>
              </div>
              <div>
                <strong>Pet:</strong> ${p.name || 'None'} (<code>${p.slug || 'none'}</code>) ${pOpts}
                ${pVis ? `<span style="font-size:0.8rem; color:var(--muted); margin-left:6px;">Swap pet:</span> ${pVis}` : ''}
              </div>
            </div>
            <table class="slots-table">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Predicted Hero</th>
                  <th>Collection & Stat Nodes</th>
                  <th>Suggested Hero Alternatives (click to swap)</th>
                  <th>Suggested Collection Alternatives</th>
                </tr>
              </thead>
              <tbody>
                ${t.heroes.map((h, sIdx) => {
                  const coll = h.collection || {};
                  const nodes = (coll.nodes || []).map(n => `<span class="badge">${n.key}</span>`).join('');
                  const hVis = (h.visual_alternatives || []).slice(1, 5).map(a =>
                    `<span class="alt-pill" onclick="swapSlot(${tIdx}, ${sIdx}, '${a.slug}', '${a.name.replace(/'/g, "\\'")}')">${a.name} (${(a.confidence * 100).toFixed(0)}%)</span>`
                  ).join('');
                  const guideOpts = (h.slot_options || []).slice(1).map(slug =>
                    `<span class="alt-pill" style="border-color:var(--accent);" onclick="swapSlot(${tIdx}, ${sIdx}, '${slug}', '${slug}')">[Guide Sub] ${slug}</span>`
                  ).join('');
                  const cVis = (coll.visual_alternatives || []).slice(1, 4).map(c =>
                    `<span class="badge">${c.name} (Lv.${c.level})</span>`
                  ).join('');
                  return `
                    <tr>
                      <td>#${sIdx + 1}</td>
                      <td>
                        <strong>${h.name}</strong> (<code>${h.slug}</code>)
                        <span class="badge ${h.needs_review ? 'warn' : 'ok'}">${(h.confidence * 100).toFixed(0)}%</span>
                      </td>
                      <td>
                        ${coll.catalog ? `<strong>${coll.name}</strong> (Lv.${coll.level})` : '<span style="color:var(--muted)">None</span>'}
                        <div>${nodes}</div>
                      </td>
                      <td>${guideOpts}${hVis}</td>
                      <td>${cVis}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            ${subs.length ? `
              <details style="margin-top:10px;">
                <summary style="cursor:pointer; color:var(--accent); font-weight:600;">
                  View ${subs.length} Decoded Substitute / Alternative Teams for Round ${t.round}
                </summary>
                <ul style="font-size:0.86rem; margin-top:6px;">
                  ${subs.map(sub => `
                    <li>
                      <strong>Sub #${sub.row_index - 1}:</strong>
                      Heroes: ${sub.hero_slots.map(s => s.options.join(' / ')).join(', ')}
                      | Pet: ${(sub.pet_options || [sub.pet]).join(' > ')}
                    </li>
                  `).join('')}
                </ul>
              </details>
            ` : ''}
          </div>
        `;
      });

      html += `
        <div class="card">
          <h2>3. Ready-to-Import Seed / Lineup JSON Payload</h2>
          <pre>${JSON.stringify(currentResult.seed_payload, null, 2)}</pre>
        </div>
      `;
      resultsRoot.innerHTML = html;
    }

    loadSamples();
  </script>
</body>
</html>
"""


class handler(BaseHTTPRequestHandler):
    """Vercel Python Serverless Function + Local Interactive Web Server entry point."""

    def _send_json(self, status_code, payload):
        response_bytes = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sample-images":
            self._send_json(200, {"ok": True, "samples": _list_sample_images()})
            return
        if parsed.path in ("/", "/index.html"):
            html_bytes = WEB_UI_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_bytes)))
            self.end_headers()
            self.wfile.write(html_bytes)
            return
        self._send_json(404, {"ok": False, "error": f"Not found: {parsed.path}"})

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")

            if parsed.path == "/api/recognize-sample":
                payload = json.loads(body.decode("utf-8"))
                rel_path = payload.get("path", "")
                target_path = (REPO_ROOT / rel_path).resolve()
                if not str(target_path).startswith(str(REPO_ROOT)) or not target_path.is_file():
                    raise ValueError(f"Sample image not found: {rel_path}")
                result = recognize_image_bytes(target_path.read_bytes())
                self._send_json(200, result)
                return

            if "application/json" in content_type:
                payload = json.loads(body.decode("utf-8"))
                b64_str = payload.get("image_base64") or payload.get("image") or ""
                if "," in b64_str:
                    b64_str = b64_str.split(",", 1)[1]
                image_bytes = base64.b64decode(b64_str)
            else:
                image_bytes = body

            result = recognize_image_bytes(image_bytes)
            self._send_json(200, result)
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})


def main():
    parser = argparse.ArgumentParser(
        description="Determine the best matching mode, target, lineup, and slot/team alternatives for an AFK Arena image."
    )
    parser.add_argument(
        "image",
        nargs="?",
        help="Path to an image file to analyze (omit when using --serve).",
    )
    parser.add_argument(
        "--json",
        type=Path,
        help="Optional path to save the full recognition + alternatives JSON report.",
    )
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Run local web UI & API server (default port 8174).",
    )
    parser.add_argument("--port", type=int, default=8174)
    args = parser.parse_args()

    if args.serve:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
        print(
            f"AFK Arena Lineup Recognizer Web UI & API listening on http://127.0.0.1:{args.port}"
        )
        server.serve_forever()
        return

    img_path = (
        Path(args.image).expanduser().resolve()
        if args.image
        else (REPO_ROOT / "afk-nightmare-corridor-infernal-overlord-9.png").resolve()
    )
    if not img_path.is_file():
        raise FileNotFoundError(f"Image not found: {img_path}")

    result = recognize_image_bytes(img_path.read_bytes())
    print(format_cli_report(result, image_label=img_path.name))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"\nSaved full JSON report to {args.json.resolve()}")


if __name__ == "__main__":
    main()
