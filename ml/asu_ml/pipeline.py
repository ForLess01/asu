"""End-to-end scientific evidence production, not production certification."""

from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import time
import zipfile

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from .data import SEMANTICS, canonical_events, chronological_splits, ingest, read_csv, save_json, sha256
from .portable import calibrate, export_model, postprocess, predict_artifact
from .training import (SEED, compare_and_select, expanding_diagnostics, fit_final,
                       point_metrics, quantile_metrics)

LIMITATIONS = [
    "End fields have not been verified as actual restoration; this predicts reported duration only.",
    "label_semantics_approved=false; no production validity or household restoration guarantee.",
    "January–May 2024 was previously viewed and is historical exploratory reuse, not independent acceptance.",
    "All positive durations are retained, including questionable extreme labels; they are not verified truth.",
    "Nonnegative CQR is fitted only on 2023; temporal drift invalidates unconditional exchangeability guarantees.",
    "Only supported training EPS/department combinations are served; no residual or elapsed-time forecast.",
    "No household data, cause, year, end time, affected connections or response trucks enter model inputs.",
]


def group_metrics(frame, raw, calibrated, column):
    result = {}
    for value in sorted(frame[column].unique(), key=str):
        mask = frame[column].eq(value).to_numpy()
        y = frame.loc[mask, "duration"].to_numpy()
        result[str(value)] = {"raw": quantile_metrics(y, raw[mask]), "calibrated": quantile_metrics(y, calibrated[mask])}
    return result


def parity_vectors(encoder, models, fit, count=10000):
    """Historical vectors plus software-only threshold-neighbour probes.

    These probes never enter scientific observations, counts, training or metrics.
    Expected values always come from scikit-learn with float32 inputs.
    """
    rng = np.random.default_rng(SEED)
    x = encoder.transform(fit)
    vectors = x[rng.choice(len(x), count, replace=True)].copy()
    cursor = 0
    for model in models:
        for estimator in model.estimators_.ravel():
            tree = estimator.tree_
            for feature, threshold in zip(tree.feature, tree.threshold):
                if feature not in (0, 1, 2) or cursor + 2 >= count:
                    continue
                middle = np.float32(threshold)
                for value in [np.nextafter(middle, np.float32(-np.inf)), middle,
                              np.nextafter(middle, np.float32(np.inf))]:
                    if feature < 2 and value % 1:
                        continue
                    if feature == 0 and not 1 <= value <= 12:
                        continue
                    if feature == 1 and not 0 <= value <= 6:
                        continue
                    if feature == 2 and not 0 <= value < 24:
                        continue
                    vectors[cursor, feature] = value
                    cursor += 1
    return vectors, cursor


