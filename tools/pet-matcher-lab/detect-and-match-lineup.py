#!/usr/bin/env python3
import argparse
import importlib.util
import json
import math
from pathlib import Path

import cv2
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


def parse_args(repo_root, lab_dir):
    parser = argparse.ArgumentParser(
        description="Detect generic game icons, then classify each crop with the catalog matcher."
    )
    parser.add_argument(
        "--image",
        type=Path,
        default=repo_root / "afk-nightmare-corridor-infernal-overlord-9.png",
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
        help="Path for the detections and catalog predictions JSON.",
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
    catalogs = matcher.load_catalogs(schema_sql, ground_truth_module)
    cache_root = (
        Path.home() / ".cache" / "afk-icon-detector-benchmark" / "identity-assets"
    )
    candidate_assets, missing_collection_assets = (
        matcher.build_identity_candidate_assets(catalogs, cache_root)
    )
    source_screenshot, source_scale = matcher.source_scale_image(screenshot)

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

    known_image_path = (repo_root / "afk-nightmare-corridor-infernal-overlord-9.png").resolve()
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
            "method": "mixed-type center-crop ranking, then source-scale alpha-masked identity reranking",
            "match_box_scale": args.match_box_scale,
            "catalog_sizes": {
                identity_type: len(entries) for identity_type, entries in catalogs.items()
            },
            "uncalibrated_score": "Lower matcher MSE is a closer template match; it is not a probability.",
        },
        "summary": summary,
        "limitations": [
            "Detector thresholds were tuned against the single known lineup-9 sample.",
            "Ground-truth evaluation uses one-to-one box matching at the configured IoU threshold.",
            "Identity accuracy is reported only for detections matched to a ground-truth box.",
            "This prototype matches identity only; it does not infer hero investments or collection levels from detector boxes.",
        ],
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
    print(f"Wrote detection and matching results to {args.output.resolve()}")


if __name__ == "__main__":
    main()
