"""Adversarial publication tests use copies of the unchanged real-data bundle."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import pytest

from asu_ml.data import save_json, sha256
from asu_ml.portable import validate_artifact
from asu_ml.registry import publish

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps/web/public/models/current"
REQUIRED_METADATA = ["model_version", "source_sha256", "data_cutoff"]


def snapshot(directory):
    return {str(p.relative_to(directory)): None if p.is_dir() else p.read_bytes()
            for p in directory.rglob("*")}


def rehash(candidate):
    checksums = json.loads((candidate / "checksums.json").read_text(encoding="utf-8"))
    save_json(candidate / "checksums.json", {name: sha256(candidate / name) for name in checksums})


@pytest.fixture
def publication_paths():
    with tempfile.TemporaryDirectory(prefix="asu-publication-test-") as folder:
        candidate, champion = Path(folder) / "candidate", Path(folder) / "current"
        shutil.copytree(PUBLIC, candidate)
        shutil.copytree(PUBLIC, champion)
        yield candidate, champion


def test_publish_copy_failure_preserves_complete_champion(publication_paths, monkeypatch):
    candidate, champion = publication_paths
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    artifact["model_version"] += "-publication-regression"
    save_json(candidate / "model.json", artifact)
    rehash(candidate)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    original_copy = shutil.copyfile
    copied = []

    def fail_after_model_copy(source, destination, *args, **kwargs):
        result = original_copy(source, destination, *args, **kwargs)
        if Path(source) == candidate / "model.json":
            copied.append(Path(destination))
            raise OSError("injected failure after model copy")
        return result

    monkeypatch.setattr(shutil, "copyfile", fail_after_model_copy)
    with pytest.raises(OSError, match="injected failure after model copy"):
        publish(candidate, champion, experimental=True)
    assert len(copied) == 1
    assert snapshot(champion) == before
    assert snapshot(candidate) == candidate_before
    assert copied[0] != champion / "model.json"


@pytest.mark.parametrize("field", REQUIRED_METADATA)
def test_publish_rejects_missing_metadata_with_rehashed_model(publication_paths, field):
    candidate, champion = publication_paths
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    del artifact[field]
    save_json(candidate / "model.json", artifact)
    rehash(candidate)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    fixtures_before = (candidate / "parity-fixtures.json").read_bytes()
    result = publish(candidate, champion, experimental=True)
    assert result["status"] == "rejected"
    assert result["reasons"] == ["invalid_artifact_or_metrics_schema"]
    assert result["production_gate_passed"] is False
    assert snapshot(champion) == before
    assert snapshot(candidate) == candidate_before
    assert (candidate / "parity-fixtures.json").read_bytes() == fixtures_before
    cli = subprocess.run(
        [sys.executable, str(ROOT / "ml/promote.py"), "--candidate", str(candidate),
         "--champion", str(champion), "--allow-experimental-publish"],
        capture_output=True, text=True, timeout=30,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    assert cli.returncode == 2 and cli.stderr == ""
    assert cli.stdout == json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    assert snapshot(champion) == before and snapshot(candidate) == candidate_before


@pytest.mark.parametrize("field,value", [
    ("model_version", ""), ("model_version", "   "), ("model_version", None), ("model_version", 1),
    ("source_sha256", ""), ("source_sha256", None), ("source_sha256", "x" * 64),
    ("source_sha256", "a" * 63), ("source_sha256", 123),
    ("data_cutoff", ""), ("data_cutoff", None), ("data_cutoff", "2024-02-30"),
    ("data_cutoff", "2023-02-29"), ("data_cutoff", "2024-2-01"),
    ("data_cutoff", "2024-06-01T00:00:00Z"), ("data_cutoff", 20240601),
    ("schema_version", True), ("schema_version", "1"),
    ("status", "validated"), ("target_semantics", "actual_restoration"),
    ("label_semantics_approved", True), ("label_semantics_approved", 0),
])
def test_publish_rejects_invalid_metadata_with_valid_hashes(publication_paths, field, value):
    candidate, champion = publication_paths
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    artifact[field] = value
    save_json(candidate / "model.json", artifact)
    rehash(candidate)
    before = snapshot(champion)
    result = publish(candidate, champion, experimental=True)
    assert result["status"] == "rejected"
    assert result["production_gate_passed"] is False
    assert snapshot(champion) == before


@pytest.mark.parametrize("field", [
    "schema_version", "model_version", "status", "target_semantics", "label_semantics_approved",
    "feature_order", "preprocessing", "models", "calibration", "support", "data_cutoff", "source_sha256",
])
def test_validator_requires_every_shared_top_level_field(field):
    artifact = json.loads((PUBLIC / "model.json").read_text(encoding="utf-8"))
    del artifact[field]
    with pytest.raises(ValueError):
        validate_artifact(artifact)


def test_valid_real_bundle_remains_a_byte_preserving_noop(publication_paths):
    candidate, champion = publication_paths
    before = snapshot(champion)
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    assert validate_artifact(artifact)
    result = publish(candidate, champion, experimental=True)
    assert result["status"] == "no_op" and result["production_gate_passed"] is False
    assert snapshot(champion) == before


def changed_candidate(candidate):
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    artifact["model_version"] += "-publication-regression"
    save_json(candidate / "model.json", artifact)
    rehash(candidate)


@pytest.mark.parametrize("after_rename", [False, True])
def test_activation_failure_restores_complete_prior_directory(publication_paths, monkeypatch, after_rename):
    import asu_ml.registry as registry

    candidate, champion = publication_paths
    changed_candidate(candidate)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    original_replace = registry.os.replace
    failures = []

    def fail_activation(source, destination):
        if Path(destination) == champion and Path(source).name.startswith(f".{champion.name}-stage-"):
            failures.append(True)
            if after_rename:
                original_replace(source, destination)
            raise OSError("injected activation failure")
        return original_replace(source, destination)

    monkeypatch.setattr(registry.os, "replace", fail_activation)
    with pytest.raises(OSError, match="injected activation failure"):
        publish(candidate, champion, experimental=True)
    assert failures == [True]
    assert snapshot(champion) == before and snapshot(candidate) == candidate_before
    assert not list(champion.parent.glob(f".{champion.name}-stage-*"))
    assert not list(champion.parent.glob(f".{champion.name}-previous-*"))


def test_corrupt_staged_copy_rejected_before_activation(publication_paths, monkeypatch):
    candidate, champion = publication_paths
    changed_candidate(candidate)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    original_copy = shutil.copyfile

    def corrupt_staged_model(source, destination, *args, **kwargs):
        result = original_copy(source, destination, *args, **kwargs)
        if Path(source) == candidate / "model.json":
            # Valid JSON and identical predictions, but not the approved bytes.
            path = Path(destination)
            path.write_bytes(path.read_bytes() + b" ")
        return result

    monkeypatch.setattr(shutil, "copyfile", corrupt_staged_model)
    result = publish(candidate, champion, experimental=True)
    assert result["status"] == "rejected" and result["reasons"] == ["checksum_mismatch"]
    assert snapshot(champion) == before and snapshot(candidate) == candidate_before


def test_successful_switch_retains_prior_complete_bundle(publication_paths):
    candidate, champion = publication_paths
    changed_candidate(candidate)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    old_sha = sha256(champion / "model.json")
    result = publish(candidate, champion, experimental=True)
    assert result["status"] == "experimental_publish_allowed" and result["production_gate_passed"] is False
    for name in ["model.json", "metrics.json", "model-card.md", "parity-fixtures.json"]:
        assert (champion / name).read_bytes() == (candidate / name).read_bytes()
    backups = list(champion.parent.glob(f".{champion.name}-previous-*"))
    assert len(backups) == 1 and snapshot(backups[0]) == before
    for name, data in before.items():
        assert (champion / "previous" / old_sha / name).read_bytes() == data
    assert snapshot(candidate) == candidate_before
    assert not list(champion.parent.glob(f".{champion.name}-stage-*"))


@pytest.mark.parametrize("path", [
    ("preprocessing", "categories"), ("preprocessing", "unknown_value"),
    ("preprocessing", "categories", "eps"), ("preprocessing", "categories", "department"),
    ("models", "p10"), ("models", "p50"), ("models", "p90"),
    ("models", "p10", "init"), ("models", "p10", "learning_rate"), ("models", "p10", "trees"),
    ("calibration", "offset_hours"), ("calibration", "nominal_coverage"),
    ("support", "eps_codes"), ("support", "departments"), ("support", "combinations"),
])
def test_validator_requires_shared_nested_fields(path):
    artifact = json.loads((PUBLIC / "model.json").read_text(encoding="utf-8"))
    parent = artifact
    for key in path[:-1]:
        parent = parent[key]
    del parent[path[-1]]
    with pytest.raises(ValueError):
        validate_artifact(artifact)


def test_metadata_accepts_real_leap_day_and_hex_digest():
    artifact = json.loads((PUBLIC / "model.json").read_text(encoding="utf-8"))
    artifact["data_cutoff"] = "2024-02-29"
    artifact["source_sha256"] = artifact["source_sha256"].upper()
    assert validate_artifact(artifact)


@pytest.mark.parametrize("linked_directory", ["candidate", "champion"])
def test_symlink_cannot_redirect_staged_copy_into_prior_bundle(publication_paths, linked_directory):
    candidate, champion = publication_paths
    changed_candidate(candidate)
    directory = candidate if linked_directory == "candidate" else champion
    target = directory / "original-model.json"
    (directory / "model.json").rename(target)
    (directory / "model.json").symlink_to(target.name)
    before, candidate_before = snapshot(champion), snapshot(candidate)
    with pytest.raises(ValueError, match="without symbolic links"):
        publish(candidate, champion, experimental=True)
    assert snapshot(champion) == before and snapshot(candidate) == candidate_before


@pytest.mark.parametrize("path,value", [
    (("preprocessing", "unknown_value"), True),
    (("calibration", "offset_hours"), False),
    (("calibration", "nominal_coverage"), True),
    (("calibration", "method"), None),
    (("models", "p10", "init"), True),
    (("models", "p10", "init"), 10 ** 400),
    (("models", "p10", "learning_rate"), False),
])
def test_validator_rejects_invalid_shared_nested_types(path, value):
    artifact = json.loads((PUBLIC / "model.json").read_text(encoding="utf-8"))
    parent = artifact
    for key in path[:-1]:
        parent = parent[key]
    parent[path[-1]] = value
    with pytest.raises(ValueError):
        validate_artifact(artifact)
