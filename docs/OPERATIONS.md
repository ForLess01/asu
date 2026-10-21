# Asu operations and reproducibility

## What is running and what is not

Implemented: local-first bilingual web application, live Neon email authentication/Data API synchronization, portable experimental reported-duration model, reproducible Python pipeline, Neon SQL migration/RPC, browser and domain tests, and CI/deployment workflow definitions.

Public application: **https://asu-forless01.pages.dev**. GitHub CI executed successfully and its dependent workflow built/uploaded the app remotely. Independent HTTPS checks bind the public release to its commit/model hash; 18 production-browser checks verify real Neon sessions and cross-device recovery. See `artifacts/verification/deployment-evidence.json`, which also preserves the initial smoke-check failure and its correction. No local application build was used.

Not established: actual-restoration label semantics, prospective prediction validity, interactive Google login or production PWA installation/offline recovery. Successful deployment does not resolve those separate limitations.

## Local application

Node 24 and the committed lockfile are the reference environment. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npm test`, and `npm run dev -- --host 127.0.0.1 --port 5174`. The explicit port avoids an unrelated development application on 5173 in the inspected environment. Deterministic browser tests start their own isolated 5184 server; do not run two at once.

Open the printed local URL. Guest state persists in IndexedDB. The separate example workspace is fictional and clearly labelled; it is never uploaded. Export JSON before clearing browser data. Changing the account does not implicitly delete local guest state.

## Optional cloud setup

No registration is required for local use. The checked-in `apps/web/src/cloud-public.json` enables the dedicated Neon Auth/Data API endpoints. Optional Vite overrides are `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`; they are an atomic pair. Two empty overrides explicitly disable cloud in deterministic guest tests. These are HTTPS public endpoints, not a Postgres connection string or server key. Never put database passwords, server secrets or JWTs in public configuration. No real environment file is included.

The active migration is `neon/migrations/20261020000100_household_workspaces.sql`; it has been applied to the dedicated Free Neon project and its Data API schema refreshed. See [NEON.md](NEON.md). Signed-in accounts now load and save automatically, with per-account durable offline queues and explicit version-conflict resolution. One account owns one workspace; sharing invitations are not implemented. The legacy `supabase/` directory remains regression coverage, not a second hosted provider.

`neon/public-project.json` records only public resource identifiers and endpoints. The organization plan was checked as `free` before provisioning; fixed compute bounds are reported as 0.25/0.25 CU. Managed Better Auth's default email/password configuration does not require email verification in this pilot and sends no signup verification email. Do not treat an unverified email as a basis for granting another household's access. Google is listed as a provider, but an interactive Google sign-in has not been completed by these tests.

Auth requires explicit trusted origins: `localhost` permission alone did not establish support for `127.0.0.1`. Registered origins include the documented 5174 address and the isolated 5186 hosted-test address for both host spellings. Data API CORS is configured separately. A new port is not automatically supported; register only intended exact origins.

Live hosted receipts prove signup, session reload, own-row save, cross-owner denial, second-device recovery and stale-write preservation at `localhost:5186`, `127.0.0.1:5186` and the actual local app at `127.0.0.1:5174`. Each receipt has 32 checks and two disposable users. CLI cleanup is corroborated by an independent aggregate query showing zero remaining Auth users/workspaces at the evidence cut. No real account identities or credentials are stored in evidence.

Repeat these mutating hosted tests only against the dedicated approved Asu project:

```sh
ASU_RUN_HOSTED_TESTS=1 npx playwright test --config playwright.hosted.config.ts
ASU_RUN_HOSTED_TESTS=1 ASU_HOSTED_HOST=127.0.0.1 npx playwright test --config playwright.hosted.config.ts
# Reuses a separately verified existing Asu server, without starting/stopping it:
ASU_RUN_HOSTED_TESTS=1 ASU_HOSTED_HOST=127.0.0.1 ASU_HOSTED_PORT=5174 npx playwright test --config playwright.hosted.config.ts
python3 scripts/record_neon_status.py
```

Hosted tests are not part of ordinary CI: they explicitly create/delete disposable accounts, suppress credential-sensitive captures, and require opt-in. Provisioning/SQL operator helpers use the authenticated Neon CLI; raw connection responses are never printed or persisted. The psql password is passed only in its child environment, never in argv or browser code.

### Seeded account and automatic-save verification

The owner-requested seed account is a persistent managed Auth account. Its workspace was inserted directly into PostgreSQL through native validation/FK constraints, with a visibly fictional household, three containers, three activities, three tasks, one closed fictional incident and two scenarios. `artifacts/verification/seed-account.json` contains only sanitized counts. It is separate from the unconnected local example mode.

Credentials are stored **only** in the Git-ignored `.env.seed.local` file with permissions `0600`. Open that file locally to obtain the login; never copy it into frontend configuration, Git, screenshots or report evidence. `python3 scripts/seed_demo_account.py --allow-create` is the explicit operator creation command and refuses to overwrite that file. Auth creates the password hash; the script never manually fabricates an Auth row.

```sh
# Uses an isolated local 5186 server and the real Neon service:
ASU_RUN_SEED_TESTS=1 npx playwright test --config playwright.account.config.ts
# After the remote CI/deploy completes, verify the actual public app:
ASU_RUN_SEED_TESTS=1 ASU_ACCOUNT_ORIGIN=https://asu-forless01.pages.dev npx playwright test --config playwright.account.config.ts
```

These tests retain the seeded account, temporarily change its synthetic tank volume and restore it afterward. They verify automatic remote hydration, saving outside Settings, reload, offline durability, reconnection, a second device and logout isolation. Receipts are `autosync-local.json` and `autosync-public.json`; the old `neon-hosted*.json` files are historical manual-sync evidence, not claims that the old UI still exists. The disposable tenant-isolation suite now writes `neon-autosync-hosted*.json`.

The owner subsequently requested a personalized Puno household. `scripts/personalize_account.py --display-name "<name>"` inspects the existing credential-backed account; adding `--apply` creates a private mode-0600 `.env.account-backup-*.local`, updates the workspace using its expected remote revision, and updates the managed Auth name with the authenticated profile API. It preserves the login, existing values and custom entries, and avoids duplicate additions on retries. Geographic values are PUNO/Puno with the catalog's `EPS EMSAPUNO`. Do not hand-write managed Auth rows or replace the account just to change its display name.

The personalized workspace has seven containers, ten activities, twelve tasks, one retained closed initial record and six scenarios. Visible placeholder markers were removed; initial assumptions use neutral editable-configuration provenance rather than claiming measured evidence. `account-personalization.json` records sanitized counts, never the login or account identifier. `.env.seed.local` contains private expected household/tank/count values for the opt-in test, so verification no longer assumes the original placeholder labels or three-container layout.

### Motion verification

Use `npm run test:e2e -- tests/e2e/motion.spec.ts` for real-frame water movement, unchanged amounts, completion feedback, per-device pause persistence and OS reduced-motion behavior. The main suite exercises those controls on desktop/mobile. The optional private visual inspection is:

```sh
ASU_RUN_SEED_TESTS=1 ASU_VISUAL_DIRECTORY=/absolute/private/preview npx playwright test --config playwright.account.config.ts --grep "personalized home"
```

Choose an existing private output directory. This read-only visual pass signs into the retained account, checks actual moving SVG frames and captures home/reserve views; it does not upload household changes. Do not enable credential-bearing traces. Interface motion is a device preference, not part of the account workspace or a service/sensor signal.

### Form catalog

`form-catalog.json` is a bundled UI reference, not a geographic/service-coverage API or model-support list. It contains 25 department-level jurisdictions, 1,893 historical district entries and 48 utilities. Native selectors/suggestions validate known choices; an explicit not-listed choice retains newer or custom entries. `scripts/import_form_catalog.py` pins the MIT geography source and checks the official historical SUNASS fingerprint before regenerating options. Provenance/license are in `docs/form-catalog-source.json` and `docs/FORM_CATALOG_LICENSE.txt`.

## Scientific model

See [ml/README.md](../ml/README.md). The generated `apps/web/public/models/current/` bundle is experimental, has `label_semantics_approved=false`, and is presented only in the laboratory. Normal reserve planning is a transparent balance independent of that model. Neither the frontend nor an environment flag can approve actual-restoration labels.

Run all scientific tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider ml/tests supabase/tests/test_schema.py neon/tests scripts/tests
python3 ml/evaluate_artifact.py --model artifacts/current/model.json --fixtures artifacts/current/parity-fixtures.json
python3 scripts/check_promotion_gate.py --candidate artifacts/current --champion apps/web/public/models/current
```

