"""Create one managed Auth account and seed its real Asu workspace directly in Postgres.

Credentials are written once to an ignored mode-0600 local file, never stdout or Git.
Only the newly returned Auth UUID is eligible for cleanup if seeding fails.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.request
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.neon_sql import connection_env
from scripts.provision_neon import cli, records


def seed_workspace():
    now = datetime.now(timezone.utc)
    timestamp = lambda value: value.isoformat().replace('+00:00', 'Z')
    source = 'Datos semilla ficticios; no son mediciones ni recomendaciones'
    state = {
        'schema_version': 1, 'id': str(uuid4()), 'revision': 1, 'locale': 'es-PE', 'updatedAt': timestamp(now),
        'household': {'label': 'Hogar de demostración · datos ficticios', 'district': 'Pueblo Libre', 'department': 'LIMA', 'eps': 'SEDAPAL', 'occupancy': 4},
        'containers': [
            {'id': str(uuid4()), 'name': name, 'category': category, 'capacity': capacity, 'volume': volume, 'observedAt': timestamp(now)}
            for name, category, capacity, volume in [('Tanque principal · demo', 'other', 800, 600), ('Bidón de cocina · demo', 'drinking', 40, 30), ('Reserva auxiliar · demo', 'other', 120, 90)]
        ],
        'activities': [
            {'id': str(uuid4()), 'name': name, 'category': category, 'liters': liters, 'timesPerDay': frequency, 'essential': essential, 'source': source, 'updatedAt': timestamp(now)}
            for name, category, liters, frequency, essential in [('Bebida y cocina · demo', 'drinking', 12, 1, True), ('Higiene del hogar · demo', 'other', 60, 1, True), ('Lavado de ropa · demo', 'other', 70, .25, False)]
        ],
        'incidents': [{'id': str(uuid4()), 'startedAt': timestamp(now-timedelta(hours=36)), 'restoredAt': timestamp(now-timedelta(hours=30)),
                       'source': source, 'scope': 'household', 'precision': 'approximate',
                       'updates': [{'at': timestamp(now-timedelta(hours=30)), 'note': 'Retorno ficticio para demostración; no es una etiqueta de entrenamiento.'}]}],
        'tasks': [{'id': str(uuid4()), 'title': title, 'done': done, 'dueAt': timestamp(now+timedelta(hours=hours))}
                  for title, done, hours in [('Demo: revisar la medición de reserva', False, 4), ('Demo: consultar el aviso de la EPS', False, 8), ('Demo: preparar un respaldo del plan', True, 12)]],
        'scenarios': [],
    }
    state['scenarios'] = [{'id': str(uuid4()), 'at': timestamp(now), 'hours': hours, 'deferredIds': [], 'replenishment': 0,
                           'category': 'other', 'baseRevision': 1, 'inputs': {'reserves': {'drinking': 30, 'other': 690}, 'rates': {'drinking': .5, 'other': 77.5/24}}}
                          for hours in (6, 12)]
    return state


def seed_sql(identity, state):
    identity = str(UUID(identity))
    payload = json.dumps(state, ensure_ascii=False, allow_nan=False).replace("'", "''")
    workspace = str(UUID(state['id']))
    return f"begin; insert into public.household_workspaces(id,owner_id,payload,revision) values ('{workspace}'::uuid,'{identity}'::uuid,'{payload}'::jsonb,1); select revision from public.household_workspaces where owner_id='{identity}'::uuid; commit;"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-create', action='store_true')
    args = parser.parse_args()
    if not args.allow_create:
        raise SystemExit('Explicit --allow-create is required; no account was created')
    project = json.loads((ROOT/'neon/public-project.json').read_text())
    if project['project_id'] != 'green-snow-30498948' or project['database'] != 'asu':
        raise SystemExit('Only the approved dedicated Asu project is allowed')
    organizations = records(cli('orgs', 'list'), 'organizations')
    if not any(o['id'] == project['organization_id'] and o.get('plan') == 'free' for o in organizations):
        raise SystemExit('Verified Free organization required')
    destination = ROOT/'.env.seed.local'
    ignored = subprocess.run(['git', 'check-ignore', '--quiet', str(destination)], cwd=ROOT).returncode == 0
    if not ignored:
        raise SystemExit('Credential destination must be Git-ignored')
    email, password = f'asu-demo-{secrets.token_hex(4)}@example.com', secrets.token_urlsafe(32)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(f'ASU_SEED_URL=https://asu-forless01.pages.dev\nASU_SEED_EMAIL={email}\nASU_SEED_PASSWORD={password}\n')
    created = None
    try:
        request = urllib.request.Request(project['auth_url']+'/sign-up/email',
            data=json.dumps({'name': 'Cuenta de demostración Asu', 'email': email, 'password': password}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': 'https://asu-forless01.pages.dev', 'User-Agent': 'Asu-Seed-Operator/1.0'}, method='POST')
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
        created = str(UUID(result['user']['id']))
        state = seed_workspace()
        query = subprocess.run(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], input=seed_sql(created, state),
                               env=connection_env(project), capture_output=True, text=True, timeout=90)
        if query.returncode:
            raise RuntimeError('seed-sql-failed')
        receipt = {'status': 'created_and_seeded', 'observed_at': datetime.now(timezone.utc).isoformat(),
                   'project_id': project['project_id'], 'auth_creation': 'Managed Auth signup; never a hand-written credential hash',
                   'workspace_write': 'Direct PostgreSQL insert with native table validation and owner FK',
                   'containers': len(state['containers']), 'activities': len(state['activities']), 'tasks': len(state['tasks']),
                   'incidents': len(state['incidents']), 'scenarios': len(state['scenarios']), 'synthetic_data_labelled': True,
                   'credentials_file': '.env.seed.local (ignored, mode 0600)', 'credentials_or_account_identifiers_included': False}
        (ROOT/'artifacts/verification/seed-account.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps(receipt, ensure_ascii=False))
    except Exception:
        # A lost signup response can still mean the server created the account.
        # Without its confirmed UUID, retain the private login for owner recovery.
        cleaned = created is not None and cli('neon-auth', 'user', 'delete', created, '--project-id', project['project_id'], '--branch', project['branch_id'], allow_failure=True, allow_text=True) is not None
        if cleaned:
            destination.unlink()
        raise SystemExit('Seed operation failed; raw credential-bearing responses suppressed. '+('New-account cleanup completed.' if cleaned else 'Cleanup unconfirmed; credentials retained locally for owner recovery.')) from None


if __name__ == '__main__':
    main()
