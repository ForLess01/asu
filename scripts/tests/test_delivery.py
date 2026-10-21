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
    monkeypatch.setattr(smoke.urllib.request, 'urlopen', lambda url, timeout: Response(values[url.removeprefix('https://example.invalid')]))
    if correct_hash:
        smoke.main()
        assert json.loads(capsys.readouterr().out)['status'] == 'passed'
    else:
        with pytest.raises(SystemExit, match='mismatch'):
            smoke.main()


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
