# Asu

<img src="assets/brand/asu-logo.png" alt="Asu" width="280" />

**Water continuity planning for Peruvian households.**

Asu helps households record water reserves, compare consumption and replenishment scenarios, organize tasks, and keep an outage history. Scientific estimates live in an explicitly experimental laboratory, separate from household balance calculations.

## Project status

**Functional local implementation with verified experimental ML.** The bilingual React application, IndexedDB persistence, model Worker, reproducible training pipeline, database migration and CI/CD definitions exist and have local test evidence. A public production URL and hosted OAuth/synchronization have **not** been established. The model predicts historical **reported duration**, not verified actual restoration.

## Run locally

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174`. No account, API key or environment variable is needed for guest use. The example workspace is fictional and remains visibly separate from your own data. Cloud synchronization is optional and says unconfigured until its service is genuinely available.

## Implemented flows

- Household setup, editable containers and separate drinking/cooking versus other-use reserves.
- Consumption assumptions, constant-demand autonomy, optional-activity deferral and capacity-limited replenishment scenarios.
- Local incidents, observed household restoration, corrections, history and due-task reminders while the app is open.
- Spanish/English interface, JSON export/validated restore, confirmed reset and IndexedDB revision conflict handling.
- Experimental model inference in a Web Worker, with supported EPS/department pairs, source dates, integrity-checked evidence and explicit abstentions.
- Optional Google OAuth/cloud adapter, owner-isolated Postgres RPC and manual version-controlled synchronization contract. Hosted integration remains pending.

No live official feed, background push, sensor reading, water-potability certification or household savings claim is fabricated.

## Verify

```sh
python3 scripts/verify_project.py
# Real SQL tests require server binaries, not only the libpq client tools:
python3 scripts/test_database.py --evidence artifacts/verification/database.json
```

Reference local results: **27 JavaScript tests**, **101 pytest tests**, **16 desktop/mobile E2E tests**, and **132 SQL assertions** on isolated PostgreSQL 16. Python/Node predictions match on **10,000 vectors** to a maximum error of `1.42e-14` hours. See [delivery status](docs/DELIVERY_STATUS.md) for scope and limitations. These numbers are test evidence, not a claim of remote CI execution or live Supabase verification.

## Start here

- [Implementation plan](PLAN_IMPLEMENTACION.md) — product behavior, UX/UI, data contracts, scientific methodology, architecture, zero-cost deployment constraints, CI/CD, retraining, tests and academic-report specification.
- [Product behavior and evidence](PRODUCT.md), [operations](docs/OPERATIONS.md) and [Supabase setup](docs/SUPABASE.md).
- [Reproduce model training](ml/README.md) and [machine-readable metrics](artifacts/current/metrics.json).
- [Transparent PNG logo](assets/brand/asu-logo.png) and [icon](assets/brand/asu-icon.png).
- [Editable SVG logo](assets/brand/asu-logo.svg) and [icon](assets/brand/asu-icon.svg).

## Architecture

- Python and scikit-learn for reproducible training and evaluation.
- Portable quantile GBR model evaluated in the browser with Python/JavaScript parity and whole-bundle checksum tests.
- React/TypeScript app with a PWA manifest and cache-coherence logic; production packaging/install behavior remains unverified.
- Optional Supabase Free deployment contract for accounts and household synchronization.
- Five scientific/technical layers: raw provenance, event-level validation, chronological evaluation/calibration, immutable evidence and controlled publication. GitHub Actions definitions cover CI, training, maintenance and manual Pages deployment; they have not executed remotely.

Free-tier limits, inactivity policies and spending controls are part of the plan; no unlimited availability or completed deployment is claimed. All hosted GitHub jobs require `ASU_HOSTED_JOBS_ENABLED=true`; initial publication leaves it `false` until account-wide quota and a zero-spend budget are verified. A skipped run is not evidence that CI passed remotely.

## Data and evidence

Initial source: [SUNASS interruption register](https://www.datosabiertos.gob.pe/dataset/registro-de-interrupciones-del-servicio-de-agua-y-alcantarillado-imprevistas-y-programadas), published under ODC-BY. The source describes interruption events, not individual household water consumption. Preserve attribution and distinguish expected, reported and actual restoration.

The current exploratory run keeps all positive eligible reported durations, including 100 events above 168 hours. On 2,830 supported historical 2024 test events: MAE **4.645 h** versus EPS median **4.940 h**, RMSE **25.868 h**, and calibrated coverage **75.55%** for a nominal 80% interval. The 2024 period was previously inspected; labels remain unapproved for actual restoration. Production scientific promotion is rejected, preserving the active experimental bundle.

## Academic report

The **Montserrat LaTeX report** is outside this repository, at `../informes/asu/output/asu_report.pdf` in the surrounding workspace. Its editable sources, five actual app screenshots and reproducible import scripts are in `../informes/asu/`. Code and sanitized metric/figure exports belong here; report LaTeX/PDF and auxiliary files do not. The current publication edition has 27 pages, including the first GitHub commit and the explicitly skipped CI receipt.
