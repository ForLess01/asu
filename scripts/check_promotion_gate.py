"""Demonstrate scientific rejection while verifying that the active bytes survive."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def fingerprint(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.rglob('*') if p.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--champion', type=Path, required=True)
    args = parser.parse_args()
    before = fingerprint(args.champion)
    run = subprocess.run([sys.executable, str(ROOT/'ml/promote.py'), '--candidate', str(args.candidate), '--champion', str(args.champion)], capture_output=True, text=True, timeout=45)
    if run.returncode != 2 or fingerprint(args.champion) != before:
        raise SystemExit('Expected scientific rejection and byte-identical active model')
    result = json.loads(run.stdout)
    if result['status'] != 'rejected' or 'label_semantics_unapproved' not in result['reasons']:
        raise SystemExit('Rejection did not include the unresolved label contract')
    print(json.dumps({'gate_demonstration': 'passed', 'active_bundle_preserved': True, 'verdict': result}, indent=2))


if __name__ == '__main__':
    main()
