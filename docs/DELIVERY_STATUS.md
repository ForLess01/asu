# Verified implementation handoff

This file distinguishes delivered code and local observations from unexecuted remote operations. It is not a production acceptance certificate.

## Public delivery update — 2026-10-21

The experimental app is available at **https://asu-forless01.pages.dev**. Executed [CI 39598438167](https://github.com/ForLess01/asu/actions/runs/39598438167) passed 44 JS, 121 Python, 26 browser tests and 278 SQL assertions. Its dependent GitHub workflow built and uploaded commit `82da3942cd19a8f11823bb0df08e478bbcc25057` to Pages. The first workflow's smoke step failed because Cloudflare rejected Python's default user agent; an identified client passed independently, and the correction has regression coverage.

The public release then passed 18 real Chromium checks: compiled entry, desktop/mobile rendering, actual Neon signup/session/reload, upload, second-device signin/restore, logout without local loss, production Worker integrity/inference, and no runtime errors. The disposable account was deleted. See `artifacts/verification/deployment-evidence.json` for exact scope, dates, commit and the initial failure; no account identity or credential is included.

## Delivered and exercised

### Automatic account saving and controlled forms

Account saving now belongs to the app rather than the Settings route. Local edits upload automatically with the fetched server revision; account backups/dirty metadata are atomic and separate from guest/example data. Offline changes resume after reconciliation, revision conflicts require an explicit choice, and late requests cannot use another account's JWT. Global desktop/mobile labels reflect actual account/save state.

The persistent seed account is created and directly seeded in the dedicated Neon database. The live seed test passed 11 local-browser/real-service checks, including automatic hydration, saving, offline/reconnect and second-device recovery; the updated disposable isolation suite also passed. Private credentials remain only in `.env.seed.local`, outside Git. `seed-account.json`, `autosync-local.json` and `neon-autosync-hosted-loopback.json` record this checkpoint; production verification is recorded separately after remote deployment.

