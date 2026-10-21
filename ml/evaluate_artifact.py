#!/usr/bin/env python3
"""Standalone evaluator for portable model JSON and optional sklearn fixtures."""

import argparse
import json
from pathlib import Path
import sys
import time

import numpy as np

from asu_ml.portable import encode_request, predict_artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, help="Verify every expected value within 1e-4 h")
    parser.add_argument("--started-at", help="ISO start timestamp interpreted in America/Lima")
    parser.add_argument("--eps")
    parser.add_argument("--department")
    args = parser.parse_args()
    try:
        artifact = json.loads(args.model.read_text(encoding="utf-8"))
        if args.fixtures:
            fixture = json.loads(args.fixtures.read_text(encoding="utf-8"))
            if set(fixture) != {"inputs", "expected"}:
                raise ValueError("Fixture schema must be exactly inputs and expected")
            start = time.perf_counter()
            prediction = predict_artifact(artifact, fixture["inputs"])
            expected = np.asarray(fixture["expected"], dtype=float)
            if expected.shape != prediction.shape or not np.isfinite(expected).all():
                raise ValueError("Invalid expected fixture values")
            error = float(np.max(np.abs(prediction - expected)))
            print(json.dumps({"count": len(prediction), "max_abs_error": error,
                              "seconds": time.perf_counter() - start, "tolerance_hours": 1e-4}))
            return 0 if error <= 1e-4 else 2
        vector = encode_request(artifact, args.started_at, args.eps, args.department)
        print(json.dumps({"status": "experimental", "target_semantics": artifact["target_semantics"],
                          "p10_p50_p90_hours": predict_artifact(artifact, [vector])[0].tolist()}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Inference rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
