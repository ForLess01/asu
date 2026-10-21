"""Run real SQL/RLS tests in an isolated temporary PostgreSQL cluster.

This verifies database behavior with a provider-specific local Auth fixture.
It does not test hosted Supabase/Neon Auth, JWT verification or deployed sync.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider', choices=('supabase', 'neon'), default='supabase',
                        help='local migration and Auth fixture provider (default: supabase)')
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    for executable in ('initdb', 'pg_ctl', 'psql'):
        if not shutil.which(executable):
            raise SystemExit(f'{executable} is required; SQL tests were not executed')
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='asu-pg-') as temporary:
        base = Path(temporary)
        data = base/'data'
        init = subprocess.run(['initdb', '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], capture_output=True, text=True, timeout=60)
        if init.returncode:
            raise SystemExit(init.stderr)
        subprocess.run(['pg_ctl', '-D', str(data), '-l', str(base/'server.log'), '-o', f'-h 127.0.0.1 -p {port} -k {base} -F', '-w', 'start'], check=True, capture_output=True, text=True, timeout=60)
        connection = f'postgresql://postgres@127.0.0.1:{port}/postgres'
        results = []
        try:
            provider = ROOT/args.provider
            files = [provider/'tests/auth_fixture.sql', provider/'migrations/20261020000100_household_workspaces.sql', provider/'tests/workspace_isolation.sql']
            for file in files:
                run = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', connection, '-f', str(file)], capture_output=True, text=True, timeout=90)
                notices = [line.partition('NOTICE:')[2].strip() for line in run.stderr.splitlines() if 'PASS:' in line]
                results.append({'file': str(file.relative_to(ROOT)), 'exit_code': run.returncode, 'passed_assertions': len(notices)})
                print(f'{file.name}: exit={run.returncode}, assertions={len(notices)}')
                if run.returncode:
                    print(run.stderr)
                    raise SystemExit(run.returncode)
            evidence = {'status': 'passed', 'provider': args.provider, 'executed_at': datetime.now(timezone.utc).isoformat(), 'engine': subprocess.check_output(['psql', '--version'], text=True).strip(), 'scope': f'Isolated PostgreSQL with local {args.provider} Auth fixture; not hosted Auth, JWT verification or Data API', 'results': results, 'assertions': sum(r['passed_assertions'] for r in results)}
            if args.evidence:
                args.evidence.parent.mkdir(parents=True, exist_ok=True)
                args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
            print(json.dumps(evidence, ensure_ascii=False, indent=2))
        finally:
            subprocess.run(['pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop'], capture_output=True, timeout=30)


if __name__ == '__main__':
    main()
