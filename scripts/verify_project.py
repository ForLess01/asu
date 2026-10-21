"""Execute the integrated checks without an application build or deployment."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    commands = [
        ('TypeScript', ['npm', 'run', 'typecheck']),
        ('Domain, browser-model integrity and 10000-vector Node parity', ['npm', 'test']),
        ('ML, SQL static guardrails and delivery checks', [sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'ml/tests', 'supabase/tests/test_schema.py', 'neon/tests', 'scripts/tests']),
        ('Desktop and mobile user flows', ['npm', 'run', 'test:e2e']),
        ('Production-promotion rejection preserving active model', [sys.executable, 'scripts/check_promotion_gate.py', '--candidate', 'artifacts/current', '--champion', 'apps/web/public/models/current']),
    ]
    evidence = {'executed_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'tests': [], 'application_build_executed': False, 'deployment_executed': False}
    env = {**os.environ, 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'PYTHONDONTWRITEBYTECODE': '1', 'NO_COLOR': '1'}
    destination = ROOT/'artifacts/verification'
    destination.mkdir(parents=True, exist_ok=True)
    for name, command in commands:
        start = time.perf_counter()
        result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, timeout=240)
        output = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout + result.stderr)
        passed = re.findall(r'(\d+) passed', output)
        record = {'name': name, 'command': ' '.join(command).replace(sys.executable, 'python3'), 'exit_code': result.returncode, 'passed': int(passed[-1]) if passed else None, 'seconds': round(time.perf_counter()-start, 2)}
        evidence['tests'].append(record)
        print(f'{name}: exit={result.returncode}, passed={record["passed"]}, seconds={record["seconds"]}', flush=True)
        if result.returncode:
            print(output)
            evidence['status'] = 'failed'
            (destination/'test-evidence.json').write_text(json.dumps(evidence, indent=2)+'\n')
            raise SystemExit(result.returncode)
    evidence['status'] = 'passed'
    database = destination/'database.json'
    if database.exists():
        evidence['database'] = json.loads(database.read_text())
    for name in ('neon-database', 'neon-hosted', 'neon-hosted-loopback', 'neon-hosted-local-app', 'neon-provisioned'):
        path = destination/f'{name}.json'
        if path.exists():
            evidence[name] = json.loads(path.read_text())
    evidence['limitations'] = ['Hosted Neon email/password Auth and synchronization are verified in separate opt-in receipts; interactive Google OAuth is not', 'Local database checks use isolated PostgreSQL with an Auth compatibility fixture', 'Service-worker coherence checks exercise logic; a packaged production PWA is not verified', 'Remote workflows are budget-gated and skipped; no executed remote tests or public deployment is claimed', 'Reported-duration model is experimental, label_semantics_approved=false']
    (destination/'test-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
