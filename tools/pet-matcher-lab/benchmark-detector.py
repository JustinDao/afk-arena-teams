#!/usr/bin/env python3
import argparse
import csv
from contextlib import contextmanager
import hashlib
import json
import math
import os
import platform
import shutil
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import torch
import yaml
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
from sahi import AutoDetectionModel
from sahi.predict import get_sliced_prediction
from ultralytics import YOLO


SEED = 2026
EPOCHS = 10
IMAGE_SIZE = 640
SLICE_SIZE = 640
SLICE_OVERLAP = 0.2
CONFIDENCE_THRESHOLD = 0.001
BATCH_SIZE = 2
CLASS_NAME = "game_icon"
METRIC_NAMES = (
    "AP",
    "AP50",
    "AP75",
    "AP_small",
    "AP_medium",
    "AP_large",
    "AR1",
    "AR10",
    "AR100",
    "AR_small",
    "AR_medium",
    "AR_large",
)


@contextmanager
def working_directory(directory):
    previous_directory = Path.cwd()
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(previous_directory)


def parse_args():
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Run leave-one-source-group-out YOLO11n and SAHI COCO evaluation."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=repo_root / "afk-icon-pilot-coco.json",
        help="COCO annotation JSON (default: repository pilot dataset).",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path.home() / ".cache" / "afk-icon-detector-benchmark",
        help="Directory for generated folds and model weights.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "tools" / "pet-matcher-lab" / "detector-benchmark-results.json",
        help="Path for the machine-readable benchmark report.",
    )
    parser.add_argument(
        "--resume-run",
        type=Path,
        help="Resume folds in an existing run directory when checkpoints are available.",
    )
    return parser.parse_args(), repo_root


def load_dataset(dataset_path, repo_root):
    coco_data = json.loads(dataset_path.read_text(encoding="utf-8"))
    if len(coco_data.get("categories", [])) != 1:
        raise ValueError("The benchmark expects exactly one COCO category.")
    if coco_data["categories"][0]["name"] != CLASS_NAME:
        raise ValueError(f'The COCO category must be named "{CLASS_NAME}".')

    images = coco_data.get("images", [])
    annotations = coco_data.get("annotations", [])
    if not images or not annotations:
        raise ValueError("The COCO dataset must include images and annotations.")

    groups = defaultdict(list)
    images_by_id = {}
    for image in images:
        group = image.get("source_group")
        if not isinstance(group, str) or not group.strip():
            raise ValueError(f'Image {image.get("id")} has no source_group.')
        image_path = (repo_root / image["file_name"]).resolve()
        if not image_path.is_relative_to(repo_root.resolve()):
            raise ValueError(f'Image path escapes the repository: {image["file_name"]}')
        if not image_path.is_file():
            raise FileNotFoundError(f"Dataset image does not exist: {image_path}")
        image["_resolved_path"] = image_path
        images_by_id[image["id"]] = image
        groups[group].append(image)

    if len(groups) < 2:
        raise ValueError("At least two source groups are required for held-out evaluation.")

    annotations_by_image = defaultdict(list)
    for annotation in annotations:
        if annotation["image_id"] not in images_by_id:
            raise ValueError(f'Annotation references missing image {annotation["image_id"]}.')
        annotations_by_image[annotation["image_id"]].append(annotation)

    return coco_data, groups, images_by_id, annotations_by_image


