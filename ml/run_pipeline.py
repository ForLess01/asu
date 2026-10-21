#!/usr/bin/env python3
"""Train an experimental candidate; publishing is explicit and gate assessed."""

import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "artifacts" / ".cache" / "matplotlib"))

from asu_ml.data import EXPECTED_SHA
from asu_ml.pipeline import run
from asu_ml.registry import publish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing local CSV, strictly offline when supplied")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw", help="Immutable SHA-addressed raw cache")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/current", help="New evidence directory; completed runs are never overwritten")
    parser.add_argument("--manifest-dir", type=Path, default=ROOT / "data/manifests")
    parser.add_argument("--expected-sha", default=EXPECTED_SHA)
    parser.add_argument("--allow-source-update", action="store_true", help="Explicitly accept different source bytes; still validate UTF-8, schema and events")
    parser.add_argument("--svr-train-cap", type=int, default=4000, help="Training-only SVR cap, recorded in experiments; no evaluation subsampling")
    parser.add_argument("--font-dir", type=Path, help="Optional Montserrat font folder; sans-serif fallback is nonfatal")
    parser.add_argument("--publish", type=Path, help="Local generated model alias, not deployment; requires --allow-experimental-publish")
    parser.add_argument("--allow-experimental-publish", action="store_true", help="Publish only if technical/performance checks pass; never marks production gate passed")
    args = parser.parse_args()
    if args.svr_train_cap < 20:
        parser.error("--svr-train-cap must be at least 20")
    if args.publish and not args.allow_experimental_publish:
        parser.error("--publish requires --allow-experimental-publish; label semantics are not approved")
    try:
        summary = run(args.source, args.output, args.cache, args.manifest_dir,
                      args.expected_sha, args.allow_source_update, args.svr_train_cap, args.font_dir)
        print(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False))
        if args.publish:
            verdict = publish(args.output, args.publish, experimental=True)
            print(json.dumps({"publication": verdict}, indent=2))
            if verdict["status"] == "rejected":
                return 2
        return 0
    except (ValueError, OSError) as error:
        print(f"Pipeline rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
