"""Software fixtures test invariants; they are not scientific observations."""

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import GradientBoostingRegressor

from asu_ml.data import COLUMNS, canonical_events, chronological_splits, ingest
from asu_ml.portable import (
    FeatureEncoder, calibrate, export_model, postprocess, predict_artifact,
    validate_artifact, encode_request,
)
from asu_ml.registry import assess, publish


def records():
    rows = []
    for i, year in enumerate(range(2019, 2025)):
        row = dict.fromkeys(COLUMNS, "")
        row.update(IDINTERRUPCION=str(i), EPS=" SEDAPAL ", DEPARTAMENTO="LIMA",
                   TIPOINTERRUPCION="IMPREVISTA", TIPOSERVICIO="AGUA POTABLE",
                   FECHAINICIO=f"{year}0601", HORAINICIO="10:30",
                   FECHAFIN=f"{year}0602", HORAFIN="12:30")
        rows.append(row)
    return pd.DataFrame(rows)


def bundle():
    frame, _ = canonical_events(records())
    # Nonconstant software-only regression problem exercises real tree splits.
    frame = pd.concat([frame] * 12, ignore_index=True)
    frame["month"] = np.tile(np.arange(1, 13), 6)
    frame["weekday"] = np.arange(len(frame)) % 7
    frame["hour"] = (np.arange(len(frame)) % 23) + .5
    frame["duration"] = frame.month * 2 + frame.weekday + frame.hour / 4
    encoder = FeatureEncoder().fit(frame)
    x = encoder.transform(frame)
    models = [GradientBoostingRegressor(loss="quantile", alpha=q, n_estimators=4,
                                       max_depth=2, random_state=42).fit(x, frame.duration)
              for q in (.1, .5, .9)]
    return export_model(models, encoder, 1., "a" * 64, "2024-06-01"), models, x


def test_schema_rejected():
    with pytest.raises(ValueError, match="schema"):
        canonical_events(records().drop(columns="HORAFIN"))


def test_bad_times_quarantined_and_positive_tail_retained():
    raw = records()
    raw.loc[0, "HORAINICIO"] = "25:90"
    raw.loc[1, "FECHAFIN"] = "20211201"
    raw.loc[2, "HORAFIN"] = "01:00"
    raw.loc[2, "FECHAFIN"] = raw.loc[2, "FECHAINICIO"]
    frame, audit = canonical_events(raw)
    assert "0" not in set(frame.IDINTERRUPCION)
    assert "2" not in set(frame.IDINTERRUPCION)
    assert frame.loc[frame.IDINTERRUPCION.eq("1"), "duration"].iloc[0] > 168
    assert audit["exclusions"]["invalid_time"] == 1
    assert audit["exclusions"]["nonpositive_duration"] == 1


def test_duplicates_conflicts_and_groups_frozen_before_split():
    raw = records()
    district = raw.iloc[[0]].copy()
    district["DISTRITO"] = "ANOTHER DISTRICT"
    conflict = raw.iloc[[1]].copy()
    conflict["HORAFIN"] = "15:00"
    frame, audit = canonical_events(pd.concat([raw, raw.iloc[[0]], district, conflict]))
    assert audit["exact_duplicate_rows"] == 1
    assert audit["conflicting_event_ids"] == ["1"]
    assert frame.IDINTERRUPCION.is_unique
    assert "1" not in set(frame.IDINTERRUPCION)
    parts, info = chronological_splits(frame)
    ids = [set(v.IDINTERRUPCION) for v in parts.values()]
    assert all(not a.intersection(b) for i, a in enumerate(ids) for b in ids[i + 1:])
    assert info["group_isolation_verified"] is True


def test_cross_boundary_labels_purged():
    raw = records()
    raw.loc[2, "FECHAFIN"] = "20220101"
    frame, _ = canonical_events(raw)
    parts, info = chronological_splits(frame)
    assert "2" not in set(parts["train"].IDINTERRUPCION)
    assert info["purged_cross_boundary_ids"] == ["2"]
    assert parts["calibration"].start.dt.year.tolist() == [2023]
    assert parts["test"].start.dt.year.tolist() == [2024]


