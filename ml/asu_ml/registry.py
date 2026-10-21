"""Fail-closed assessment and explicit experimental publication, never deployment."""

import json
import os
from pathlib import Path
import shutil
import tempfile
from uuid import uuid4

import numpy as np

from .data import save_json, sha256
from .portable import predict_artifact, validate_artifact


def assess(artifact, metrics, champion_metrics=None, experimental=False):
    artifact = artifact if isinstance(artifact, dict) else {}
    metrics = metrics if isinstance(metrics, dict) else {}
    reasons = []
    try:
        validate_artifact(artifact)
        test = metrics["test"]["calibrated"]
        mae, coverage = float(test["mae"]), float(test["coverage"])
        baseline = float(metrics["strong_baseline_mae"])
        error = float(metrics["parity"]["max_abs_error"])
        if not np.isfinite([mae, coverage, baseline, error]).all() or mae < 0 or baseline <= 0 or error < 0:
            reasons.append("nonfinite_or_invalid_metrics")
        if mae > baseline * .95:
            reasons.append("baseline_improvement_below_5pct")
        if not .75 <= coverage <= .85:
            reasons.append("coverage_outside_075_085")
        if error > 1e-4 or metrics["parity"]["count"] < 10000:
            reasons.append("parity_failed")
        if not metrics["splits"]["group_isolation_verified"]:
            reasons.append("group_leakage")
        if champion_metrics and mae > champion_metrics["test"]["calibrated"]["mae"] * 1.02:
            reasons.append("champion_mae_degraded_over_2pct")
    except (KeyError, TypeError, ValueError, IndexError):
        reasons.append("invalid_artifact_or_metrics_schema")
    semantic_reasons = []
    if artifact.get("label_semantics_approved") is not True:
        semantic_reasons.append("label_semantics_unapproved")
    if metrics.get("splits", {}).get("test_role") != "prospective_independent_acceptance":
        semantic_reasons.append("no_independent_prospective_acceptance")
    # The explicit experimental path waives ONLY scientific eligibility, not
    # corrupt schemas, failed parity, degraded performance, or bad calibration.
    if not experimental:
        reasons.extend(semantic_reasons)
    return {"status": "rejected" if reasons else ("experimental_publish_allowed" if experimental else "production_promotion_allowed"),
            "production_gate_passed": not reasons and not experimental,
            "experimental_only": experimental, "reasons": reasons, "scientific_blockers": semantic_reasons,
            "policy": {"baseline_min_improvement": .05, "champion_max_mae_degradation": .02,
                       "coverage_range": [.75, .85], "parity_tolerance_hours": 1e-4}}


def _verified_candidate(candidate, champion_metrics, experimental):
    """Use the same assessment, checksums and parity for source and staged bytes."""
    artifact = json.loads((candidate / "model.json").read_text(encoding="utf-8"))
    metrics = json.loads((candidate / "metrics.json").read_text(encoding="utf-8"))
    verdict = assess(artifact, metrics, champion_metrics, experimental)
    checksums = None

    def result(reason=None):
        outcome = {**verdict, "status": "rejected", "production_gate_passed": False,
                   "reasons": [reason]} if reason else verdict
        return artifact, metrics, checksums, outcome

    if verdict["status"] == "rejected":
        return result()
    # Every byte of an actual published bundle is verified before touching the
    # champion. Absence of checksums is a rejection, not trust by filename.
    manifest_path = candidate / "checksums.json"
    if not manifest_path.exists():
        return result("missing_checksums")
    checksums = json.loads(manifest_path.read_text(encoding="utf-8"))
    required = ["model.json", "metrics.json", "model-card.md", "parity-fixtures.json"]
    if any(name not in checksums for name in required):
        return result("incomplete_checksums")
    for name, expected in checksums.items():
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or not (candidate / path).is_file() or sha256(candidate / path) != expected:
            return result("checksum_mismatch")
    try:
        fixture = json.loads((candidate / "parity-fixtures.json").read_text(encoding="utf-8"))
        if set(fixture) != {"inputs", "expected"} or len(fixture["inputs"]) < 10000:
            raise ValueError("Invalid parity fixtures")
        prediction = predict_artifact(artifact, fixture["inputs"])
        expected = np.asarray(fixture["expected"], dtype=float)
        if (expected.shape != prediction.shape or not np.isfinite(expected).all()
                or len(prediction) != metrics["parity"]["count"]
                or np.max(np.abs(prediction - expected)) > 1e-4):
            raise ValueError("Fixture parity failed")
    except (KeyError, TypeError, ValueError, IndexError):
        return result("fixture_parity_failed")
    return result()


