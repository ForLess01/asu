"""Execute SQL on the dedicated Free Asu project without logging credentials."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def connection_env(project):
    # This CLI subcommand returns a plain URI even when --output=json is set.
    # Keep it in memory and pass its password only through the psql environment.
    result = subprocess.run(['neon', 'connection-string', project['branch_id'], '--project-id', project['project_id'], '--database-name', project['database'], '--role-name', project.get('database_role', 'asu_owner'), '--analytics=false', '--color=false'], text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Could not obtain the dedicated project connection; response suppressed')
    raw = result.stdout.strip()
    response = raw if raw.startswith(('postgresql://', 'postgres://')) else json.loads(raw)
    def find(value):
        if isinstance(value, str) and value.startswith(('postgresql://', 'postgres://')):
            return value
        if isinstance(value, dict):
            for item in value.values():
                result = find(item)
                if result:
                    return result
        if isinstance(value, list):
            for item in value:
                result = find(item)
                if result:
                    return result
        return None
    uri = find(response)
    if not uri:
        raise RuntimeError('The CLI did not return a database connection; raw response suppressed')
    parts = urlsplit(uri)
    expected_endpoint = urlsplit(project['data_api_url']).hostname.split('.')[0]
    actual_endpoint = (parts.hostname or '').split('.')[0].removesuffix('-pooler')
    if (actual_endpoint != expected_endpoint
            or unquote(parts.path.lstrip('/')) != project['database']
            or unquote(parts.username or '') != project.get('database_role', 'asu_owner')
            or not parts.password):
        raise RuntimeError('Dedicated Asu endpoint, database or role mismatch; connection rejected')
    return {**os.environ, 'PGHOST': parts.hostname, 'PGPORT': str(parts.port or 5432),
            'PGDATABASE': unquote(parts.path.lstrip('/')), 'PGUSER': unquote(parts.username or ''),
            'PGPASSWORD': unquote(parts.password or ''), 'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '20'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--query')
    source.add_argument('--file', type=Path)
    args = parser.parse_args()
    project = json.loads((ROOT/'neon/public-project.json').read_text())
    if project['project_name'] != 'asu' or project['organization_plan'] != 'free':
        raise SystemExit('Only the dedicated verified-Free Asu project is allowed')
    command = ['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    command += ['-f', str(args.file)] if args.file else ['-c', args.query]
    result = subprocess.run(command, env=connection_env(project), text=True, capture_output=True, timeout=120)
    print(result.stdout, end='')
    if result.returncode:
        # psql never receives a password in argv or SQL from this helper.
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