def test_encoder_fit_only_and_rejects_unsupported_requests():
    frame, _ = canonical_events(records())
    encoder = FeatureEncoder().fit(frame.iloc[:2])
    other = frame.iloc[[2]].copy()
    other["EPS"] = "UNSEEN"
    assert encoder.transform(other)[0, 3] == -1
    artifact, _, _ = bundle()
    assert encode_request(artifact, "2024-06-01T10:30:00-05:00", "SEDAPAL", "LIMA")[2] == 10.5
    for started, eps, department in [("bad", "SEDAPAL", "LIMA"),
                                     ("2024-06-01", "UNSEEN", "LIMA"),
                                     ("2024-06-01", "SEDAPAL", "OTHER")]:
        with pytest.raises(ValueError):
            encode_request(artifact, started, eps, department)


def test_cqr_uses_only_supplied_calibration_and_nonnegative_order():
    raw = np.array([[8., -3., 2.], [1., 3., 2.]])
    np.testing.assert_equal(postprocess(raw), [[0., 2., 8.], [1., 2., 3.]])
    # n=4, finite-sample rank ceil(5*.8)=4; max score is 7.
    offset = calibrate(np.tile([1., 2., 3.], (4, 1)), np.array([1., 2., 3., 10.]))
    assert offset == 7.
    assert calibrate(np.tile([0., 1., 100.], (4, 1)), np.arange(4.)) == 0.
    result = postprocess(raw, offset)
    assert np.all(result >= 0) and np.all(np.diff(result, axis=1) >= 0)
    with pytest.raises(ValueError):
        calibrate(np.ones((1, 3)), np.ones(1))


def test_export_float32_parity_10000_and_invalid_schema():
    artifact, models, x = bundle()
    vectors = np.tile(x, (1667, 1))[:10000]
    expected = postprocess(np.column_stack([m.predict(vectors.astype(np.float32)) for m in models]), 1.)
    np.testing.assert_allclose(predict_artifact(artifact, vectors), expected, atol=1e-10)
    assert np.ptp(expected[:, 1]) > 1  # Not a constant-init-only parity test.
    bad = copy.deepcopy(artifact)
    bad["feature_order"] = ["year"]
    with pytest.raises(ValueError, match="feature_order"):
        validate_artifact(bad)
    bad = copy.deepcopy(artifact)
    bad["models"]["p10"]["trees"][0]["children_left"][0] = 10000
    with pytest.raises(ValueError):
        validate_artifact(bad)
    with pytest.raises(ValueError):
        predict_artifact(artifact, [[1, 0, 10, -1, 0]])


def test_ingest_hash_noop_and_rejection_preserves_cache():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source = root / "input.csv"
        records().to_csv(source, index=False)
        sha = hashlib.sha256(source.read_bytes()).hexdigest()
        first = ingest(source, root / "raw", expected_sha=sha)
        second = ingest(source, root / "raw", expected_sha=sha)
        assert first["status"] == "ingested" and second["status"] == "no_op"
        before = {p.name: p.read_bytes() for p in (root / "raw").iterdir()}
        with pytest.raises(ValueError, match="SHA"):
            ingest(source, root / "raw", expected_sha="0" * 64)
        assert before == {p.name: p.read_bytes() for p in (root / "raw").iterdir()}


def test_gate_blocks_production_and_degraded_preserves_previous():
    artifact, _, _ = bundle()
    metrics = {"test": {"calibrated": {"mae": 2., "coverage": .8}},
               "strong_baseline_mae": 3., "parity": {"max_abs_error": 0., "count": 10000},
               "splits": {"group_isolation_verified": True}}
    assert "label_semantics_unapproved" in assess(artifact, metrics)["reasons"]
    assert assess(artifact, metrics, experimental=True)["status"] == "experimental_publish_allowed"
    assert assess(artifact, metrics, champion_metrics={**metrics, "test": {"calibrated": {"mae": 1.}}},
                  experimental=True)["status"] == "rejected"
    with tempfile.TemporaryDirectory() as folder:
        candidate, champion = Path(folder) / "candidate", Path(folder) / "champion"
        candidate.mkdir()
        champion.mkdir()
        (champion / "previous.txt").write_text("keep")
        (candidate / "model.json").write_text(json.dumps(artifact))
        (candidate / "metrics.json").write_text(json.dumps(metrics))
        result = publish(candidate, champion)
        assert result["status"] == "rejected"
        assert list(champion.iterdir()) == [champion / "previous.txt"]
        assert (champion / "previous.txt").read_text() == "keep"