def run(source, output, cache, manifest_dir, expected_sha, allow_source_update=False,
        svr_cap=4000, font_dir=None):
    start = time.perf_counter()
    output = Path(output)
    if (output / "model.json").exists():
        raise ValueError("Evidence output already contains a model; choose a new candidate directory, never overwrite a completed run")
    ingestion = ingest(source, cache, expected_sha, allow_source_update)
    raw = read_csv(ingestion["path"])
    frame, quality = canonical_events(raw)
    parts, split_info = chronological_splits(frame)
    if any(len(p) < 5 for p in parts.values()):
        raise ValueError("Each fixed chronological partition requires at least five eligible events")
    source_hash = ingestion["source_sha256"]
    output.mkdir(parents=True, exist_ok=True)
    code_files = sorted(Path(__file__).parent.glob("*.py"))
    code_hash = hashlib.sha256(b"".join(p.name.encode() + p.read_bytes() for p in code_files)).hexdigest()
    run_id = f"reported-{source_hash[:12]}-{code_hash[:12]}"
    versions = {name: importlib.metadata.version(name) for name in ["numpy", "pandas", "scikit-learn", "matplotlib", "pytest", "threadpoolctl"]}
    versions["python"] = platform.python_version()
    # All family fitting, including HGB/OpenMP, is bounded to one CPU thread.
    with threadpool_limits(limits=1):
        chosen, experiments, search = compare_and_select(parts, svr_cap)
        fit, encoder, models, test, baselines, test_rows, fit_seconds = fit_final(parts, chosen, svr_cap)
        experiments.extend(test_rows)
        expanding = expanding_diagnostics(parts["train"], chosen)
        calibration = parts["calibration"].loc[encoder.supported(parts["calibration"])].copy()
        xc, xt = encoder.transform(calibration), encoder.transform(test)
        raw_cal = np.column_stack([model.predict(xc) for model in models])
        offset = calibrate(raw_cal, calibration.duration.to_numpy())
        raw_test = np.column_stack([model.predict(xt) for model in models])
        raw_test_pp, calibrated = postprocess(raw_test), postprocess(raw_test, offset)
        cutoff = str(frame.start.max().date())
        artifact = export_model(models, encoder, offset, source_hash, cutoff)
        vectors, probe_count = parity_vectors(encoder, models, fit)
        reference = postprocess(np.column_stack([model.predict(vectors.astype(np.float32)) for model in models]), offset)
        parity_start = time.perf_counter()
        portable = predict_artifact(artifact, vectors)
        parity_seconds = time.perf_counter() - parity_start
        max_error = float(np.max(np.abs(reference - portable)))
        if max_error > 1e-4:
            raise ValueError(f"Python artifact parity failed: {max_error}")
    metrics = {**SEMANTICS, "schema_version": 1, "run_id": run_id, "source_sha256": source_hash,
               "dataset": {"raw_rows": len(raw), "eligible_events": len(frame), "final_fit_events": len(fit),
                           "calibration_events": len(calibration), "test_events": len(test), "positive_tail_over_168h": int(frame.duration.gt(168).sum())},
               "splits": split_info, "search": search, "expanding_train_diagnostics": expanding,
               "model_comparison": experiments,
               "test": {"raw": quantile_metrics(test.duration, raw_test_pp),
                        "calibrated": quantile_metrics(test.duration, calibrated)},
               "calibration": {"offset_hours": offset, "n": len(calibration), "partition": "2023",
                               "rank": math.ceil((len(calibration) + 1) * .8), "nominal_coverage": .8,
                               "method": "max(0, finite rank of max(clamped_sorted_q10-y, y-clamped_sorted_q90))",
                               "raw": quantile_metrics(calibration.duration, postprocess(raw_cal)),
                               "calibrated": quantile_metrics(calibration.duration, postprocess(raw_cal, offset))},
               "strong_baseline_mae": point_metrics(test.duration, baselines["EPSMedian"][:, 1])["mae"],
               "support": {"test_abstentions": len(parts["test"]) - len(test),
                           "calibration_abstentions": len(parts["calibration"]) - len(calibration),
                           "test_abstention_rate": 1 - len(test) / len(parts["test"])},
               "parity": {"count": len(vectors), "max_abs_error": max_error, "tolerance_hours": 1e-4,
                          "threshold_software_probe_count": probe_count, "python_artifact_seconds_10000": parity_seconds,
                          "node_browser_status": "pending_frontend_owned_verification", "expected_source": "sklearn_float32"},
               "runtime": {"final_three_quantile_fit_seconds": fit_seconds, "threads": 1},
               "versions": versions, "limitations": LIMITATIONS}
    metrics["relative_improvement_pct"] = 100 * (1 - metrics["test"]["calibrated"]["mae"] / metrics["strong_baseline_mae"])
    metrics["segments"] = {"eps": group_metrics(test, raw_test_pp, calibrated, "EPS"),
                           "month": group_metrics(test, raw_test_pp, calibrated, "month")}
    thresholds = {"p90": float(parts["train"].duration.quantile(.9)), "p95": float(parts["train"].duration.quantile(.95))}
    metrics["tail"] = {"thresholds_fit_train_only_hours": thresholds, "test": {}}
    for name, threshold in thresholds.items():
        mask = test.duration.ge(threshold).to_numpy()
        metrics["tail"]["test"][name] = quantile_metrics(test.loc[mask, "duration"], calibrated[mask]) if mask.any() else {"n": 0}
    holdout = test[["IDINTERRUPCION", "EPS", "DEPARTAMENTO", "start", "end", "duration"]].copy()
    holdout = holdout.rename(columns={"duration": "actual"})
    holdout["label_kind"] = "reported_duration_not_verified_actual_restoration"
    for i, name in enumerate(["p10", "p50", "p90"]):
        holdout[f"raw_{name}"] = raw_test_pp[:, i]
        holdout[name] = calibrated[:, i]
    holdout["eps_median"] = baselines["EPSMedian"][:, 1]
    holdout["global_median"] = baselines["GlobalMedian"][:, 1]
    holdout.to_csv(output / "holdout-predictions.csv", index=False)
    rejected = parts["test"].loc[~encoder.supported(parts["test"]), ["IDINTERRUPCION", "EPS", "DEPARTAMENTO", "start"]].copy()
    rejected["reason"] = "unsupported_training_combination"
    rejected.to_csv(output / "holdout-abstentions.csv", index=False)
    events_export = frame[["IDINTERRUPCION", "EPS", "DEPARTAMENTO", "MOTIVOINTERRUPCION", "start", "end", "duration"]].copy()
    events_export.to_csv(output / "canonical-events.csv", index=False)
    assignment = pd.concat([p.assign(partition=name) for name, p in parts.items()])
    assignment[["IDINTERRUPCION", "start", "end", "partition"]].to_csv(output / "split-assignments.csv", index=False)
    audit_tables = {
        "events-by-eps": frame.groupby("EPS").duration.agg(["size", "median", "mean", "max"]),
        "events-by-department": frame.groupby("DEPARTAMENTO").duration.agg(["size", "median", "mean", "max"]),
        "events-by-cause": frame.groupby("MOTIVOINTERRUPCION").duration.agg(["size", "median", "mean", "max"]),
        "events-by-month": frame.groupby(frame.start.dt.strftime("%Y-%m")).duration.agg(["size", "median", "mean", "max"]),
    }
    for name, table in audit_tables.items():
        table.to_csv(output / f"{name}.csv")
    missing = raw.apply(lambda col: col.str.strip().eq(""))
    missing["year"] = raw.FECHAINICIO.str[:4]
    missing.groupby("year").mean().to_csv(output / "missingness-by-year.csv")
    manifest = {**ingestion, **SEMANTICS, "ingestion_action": ingestion["status"], "path": f"raw/{source_hash}.csv",
                "run_id": run_id, "code_sha256": code_hash, "versions": versions, "seed": SEED,
                "generated_utc": datetime.now(timezone.utc).isoformat(), "feature_order": artifact["feature_order"],
                "filters": "freeze IDs; quarantine conflicts/invalids; unplanned drinking water; all positive durations",
                "calibration_isolation": "fit on train+validation, freeze, then calibrate 2023, evaluate historical 2024",
                "scientific_status": "experimental", "label_semantics_approved": False}
    save_json(output / "source-manifest.json", manifest)
    save_json(Path(manifest_dir) / f"sunass-{source_hash}.json", manifest)
    save_json(output / "data-quality.json", quality)
    save_json(output / "splits.json", split_info)
    save_json(output / "model.json", artifact)
    save_json(output / "feature-schema.json", {"feature_order": artifact["feature_order"], "preprocessing": artifact["preprocessing"], "support": artifact["support"]})
    save_json(output / "calibration.json", metrics["calibration"])
    save_json(output / "parity-fixtures.json", {"inputs": vectors.tolist(), "expected": reference.tolist()})
    experiments.append({"algorithm": "QuantileGBR", "phase": "historical_test", "params": chosen,
                        "fit_count": len(fit), "evaluation_count": len(test), "fit_seconds": fit_seconds,
                        **metrics["test"]["calibrated"]})
    flat = [{**row, "params": json.dumps(row.get("params", {}), sort_keys=True),
             "pinball": json.dumps(row.get("pinball", {})), "run_id": run_id,
             "source_sha256": source_hash, "seed": SEED, **SEMANTICS} for row in experiments]
    pd.DataFrame(flat).to_csv(output / "experiments.csv", index=False)
    # Metrics are consumed by the plots and documented as an extensible v1 object.
    save_json(output / "metrics.json", metrics)
    from .plots import create_figures
    create_figures(output / "figures", raw, frame, quality, parts, experiments, holdout, metrics, font_dir)
    metrics["runtime"]["total_seconds"] = time.perf_counter() - start
    metrics["runtime"]["model_bytes"] = (output / "model.json").stat().st_size
    save_json(output / "metrics.json", metrics)
    model_card = f"""# Experimental reported-duration model — Asu

**Not actual restoration prediction. Production promotion is blocked.**
`target_semantics: reported_duration_not_actual_restoration`; `label_semantics_approved: false`.

## Measured run

| Property | Value |
|---|---|
| Run | `{run_id}` |
| Source SHA-256 | `{source_hash}` |
| Raw rows / eligible unique events | {len(raw)} / {len(frame)} |
| Train / validation / calibration / historical test | {' / '.join(str(len(p)) for p in parts.values())} |
| Supported calibration / historical test | {len(calibration)} / {len(test)} |
| Purged crossing-boundary labels | {split_info['purged_count']} |
| Positive durations >168 h retained | {quality['positive_tail_over_168h_retained']} |
| Historical test MAE / MedAE / RMSE (h) | {metrics['test']['calibrated']['mae']:.6f} / {metrics['test']['calibrated']['medae']:.6f} / {metrics['test']['calibrated']['rmse']:.6f} |
| EPS baseline MAE (h) | {metrics['strong_baseline_mae']:.6f} |
| Relative MAE improvement | {metrics['relative_improvement_pct']:.3f}% |
| Raw / calibrated historical coverage | {metrics['test']['raw']['coverage']:.6f} / {metrics['test']['calibrated']['coverage']:.6f} |
| Calibrated median / mean interval width (h) | {metrics['test']['calibrated']['median_width_hours']:.6f} / {metrics['test']['calibrated']['mean_width_hours']:.6f} |
| Nonnegative independent-2023 CQR offset (h) | {offset:.6f} |
| Python export max error across 10,000 fixtures (h) | {max_error:.12g} |
| Source attribution | SUNASS; Plataforma Nacional de Datos Abiertos del Perú; ODC-BY |

## Protocol

Four median-GBR configurations are selected by 2022 validation MAE only. Vocabulary is fit
on 2019–2021 during selection and refit on train+2022 for the final three quantile models.
Calibration fits no estimator or vocabulary. All partition labels crossing their right
boundary are purged. EPS baseline requires 20 fit events and otherwise uses global quantiles.
SVR alone uses a recorded training-only seed-42 cap of {svr_cap}; other families use all fit data.
ExtraTrees uses 60 trees and depth 10 for bounded CPU/memory, not an exhaustive search.
Comparators use raw-hour targets (OLS and Ridge are ordinary linear mean regressors).
HGB is a research comparator, not exported as GBR. No seed or parameter is selected on test.
Three additional expanding-window checks are train-only diagnostics, not another selection pass.

## Interpretation and limitations

{chr(10).join('- ' + item for item in LIMITATIONS)}

No official event-by-event end-label audit has been completed. No household impact,
prospective acceptance, browser/device latency, bootstrap confidence interval, or production
deployment is claimed. `actual` in holdout CSV means the recorded numeric target only;
`label_kind` disambiguates it. Input features are month, Monday-zero weekday, fractional
hour, EPS and department. Unknown categories/combinations abstain. Geographic support is
not proof a household is affected. Full tail, cause summaries and quarantined IDs remain
available in the quality/evidence tables for investigation, not causal interpretation.

## Reproduce and verify

See `ml/README.md` for commands and `ml/METRICS_SCHEMA.md` for the extensible summary schema.
`parity-fixtures.json` expected outputs come from Python/scikit-learn float32 prediction,
not from the exporter. Node and browser parity verification is owned by the frontend.
"""
    (output / "model-card.md").write_text(model_card, encoding="utf-8")
    summary = {**SEMANTICS, "run_id": run_id, "source_sha256": source_hash, "counts": metrics["dataset"],
               "test": metrics["test"], "strong_baseline_mae": metrics["strong_baseline_mae"],
               "relative_improvement_pct": metrics["relative_improvement_pct"], "parity": metrics["parity"],
               "runtime": metrics["runtime"], "limitations": LIMITATIONS}
    save_json(output / "run-summary.json", summary)
    checksums = {str(p.relative_to(output)): sha256(p) for p in sorted(output.rglob("*")) if p.is_file()}
    save_json(output / "checksums.json", checksums)
    with zipfile.ZipFile(output / "evidence_bundle.zip", "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in list(checksums) + ["checksums.json"]:
            bundle.write(output / name, arcname=name)
    return summary
