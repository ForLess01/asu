"""Personalize only the existing credential-backed Asu account; preserve a private backup."""
import argparse
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.neon_sql import connection_env
from scripts.provision_neon import cli, records

MARKERS = re.compile(r'\b(?:demo|demostraci[oó]n|pruebas?|fictici[oa]s?)\b', re.I)


def normal_label(value, fallback):
    value = re.sub(r'^\s*(?:demo|prueba)\s*:\s*', '', value, flags=re.I)
    value = re.sub(r'\s*[·-]\s*(?:demo|prueba|fictici[oa])\s*$', '', value, flags=re.I).strip()
    return fallback if MARKERS.search(value) or not value else value[0].upper()+value[1:]


def personalized_workspace(before, name, catalog, now=None):
    name = name.strip()
    if not name or len(name) > 64 or '\n' in name or '\r' in name:
        raise ValueError('invalid-display-name')
    state = json.loads(json.dumps(before))
    now = now or datetime.now(timezone.utc)
    timestamp = lambda value: value.isoformat().replace('+00:00', 'Z')
    utility = next((item for item in catalog['utilities'] if 'EMSAPUNO' in item.upper().replace(' ', '')), None)
    if 'PUNO' not in catalog['departments'] or not utility:
        raise ValueError('puno-options-unavailable')
    state['revision'] += 1
    state['updatedAt'] = timestamp(now)
    state['household'] = {**(state.get('household') or {}), 'label': f'Hogar de {name}', 'district': 'Puno',
                          'department': 'PUNO', 'eps': utility, 'occupancy': (state.get('household') or {}).get('occupancy', 4)}
    for index, container in enumerate(state['containers']):
        container['name'] = normal_label(container['name'], f'Recipiente {index+1}')
    for index, activity in enumerate(state['activities']):
        activity['name'] = normal_label(activity['name'], f'Actividad {index+1}')
        if MARKERS.search(activity['source']): activity['source'] = 'Configuración inicial editable'
    for task in state['tasks']: task['title'] = normal_label(task['title'], 'Revisar el plan del hogar')
    for incident in state['incidents']:
        if MARKERS.search(incident['source']): incident['source'] = 'Registro inicial del hogar'
        for update in incident['updates']:
            if MARKERS.search(update['note']): update['note'] = 'Información inicial editable; confirmar el horario del registro.'
    containers = [('Tanque de lavandería', 'other', 250, 180), ('Bidón para consumo', 'drinking', 25, 20),
                  ('Reserva del baño', 'other', 120, 85), ('Contenedor de limpieza', 'other', 90, 60)]
    for label, category, capacity, volume in containers:
        if not any(c['name'].casefold() == label.casefold() for c in state['containers']):
            state['containers'].append({'id': str(uuid4()), 'name': label, 'category': category, 'capacity': capacity, 'volume': volume, 'observedAt': timestamp(now)})
    activities = [('Aseo de manos', 'other', 2, 8, True), ('Duchas programadas', 'other', 24, 2, True),
                  ('Lavado de utensilios', 'other', 15, 2, True), ('Limpieza de pisos', 'other', 20, .5, False),
                  ('Servicios higiénicos', 'other', 6, 12, True), ('Agua para visitas', 'drinking', 6, .25, False),
                  ('Limpieza de recipientes', 'other', 10, .25, True)]
    for label, category, liters, frequency, essential in activities:
        if not any(a['name'].casefold() == label.casefold() for a in state['activities']):
            state['activities'].append({'id': str(uuid4()), 'name': label, 'category': category, 'liters': liters,
                'timesPerDay': frequency, 'essential': essential, 'source': 'Configuración inicial editable', 'updatedAt': timestamp(now)})
    titles = ['Consultar los avisos de EMSAPUNO', 'Revisar fugas en conexiones', 'Actualizar el nivel del bidón de cocina',
              'Limpiar las tapas de los recipientes', 'Proteger las conexiones expuestas al frío', 'Organizar el uso de la lavandería',
              'Coordinar una reposición de agua', 'Revisar los escenarios del fin de semana', 'Confirmar los litros disponibles']
    for index, title in enumerate(titles):
        if not any(t['title'].casefold() == title.casefold() for t in state['tasks']):
            state['tasks'].append({'id': str(uuid4()), 'title': title, 'done': False, 'dueAt': timestamp(now+timedelta(hours=4+index*3))})
    reserves = {category: sum(c['volume'] or 0 for c in state['containers'] if c['category'] == category) for category in ('drinking', 'other')}
    rates = {category: sum(a['liters']*a['timesPerDay']/24 for a in state['activities'] if a['category'] == category) for category in ('drinking', 'other')}
    for hours in (18, 24, 36, 48):
        if not any(s['hours'] == hours for s in state['scenarios']):
            state['scenarios'].append({'id': str(uuid4()), 'at': timestamp(now), 'hours': hours, 'deferredIds': [], 'replenishment': 0,
                'category': 'other', 'baseRevision': state['revision'], 'inputs': {'reserves': reserves, 'rates': rates}})
    return state


