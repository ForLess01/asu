#!/usr/bin/env python3
"""Assess a candidate and preserve the champion on any rejection."""

import argparse
import json
from pathlib import Path
import sys

from asu_ml.registry import publish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--champion", type=Path, required=True)
    parser.add_argument("--allow-experimental-publish", action="store_true",
                        help="Separate experimental-only path, never a production gate pass")
    args = parser.parse_args()
    try:
        verdict = publish(args.candidate, args.champion, args.allow_experimental_publish)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Promotion rejected: {error}", file=sys.stderr)
        return 2
    print(json.dumps(verdict, ensure_ascii=False, indent=2, allow_nan=False))
    return 2 if verdict["status"] == "rejected" else 0


if __name__ == "__main__":
    raise SystemExit(main())
