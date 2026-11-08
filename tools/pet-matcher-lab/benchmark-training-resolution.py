#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path

import torch
import yaml
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
from ultralytics import YOLO


SEED = 2026
TRAIN_SIZE = 1280
TRAIN_BATCH = 1
EPOCHS = 10
INFERENCE_SIZES = (640, 1280, 2080)
CONFIDENCE_THRESHOLD = 0.001
DIAGNOSTIC_THRESHOLD = 0.25
MAX_DETECTIONS = 300


@contextmanager
def working_directory(directory):
    previous_directory = Path.cwd()
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(previous_directory)


def iou(first, second):
    first_x, first_y, first_width, first_height = first
    second_x, second_y, second_width, second_height = second
    intersection_width = max(
        0,
        min(first_x + first_width, second_x + second_width)
        - max(first_x, second_x),
    )
    intersection_height = max(
        0,
        min(first_y + first_height, second_y + second_height)
        - max(first_y, second_y),
    )
    intersection = intersection_width * intersection_height
    union = first_width * first_height + second_width * second_height - intersection
    return intersection / union if intersection else 0


def coco_metrics(coco, predictions, image_id):
    if predictions:
        detection_coco = coco.loadRes(predictions)
    else:
        detection_coco = COCO()
        detection_coco.dataset = {
            "images": [image for image in coco.dataset["images"] if image["id"] == image_id],
            "categories": coco.dataset["categories"],
            "annotations": [],
        }
        detection_coco.createIndex()
    evaluator = COCOeval(coco, detection_coco, "bbox")
    evaluator.params.imgIds = [image_id]
    evaluator.evaluate()
    evaluator.accumulate()
    evaluator.summarize()
    names = (
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
    return {
        name: (float(value) if value >= 0 else None)
        for name, value in zip(names, evaluator.stats)
    }


def operating_point(predictions, ground_truth):
    selected = sorted(
        (prediction for prediction in predictions if prediction["score"] >= DIAGNOSTIC_THRESHOLD),
        key=lambda prediction: prediction["score"],
        reverse=True,
    )
    matched = set()
    for prediction in selected:
        overlaps = [
            (iou(prediction["bbox"], truth), index)
            for index, truth in enumerate(ground_truth)
            if index not in matched
        ]
        if overlaps:
            overlap, index = max(overlaps)
            if overlap >= 0.5:
                matched.add(index)
    return {
        "confidence_threshold": DIAGNOSTIC_THRESHOLD,
        "predictions": len(selected),
        "hit_prediction_limit": len(selected) == MAX_DETECTIONS,
        "greedy_one_to_one_matches_iou_0_5": len(matched),
        "ground_truth_boxes": len(ground_truth),
    }


def main():
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Train a 1280-pixel YOLO11n on non-app groups and evaluate the held-out app image."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=repo_root / "afk-icon-pilot-coco.json",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path.home() / ".cache" / "afk-icon-detector-benchmark",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root
        / "tools"
        / "pet-matcher-lab"
        / "detector-training-resolution-results.json",
    )
    args = parser.parse_args()

    dataset_path = args.dataset.resolve()
    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    categories = data["categories"]
    if len(categories) != 1 or categories[0]["name"] != "game_icon":
        raise ValueError('Expected the pilot COCO dataset to have one "game_icon" category.')
    app_images = [
        image
        for image in data["images"]
        if image.get("source_group") == "nightmare-corridor-app-export"
    ]
    if len(app_images) != 1:
        raise ValueError("Expected exactly one app-export image as the held-out group.")
    app_image = app_images[0]
    images_by_id = {image["id"]: image for image in data["images"]}
    annotations_by_image = {image["id"]: [] for image in data["images"]}
    for annotation in data["annotations"]:
        annotations_by_image[annotation["image_id"]].append(annotation)
    train_images = [
        image
        for image in data["images"]
        if image.get("source_group") != app_image["source_group"]
    ]
    if not train_images or not annotations_by_image[app_image["id"]]:
        raise ValueError("Training images or held-out app annotations are missing.")
    for image in data["images"]:
        image_path = (repo_root / image["file_name"]).resolve()
        if not image_path.is_relative_to(repo_root.resolve()) or not image_path.is_file():
            raise FileNotFoundError(f"Invalid dataset image path: {image['file_name']}")
        image["_resolved_path"] = image_path

    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + f"-{os.getpid()}"
    run_dir = args.work_dir.resolve() / f"resolution-1280-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=False)
    pretrained_dir = run_dir / "pretrained"
    pretrained_dir.mkdir()
    with working_directory(pretrained_dir):
        YOLO("yolo11n.pt")
    pretrained_weights = pretrained_dir / "yolo11n.pt"
    if not pretrained_weights.is_file():
        raise FileNotFoundError(f"Pretrained weights were not downloaded: {pretrained_weights}")

    fold_dir = run_dir / "data"
    image_dir = fold_dir / "images" / "train"
    label_dir = fold_dir / "labels" / "train"
    image_dir.mkdir(parents=True)
    label_dir.mkdir(parents=True)
    for image in train_images:
        stem = f'image-{image["id"]:04d}'
        shutil.copy2(image["_resolved_path"], image_dir / f"{stem}{image['_resolved_path'].suffix.lower()}")
        width = image["width"]
        height = image["height"]
        labels = []
        for annotation in annotations_by_image[image["id"]]:
            x, y, box_width, box_height = annotation["bbox"]
            labels.append(
                f"0 {(x + box_width / 2) / width:.8f} "
                f"{(y + box_height / 2) / height:.8f} "
                f"{box_width / width:.8f} {box_height / height:.8f}"
            )
        (label_dir / f"{stem}.txt").write_text(
            "\n".join(labels) + ("\n" if labels else ""),
            encoding="utf-8",
        )
    data_yaml = fold_dir / "data.yaml"
    data_yaml.write_text(
        yaml.safe_dump(
            {
                "path": str(fold_dir),
                "train": "images/train",
                "val": "images/train",
                "names": {0: "game_icon"},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    model = YOLO(str(pretrained_weights))
    training_started = time.monotonic()
    model.train(
        data=str(data_yaml),
        epochs=EPOCHS,
        imgsz=TRAIN_SIZE,
        batch=TRAIN_BATCH,
        device="cpu",
        workers=0,
        seed=SEED,
        deterministic=True,
        patience=100,
        project=str(run_dir / "runs"),
        name="train-1280",
        exist_ok=True,
        plots=False,
        verbose=False,
    )
    training_seconds = time.monotonic() - training_started
    weights = run_dir / "runs" / "train-1280" / "weights" / "last.pt"
    if not weights.is_file():
        raise FileNotFoundError(f"High-resolution training produced no weights: {weights}")

    coco = COCO(str(dataset_path))
    ground_truth = [annotation["bbox"] for annotation in annotations_by_image[app_image["id"]]]
    trained_model = YOLO(str(weights))
    results = []
    for inference_size in INFERENCE_SIZES:
        started = time.monotonic()
        prediction_result = trained_model.predict(
            source=str(app_image["_resolved_path"]),
            imgsz=inference_size,
            conf=CONFIDENCE_THRESHOLD,
            max_det=MAX_DETECTIONS,
            device="cpu",
            verbose=False,
        )[0]
        inference_seconds = time.monotonic() - started
        predictions = []
        for coordinates, score in zip(
            prediction_result.boxes.xyxy.cpu().tolist(),
            prediction_result.boxes.conf.cpu().tolist(),
        ):
            x1, y1, x2, y2 = coordinates
            predictions.append(
                {
                    "image_id": app_image["id"],
                    "category_id": categories[0]["id"],
                    "bbox": [x1, y1, x2 - x1, y2 - y1],
                    "score": score,
                }
            )
        result = {
            "imgsz": inference_size,
            "inference_seconds": inference_seconds,
            "detections": len(predictions),
            "metrics": coco_metrics(coco, predictions, app_image["id"]),
            "operating_point": operating_point(predictions, ground_truth),
            "prediction_boxes": predictions,
        }
        results.append(result)
        print(
            f"train={TRAIN_SIZE}, infer={inference_size}: "
            f"AP={result['metrics']['AP']:.3f}, "
            f"AP50={result['metrics']['AP50']:.3f}, "
            f"AR100={result['metrics']['AR100']:.3f}",
            flush=True,
        )

    prior_resolution_path = (
        repo_root / "tools" / "pet-matcher-lab" / "detector-resolution-results.json"
    )
    prior_resolution = json.loads(prior_resolution_path.read_text(encoding="utf-8"))
    baseline_by_size = {
        result["imgsz"]: result["metrics"]
        for result in prior_resolution["results"]
    }
    report = {
        "experiment": "1280-pixel training, held-out app image, inference resolution sweep",
        "dataset": {
            "path": str(dataset_path),
            "sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
            "training_images": len(train_images),
            "training_annotations": sum(
                len(annotations_by_image[image["id"]]) for image in train_images
            ),
            "held_out_source_group": app_image["source_group"],
            "held_out_image": app_image["file_name"],
            "held_out_ground_truth_boxes": len(ground_truth),
        },
        "configuration": {
            "model": "YOLO11n",
            "pretrained_weights_sha256": hashlib.sha256(pretrained_weights.read_bytes()).hexdigest(),
            "training_size": TRAIN_SIZE,
            "batch_size": TRAIN_BATCH,
            "epochs": EPOCHS,
            "seed": SEED,
            "device": "cpu",
            "torch_threads": 4,
            "inference_sizes": list(INFERENCE_SIZES),
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "max_detections": MAX_DETECTIONS,
            "training_validation": "training images only; fixed epochs; evaluate last.pt on held-out app image",
            "training_seconds": training_seconds,
        },
        "limitations": [
            "One held-out app image and best-effort generic icon boxes.",
            "Identity of heroes, pets, and collections is not evaluated.",
            "The 640-trained baseline and 1280-trained model each use a single training run.",
        ],
        "run_dir": str(run_dir),
        "weights": str(weights),
        "baseline_640_training_metrics": baseline_by_size,
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_output.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary_output.replace(args.output)
    print(f"Saved results to {args.output.resolve()}")


if __name__ == "__main__":
    main()
