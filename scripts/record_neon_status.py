"""Capture public provider setup and aggregate cleanup evidence, never credentials."""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.provision_neon import cli, records
from scripts.neon_sql import connection_env


def main():
    project = json.loads((ROOT/'neon/public-project.json').read_text())
    orgs = records(cli('orgs', 'list'), 'organizations')
    org = next(item for item in orgs if item['id'] == project['organization_id'])
    if org.get('plan') != 'free':
        raise SystemExit('The organization is not verified Free; no database query executed')
    projects = records(cli('projects', 'list', '--org-id', org['id']), 'projects')
    actual = next(item for item in projects if item['id'] == project['project_id'])
    sql = '''select json_build_object(
      'remaining_auth_users',(select count(*) from neon_auth."user"),
      'remaining_workspaces',(select count(*) from public.household_workspaces),
      'rls_enabled',(select relrowsecurity from pg_class where oid='public.household_workspaces'::regclass),
      'policy_count',(select count(*) from pg_policy where polrelid='public.household_workspaces'::regclass),
      'rpc_authenticated_only',has_function_privilege('authenticated','public.update_workspace(uuid,jsonb,integer)','execute') and not has_function_privilege('anonymous','public.update_workspace(uuid,jsonb,integer)','execute')
    );'''
    query = subprocess.run(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql], env=connection_env(project), capture_output=True, text=True, timeout=45)
    if query.returncode:
        raise SystemExit('Aggregate provider verification failed; raw output suppressed')
    aggregate = json.loads(query.stdout)
    endpoints = actual.get('default_endpoint_settings', {})
    evidence = {
        'status': 'verified', 'checked_at': datetime.now(timezone.utc).isoformat(),
        'provider': 'neon', 'project_id': project['project_id'], 'organization_plan': org['plan'],
        'region': actual['region_id'], 'database': project['database'],
        'compute_min_cu_reported': endpoints.get('autoscaling_limit_min_cu'),
        'compute_max_cu_reported': endpoints.get('autoscaling_limit_max_cu'),
        'suspend_timeout_seconds_reported': endpoints.get('suspend_timeout_seconds'),
        'scale_to_zero_note': 'Free-plan policy is documented by Neon; suspend timing was not independently measured',
        'auth_provider': 'managed_better_auth', 'auth_url': project['auth_url'], 'data_api_url': project['data_api_url'],
        'migration_applied': True, 'aggregate_database_observations': aggregate,
        'cleanup_rows_independently_observed_empty': aggregate['remaining_auth_users'] == 0 and aggregate['remaining_workspaces'] == 0,
        'interactive_google_login_verified': False, 'public_web_deployment_verified': False,
        'credentials_included': False,
    }
    output = ROOT/'artifacts/verification/neon-provisioned.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
