"""Validate the delivered real-data bundle without external raw files or training."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from asu_ml.data import EXPECTED_SHA, sha256
from asu_ml.portable import validate_artifact
from asu_ml.training import quantile_metrics

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "artifacts/current"


def load(name):
    return json.loads((EVIDENCE / name).read_text(encoding="utf-8"))


def test_delivered_checksums_public_bundle_and_exact_fixture_schema():
    for name, expected in load("checksums.json").items():
        assert sha256(EVIDENCE / name) == expected, name
    public = ROOT / "apps/web/public/models/current"
    checksums = json.loads((public / "checksums.json").read_text(encoding="utf-8"))
    for name, expected in checksums.items():
        assert sha256(public / name) == expected
        assert (public / name).read_bytes() == (EVIDENCE / name).read_bytes()
    artifact = load("model.json")
    assert validate_artifact(artifact)
    assert artifact["source_sha256"] == EXPECTED_SHA
    assert artifact["label_semantics_approved"] is False and artifact["status"] == "experimental"
    fixture = load("parity-fixtures.json")
    assert set(fixture) == {"inputs", "expected"}
    assert np.asarray(fixture["inputs"]).shape == (10000, 5)
    assert np.asarray(fixture["expected"]).shape == (10000, 3)
    assert np.isfinite(fixture["inputs"]).all() and np.isfinite(fixture["expected"]).all()
    assert len(list((EVIDENCE / "figures").glob("*.png"))) >= 8
    assert len(list((EVIDENCE / "figures").glob("*.pdf"))) >= 8


def test_delivered_metrics_recompute_from_postprocessed_holdout():
    holdout = pd.read_csv(EVIDENCE / "holdout-predictions.csv")
    metrics = load("metrics.json")
    y = holdout.actual.to_numpy()
    for kind, columns in [("raw", ["raw_p10", "raw_p50", "raw_p90"]),
                          ("calibrated", ["p10", "p50", "p90"])]:
        values = holdout[columns].to_numpy()
        assert np.all(values >= 0) and np.all(np.diff(values, axis=1) >= 0)
        recomputed = quantile_metrics(y, values)
        for name in ["mae", "medae", "rmse", "r2", "coverage", "mean_width_hours", "median_width_hours", "interval_score_80"]:
            np.testing.assert_allclose(metrics["test"][kind][name], recomputed[name], atol=1e-10)
        for quantile in ["p10", "p50", "p90"]:
            np.testing.assert_allclose(metrics["test"][kind]["pinball"][quantile], recomputed["pinball"][quantile], atol=1e-10)
    assert holdout.label_kind.eq("reported_duration_not_verified_actual_restoration").all()


def test_actual_event_ids_purges_and_positive_tail_counts():
    events = pd.read_csv(EVIDENCE / "canonical-events.csv")
    assignments = pd.read_csv(EVIDENCE / "split-assignments.csv")
    quality, splits, metrics = load("data-quality.json"), load("splits.json"), load("metrics.json")
    assert events.IDINTERRUPCION.is_unique and assignments.IDINTERRUPCION.is_unique
    assert len(events) == quality["eligible_events"] == metrics["dataset"]["eligible_events"]
    assert events.duration.gt(0).all()
    assert events.duration.gt(168).sum() == quality["positive_tail_over_168h_retained"] > 0
    assert set(assignments.IDINTERRUPCION).isdisjoint(splits["purged_cross_boundary_ids"])
    assert len(assignments) + splits["purged_count"] + len(splits["unassigned_event_ids"]) == len(events)
    for name, bounds in splits["partitions"].items():
        part = assignments.loc[assignments.partition.eq(name)]
        start, end = pd.to_datetime(part.start), pd.to_datetime(part.end)
        assert len(part) == bounds["count"]
        assert start.ge(pd.Timestamp(bounds["start_inclusive"], tz="America/Lima")).all()
        assert end.lt(pd.Timestamp(bounds["start_exclusive"], tz="America/Lima")).all()
    assert quality["raw_rows"] == 45671 and quality["unique_event_ids"] == 43520
    assert quality["exact_duplicate_rows"] == 671


def test_experiment_search_and_only_svr_has_training_cap():
    rows = pd.read_csv(EVIDENCE / "experiments.csv")
    metrics = load("metrics.json")
    trials = rows.loc[rows.phase.eq("validation") & rows.algorithm.eq("QuantileGBR")]
    assert len(trials) == 4
    assert metrics["search"]["selection_partition"] == "2022"
    assert metrics["search"]["selected_params"] == json.loads(trials.loc[trials.mae.idxmin(), "params"])
    for phase, count in [("validation", metrics["splits"]["partitions"]["train"]["count"]),
                         ("historical_test", metrics["dataset"]["final_fit_events"])]:
        subset = rows.loc[rows.phase.eq(phase)]
        assert subset.loc[subset.algorithm.ne("SVR"), "fit_count"].eq(count).all()
        assert subset.loc[subset.algorithm.eq("SVR"), "fit_count"].eq(min(count, 4000)).all()
        assert subset.evaluation_count.nunique() == 1
    assert metrics["splits"]["test_role"] == "historical_exploratory_reuse_not_independent_acceptance"
