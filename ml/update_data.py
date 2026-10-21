#!/usr/bin/env python3
"""Cron-compatible bounded source check; identical bytes/canonical content are no-op."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

from asu_ml.data import EXPECTED_SHA, ingest, save_json

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing file for offline check; omitted means check official URL")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--state", type=Path, default=ROOT / "data/manifests/update-state.json")
    parser.add_argument("--expected-sha", default=EXPECTED_SHA)
    parser.add_argument("--allow-source-update", action="store_true")
    parser.add_argument("--retrain", action="store_true", help="Train changed content into a new artifact candidate, no automatic promotion")
    parser.add_argument("--output-root", type=Path, default=ROOT / "artifacts/runs")
    parser.add_argument("--timeout-seconds", type=int, default=300, help="Bounded foreground training subprocess budget")
    args = parser.parse_args()
    previous = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}
    try:
        # Use a distinct request cache for checking only when no explicit source:
        # ingest's normal training path reuses pinned bytes, whereas this command
        # must actually re-fetch to discover provider changes. The fetch helper
        # passes the same validation/immutable write path, not a second ingester.
        result = ingest(args.source, args.cache, args.expected_sha, args.allow_source_update,
                        refresh=args.source is None)
        unchanged = result["source_sha256"] == previous.get("source_sha256") or result["canonical_sha256"] == previous.get("canonical_sha256")
        result["status"] = "no_op" if unchanged else "changed"
        if unchanged:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        # Validate every changed content batch before state advances or training.
        from asu_ml.data import canonical_events, read_csv
        events, quality = canonical_events(read_csv(result["path"]))
        result["eligible_events"] = len(events)
        result["quality_exclusions"] = quality["exclusions"]
        if args.retrain:
            output = args.output_root / result["source_sha256"]
            command = [sys.executable, str(ROOT / "ml/run_pipeline.py"), "--source", result["path"],
                       "--cache", str(args.cache), "--output", str(output), "--expected-sha", result["source_sha256"]]
            subprocess.run(command, check=True, timeout=args.timeout_seconds)
            result["training_output"] = str(output)
        save_json(args.state, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Data update rejected; prior state/champion preserved: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