def create_fold_dataset(run_dir, fold_name, train_images, annotations_by_image):
    fold_dir = run_dir / "data" / fold_name
    image_dir = fold_dir / "images" / "train"
    label_dir = fold_dir / "labels" / "train"
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)

    for image in train_images:
        suffix = image["_resolved_path"].suffix.lower()
        file_stem = f'image-{image["id"]:04d}'
        destination = image_dir / f"{file_stem}{suffix}"
        shutil.copy2(image["_resolved_path"], destination)

        width = image["width"]
        height = image["height"]
        label_lines = []
        for annotation in annotations_by_image[image["id"]]:
            x, y, box_width, box_height = annotation["bbox"]
            center_x = (x + box_width / 2) / width
            center_y = (y + box_height / 2) / height
            label_lines.append(
                f"0 {center_x:.8f} {center_y:.8f} "
                f"{box_width / width:.8f} {box_height / height:.8f}"
            )
        (label_dir / f"{file_stem}.txt").write_text(
            "\n".join(label_lines) + ("\n" if label_lines else ""),
            encoding="utf-8",
        )

    data_yaml = fold_dir / "data.yaml"
    data_yaml.write_text(
        yaml.safe_dump(
            {
                "path": str(fold_dir),
                "train": "images/train",
                "val": "images/train",
                "names": {0: CLASS_NAME},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return data_yaml


def predictions_from_yolo(model, image, coco_image_id, coco_category_id):
    results = model.predict(
        source=str(image["_resolved_path"]),
        imgsz=IMAGE_SIZE,
        conf=CONFIDENCE_THRESHOLD,
        max_det=300,
        device="cpu",
        verbose=False,
    )
    predictions = []
    for result in results:
        if result.boxes is None:
            continue
        for xyxy, score in zip(
            result.boxes.xyxy.cpu().tolist(),
            result.boxes.conf.cpu().tolist(),
        ):
            x1, y1, x2, y2 = xyxy
            predictions.append(
                {
                    "image_id": coco_image_id,
                    "category_id": coco_category_id,
                    "bbox": [x1, y1, x2 - x1, y2 - y1],
                    "score": score,
                }
            )
    return predictions


def predictions_from_sahi(detection_model, image, coco_image_id, coco_category_id):
    result = get_sliced_prediction(
        str(image["_resolved_path"]),
        detection_model=detection_model,
        slice_height=SLICE_SIZE,
        slice_width=SLICE_SIZE,
        overlap_height_ratio=SLICE_OVERLAP,
        overlap_width_ratio=SLICE_OVERLAP,
        perform_standard_pred=True,
        postprocess_type="NMS",
        postprocess_match_threshold=0.5,
        confidence_threshold=CONFIDENCE_THRESHOLD,
        verbose=0,
        progress_bar=False,
    )
    predictions = []
    for object_prediction in result.object_prediction_list:
        x1, y1, x2, y2 = object_prediction.bbox.to_xyxy()
        predictions.append(
            {
                "image_id": coco_image_id,
                "category_id": coco_category_id,
                "bbox": [x1, y1, x2 - x1, y2 - y1],
                "score": object_prediction.score.value,
            }
        )
    return predictions


def evaluate(coco, predictions, image_ids):
    if predictions:
        detection_coco = coco.loadRes(predictions)
    else:
        detection_coco = COCO()
        detection_coco.dataset = {
            "images": [
                image for image in coco.dataset["images"] if image["id"] in image_ids
            ],
            "categories": coco.dataset["categories"],
            "annotations": [],
        }
        detection_coco.createIndex()

    evaluator = COCOeval(coco, detection_coco, "bbox")
    evaluator.params.imgIds = sorted(image_ids)
    evaluator.evaluate()
    evaluator.accumulate()
    evaluator.summarize()
    return {
        name: (None if not math.isfinite(value) or value < 0 else float(value))
        for name, value in zip(METRIC_NAMES, evaluator.stats)
    }


def mean_metrics(fold_results, method):
    averaged = {}
    for metric in METRIC_NAMES:
        values = [
            fold[method][metric]
            for fold in fold_results
            if fold[method][metric] is not None
        ]
        averaged[metric] = statistics.mean(values) if values else None
    return averaged


def run():
    args, repo_root = parse_args()
    dataset_path = args.dataset.resolve()
    coco_data, groups, images_by_id, annotations_by_image = load_dataset(
        dataset_path, repo_root
    )
    coco_category_id = coco_data["categories"][0]["id"]

    if args.resume_run:
        run_dir = args.resume_run.resolve()
        if not run_dir.is_dir():
            raise FileNotFoundError(f"Benchmark run directory does not exist: {run_dir}")
        pretrained_weights = run_dir / "pretrained" / "yolo11n.pt"
    else:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
        run_dir = args.work_dir.resolve() / f"run-{run_id}"
        run_dir.mkdir(parents=True, exist_ok=False)
        pretrained_dir = run_dir / "pretrained"
        pretrained_dir.mkdir()
        with working_directory(pretrained_dir):
            YOLO("yolo11n.pt")
        pretrained_weights = pretrained_dir / "yolo11n.pt"
    if not pretrained_weights.is_file():
        raise FileNotFoundError(f"Pretrained YOLO11n weights are missing: {pretrained_weights}")
    pretrained_weights_sha256 = hashlib.sha256(pretrained_weights.read_bytes()).hexdigest()

    torch.manual_seed(SEED)
    torch.set_num_threads(8)
    torch.set_num_interop_threads(1)
    coco = COCO(str(dataset_path))
    all_predictions = {"yolo": [], "sahi": []}
    fold_results = []

    for fold_number, (held_out_group, test_images) in enumerate(
        sorted(groups.items()), start=1
    ):
        fold_name = f"fold-{fold_number}"
        train_images = [
            image
            for group_name, group_images in groups.items()
            if group_name != held_out_group
            for image in group_images
        ]
        data_yaml = create_fold_dataset(
            run_dir, fold_name, train_images, annotations_by_image
        )

        fold_run_dir = run_dir / "runs" / fold_name
        weights_path = fold_run_dir / "weights" / "last.pt"
        results_path = fold_run_dir / "results.csv"
        completed_epochs = 0
        recorded_training_seconds = None
        if results_path.is_file():
            with results_path.open(encoding="utf-8") as results_file:
                result_rows = list(csv.DictReader(results_file))
                completed_epochs = len(result_rows)
                if result_rows:
                    recorded_training_seconds = float(result_rows[-1]["time"])

        if completed_epochs >= EPOCHS and weights_path.is_file():
            train_seconds = recorded_training_seconds or 0.0
        else:
            train_started = time.monotonic()
            if completed_epochs > 0 and weights_path.is_file():
                YOLO(str(weights_path)).train(resume=True)
            else:
                YOLO(str(pretrained_weights)).train(
                    data=str(data_yaml),
                    epochs=EPOCHS,
                    imgsz=IMAGE_SIZE,
                    batch=BATCH_SIZE,
                    device="cpu",
                    workers=0,
                    seed=SEED,
                    deterministic=True,
                    patience=100,
                    project=str(run_dir / "runs"),
                    name=fold_name,
                    exist_ok=True,
                    plots=False,
                    verbose=False,
                )
            train_seconds = time.monotonic() - train_started
            if results_path.is_file():
                with results_path.open(encoding="utf-8") as results_file:
                    result_rows = list(csv.DictReader(results_file))
                    if result_rows:
                        train_seconds = float(result_rows[-1]["time"])
        if not weights_path.is_file():
            raise FileNotFoundError(f"Training did not produce final weights: {weights_path}")

        trained_model = YOLO(str(weights_path))
        yolo_predictions = []
        yolo_started = time.monotonic()
        for image in test_images:
            yolo_predictions.extend(
                predictions_from_yolo(
                    trained_model, image, image["id"], coco_category_id
                )
            )
        yolo_seconds = time.monotonic() - yolo_started

        detection_model = AutoDetectionModel.from_pretrained(
            model_type="ultralytics",
            model_path=str(weights_path),
            confidence_threshold=CONFIDENCE_THRESHOLD,
            device="cpu",
            image_size=IMAGE_SIZE,
        )
        sahi_predictions = []
        sahi_started = time.monotonic()
        for image in test_images:
            sahi_predictions.extend(
                predictions_from_sahi(
                    detection_model, image, image["id"], coco_category_id
                )
            )
        sahi_seconds = time.monotonic() - sahi_started

        test_image_ids = [image["id"] for image in test_images]
        yolo_metrics = evaluate(coco, yolo_predictions, test_image_ids)
        sahi_metrics = evaluate(coco, sahi_predictions, test_image_ids)
        all_predictions["yolo"].extend(yolo_predictions)
        all_predictions["sahi"].extend(sahi_predictions)
        fold_results.append(
            {
                "source_group": held_out_group,
                "training_images": len(train_images),
                "training_annotations": sum(
                    len(annotations_by_image[image["id"]]) for image in train_images
                ),
                "test_images": len(test_images),
                "test_annotations": sum(
                    len(annotations_by_image[image["id"]]) for image in test_images
                ),
                "training_seconds": train_seconds,
                "yolo_inference_seconds": yolo_seconds,
                "sahi_inference_seconds": sahi_seconds,
                "yolo": yolo_metrics,
                "sahi": sahi_metrics,
            }
        )
        print(
            f"{held_out_group}: YOLO AP={yolo_metrics['AP']}, "
            f"SAHI AP={sahi_metrics['AP']}"
        )

    all_image_ids = sorted(images_by_id)
    report = {
        "experiment": "source-grouped leave-one-guide-out",
        "limitations": [
            "Only three visually labeled source groups and 10 images.",
            "Pilot boxes are best-effort and have not undergone independent review.",
            "The single class measures localization only, not hero, pet, or collection identity.",
            "Collection node and investment badges are not annotated.",
            "SAHI combines full-image inference with sliced inference.",
        ],
        "dataset": {
            "path": str(dataset_path),
            "sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
            "images": len(coco_data["images"]),
            "annotations": len(coco_data["annotations"]),
            "source_groups": sorted(groups),
            "source_group_counts": {
                group: {"images": len(images), "annotations": sum(
                    len(annotations_by_image[image["id"]]) for image in images
                )}
                for group, images in sorted(groups.items())
            },
        },
        "configuration": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "torch": version("torch"),
            "torchvision": version("torchvision"),
            "ultralytics": version("ultralytics"),
            "sahi": version("sahi"),
            "pycocotools": version("pycocotools"),
            "model": "YOLO11n pretrained, fine-tuned independently per fold",
            "pretrained_weights": "yolo11n.pt",
            "pretrained_weights_sha256": pretrained_weights_sha256,
            "seed": SEED,
            "epochs": EPOCHS,
            "image_size": IMAGE_SIZE,
            "batch_size": BATCH_SIZE,
            "device": "cpu",
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "max_detections": 300,
            "sahi_slice_size": SLICE_SIZE,
            "sahi_overlap": SLICE_OVERLAP,
            "sahi_perform_standard_pred": True,
            "sahi_postprocess": "NMS at IoU 0.5",
            "training_validation": "training images only; fixed epochs; evaluate last.pt on held-out group",
        },
        "run_dir": str(run_dir),
        "resumed_run": bool(args.resume_run),
        "folds": fold_results,
        "macro_average": {
            "yolo": mean_metrics(fold_results, "yolo"),
            "sahi": mean_metrics(fold_results, "sahi"),
        },
        "out_of_fold": {
            "yolo": evaluate(coco, all_predictions["yolo"], all_image_ids),
            "sahi": evaluate(coco, all_predictions["sahi"], all_image_ids),
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_output.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    temporary_output.replace(args.output)
    print(f"Saved benchmark report to {args.output.resolve()}")


if __name__ == "__main__":
    run()
