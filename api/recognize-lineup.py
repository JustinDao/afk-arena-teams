#!/usr/bin/env python3
"""
Vercel-compatible Python Serverless Function (`POST /api/recognize-lineup`)
and standalone CLI for extracting structured AFK Arena teams (heroes,
collections, collection levels, collection node stat icons, and pets)
from a guide or export screenshot.

Supports:
- Local Ultralytics YOLO11n checkpoints (.pt) when available,
- OpenCV DNN / ONNXRuntime (.onnx) models for lightweight serverless deployment,
- Pure OpenCV/NumPy multi-scale grid proposal fallback when no detector weights are present.
"""
import base64
from http.server import BaseHTTPRequestHandler
import importlib.util
import json
from pathlib import Path
import time

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
    catalogs = matcher.load_catalogs(schema_sql, gt_mod)
    hero_meta, pet_meta, collections_catalog = matcher.load_hero_and_pet_metadata(
        schema_sql, gt_mod
    )
    cache_root = (
        Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    )
    candidate_assets, _ = matcher.build_identity_candidate_assets(catalogs, cache_root)
    type_tensors = matcher.build_type_tensors(candidate_assets, cache_root)
    node_assets = matcher.build_collection_node_assets(cache_root)

    model = None
    try:
        from ultralytics import YOLO

        detector_report_path = LAB_DIR / "detector-resolution-results.json"
        if detector_report_path.is_file():
            rep = json.loads(detector_report_path.read_text(encoding="utf-8"))
            weights_path = Path(rep.get("weights", ""))
            if weights_path.is_file():
                model = YOLO(str(weights_path))
    except Exception:
        model = None

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
            "model": model,
        }
    )
    return _STATE


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
    model = state["model"]

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

    formations = det.teams_to_seed_formations(solved_teams)
    return {
        "ok": True,
        "elapsed_seconds": round(time.time() - t0, 3),
        "image_shape": {"width": int(img.shape[1]), "height": int(img.shape[0])},
        "team_count": len(solved_teams),
        "teams": solved_teams,
        "formations": formations,
    }


class handler(BaseHTTPRequestHandler):
    """Vercel Python Serverless Function entry point."""

    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")
            if "application/json" in content_type:
                payload = json.loads(body.decode("utf-8"))
                b64_str = payload.get("image_base64") or payload.get("image") or ""
                if "," in b64_str:
                    b64_str = b64_str.split(",", 1)[1]
                image_bytes = base64.b64decode(b64_str)
            else:
                image_bytes = body

            result = recognize_image_bytes(image_bytes)
            response_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
        except Exception as exc:
            err_bytes = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_bytes)))
            self.end_headers()
            self.wfile.write(err_bytes)
