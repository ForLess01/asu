# Asu operations and reproducibility

## What is running and what is not

Implemented: local-first bilingual web application, optional Supabase adapter, portable experimental reported-duration model, reproducible Python pipeline, SQL migration/RPC, browser and domain tests, and CI/deployment workflow definitions.

Not established: actual-restoration label semantics, prospective prediction validity, hosted Supabase configuration/OAuth, a production public URL, or successful GitHub workflow runs. A workflow file is not evidence that the workflow executed. The application build was not run during this implementation session.

## Local application

Node 24 and the committed lockfile are the reference environment. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npm test`, and `npm run dev -- --host 127.0.0.1 --port 5174`. The explicit port avoids an unrelated development application on 5173 in the inspected environment. Browser tests start their own isolated 5174 server; do not run two at once.

Open the printed local URL. Guest state persists in IndexedDB. The separate example workspace is fictional and clearly labelled; it is never uploaded. Export JSON before clearing browser data. Changing the account does not implicitly delete local guest state.

## Optional cloud setup

No cloud values are required for local use. At runtime configuration time, provide only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to Vite. These are public configuration; never put database passwords, service-role keys or OAuth secrets in `VITE_` variables. No real environment file is included.

Apply the reviewed SQL migration to a separately approved Free Supabase project. Configure Google OAuth and exact redirect origins, then test two actual users before enabling cloud claims. See [SUPABASE.md](SUPABASE.md). The current application supports one owned workspace per account and manual upload/restore with revision conflicts; sharing invitations are not implemented.

The inspected account contains pre-existing Supabase projects but no Asu project. No new database was provisioned without verifying its organization plan and available free quota. No existing project was repurposed or modified.

## Scientific model

See [ml/README.md](../ml/README.md). The generated `apps/web/public/models/current/` bundle is experimental, has `label_semantics_approved=false`, and is presented only in the laboratory. Normal reserve planning is a transparent balance independent of that model. Neither the frontend nor an environment flag can approve actual-restoration labels.

Run all scientific tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider ml/tests supabase/tests/test_schema.py scripts/tests
python3 ml/evaluate_artifact.py --model artifacts/current/model.json --fixtures artifacts/current/parity-fixtures.json
python3 scripts/check_promotion_gate.py --candidate artifacts/current --champion apps/web/public/models/current
```

For a new experimental run choose a new immutable output, such as `artifacts/runs/local-001`. No completed scientific run is overwritten. `ml/promote.py` without the explicit experimental flag is expected to reject this target. Rejection preserves the active bundle. See the ML documentation for the single-publisher and interrupted-directory-switch recovery limits.

## Database verification

`scripts/test_database.py` creates a temporary isolated PostgreSQL cluster and always stops it. It does not touch existing databases. It uses a small test-only Auth compatibility fixture. On the inspected macOS environment PostgreSQL 16 lives outside the default libpq-only path:

```sh
PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" python3 scripts/test_database.py --evidence artifacts/verification/database.json
```

The same SQL can run in the disposable GitHub CI Postgres service. Real SQL/RLS tests do not verify Google login, hosted PostgREST, cross-device cloud behavior or multi-session race scheduling.

## CI/CD workflow definitions

- `ci.yml`: type checks, domain/inference/Python tests, real SQL tests, desktop/mobile browser flows. Fails on a violated invariant.
- `train.yml`: downloads the pinned public source, creates a new candidate, tests Python and Node parity, and demonstrates scientific rejection while preserving the champion. It does not deploy a model.
- `maintenance.yml`: weekly source check with bounded training on changed valid approved fingerprints. An unchanged source returns `no_op`; a provider fingerprint change is rejected until explicitly reviewed. No automatic promotion.
- `deploy.yml`: manual experimental-application deployment. Requires explicit confirmation and configured Cloudflare credentials before packaging or publishing. It publishes the user-facing product with the experimental status preserved, not a scientifically approved actual-restoration service.

Training and maintenance have one publisher at a time. **Every hosted job requires repository variable `ASU_HOSTED_JOBS_ENABLED` to equal the literal string `true`.** An unset or `false` value skips the job before assigning a runner. The initial publication keeps this variable `false` because the available token cannot read the account's billing usage/budget. A skipped workflow is not a passed test run.

After the owner verifies included minutes, shared storage and a zero-spend limit, enable the variable explicitly and dispatch CI. Do not enable it merely to make a badge green. Source training, maintenance and deployment remain blocked by the same control, including manually dispatched workflows.

## Public deployment prerequisites

The CLI inspection found existing Cloudflare OAuth access, but this is not a published Asu project. Creating a broken static upload of TypeScript source would not be a deployment. A checked distributable, owner-authorized code publication, a configured free Pages project and a post-deployment smoke test are still required.

Before enabling workflows, verify account-level GitHub spending controls and shared minutes. Free Supabase can pause; the app must keep its local state useful. Cloudflare static requests are free within the documented service conditions; paid Functions, GPU, SMS and commercial APIs are not used.

Configure GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with minimum Pages scope; use repository variables for optional public Supabase configuration and `ASU_PUBLIC_URL`. Use a previously verified Free Pages project named `asu`, or update the workflow to its assigned name. Never upload the local OAuth credential file or print its contents.

The deployment stamps `version.json` and checks the actual HTTPS URL plus published model SHA-256. An absent URL or mismatch is failure, not a successful deployment. Do not set a pretend URL in the README.

## Rollback

For a public application rollback, republish the previous checked static release as a unit; do not overwrite individual model files in a live site. For local model recovery use the complete sibling prior bundle retained by the publisher. Do not run destructive database down migrations automatically. Recovery needs the schema and the two supported application versions to remain compatible.

## Academic report

The real LaTeX source and PDF are outside this repository at `../informes/asu/`. From there run `python3 compile_report.py` to import current public artifacts and actual screenshots. This compiles the document only. User state and auth credentials are excluded from its evidence.
