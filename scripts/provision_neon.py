"""Provision only an explicitly approved Asu project in a verified Free org.

The CLI owns credential access. Its raw responses may contain credentials and are
never printed or stored. Only a small public allowlist is written to evidence.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def cli(*arguments, allow_failure=False, allow_text=False):
    result = subprocess.run(['neon', *arguments, '--output', 'json', '--analytics=false'], text=True, capture_output=True, timeout=180)
    if result.returncode:
        if allow_failure:
            return None
        # Do not print a response that may contain a connection URI or secret.
        raise RuntimeError(f'Neon CLI operation failed ({arguments[0]}), exit {result.returncode}; inspect account in the console')
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        if allow_text:
            return {'command_succeeded': True, 'response_format': 'text-suppressed'}
        raise RuntimeError('Neon CLI returned an unexpected non-JSON response; raw output suppressed') from error


def records(value, key):
    return value if isinstance(value, list) else value.get(key, [])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--org-id', required=True)
    parser.add_argument('--allow-create', action='store_true')
    parser.add_argument('--region', default='aws-us-east-1')
    args = parser.parse_args()
    organizations = records(cli('orgs', 'list'), 'organizations')
    organization = next((item for item in organizations if item['id'] == args.org_id), None)
    if not organization or organization.get('plan') != 'free':
        raise SystemExit('An explicitly verified Free organization is required; no project was created')
    projects = records(cli('projects', 'list', '--org-id', args.org_id), 'projects')
    matches = [item for item in projects if item.get('name', '').casefold() == 'asu']
    evidence_path = ROOT/'neon/public-project.json'
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    retained_public = {}
    if matches:
        if len(matches) != 1 or not evidence_path.exists():
            raise SystemExit('An existing project named Asu needs explicit identity review before reuse')
        previous = json.loads(evidence_path.read_text())
        if matches[0]['id'] != previous['project_id']:
            raise SystemExit('Project identity mismatch; no project was modified')
        retained_public = {key: previous[key] for key in ('auth_url', 'data_api_url') if key in previous}
        project = matches[0]
        action = 'reused_verified_asu_project'
    else:
        if not args.allow_create:
            raise SystemExit('Pass --allow-create only after project creation is authorized')
        created = cli('projects', 'create', '--name', 'asu', '--org-id', args.org_id, '--region-id', args.region, '--database', 'asu', '--cu', '0.25')
        project = created.get('project', created)
        action = 'created'
    project_id = project['id']
    branches = records(cli('branches', 'list', '--project-id', project_id), 'branches')
    branch = next((item for item in branches if item.get('default')), branches[0])
    public = {
        'provider': 'neon', 'organization_id': organization['id'], 'organization_plan': organization['plan'],
        'project_id': project_id, 'project_name': 'asu', 'branch_id': branch['id'],
        'branch_name': branch['name'], 'database': 'asu', 'database_role': 'asu_owner', 'region': project.get('region_id', args.region),
        'created_or_verified_at': datetime.now(timezone.utc).isoformat(), 'action': action,
        'credentials_included': False,
        **retained_public,
    }
    evidence_path.write_text(json.dumps(public, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(public, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
