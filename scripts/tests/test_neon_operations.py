"""Operator helpers must reject paid scope and never log or persist credentials."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_paid_org_is_rejected_before_project_mutation(monkeypatch):
    provision = load('provision_neon')
    calls = []
    def fake(*args, **kwargs):
        calls.append(args)
        return [{'id':'test-org','plan':'launch'}]
    monkeypatch.setattr(provision, 'cli', fake)
    monkeypatch.setattr(sys, 'argv', ['provision','--org-id','test-org','--allow-create'])
    with pytest.raises(SystemExit, match='Free organization'):
        provision.main()
    assert calls == [('orgs','list')]


def test_cli_error_does_not_expose_credential_response(monkeypatch, capsys):
    provision = load('provision_neon')
    monkeypatch.setattr(provision.subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a,1,'postgresql://owner:fictional-password@localhost/asu','fictional-password'))
    with pytest.raises(RuntimeError, match='operation failed') as error:
        provision.cli('projects','create')
    assert 'fictional-password' not in str(error.value)
    assert not capsys.readouterr().out


@pytest.mark.parametrize('database,host,role,allowed', [
    ('asu','ep-test.neon.tech','asu_owner',True),
    ('other','ep-test.neon.tech','asu_owner',False),
    ('asu','ep-other.neon.tech','asu_owner',False),
    ('asu','ep-test.neon.tech','other',False),
])
def test_sql_connection_is_scoped_and_password_not_an_argument(monkeypatch, database, host, role, allowed):
    sql = load('neon_sql')
    captured = []
    def fake(command, **kwargs):
        captured.append(command)
        return subprocess.CompletedProcess(command,0,f'postgresql://{role}:fictional-password@{host}/{database}?sslmode=require','')
    monkeypatch.setattr(sql.subprocess, 'run', fake)
    project = {'project_id':'test-project','branch_id':'test-branch','database':'asu','database_role':'asu_owner','data_api_url':'https://ep-test.apirest.neon.tech/asu/rest/v1'}
    if allowed:
        env = sql.connection_env(project)
        assert env['PGPASSWORD'] == 'fictional-password' and env['PGDATABASE'] == 'asu'
    else:
        with pytest.raises(RuntimeError, match='mismatch'):
            sql.connection_env(project)
    assert all('fictional-password' not in argument for argument in captured[0])


def test_reuse_retains_only_verified_public_configuration(tmp_path, monkeypatch):
    provision = load('provision_neon')
    public = tmp_path/'neon/public-project.json'
    public.parent.mkdir()
    public.write_text(json.dumps({'project_id':'test-project','auth_url':'https://auth.example.invalid','data_api_url':'https://api.example.invalid','server_secret':'must-not-persist'}))
    monkeypatch.setattr(provision,'ROOT',tmp_path)
    def fake(*args, **kwargs):
        if args[:2] == ('orgs','list'): return [{'id':'test-org','plan':'free'}]
        if args[:2] == ('projects','list'): return [{'id':'test-project','name':'asu','region_id':'test-region'}]
        if args[:2] == ('branches','list'): return [{'id':'test-branch','name':'main','default':True}]
        raise AssertionError('Unexpected mutation')
    monkeypatch.setattr(provision,'cli',fake)
    monkeypatch.setattr(sys,'argv',['provision','--org-id','test-org'])
    provision.main()
    result=json.loads(public.read_text())
    assert result['auth_url']=='https://auth.example.invalid' and result['database_role']=='asu_owner'
    assert 'server_secret' not in result and 'must-not-persist' not in public.read_text()