def test_missing_combination_support_fails_closed():
    artifact, _, _ = bundle()
    artifact["support"]["combinations"] = []
    with pytest.raises(ValueError, match="combination"):
        predict_artifact(artifact, [[6, 0, 10.5, 0, 0]])


def test_known_categories_but_unobserved_combination_rejected():
    artifact, _, _ = bundle()
    artifact["preprocessing"]["categories"] = {"eps": ["A", "B"], "department": ["X", "Y"]}
    artifact["support"] = {"eps_codes": ["A", "B"], "departments": ["X", "Y"],
                           "combinations": [{"eps": "A", "department": "X"}, {"eps": "B", "department": "Y"}]}
    with pytest.raises(ValueError, match="combination"):
        encode_request(artifact, "2024-06-01T10:30:00-05:00", "A", "Y")


def test_export_threshold_neighbours_float32():
    artifact, models, x = bundle()
    probes = []
    for model in models:
        for estimator in model.estimators_.ravel():
            for feature, threshold in zip(estimator.tree_.feature, estimator.tree_.threshold):
                if feature != 2:
                    continue
                for value in [np.nextafter(np.float32(threshold), np.float32(-np.inf)),
                              np.float32(threshold), np.nextafter(np.float32(threshold), np.float32(np.inf))]:
                    row = x[0].copy()
                    row[feature] = value
                    probes.append(row)
    assert len(probes) > 0
    expected = postprocess(np.column_stack([m.predict(np.asarray(probes, dtype=np.float32)) for m in models]), 1.)
    np.testing.assert_allclose(predict_artifact(artifact, probes), expected, atol=1e-10)


def cli(script, *args):
    return subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / script), *map(str, args)],
                          capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, timeout=30)


def test_update_cli_noop_canonical_order_and_rejection_preserve_state():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source, state, cache = root / "input.csv", root / "state.json", root / "cache"
        records().to_csv(source, index=False)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        args = ["--source", source, "--state", state, "--cache", cache, "--expected-sha", digest]
        first = cli("update_data.py", *args)
        assert first.returncode == 0 and first.stderr == ""
        assert json.loads(first.stdout)["status"] == "changed"
        previous = state.read_bytes()
        second = cli("update_data.py", *args)
        assert second.returncode == 0 and second.stderr == ""
        assert json.loads(second.stdout)["status"] == "no_op"
        assert state.read_bytes() == previous
        before_cache = {p.name: p.read_bytes() for p in cache.iterdir()}
        records().iloc[::-1].to_csv(source, index=False)
        rejected = cli("update_data.py", *args)
        assert rejected.returncode == 2 and rejected.stdout == ""
        actual_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        assert rejected.stderr == ("Data update rejected; prior state/champion preserved: "
                                   f"Source SHA mismatch: expected {digest}, received {actual_hash}; use --allow-source-update explicitly\n")
        assert state.read_bytes() == previous
        assert before_cache == {p.name: p.read_bytes() for p in cache.iterdir()}
        reordered = cli("update_data.py", *args, "--allow-source-update")
        assert reordered.returncode == 0 and reordered.stderr == ""
        assert json.loads(reordered.stdout)["status"] == "no_op"
        assert state.read_bytes() == previous


