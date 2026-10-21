"""Personalization tests use local objects only, never credentials or hosted writes."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_personalization_uses_real_puno_choices_and_removes_visible_placeholder_markers():
    personal, seed = load('personalize_account'), load('seed_demo_account')
    catalog = json.loads((ROOT/'apps/web/src/form-catalog.json').read_text())
    before = seed.seed_workspace()
    state = personal.personalized_workspace(before, 'Alex', catalog)
    assert state['household']['label'] == 'Hogar de Alex'
    assert (state['household']['department'], state['household']['district']) == ('PUNO', 'Puno')
    assert state['household']['eps'] in catalog['utilities'] and 'EMSAPUNO' in state['household']['eps']
    assert not personal.MARKERS.search(json.dumps(state, ensure_ascii=False))
    assert len(state['containers']) == 7 and len(state['activities']) == 10 and len(state['tasks']) == 12
    assert len(state['scenarios']) == 6
    assert before['household']['department'] == 'LIMA'


def test_personalization_preserves_existing_edits_and_does_not_duplicate_items_on_retry():
    personal, seed = load('personalize_account'), load('seed_demo_account')
    catalog = json.loads((ROOT/'apps/web/src/form-catalog.json').read_text())
    before = seed.seed_workspace()
    before['containers'][0].update({'name': 'Tanque de mi terraza', 'volume': 321})
    before['household']['occupancy'] = 6
    before['tasks'].append({'id': 'my-task', 'title': 'Mi pendiente personal', 'done': True, 'dueAt': None})
    now = datetime(2026, 10, 21, tzinfo=timezone.utc)
    once = personal.personalized_workspace(before, 'Alex', catalog, now)
    twice = personal.personalized_workspace(once, 'Alex', catalog, now)
    assert twice['containers'][0] == before['containers'][0]
    assert twice['household']['occupancy'] == 6
    assert next(task for task in twice['tasks'] if task['id'] == 'my-task') == before['tasks'][-1]
    for key in ('containers', 'activities', 'tasks', 'incidents', 'scenarios'):
        assert twice[key] == once[key]


def test_initial_scenarios_preserve_unknown_reserves_instead_of_inventing_zero():
    personal, seed = load('personalize_account'), load('seed_demo_account')
    catalog = json.loads((ROOT/'apps/web/src/form-catalog.json').read_text())
    before = seed.seed_workspace(); before['containers'][0]['volume'] = None
    state = personal.personalized_workspace(before, 'Alex', catalog)
    assert state['containers'][0]['volume'] is None
    assert next(s for s in state['scenarios'] if s['hours'] == 18)['inputs']['reserves']['other'] is None


@pytest.mark.parametrize('name', ['', 'x'*65, 'Name\nASU_SEED_PASSWORD=changed'])
def test_invalid_profile_names_are_rejected_before_mutation(name):
    personal, seed = load('personalize_account'), load('seed_demo_account')
    with pytest.raises(ValueError, match='display-name'):
        personal.personalized_workspace(seed.seed_workspace(), name, {})


def test_login_file_update_is_private_and_failed_activation_preserves_original(tmp_path, monkeypatch):
    personal = load('personalize_account')
    target = tmp_path/'.env.seed.local'
    target.write_text('ASU_SEED_PASSWORD=old-test-only-value\n')
    original = target.read_bytes()
    replace = personal.os.replace
    def fail_activation(*_args): raise OSError('injected activation failure')
    monkeypatch.setattr(personal.os, 'replace', fail_activation)
    with pytest.raises(OSError): personal.update_private_fields(target, {'ASU_SEED_PASSWORD': 'old-test-only-value', 'ASU_SEED_HOUSEHOLD': 'Hogar de Alex'})
    assert target.read_bytes() == original
    monkeypatch.setattr(personal.os, 'replace', replace)
    personal.update_private_fields(target, {'ASU_SEED_PASSWORD': 'old-test-only-value', 'ASU_SEED_HOUSEHOLD': 'Hogar de Alex'})
    assert target.stat().st_mode & 0o777 == 0o600
    assert 'ASU_SEED_PASSWORD=old-test-only-value' in target.read_text()