def private_write(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as handle:
        handle.write(content)


def update_private_fields(path, fields):
    pending = path.with_name(path.name+f'.pending-{uuid4().hex}')
    try:
        private_write(pending, ''.join(f'{key}={value}\n' for key, value in fields.items()))
        os.replace(pending, path)
    finally:
        if pending.exists(): pending.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--display-name', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    stage = 'configuration'
    try:
        project = json.loads((ROOT/'neon/public-project.json').read_text())
        if project['project_id'] != 'green-snow-30498948' or project['database'] != 'asu': raise ValueError('wrong-project')
        orgs = records(cli('orgs', 'list'), 'organizations')
        if not any(o['id'] == project['organization_id'] and o.get('plan') == 'free' for o in orgs): raise ValueError('not-free')
        fields = dict(line.split('=', 1) for line in (ROOT/'.env.seed.local').read_text().splitlines() if '=' in line)
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def auth(path, body):
            request = urllib.request.Request(project['auth_url']+path, data=json.dumps(body).encode(), method='POST',
                headers={'Content-Type': 'application/json', 'Origin': 'https://asu-forless01.pages.dev', 'User-Agent': 'Asu-Account-Operator/1.0'})
            with opener.open(request, timeout=45) as response: return json.load(response)
        stage = 'signin'
        session = auth('/sign-in/email', {'email': fields['ASU_SEED_EMAIL'], 'password': fields['ASU_SEED_PASSWORD']})
        identity = str(UUID(session['user']['id']))
        environment = connection_env(project)
        def query(sql):
            result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], input=sql, env=environment, text=True, capture_output=True, timeout=90)
            if result.returncode: raise RuntimeError('sql-failed')
            return result.stdout.strip()
        stage = 'read-existing-workspace'
        row = json.loads(query(f"select row_to_json(w) from public.household_workspaces w where owner_id='{identity}'::uuid;"))
        catalog = json.loads((ROOT/'apps/web/src/form-catalog.json').read_text())
        state = personalized_workspace(row['payload'], args.display_name, catalog)
        counts = {key: len(state[key]) for key in ('containers', 'activities', 'tasks', 'incidents', 'scenarios')}
        if not args.apply:
            print(json.dumps({'status': 'inspected', 'existing_revision': row['revision'], 'department': 'PUNO', 'utility': state['household']['eps'], 'planned_counts': counts, 'login_unchanged': True}))
            return
        stage = 'private-backup'
        backup = ROOT/f'.env.account-backup-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")}.local'
        private_write(backup, json.dumps({'profile_name': session['user'].get('name'), 'workspace': row}, ensure_ascii=False, indent=2))
        stage = 'workspace-update'
        payload = json.dumps(state, ensure_ascii=False, allow_nan=False).replace("'", "''")
        changed = query(f"with changed as (update public.household_workspaces set payload='{payload}'::jsonb,revision=revision+1,updated_at=clock_timestamp() where owner_id='{identity}'::uuid and revision={int(row['revision'])} returning revision) select coalesce((select revision from changed),-1);")
        if int(changed) < 0: raise RuntimeError('concurrent-workspace-change')
        stage = 'managed-profile-update'
        auth('/update-user', {'name': args.display_name.strip()})
        # Preserve the login values, adding only local verification expectations.
        primary = next(c for c in state['containers'] if isinstance(c['volume'], (int, float)) and c['volume'] >= 2)
        fields.update({'ASU_SEED_DISPLAY_NAME': args.display_name.strip(), 'ASU_SEED_HOUSEHOLD': state['household']['label'],
                       'ASU_SEED_TANK': primary['name'], 'ASU_SEED_VOLUME': str(primary['volume']), 'ASU_SEED_CONTAINER_COUNT': str(counts['containers']),
                       'ASU_SEED_DEPARTMENT': 'PUNO'})
        update_private_fields(ROOT/'.env.seed.local', fields)
        receipt = {'status': 'personalized', 'observed_at': datetime.now(timezone.utc).isoformat(), 'department': 'PUNO',
            'district': 'Puno', 'utility': state['household']['eps'], 'counts': counts, 'existing_values_preserved': True,
            'managed_profile_updated': True, 'private_backup_created': True, 'login_unchanged': True,
            'credentials_or_account_identifiers_included': False}
        (ROOT/'artifacts/verification/account-personalization.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps(receipt, ensure_ascii=False))
    except Exception:
        raise SystemExit(f'Account operation stopped at {stage}; private responses suppressed. Existing backups and login are retained.') from None


if __name__ == '__main__': main()
