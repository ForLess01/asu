# Experimental reported-duration model — Asu

**Not actual restoration prediction. Production promotion is blocked.**
`target_semantics: reported_duration_not_actual_restoration`; `label_semantics_approved: false`.

## Measured run

| Property | Value |
|---|---|
| Run | `reported-0798ed3ef4a6-f0bd6e8d6571` |
| Source SHA-256 | `0798ed3ef4a649b8f4b0c75a37a3799d3694abfcaa7d7524c80cb0ebf04d2a4c` |
| Raw rows / eligible unique events | 45671 / 32682 |
| Train / validation / calibration / historical test | 13336 / 8691 / 7811 / 2833 |
| Supported calibration / historical test | 7796 / 2830 |
| Purged crossing-boundary labels | 11 |
| Positive durations >168 h retained | 100 |
| Historical test MAE / MedAE / RMSE (h) | 4.645255 / 1.983696 / 25.867678 |
| EPS baseline MAE (h) | 4.940018 |
| Relative MAE improvement | 5.967% |
| Raw / calibrated historical coverage | 0.730742 / 0.755477 |
| Calibrated median / mean interval width (h) | 6.375626 / 11.559146 |
| Nonnegative independent-2023 CQR offset (h) | 0.133973 |
| Python export max error across 10,000 fixtures (h) | 1.42108547152e-14 |
| Source attribution | SUNASS; Plataforma Nacional de Datos Abiertos del Perú; ODC-BY |

## Protocol

Four median-GBR configurations are selected by 2022 validation MAE only. Vocabulary is fit
on 2019–2021 during selection and refit on train+2022 for the final three quantile models.
Calibration fits no estimator or vocabulary. All partition labels crossing their right
boundary are purged. EPS baseline requires 20 fit events and otherwise uses global quantiles.
SVR alone uses a recorded training-only seed-42 cap of 4000; other families use all fit data.
ExtraTrees uses 60 trees and depth 10 for bounded CPU/memory, not an exhaustive search.
Comparators use raw-hour targets (OLS and Ridge are ordinary linear mean regressors).
HGB is a research comparator, not exported as GBR. No seed or parameter is selected on test.
Three additional expanding-window checks are train-only diagnostics, not another selection pass.

## Interpretation and limitations

- End fields have not been verified as actual restoration; this predicts reported duration only.
- label_semantics_approved=false; no production validity or household restoration guarantee.
- January–May 2024 was previously viewed and is historical exploratory reuse, not independent acceptance.
- All positive durations are retained, including questionable extreme labels; they are not verified truth.
- Nonnegative CQR is fitted only on 2023; temporal drift invalidates unconditional exchangeability guarantees.
- Only supported training EPS/department combinations are served; no residual or elapsed-time forecast.
- No household data, cause, year, end time, affected connections or response trucks enter model inputs.

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
