# Implementation integration contract

## Ownership and delivery

The web implementation owns root npm/Vite/TypeScript configuration, `apps/web/`, `packages/`, and browser tests. The ML implementation owns `ml/`, `data/manifests/`, `artifacts/`, and generated `apps/web/public/models/`. Infrastructure owns `.github/`, provider migrations and project documentation. Neon is the active cloud provider; `supabase/` is retained only for legacy regression coverage. The academic report is outside the repository at `../informes/asu/`.

The original plan and brand assets are retained. No commits, pushes, paid resources or application builds are authorized by the implementation workflow without an explicit instruction. Tests, type checks, development servers and browser inspections are permitted. Future CI may declare a build step; do not claim an actual deployed service without a public URL and verification.

## Scientific status

SUNASS end-time semantics remain unresolved. The first model is **experimental reported-duration regression**, not verified actual restoration prediction. Its artifact must contain `label_semantics_approved: false`. The UI must show this explicitly and keep household balance planning usable independently. Old January–May 2024 outcomes are exploratory reuse, not untouched final validation. Do not manufacture results, labels, live outages, confidence guarantees or account synchronization.

## Portable model v1

Generated resource URL: `/models/current/model.json`; summaries at `/models/current/metrics.json`, `/models/current/model-card.md`. Matching evidence is exported under `artifacts/current/` for the external report.

```json
{
  "schema_version": 1,
  "model_version": "asu-reported-v1",
  "status": "experimental",
  "target_semantics": "reported_duration_not_actual_restoration",
  "label_semantics_approved": false,
  "feature_order": ["month", "weekday", "hour", "eps", "department"],
  "preprocessing": {
    "categories": {"eps": ["SEDAPAL"], "department": ["LIMA"]},
    "unknown_value": -1
  },
  "models": {
    "p10": {"init": 0, "learning_rate": 0.06, "trees": []},
    "p50": {"init": 0, "learning_rate": 0.06, "trees": []},
    "p90": {"init": 0, "learning_rate": 0.06, "trees": []}
  },
  "calibration": {"offset_hours": 0, "nominal_coverage": 0.8},
  "support": {"eps_codes": ["SEDAPAL"], "departments": ["LIMA"]},
  "data_cutoff": "2024-05-07",
  "source_sha256": "recorded-source-fingerprint"
}
```

Each tree has parallel arrays `children_left`, `children_right`, `feature`, `threshold`, `value`. A leaf has child `-1`. Values are scalar. Accumulation is constant initialization plus learning-rate times the sum of reached leaves. Inputs are cast to float32 before `<=` threshold comparisons; accumulation remains double precision.

Use the start time interpreted in `America/Lima`: month 1–12, weekday Monday=0–Sunday=6, fractional hour 0–24. Categories are exact ordered strings from the artifact; no implicit locale sorting. Reject missing/invalid time and unsupported category combinations rather than silently assigning a new category. No subtraction of elapsed time to claim residual quantiles.

Postprocessing: predict three values, clamp each to zero, sort to prevent crossing, then return `p10=max(0,q10-offset)`, `p50=q50`, `p90=q90+offset` with a nonnegative CQR offset. All metrics evaluate that same postprocessing. Browser and Python must agree at 1e-4 hours.

`artifacts/current/parity-fixtures.json` contains `{inputs: number[][], expected: number[][]}` in p10/p50/p90 order; generated fixtures count is at least 10,000. TypeScript inference must be a standalone module executable in Node for parity tests and usable inside a Web Worker. Browser tests must wait for a ready model before invoking it.

## Web and persistence

Root commands: `npm run dev -- --host 127.0.0.1 --port 5174`, `npm run typecheck`, `npm test`, `npm run test:e2e`; future packaging uses `npm run build`. Use Vite root `apps/web`, output `dist` at repository root. Guest local use works without registration. Optional Neon override names: `VITE_NEON_AUTH_URL`, `VITE_NEON_DATA_API_URL`. The checked-in public configuration contains only service URLs, never credentials. Both empty overrides explicitly disable cloud.

Cloud snapshot relation: `household_workspaces(id uuid primary key, owner_id uuid, payload jsonb, revision integer, updated_at timestamptz)`. Ownership references `neon_auth."user"(id)` and provider-owned `auth.uid()`. RLS authorizes only the owner. Payload schema version1 contains the application state, excluding auth credentials and device-only caches. Optimistic concurrency uses an `update_workspace` RPC validating authenticated owner and expected revision. UI must not advertise cloud sync when not configured. First release supports one household workspace per signed-in user; multi-user sharing is explicitly deferred unless implemented and tested.

## Evidence

Metrics summary: structured JSON with sample counts and boundaries, model comparison, quantile calibration, actual source hashes, scientific caveats, search records, parity and runtime measurements. All plots are generated from real inputs/results. Public research data can be downloaded, but private household state never enters model assets or report bundles.
