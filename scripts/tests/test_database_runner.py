"""CLI contract for provider selection; PostgreSQL behavior has its own SQL suite."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def scratch():
    with tempfile.TemporaryDirectory(prefix='asu-database-cli-') as directory:
        yield Path(directory)


def runner():
    spec = importlib.util.spec_from_file_location('database_runner', ROOT/'scripts/test_database.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('arguments, provider', [([], 'supabase'), (['--provider', 'supabase'], 'supabase'), (['--provider', 'neon'], 'neon')])
def test_provider_selects_only_its_sql_and_labels_evidence(arguments, provider, monkeypatch, scratch, capsys):
    database = runner()
    calls = []

    def execute(command, **kwargs):
        calls.append(command)
        stderr = 'NOTICE: PASS: fixture assertion\n' if command[0] == 'psql' else ''
        return subprocess.CompletedProcess(command, 0, '', stderr)

    monkeypatch.setattr(database.shutil, 'which', lambda executable: '/test/'+executable)
    monkeypatch.setattr(database.subprocess, 'run', execute)
    monkeypatch.setattr(database.subprocess, 'check_output', lambda *args, **kwargs: 'psql (PostgreSQL) test\n')
    # Exercise argparse/main, not provider-selection internals. No real server here.
    evidence_path = scratch/'database.json'
    monkeypatch.setattr(sys, 'argv', ['test_database.py', *arguments, '--evidence', str(evidence_path)])
    database.main()
    captured = capsys.readouterr()
    assert captured.err == ''
    evidence = json.loads(evidence_path.read_text())
    assert evidence['provider'] == provider
    assert evidence['status'] == 'passed'
    assert evidence['assertions'] == 3
    expected = [f'{provider}/tests/auth_fixture.sql', f'{provider}/migrations/20261020000100_household_workspaces.sql', f'{provider}/tests/workspace_isolation.sql']
    assert [row['file'] for row in evidence['results']] == expected
    assert all(row['exit_code'] == 0 and row['passed_assertions'] == 1 for row in evidence['results'])
    assert [str(Path(call[-1]).relative_to(ROOT)) for call in calls if call[0] == 'psql'] == expected
    assert captured.out == ''.join(f'{Path(file).name}: exit=0, assertions=1\n' for file in expected) + json.dumps(evidence, ensure_ascii=False, indent=2)+'\n'
    assert calls[-1][-1] == 'stop'
    assert 'not hosted' in evidence['scope']
    assert provider in evidence['scope'].lower()


def test_unknown_provider_is_rejected_before_starting_or_writing(monkeypatch, scratch, capsys):
    database = runner()
    monkeypatch.setattr(database.subprocess, 'run', lambda *args, **kwargs: pytest.fail('must not start a server'))
    evidence = scratch/'database.json'
    monkeypatch.setattr(sys, 'argv', ['test_database.py', '--provider', 'unknown', '--evidence', str(evidence)])
    with pytest.raises(SystemExit) as error:
        database.main()
    assert error.value.code == 2
    captured = capsys.readouterr()
    assert captured.out == ''
    assert captured.err == (
        'usage: test_database.py [-h] [--provider {supabase,neon}]\n'
        '                        [--evidence EVIDENCE]\n'
        "test_database.py: error: argument --provider: invalid choice: 'unknown' (choose from 'supabase', 'neon')\n"
    )
    assert not evidence.exists()


def test_help_documents_default_and_both_providers(monkeypatch, capsys):
    database = runner()
    monkeypatch.setattr(sys, 'argv', ['test_database.py', '--help'])
    with pytest.raises(SystemExit) as error:
        database.main()
    assert error.value.code == 0
    captured = capsys.readouterr()
    assert captured.err == ''
    assert '--provider {supabase,neon}' in captured.out
    assert 'default: supabase' in ' '.join(captured.out.split())
