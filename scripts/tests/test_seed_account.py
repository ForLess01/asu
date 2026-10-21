"""Seeding contract tests never create hosted accounts or read private login files."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def module():
    spec = importlib.util.spec_from_file_location('seed_demo_account', ROOT/'scripts/seed_demo_account.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_seed_is_labelled_synthetic_balanced_and_contains_no_authentication_fields():
    state = module().seed_workspace()
    assert 'ficticios' in state['household']['label']
    assert (len(state['containers']), len(state['activities']), len(state['tasks']), len(state['incidents']), len(state['scenarios'])) == (3, 3, 3, 1, 2)
    assert all(0 <= c['volume'] <= c['capacity'] for c in state['containers'])
    assert set(state) == {'schema_version', 'id', 'revision', 'locale', 'updatedAt', 'household', 'containers', 'activities', 'incidents', 'tasks', 'scenarios'}
    assert '@example.com' not in json.dumps(state)
    assert all('semilla ficticios' in activity['source'] for activity in state['activities'])


def test_seed_sql_validates_owner_uuid_and_escapes_text_literals():
    seed = module(); state = seed.seed_workspace(); state['household']['label'] = "Hogar d'ejemplo"
    query = seed.seed_sql('a0000000-0000-4000-8000-000000000001', state)
    assert "Hogar d''ejemplo" in query
    assert 'insert into public.household_workspaces' in query
    assert 'insert into neon_auth' not in query
    with pytest.raises(ValueError):
        seed.seed_sql("invalid'); delete from neon_auth.user; --", state)


def test_seed_cli_requires_opt_in_before_any_provider_operation():
    result = subprocess.run([sys.executable, str(ROOT/'scripts/seed_demo_account.py')], capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert '--allow-create' in result.stderr