For a new experimental run choose a new immutable output, such as `artifacts/runs/local-001`. No completed scientific run is overwritten. `ml/promote.py` without the explicit experimental flag is expected to reject this target. Rejection preserves the active bundle. See the ML documentation for the single-publisher and interrupted-directory-switch recovery limits.

## Database verification

`scripts/test_database.py` creates a temporary isolated PostgreSQL cluster and always stops it. It does not touch existing databases. It uses a small test-only Auth compatibility fixture. On the inspected macOS environment PostgreSQL 16 lives outside the default libpq-only path:

```sh
PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" python3 scripts/test_database.py --evidence artifacts/verification/database.json
PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" python3 scripts/test_database.py --provider neon --evidence artifacts/verification/neon-database.json
```

The Neon suite has 146 isolated SQL assertions; legacy Supabase has 132. CI definitions use separate disposable databases because provider schemas differ while roles are cluster-wide. Local SQL tests do not prove hosted JWT verification; the separate live receipts provide that boundary evidence. Neither establishes interactive Google login or simultaneous two-session first-insert scheduling.

## CI/CD workflow definitions

- `ci.yml`: type checks, domain/inference/Python tests, real SQL tests, desktop/mobile browser flows. Fails on a violated invariant.
- `train.yml`: downloads the pinned public source, creates a new candidate, tests Python and Node parity, and demonstrates scientific rejection while preserving the champion. It does not deploy a model.
- `maintenance.yml`: weekly source check with bounded training on changed valid approved fingerprints. An unchanged source returns `no_op`; a provider fingerprint change is rejected until explicitly reviewed. No automatic promotion.
- `deploy.yml`: automatically publishes after successful `Application and model checks` CI for a trusted push to `main`. It checks out and stamps the exact tested SHA, refuses a superseded main revision, builds only on GitHub, and checks the public release commit/model hash with bounded retries. Pull-request runs cannot enter the secret-bearing deploy job. A manually confirmed main deployment remains available. This publishes the experimental product, not a scientifically approved actual-restoration service.

