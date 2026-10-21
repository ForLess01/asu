# Asu

<img src="assets/brand/asu-logo.png" alt="Asu" width="280" />

**Water continuity planning for Peruvian households.**

Asu helps households record water reserves, compare consumption and replenishment scenarios, organize tasks, and keep an outage history. Scientific estimates live in an explicitly experimental laboratory, separate from household balance calculations.

## Project status

**Public experimental application: [asu-forless01.pages.dev](https://asu-forless01.pages.dev).** GitHub Actions builds and deploys after successful main CI. Public HTTPS verification and 18 real production-browser checks cover Neon email authentication, plan transfer, second-device recovery and the model Worker. Interactive Google login remains unverified. The model predicts historical **reported duration**, not verified actual restoration.

## Run locally

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174`. No account, API key or environment variable is needed for guest use. The example workspace is fictional and remains visibly separate from your own data. Optional cloud access uses the public Neon endpoints in `apps/web/src/cloud-public.json`; no database password or server key is included. An explicit pair of empty `VITE_NEON_AUTH_URL` / `VITE_NEON_DATA_API_URL` disables cloud for deterministic offline tests.

## Implemented flows

- Household setup, editable containers and separate drinking/cooking versus other-use reserves.
- Consumption assumptions, constant-demand autonomy, optional-activity deferral and capacity-limited replenishment scenarios.
- Local incidents, observed household restoration, corrections, history and due-task reminders while the app is open.
- Spanish/English interface, JSON export/validated restore, confirmed reset and IndexedDB revision conflict handling.
- Experimental model inference in a Web Worker, with supported EPS/department pairs, source dates, integrity-checked evidence and explicit abstentions.
- Optional email sign-up/sign-in and automatic Neon saving, account-isolated offline backups, cross-device recovery and explicit revision-conflict resolution. Visible status distinguishes guest/local, pending/offline and server-confirmed cloud saves; interactive Google login remains pending.
- Department selectors, district/EPS reference suggestions, validated choices and unique-prefix Tab completion. Custom names stay editable; suggestions never invent measurements.
- Managed profile names and personalized household context; animated water surfaces, icon/button feedback and task-completion responses, with per-device pause and system reduced-motion support.

No live official feed, background push, sensor reading, water-potability certification or household savings claim is fabricated.

## Verify

```sh
python3 scripts/verify_project.py
# Real SQL tests require server binaries, not only the libpq client tools:
python3 scripts/test_database.py --evidence artifacts/verification/database.json
```

Current commands generate exact local test counts in `artifacts/verification/test-evidence.json`. The Neon migration has **146 SQL assertions** and **32 live browser/Auth/Data API checks per supported tested local origin**, recorded separately from mock tests. The first executed remote CI passed **44 JS, 121 Python and 26 E2E tests**, plus **278 SQL assertions** across both provider contracts. The [public release receipt](artifacts/verification/deployment-evidence.json) records actual runs and 18 production-browser checks. Python/Node predictions match on **10,000 vectors** to a maximum error of `1.42e-14` hours. See [delivery status](docs/DELIVERY_STATUS.md) for scope and limitations.

## Start here

The requested persistent demonstration account has real seed data in Neon. Its login is stored locally in **`.env.seed.local`** (Git-ignored, private permissions), not in this repository or the browser bundle. See [operations](docs/OPERATIONS.md#seeded-account-and-automatic-save-verification) for verification commands and seed-data scope.

- [Implementation plan](PLAN_IMPLEMENTACION.md) — product behavior, UX/UI, data contracts, scientific methodology, architecture, zero-cost deployment constraints, CI/CD, retraining, tests and academic-report specification.
- [Product behavior and evidence](PRODUCT.md), [operations](docs/OPERATIONS.md) and [Neon setup](docs/NEON.md).
- [Reproduce model training](ml/README.md) and [machine-readable metrics](artifacts/current/metrics.json).
- [Transparent PNG logo](assets/brand/asu-logo.png) and [icon](assets/brand/asu-icon.png).
- [Editable SVG logo](assets/brand/asu-logo.svg) and [icon](assets/brand/asu-icon.svg).

## Architecture

- Python and scikit-learn for reproducible training and evaluation.
- Portable quantile GBR model evaluated in the browser with Python/JavaScript parity and whole-bundle checksum tests.
- React/TypeScript app built remotely and verified on public HTTPS, with a PWA manifest and cache-coherence logic; installation/offline recovery remains unverified.
- Neon Free project with Managed Better Auth, JWT-validated Data API and row-level owner isolation. Legacy Supabase SQL remains only as a regression fixture/reference.
- Five scientific/technical layers: raw provenance, event-level validation, chronological evaluation/calibration, immutable evidence and controlled publication. GitHub Actions definitions cover CI, training, maintenance and Pages deployment after successful trusted-main CI. The remote job builds and publishes the exact tested commit; local build output is not uploaded.

Free-tier limits, inactivity policies and spending controls are part of the plan; no unlimited availability is claimed. All hosted GitHub jobs require `ASU_HOSTED_JOBS_ENABLED=true`, which the owner has authorized and enabled. The initial skipped runs remain historical and are not successful test evidence. A public release is established only by the actual remote run and HTTPS commit/model-hash checks.

## Data and evidence

Initial source: [SUNASS interruption register](https://www.datosabiertos.gob.pe/dataset/registro-de-interrupciones-del-servicio-de-agua-y-alcantarillado-imprevistas-y-programadas), published under ODC-BY. The source describes interruption events, not individual household water consumption. Preserve attribution and distinguish expected, reported and actual restoration.

The current exploratory run keeps all positive eligible reported durations, including 100 events above 168 hours. On 2,830 supported historical 2024 test events: MAE **4.645 h** versus EPS median **4.940 h**, RMSE **25.868 h**, and calibrated coverage **75.55%** for a nominal 80% interval. The 2024 period was previously inspected; labels remain unapproved for actual restoration. Production scientific promotion is rejected, preserving the active experimental bundle.

## Academic report

The **Montserrat LaTeX report** is outside this repository, at `../informes/asu/output/asu_report.pdf` in the surrounding workspace. Its editable sources, actual app screenshots and reproducible import scripts are in `../informes/asu/`. Code and sanitized metric/figure exports belong here; report LaTeX/PDF and auxiliary files do not. Its verification receipt records the current page count and evidence cut.
