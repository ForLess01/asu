# Reproduce the experimental reported-duration pipeline

This pipeline trains on the complete official SUNASS snapshot, generates auditable
evidence and exports portable quantile GBR trees. **It does not predict verified actual
restoration and cannot pass the production label-semantics gate.** The 2024 evaluation
is historical exploratory reuse, never an untouched acceptance set.

## Quick path

Run from the repository root with Python 3.11 or later and the pinned dependencies in
`ml/requirements.txt`. An environment installer is not part of the pipeline.

```sh
# Tests do not download or train the scientific model.
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider ml/tests

# Download the pinned official snapshot if data/raw/<sha>.csv is absent.
# Completed output directories are never overwritten: choose a fresh run path.
python3 ml/run_pipeline.py --output artifacts/current

# An explicit file always works offline. Cache defaults to gitignored data/raw.
python3 ml/run_pipeline.py --source /path/to/official.csv --output artifacts/new-candidate

# Explicit experimental-only publication, NOT a deployment or production approval.
python3 ml/promote.py --candidate artifacts/current --champion apps/web/public/models/current --allow-experimental-publish

# Actual scikit-learn outputs versus standalone JSON evaluator, all 10,000 vectors.
python3 ml/evaluate_artifact.py --model artifacts/current/model.json --fixtures artifacts/current/parity-fixtures.json

# Without the explicit experimental flag, this rejects the unapproved labels.
python3 ml/promote.py --candidate artifacts/current --champion apps/web/public/models/current

# Weekly/cron source check, bounded retries, no retraining on identical/canonical hash.
python3 ml/update_data.py
# Changed source bytes require explicit review/acceptance, never automatic pin drift.
python3 ml/update_data.py --allow-source-update --retrain --timeout-seconds 300
```

`run_pipeline.py --publish <directory> --allow-experimental-publish` combines training
and experimental publication with the same registry function. Rejections exit 2 and
leave the champion unchanged. `--source` selects an existing CSV without network access;
`--expected-sha` pins a separately approved snapshot; `--allow-source-update` is the
only opt-in to accept a different fingerprint. The full source is strict UTF-8/comma.
Downloads use Mozilla User-Agent, a 45-second timeout, three attempts and a 50 MiB limit.
Original bytes are immutable and SHA-addressed; sorting rows alone is a canonical no-op.
An update advances its state only after validation (and successful bounded training if
requested). It never promotes automatically. The run budget uses one CPU thread,
four GBR validation configurations, three final quantiles, 60 ExtraTrees and a
seed-42 **training-only** SVR cap of 4,000, all recorded. Evaluation is never subsampled.

## Scientific protocol

| Stage | Rule |
|---|---|
| Identity | Freeze event IDs before any split; collapse geographic duplicates only after checking invariant times/EPS/service/type. Quarantine all conflicting IDs. |
| Eligibility | Unplanned drinking water, valid nonfuture times, nonempty categories and positive reported duration. **No upper-duration cutoff.** |
| Geography | One frozen event; lexical department choice for multidepartment events, explicitly audited; no row is presented as a household. |
| Train | 2019–2021, vocabulary fit here for selection. |
| Validation | 2022, median MAE selects only among four predeclared GBR configurations. |
| Final fit | Train+validation, refit vocabulary and three quantile estimators; never calibrate with refit data. |
| Calibration | Supported 2023 events only; finite rank `ceil((n+1)*.8)`, nonnegative CQR offset. |
| Historical test | Supported 2024 events only, previously viewed; abstentions recorded, never silently counted as predictions. |
| Availability | Purge event labels crossing each split's right boundary. All geographic rows of one event stay together. |
| Output | Clamp each raw quantile to zero, sort, subtract/add nonnegative offset at the endpoints; median unchanged. Every metric uses these same outputs. |

Family comparisons include global/EPS medians, OLS, Ridge, scaled/one-hot KNN and
SVR, decision tree, ExtraTrees, native-categorical HGB median and exportable quantile
GBR. Linear models use the raw-hour target and are deliberately not mislabeled medians.
Preprocessing/scaling is inside each fit. Train-only expanding checks are diagnostics;
there is no post-test parameter/seed tuning. End-time semantics and causality remain
unverified. Only a new prospective evaluation and a verified label audit can resolve
the scientific blockers. No environment switch can approve these labels.