def test_downloader_uses_same_verified_ingestion_and_offline_is_offline(monkeypatch):
    import io
    import asu_ml.data as data
    content = records().to_csv(index=False).encode("utf-8")
    digest = hashlib.sha256(content).hexdigest()
    calls = []

    def download(request, timeout):
        calls.append((request.get_header("User-agent"), timeout))
        return io.BytesIO(content)

    monkeypatch.setattr(data, "urlopen", download)
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        remote = ingest(cache=root / "cache", expected_sha=digest)
        assert calls == [("Mozilla/5.0 AsuResearch/1.0", 45)]
        assert remote["source_sha256"] == digest
        local = ingest(source=remote["path"], cache=root / "cache", expected_sha=digest)
        assert local["status"] == "no_op" and len(calls) == 1


def test_train_and_calibration_outputs_invariant_to_test_labels(monkeypatch):
    import asu_ml.training as training
    monkeypatch.setattr(training, "family_estimators", lambda: {})
    frame, _ = canonical_events(records())
    parts, _ = chronological_splits(frame)
    chosen, _, _ = training.compare_and_select(parts)
    _, encoder, models, _, _, _, _ = training.fit_final(parts, chosen)
    xcal = encoder.transform(parts["calibration"])
    # Add calibration rows only for finite-rank CQR software test support.
    xcal = np.repeat(xcal, 5, axis=0)
    yc = np.repeat(parts["calibration"].duration, 5)
    before = np.column_stack([model.predict(xcal) for model in models])
    before_offset = calibrate(before, yc)
    altered = {name: part.copy() for name, part in parts.items()}
    altered["test"]["duration"] = 999999.
    after_choice, _, _ = training.compare_and_select(altered)
    _, _, after_models, _, _, _, _ = training.fit_final(altered, after_choice)
    after = np.column_stack([model.predict(xcal) for model in after_models])
    assert after_choice == chosen
    np.testing.assert_equal(before, after)
    assert calibrate(after, yc) == before_offset


def test_registry_publication_verifies_bytes_and_preserves_previous_on_tamper():
    from asu_ml.data import save_json, sha256
    artifact, _, x = bundle()
    metrics = {"test": {"calibrated": {"mae": 2., "coverage": .8}}, "strong_baseline_mae": 3.,
               "parity": {"count": 10000, "max_abs_error": 0.}, "splits": {"group_isolation_verified": True}}
    with tempfile.TemporaryDirectory() as folder:
        candidate, champion = Path(folder) / "candidate", Path(folder) / "champion"
        candidate.mkdir()
        save_json(candidate / "model.json", artifact)
        save_json(candidate / "metrics.json", metrics)
        vectors = np.tile(x, (140, 1))[:10000]
        fixture = {"inputs": vectors.tolist(), "expected": predict_artifact(artifact, vectors).tolist()}
        save_json(candidate / "parity-fixtures.json", fixture)
        (candidate / "model-card.md").write_text("Experimental software test bundle")
        save_json(candidate / "checksums.json", {p.name: sha256(p) for p in candidate.iterdir()})
        result = publish(candidate, champion, experimental=True)
        assert result["status"] == "experimental_publish_allowed" and not result["production_gate_passed"]
        before = {p.name: p.read_bytes() for p in champion.iterdir()}
        assert publish(candidate, champion, experimental=True)["status"] == "no_op"
        (candidate / "model-card.md").write_text("tampered")
        result = publish(candidate, champion, experimental=True)
        assert result["status"] == "rejected" and result["reasons"] == ["checksum_mismatch"]
        assert before == {p.name: p.read_bytes() for p in champion.iterdir()}
        # Rehashing a wrong expected vector must not make it trustworthy. The
        # registry re-evaluates the actual portable model, even for a no-op.
        (candidate / "model-card.md").write_text("Experimental software test bundle")
        fixture["expected"][0][0] += 1.
        save_json(candidate / "parity-fixtures.json", fixture)
        save_json(candidate / "checksums.json", {p.name: sha256(p) for p in candidate.iterdir() if p.name != "checksums.json"})
        result = publish(candidate, champion, experimental=True)
        assert result["status"] == "rejected" and result["reasons"] == ["fixture_parity_failed"]
        assert before == {p.name: p.read_bytes() for p in champion.iterdir()}