def publish(candidate, champion, experimental=False):
    """Stage/verify a complete bundle, then rename directories with error rollback.

    Requires a single publisher and same-filesystem local directory renames. The
    two-rename switch is NOT crash-atomic: abrupt termination between renames can
    leave the alias absent, with the intact prior directory retained beside it.
    """
    candidate, champion = Path(candidate), Path(champion)
    for directory in [candidate, champion]:
        if (directory.is_symlink() or (directory.exists() and not directory.is_dir())
                or any(path.is_symlink() for path in directory.rglob("*"))):
            # An inherited link in a stage could redirect copyfile into the live
            # bundle or its immutable history before the directory switch.
            raise ValueError("Publication requires regular directories without symbolic links")
    previous_metrics = json.loads((champion / "metrics.json").read_text(encoding="utf-8")) if (champion / "metrics.json").exists() else None
    _, _, checksums, verdict = _verified_candidate(candidate, previous_metrics, experimental)
    if verdict["status"] == "rejected":
        return verdict
    if (champion / "model.json").exists() and sha256(champion / "model.json") == sha256(candidate / "model.json"):
        return {**verdict, "status": "no_op", "production_gate_passed": False}
    required = ["model.json", "metrics.json", "model-card.md", "parity-fixtures.json"]
    champion.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{champion.name}-stage-", dir=champion.parent) as folder:
        staged = Path(folder)
        if champion.exists():
            # Preserve existing history/other assets in the inactive copy. A failed
            # copy must not even add a history entry to the live directory.
            shutil.copytree(champion, staged, dirs_exist_ok=True, symlinks=True)
            if (champion / "model.json").exists():
                previous = staged / "previous" / sha256(champion / "model.json")
                previous.mkdir(parents=True, exist_ok=True)
                for name in required + ["checksums.json", "publication.json"]:
                    source = champion / name
                    if source.exists() and not (previous / name).exists():
                        shutil.copyfile(source, previous / name)
        for name in required:
            shutil.copyfile(candidate / name, staged / name)
        # Compare staged copies against the already-verified source fingerprints,
        # not freshly computed hashes that could bless a corrupt/changed copy.
        save_json(staged / "checksums.json", {name: checksums[name] for name in required})
        save_json(staged / "publication.json", verdict)
        _, _, _, staged_verdict = _verified_candidate(staged, previous_metrics, experimental)
        if staged_verdict["status"] == "rejected":
            return staged_verdict

        backup = None
        try:
            if champion.exists():
                backup = champion.with_name(f".{champion.name}-previous-{uuid4().hex}")
                if backup.exists():
                    raise OSError("Previous bundle archive already exists")
                os.replace(champion, backup)
            os.replace(staged, champion)
        except BaseException:
            try:
                # Also handle an exception reported immediately after activation.
                if not staged.exists() and champion.exists():
                    os.replace(champion, staged)
                if backup is not None and backup.exists() and not champion.exists():
                    os.replace(backup, champion)
            except OSError as recovery_error:
                raise OSError(f"Publication and rollback failed; prior bundle retained at {backup}") from recovery_error
            raise
        # No fallible writes to the active bundle after its activation. The old
        # full directory remains available for recovery; never delete it here.
    return verdict