## Artifacts and integration

`artifacts/current/` contains `metrics.json`, `data-quality.json`, source manifest,
`model.json`, calibration/feature schema, split assignments, all eligible canonical
events, holdout predictions and abstentions, experiments, cause/EPS/month/department
tables, missingness by year, 11 actual-data figure pairs (PNG/vector PDF), model card,
summary, checksums and `evidence_bundle.zip`. Source bytes are not embedded in the ZIP.
`data/manifests/` records original/dictionary/metadata URLs and hashes. Scientific
source code is reproducible without the sibling research directory.

Optional `--font-dir` loads local Montserrat; otherwise standard sans-serif is used.
PDF fonttype 3 accommodates CFF fonts. No fonts are downloaded by this pipeline.

Portable JSON follows `docs/INTEGRATION.md` exactly, with an additive
`support.combinations: [{eps, department}]` list for rejecting unsupported pairs.
Feature order is `month, weekday, hour, eps, department`; categories are exact ordered
strings. `weekday` uses Monday=0, hour includes minutes, timestamps use America/Lima,
tree comparisons cast input to float32 and accumulate in float64. No year, elapsed
time, cause or household data are model inputs. The standalone Python evaluator rejects
invalid time and out-of-vocabulary/pair requests rather than generating new codes.
`parity-fixtures.json` has **exactly** `inputs` and `expected`; software-only threshold
probes are never scientific observations. Frontend owns Node/browser verification.

`ml/METRICS_SCHEMA.md` documents the summary without prescribing UI assumptions.
Publication verifies the candidate, copies the complete public bundle to an inactive
same-parent staging directory, then **rechecks its schema, original source checksums
and all parity fixtures** before changing the active directory. Copy/verification
failures leave the complete champion, including history, byte-identical. Existing
assets/history are preserved in the staged copy. Prior public bytes remain available
under `previous/<model_sha>/` after a successful switch.

### Publication consistency and recovery

The local publisher requires **one publisher at a time**, regular directories without
symbolic links (including their contents),
and same-filesystem directory-rename support (the Linux/macOS workflow). It moves the
old directory to a unique sibling `.current-previous-<id>`, then renames the fully
verified stage to `current`. A caught activation failure restores the complete old
directory, including when an error is reported just after activation. There are no
individual writes into the active model directory or fallible content writes after
activation. CLI I/O failures still exit 2 through the existing error path.

**This is not a crash-atomic pointer transaction.** The two renames have a brief
missing-alias window. SIGKILL/process loss between them can leave `current` absent;
power-loss durability is not guaranteed (no filesystem-wide fsync protocol). The
intact old directory is deliberately retained at the sibling backup path for manual
checksum-verified restoration. If rollback itself encounters another I/O failure,
the exception identifies that retained path rather than claiming recovery succeeded.
Successful publication also retains the full old sibling directory; retention is
operator-managed, not automatic deletion. Multiple HTTP requests across a switch are
not pinned to one release; a future deployment-level atomic immutable-version pointer
would require separate hosting/client integration. No such guarantee is claimed here.

Metadata validation requires every shared top-level/nested field, nonempty model
version, an actual `YYYY-MM-DD` calendar date, strict scientific enums/boolean values,
and a 64-character hexadecimal source SHA-256. Numeric booleans are rejected. Browser
tree bounds and duplicate-support-pair rejection are enforced too. The browser currently
checks only that the source fingerprint is a nonempty string; Python additionally
requires the actual SHA-256 representation before publication. Existing trained
artifacts and parity expectations are not rewritten to satisfy these checks.

No remote deployment, app build or git operation is performed.

## Deliberate limits

There are no prospective or independent new-label results, residual forecasts,
production claims, bootstrap confidence intervals, household efficacy measurements
or mobile runtime measurements. These remain explicitly pending, not fabricated.
Fixed chronological 2019–2024 evidence does not silently expand into later acceptance
periods when the provider changes; a later protocol needs separate review.
