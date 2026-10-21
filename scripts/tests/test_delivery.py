"""Delivery tests assert deployment integrity and fail-closed promotion behavior."""

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_smoke_requires_real_https_url(monkeypatch):
    smoke = module('smoke_deployment')
    monkeypatch.setenv('ASU_PUBLIC_URL', 'http://localhost:5174')
    with pytest.raises(SystemExit, match='HTTPS'):
        smoke.main()


class Response:
    status = 200
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def read(self):
        return self.body


@pytest.mark.parametrize('correct_hash', [True, False])
def test_smoke_binds_published_model_to_release(monkeypatch, capsys, correct_hash):
    smoke = module('smoke_deployment')
    model = (ROOT/'apps/web/public/models/current/model.json').read_bytes()
    release = {'model_sha256': hashlib.sha256(model).hexdigest() if correct_hash else '0'*64}
    values = {'/': b'<html><title>Asu</title></html>', '/version.json': json.dumps(release).encode(), '/models/current/model.json': model}
    monkeypatch.setenv('ASU_PUBLIC_URL', 'https://example.invalid')
    monkeypatch.setattr(smoke.urllib.request, 'urlopen', lambda request, timeout: Response(values[request.full_url.removeprefix('https://example.invalid')]))
    if correct_hash:
        smoke.main()
        assert json.loads(capsys.readouterr().out)['status'] == 'passed'
    else:
        with pytest.raises(SystemExit, match='mismatch'):
            smoke.main()


def test_smoke_rejects_an_old_release_even_when_its_model_hash_matches(monkeypatch):
    smoke = module('smoke_deployment')
    model = b'{"fixture": true}'
    release = {'commit': 'a'*40, 'model_sha256': hashlib.sha256(model).hexdigest()}
    values = {'/': b'<html></html>', '/version.json': json.dumps(release).encode(), '/models/current/model.json': model}
    monkeypatch.setenv('ASU_PUBLIC_URL', 'https://example.invalid')
    monkeypatch.setenv('CODE_REVISION', 'b'*40)
    monkeypatch.setattr(smoke.urllib.request, 'urlopen', lambda request, timeout: Response(values[request.full_url.removeprefix('https://example.invalid')]))
    with pytest.raises(SystemExit, match='commit mismatch'):
        smoke.main()


def test_smoke_identifies_its_requests_to_the_public_edge(monkeypatch, capsys):
    smoke = module('smoke_deployment')
    model = b'{"fixture": true}'
    release = {'model_sha256': hashlib.sha256(model).hexdigest()}
    values = {'/': b'<html></html>', '/version.json': json.dumps(release).encode(), '/models/current/model.json': model}
    requests = []
    def edge(request, timeout):
        assert isinstance(request, smoke.urllib.request.Request)
        assert request.get_header('User-agent') == 'Asu-Deployment-Check/1.0'
        requests.append(request.full_url)
        return Response(values[request.full_url.removeprefix('https://example.invalid')])
    monkeypatch.setenv('ASU_PUBLIC_URL', 'https://example.invalid')
    monkeypatch.delenv('CODE_REVISION', raising=False)
    monkeypatch.setattr(smoke.urllib.request, 'urlopen', edge)
    smoke.main()
    assert json.loads(capsys.readouterr().out)['status'] == 'passed'
    assert len(requests) == 3


def test_production_gate_preserves_all_active_bytes(tmp_path, monkeypatch, capsys):
    gate = module('check_promotion_gate')
    champion = tmp_path/'current'
    shutil.copytree(ROOT/'apps/web/public/models/current', champion)
    before = gate.fingerprint(champion)
    monkeypatch.setattr(sys, 'argv', ['gate', '--candidate', str(ROOT/'artifacts/current'), '--champion', str(champion)])
    gate.main()
    result = json.loads(capsys.readouterr().out)
    assert result['active_bundle_preserved']
    assert 'label_semantics_unapproved' in result['verdict']['reasons']
    assert gate.fingerprint(champion) == before
