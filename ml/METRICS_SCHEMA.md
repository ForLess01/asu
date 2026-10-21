# Metrics summary v1

`metrics.json` is an extensible research object, not a required UI state shape. Units
are hours unless named otherwise. Every output carries experimental status and the
unapproved reported-duration semantics. Unknown additive fields should be ignored.

| Field | Meaning |
|---|---|
| `schema_version`, `run_id`, `source_sha256` | Summary version and content/code provenance. |
| `status`, `target_semantics`, `label_semantics_approved` | Always `experimental`, `reported_duration_not_actual_restoration`, `false`. |
| `dataset` | Actual raw row count, eligible unique events, final-fit, supported calibration/test counts, positive tail retained. |
| `splits.partitions.<name>` | Count, fixed bounds, actual minimum/maximum start, maximum label end, frozen event IDs. Names: `train`, `validation`, `calibration`, `test`. |
| `splits.purged_cross_boundary_ids`, `purged_count` | Labels unavailable at split closure. |
| `splits.group_isolation_verified`, `unassigned_event_ids`, `test_role` | Audit and exploratory-reuse warning, not a scientific validity certificate. |
| `search` | Four validation-only trial records, selected parameters, seed, train-only vocabulary and SVR cap. |
| `expanding_train_diagnostics` | Three expanding purged train-only checks, not additional selection. |
| `model_comparison[]` | Algorithm, phase, fit/evaluation counts, exact parameters, timing and point/interval metrics where applicable. |
| `test.raw`, `test.calibrated` | Metrics on clamp/sorted outputs before and after independent-2023 CQR. |
| `calibration` | Formula, rank, count, nominal level, offset hours, 2023 before/after metrics. |
| `strong_baseline_mae`, `relative_improvement_pct` | EPS-median comparison on the same supported historical-test events. |
| `segments.eps`, `segments.month` | Per-group `raw` and `calibrated` metric objects; no local guarantee. |
| `tail.thresholds_fit_train_only_hours`, `tail.test` | Train p90/p95 thresholds fixed before evaluation, long-duration historical-test metrics. |
| `support` | Test/calibration abstention counts and test abstention rate; all unsupported IDs are separately exported. |
| `parity` | 10,000 count, Python max error, tolerance, software probes, runtime; Node/browser verification remains explicitly pending here. |
| `runtime`, `versions`, `limitations` | Measured timings, model bytes, library/Python versions, scientific caveats. |

## Metric object

Point metrics: `n`, `mae`, `medae`, `rmse`, `r2` (null for n<2). For quantiles:
`coverage`, `mean_width_hours`, `median_width_hours`, `interval_score_80`,
`pinball.{p10,p50,p90}`. Coverage is the inclusive observed fraction inside the
postprocessed lower/upper endpoints. Interval score uses width plus 10 times each
endpoint violation (central 80%). Test metrics cover only supported requests;
the abstention denominator is the full purged 2024 partition. No MAPE, accuracy or
manufactured uncertainty bounds are included.

`holdout-predictions.csv` records the target as `actual` for plotting compatibility
with an explicit `label_kind=reported_duration_not_verified_actual_restoration`.
It is not an assertion that SUNASS end fields represent actual restoration.

## Registry verdict

`ml/promote.py` exits 2 on rejection, 0 for a verified no-op or explicitly allowed
experimental publication. Technical/performance gates require finite valid metrics,
at least 5% EPS-baseline MAE improvement, no champion MAE degradation >2%, empirical
coverage in [0.75,0.85], group isolation, 10,000 parity cases within 1e-4 and verified
file checksums. The registry independently evaluates every fixture against the
portable model, including before returning a no-op; rehashing incorrect expected
outputs cannot bypass parity. Production additionally requires approved label semantics and a
prospective independent acceptance period; **this pipeline cannot satisfy them**.
An experimental verdict is `experimental_publish_allowed` with
`production_gate_passed: false`, not a false production pass. These design thresholds
are fixed in code and are not tuned to historical-test results.

## Bundle/schema safety

Publication validates all shared model fields, including `model_version`,
`source_sha256` and `data_cutoff`, even when model checksums have been regenerated.
Dates must be real ISO calendar dates and source fingerprints must be 64 hexadecimal
characters. Experimental enums and the literal false approval flag are mandatory.
Missing nested fields, boolean numeric values, duplicate support pairs and tree
graphs outside the browser's size/depth bounds are rejected.

The complete staged bundle is assessed with the same registry checks as its source,
against the **original candidate fingerprints**, before the active directory changes.
A caught copy/activation error preserves or restores the previous complete directory;
it is not reported as a successful gate verdict. The directory switch uses two
same-filesystem renames, not a crash-atomic multi-file operation. Single-publisher,
crash-window, retained-backup and recovery limitations are documented in
`ml/README.md` under “Publication consistency and recovery.” No metrics, fitted
estimators or parity expected values are altered by this publication hardening.