The automatic-saving release `e359bd8` completed [CI 39624434994](https://github.com/ForLess01/asu/actions/runs/39624434994) and [deployment 39624783132](https://github.com/ForLess01/asu/actions/runs/39624783132), both successful: 58 JS, 126 Python, 42 browser tests and 278 SQL assertions. Real production acceptance then passed all 11 seeded-account checks at `2026-10-21T15:35:18.609Z`, including logout isolation; see `autosync-public.json`. The initial incomplete attempt is preserved in `autosync-public-initial-failure.json`, not relabelled as success. The seed account remains usable and the temporary test volume was restored.

Forms now use 25 department choices, 1,893 reference district entries, 48 historical utilities, validated suggestions and Tab completion for unique typed prefixes. Explicit not-listed entry supports catalog gaps. Names/measurements remain user-specific; no values are invented from placeholders. Source snapshots and license are documented separately.

### Puno personalization and interaction motion

The existing managed account was personalized in place, retaining its login and backing up the previous profile/workspace privately. Its PUNO/Puno household uses `EPS EMSAPUNO` and now contains seven containers, ten activities, twelve tasks, one retained closed initial record and six scenarios. Visible placeholder markers were removed while initial assumptions retain editable-configuration provenance. Six operator tests cover valid catalog selection, preservation/idempotence, invalid profile input and failure-safe private-login updates; `account-personalization.json` records the actual database operation.

The UI now renders the managed display name and household location, layered moving water surfaces and transform-based level updates, button/icon feedback and completion/dialog/save responses. Motion can be paused per device, pauses in background tabs and respects system reduced-motion preferences. Four focused desktop/mobile motion cases and the expanded ordinary browser suite pass locally; public verification is recorded after the remote pipeline completes. Private seeded-account checks use the current personalized expectations instead of hard-coded initial names.

| Area | Evidence |
|---|---|
| TypeScript | `npm run typecheck` passed. |
| Domain, runtime and model integrity | 27 Vitest tests passed, including 10,000 Python/Node parity vectors. |
| Data, scientific pipeline, publication and delivery | 101 pytest tests passed: 88 ML, 6 static SQL guardrails and 7 delivery/workflow checks. |
| Product browser flows | 16 desktop/mobile Playwright tests passed. |
| Database behavior | 132 assertions passed on isolated PostgreSQL 16.15 with a test Auth compatibility fixture. |
| Data provenance | Official CSV SHA-256 pinned; strict parsing and event grouping; full source has 45,671 rows. |
| Scientific result | 32,682 eligible events; positive tail retained. Historical supported test MAE 4.645255 h versus EPS baseline 4.940018 h. |
| Interval | Coverage 75.55%, median width 6.375626 h; nominal level 80%, not an individual guarantee. |
| Runtime equivalence | 10,000 vectors, max absolute Python/Node error 1.4210854715202004e-14 h. |
| Gate behavior | Actual-restoration promotion is rejected and active model bytes are preserved. |
| Source maintenance | Existing source check returned no-op; changed/corrupt batches and state preservation have tests. |
| Visual evidence | Five actual desktop/mobile screenshots with fictional example data visibly labelled. |
| Academic report | External evidence edition: 29 pages, Montserrat embedded, five screenshots and separate Neon/model-quality evidence; no overflow or private home paths. |

Machine-readable integrated evidence: `artifacts/verification/test-evidence.json` and `database.json`. Scientific run evidence is immutable under `artifacts/current/`. A later test run may update integration evidence; it does not rewrite historical model metrics.

## Confirmed defects corrected during integration

- Container validation feedback moved the submit button and prevented a corrected save. Stable feedback space and browser regression tests fixed it.
- Publication could partially replace a model on a copy failure. A verified staging bundle and restoration on handled activation failure preserve complete prior bytes. **Two directory renames are not a crash-atomic pointer**; a single publisher and documented recovery remain required.
- A rehashed model missing metadata could pass Python publication but fail the browser. Shared required fields and schema bounds are now tested.
- The laboratory could display metrics from a different model. A stable checksum set binds model, card and metrics; download changes are rejected before readiness.
- Offline HTML could reference uncached assets from an older release. Entry assets are staged before updating the cached root; A/B/offline and failed-update logic tests pass.
- Overdue tasks waited for another user action to refresh. A visible-tab clock and visibility revalidation now refresh warnings while idle.
- The SQL migration contained a PL/pgSQL CASE grouping error. Real PostgreSQL execution reproduced and fixed it; static checks alone had not caught it.

## Remaining acceptance gates

1. **G0:** verify whether the source end fields represent actual versus expected restoration; the application refuses actual-restoration claims meanwhile.
2. Obtain a new independent prospective evaluation period and assess tail/segment performance. Historical 2024 reuse is explicitly exploratory.
3. Neon Free now replaces the unprovisioned Supabase backend. Email Auth, live JWT/Data API isolation and cross-device synchronization are verified separately from local tests; interactive Google login remains pending. Existing unrelated projects were not altered.
4. Verify production PWA installation/cache recovery, physical-device performance, multi-session database races and user comprehension. Current SW tests are deterministic logic tests; production-browser emulation is not a physical-device study.
5. Household sharing, background push and an official live-outage feed are not implemented. One account owns one workspace; local guest use remains complete.

## Workspace and publication

### Neon migration evidence

The active provider is Neon Managed Better Auth + Data API. `neon/public-project.json`
and `deployment/pages-public.json` contain public configuration only. Local Neon
SQL tests passed 146 assertions. Real browser tests passed 32 checks at each of the
three explicitly recorded origins; they are not mock-test counts or remote CI runs.
An independent aggregate query observed zero remaining disposable accounts and
workspaces after cleanup. Public frontend verification is recorded above in its
later release receipt. Interactive Google OAuth and scientific approval remain unestablished.

Current exact regression counts are generated by `scripts/verify_project.py`; the
older 27/101/16 receipt above describes the initial implementation cut, not the
expanded Neon regression suite. Scientific metrics and artifact checksums are unchanged.

All application/ML/infrastructure code is inside the `asu` repository. The report is outside at `../informes/asu/`. No private household examples, credentials or source-report conversations are included in the report.

The owner authorized the initial implementation commit and push to the private `ForLess01/asu` repository. Git history and the remote branch determine the published revision; the external academic report remains outside Git.

The first implementation is published on `main` as [`3977314`](https://github.com/ForLess01/asu/commit/3977314a0a884f9a21be9c936f46851c14bdff0a), pushed on 2026-10-21 at 09:39:49 UTC. The local and remote implementation hashes were checked for equality. This receipt is a code-publication event, not a web deployment.

Every hosted workflow job is guarded by `ASU_HOSTED_JOBS_ENABLED == 'true'`. The owner authorized enabling the variable on 2026-10-21 and it was read back as `true`; `CLOUDFLARE_API_TOKEN` is now installed. The initial disabled/skipped runs remain historical, not executed test evidence. Current remote execution and deployment must be established by their own run receipts.

Automatic delivery follows successful trusted-main CI, checks out the tested commit, builds on GitHub and validates the public release commit/model hash. A failed, cancelled or pull-request CI run cannot publish. Local build output is not used.

The additional cost-guard regression suite passed four workflow tests. It checks every hosted job, including manual training and deployment, and does not change the immutable scientific run or the earlier integrated test receipt.

Initial [CI run `39578705150`](https://github.com/ForLess01/asu/actions/runs/39578705150) completed with conclusion `skipped`. REST inspection showed `verify` and `database` both skipped, zero steps, and no assigned runner. No remotely executed tests or successful production release are inferred from this run. The external report preserves that exact distinction.

## Short path for the next maintainer

1. Read `PRODUCT.md`, `docs/OPERATIONS.md` and `artifacts/current/model-card.md` before changing semantics.
2. Run `python3 scripts/verify_project.py`; for database behavior also use the isolated PostgreSQL harness.
3. Run the development app on a free port, for example `npm run dev -- --host 127.0.0.1 --port 5174`.
4. Preserve the existing scientific run and prior report. Further experiments use new output directories.
5. Resolve the explicit gates rather than changing the experimental label to an approved claim.
