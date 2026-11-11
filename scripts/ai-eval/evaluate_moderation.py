#!/usr/bin/env python3
"""Evaluate the synthetic Persian moderation corpus against the staging API.

Only unique synthetic text cases are submitted. The script deliberately keeps
"review" labels outside the binary allow/block confusion matrix because the
current API does not expose a human-review decision.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

EXPECTED_DIMENSION = 384


def get_json(url: str, timeout: int = 30) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict[str, Any], timeout: int = 180) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_unique_cases(path: Path) -> list[dict[str, Any]]:
    by_text: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("synthetic_only") is not True:
                raise ValueError(f"Fixture line {line_no} is not marked synthetic_only")
            text = row.get("text")
            label = row.get("expected_policy")
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Fixture line {line_no} has invalid text")
            if label not in {"allow", "block", "review"}:
                raise ValueError(f"Fixture line {line_no} has invalid expected_policy")
            previous = by_text.get(text)
            if previous and previous["expected_policy"] != label:
                raise ValueError("The same text has conflicting expected policy labels")
            by_text[text] = row
    return list(by_text.values())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:18018")
    parser.add_argument("--embedding-url", default="http://127.0.0.1:18104")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.fixtures.is_file():
        raise SystemExit(f"Fixture file not found: {args.fixtures}")
    if not 1 <= args.batch_size <= 10:
        raise SystemExit("--batch-size must be between 1 and 10")

    embedding_health = get_json(f"{args.embedding_url}/health")
    if embedding_health.get("model_loaded") is not True or embedding_health.get("redis") is not True:
        raise SystemExit(f"Embedding is not ready: {embedding_health}")
    sample_embedding = post_json(
        f"{args.embedding_url}/embed",
        {"text": "سلام، این یک آزمون بردارسازی فارسی است."},
    )
    if sample_embedding.get("dimension") != EXPECTED_DIMENSION:
        raise SystemExit(f"Unexpected embedding dimension: {sample_embedding.get('dimension')}")

    moderation_health = get_json(f"{args.base_url}/health")
    if moderation_health.get("status") != "healthy":
        raise SystemExit(f"Moderation is not healthy: {moderation_health}")

    cases = load_unique_cases(args.fixtures)
    if not cases:
        raise SystemExit("No moderation fixtures found")

    observations: list[dict[str, Any]] = []
    started = time.monotonic()
    for offset in range(0, len(cases), args.batch_size):
        batch = cases[offset : offset + args.batch_size]
        response = post_json(
            f"{args.base_url}/moderate/batch",
            {"texts": [row["text"] for row in batch], "context": "message"},
        )
        results = response.get("results")
        if not isinstance(results, list) or len(results) != len(batch):
            raise RuntimeError(
                f"Batch response contract mismatch at offset {offset}: {response}"
            )

        for row, result in zip(batch, results):
            allowed = result.get("allowed")
            confidence = result.get("confidence")
            layer = result.get("layer")
            if not isinstance(allowed, bool):
                raise RuntimeError(f"Invalid allowed flag for {row['case_id']}: {result}")
            if (
                isinstance(confidence, bool)
                or not isinstance(confidence, (int, float))
                or not math.isfinite(float(confidence))
                or not 0.0 <= float(confidence) <= 1.0
            ):
                raise RuntimeError(f"Invalid confidence for {row['case_id']}: {result}")
            observations.append(
                {
                    "case_id": row["case_id"],
                    "category": row["category"],
                    "expected_policy": row["expected_policy"],
                    "actual_policy": "allow" if allowed else "block",
                    "reason": result.get("reason"),
                    "layer": layer,
                    "confidence": float(confidence),
                    "text": row["text"],
                }
            )

        print(
            f"Evaluated {min(offset + len(batch), len(cases))}/{len(cases)} unique synthetic cases",
            flush=True,
        )

    binary = [row for row in observations if row["expected_policy"] in {"allow", "block"}]
    tp = sum(row["expected_policy"] == "block" and row["actual_policy"] == "block" for row in binary)
    fn = sum(row["expected_policy"] == "block" and row["actual_policy"] == "allow" for row in binary)
    fp = sum(row["expected_policy"] == "allow" and row["actual_policy"] == "block" for row in binary)
    tn = sum(row["expected_policy"] == "allow" and row["actual_policy"] == "allow" for row in binary)
    unavailable = sum(row["layer"] == "semantic_unavailable" for row in observations)
    review_counts = Counter(row["actual_policy"] for row in observations if row["expected_policy"] == "review")
    category_metrics: dict[str, dict[str, int]] = {}
    for row in observations:
        metrics = category_metrics.setdefault(
            row["category"], {"cases": 0, "allow": 0, "block": 0, "semantic_unavailable": 0}
        )
        metrics["cases"] += 1
        metrics[row["actual_policy"]] += 1
        if row["layer"] == "semantic_unavailable":
            metrics["semantic_unavailable"] += 1

    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall else None
    accuracy = (tp + tn) / len(binary) if binary else None

    report = {
        "synthetic_only": True,
        "model": sample_embedding.get("model_name"),
        "embedding_dimension": sample_embedding.get("dimension"),
        "unique_cases_evaluated": len(observations),
        "binary_labeled_cases": len(binary),
        "review_labeled_cases": len(observations) - len(binary),
        "confusion_matrix": {"true_positive_block": tp, "false_negative": fn, "false_positive": fp, "true_negative_allow": tn},
        "metrics_excluding_review_labels": {
            "accuracy": accuracy,
            "precision_block": precision,
            "recall_block": recall,
            "f1_block": f1,
        },
        "review_label_actual_outcomes": dict(review_counts),
        "semantic_unavailable_count": unavailable,
        "category_metrics": category_metrics,
        "duration_seconds": round(time.monotonic() - started, 2),
        "cases": observations,
        "limitations": [
            "Synthetic labels are controlled fixtures, not human-validated ground truth.",
            "The current API is binary allow/block and has no dedicated human-review response.",
            "This report does not establish real-world Persian moderation accuracy.",
        ],
    }

    print(json.dumps({k: v for k, v in report.items() if k != "cases"}, ensure_ascii=False, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Full report saved to {args.output}")

    if unavailable:
        print("FAIL: at least one case could not complete semantic moderation", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as exc:
        print(f"HTTP request failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