Training and maintenance have one publisher at a time. **Every hosted job requires repository variable `ASU_HOSTED_JOBS_ENABLED` to equal the literal string `true`.** An unset or `false` value skips the job before assigning a runner. The owner authorized enabling it on 2026-10-21 and its value was read back as `true`. The earlier disabled/skipped runs remain historical evidence, not executed tests.

Account quota and billing controls remain GitHub account settings. The owner confirmed proceeding with GitHub Pro Student; the current CLI credential cannot independently inspect remaining included usage or the spending budget. This repository switch enables source maintenance and manual training as well as CI/deployment; setting it to `false` pauses all those hosted jobs.

## Public deployment prerequisites

Cloudflare Pages project `asu-forless01` now serves the checked application. `deployment/pages-public.json` records the first verified release and true publication/verification flags. GitHub performs the build; raw TypeScript and local build output are not uploaded.

Wrangler initially selected a stale cached account and failed authentication. Selecting the account actually returned by `whoami` resolved the mismatch. Project creation then required the CLI's direct Pages creation path because its default delegated to Workers and attempted to detect static output. Only project metadata was created; no bundle was built or deployed. Future commands target the existing Pages project without repeating the creation-only force option.

Review account-level spending controls and shared minutes when changing automation. Neon can suspend idle compute; the app must keep its local state useful. Cloudflare static requests are free within the documented service conditions; paid Functions, GPU, SMS and commercial APIs are not used.

GitHub variables contain public `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `ASU_PUBLIC_URL`, `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`. `ASU_PUBLIC_URL` is only an assigned target until deployment passes. The owner installed `CLOUDFLARE_API_TOKEN` as an Actions secret, confirmed by listing its name without reading its value. Local Wrangler OAuth is not copied into GitHub or the application. `ASU_HOSTED_JOBS_ENABLED=true` has been explicitly authorized and verified.

The deployment stamps `version.json` and checks the actual HTTPS URL, tested commit and published model SHA-256. An absent URL or mismatch is failure. The smoke client identifies itself as `Asu-Deployment-Check/1.0`: the default Python-urllib user agent was rejected by the Pages edge with error 1010 despite a successful upload. The fix retains all integrity checks without weakening edge security settings.

## Rollback

For a public application rollback, republish the previous checked static release as a unit; do not overwrite individual model files in a live site. For local model recovery use the complete sibling prior bundle retained by the publisher. Do not run destructive database down migrations automatically. Recovery needs the schema and the two supported application versions to remain compatible.

## Academic report

The real LaTeX source and PDF are outside this repository at `../informes/asu/`. From there run `python3 compile_report.py` to import current public artifacts and actual screenshots. This compiles the document only. User state and auth credentials are excluded from its evidence.
