# Verified implementation handoff

This file distinguishes delivered code and local observations from unexecuted remote operations. It is not a production acceptance certificate.

## Delivered and exercised

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
| Academic report | Current publication edition: 27 pages, Montserrat embedded, all five screenshots and publication receipt; no overflow or private home paths. |

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
3. Provision a confirmed Free Supabase project, configure OAuth and verify hosted PostgREST/browser synchronization. Existing unrelated projects were not altered.
4. Publish a checked distributable to an authorized Free Pages project and run a real HTTPS smoke test. No application build or public deployment was performed during this session.
5. Run the local workflow definitions on GitHub after owner-authorized code publication and billing-budget verification. Files alone are not remote execution evidence.
6. Verify production PWA installation/cache recovery, physical-device performance, multi-session database races and user comprehension. Current SW tests are deterministic logic tests.
7. Household sharing, background push and an official live-outage feed are not implemented. One account owns one workspace; local guest use remains complete.

## Workspace and publication

All application/ML/infrastructure code is inside the `asu` repository. The report is outside at `../informes/asu/`. No private household examples, credentials or source-report conversations are included in the report.

The owner authorized the initial implementation commit and push to the private `ForLess01/asu` repository. Git history and the remote branch determine the published revision; the external academic report remains outside Git.

The first implementation is published on `main` as [`3977314`](https://github.com/ForLess01/asu/commit/3977314a0a884f9a21be9c936f46851c14bdff0a), pushed on 2026-10-21 at 09:39:49 UTC. The local and remote implementation hashes were checked for equality. This receipt is a code-publication event, not a web deployment.

Every hosted workflow job is guarded by `ASU_HOSTED_JOBS_ENABLED == 'true'`. The repository variable is initially `false`: the current credential cannot inspect account-wide billing usage or a zero-spend budget. An initial push may register a workflow whose jobs are all skipped. That is **not remote test execution**, even if GitHub displays a successful/skipped overall conclusion. Local verification above remains the actual test evidence until hosted jobs are explicitly enabled after quota review.

The additional cost-guard regression suite passed four workflow tests. It checks every hosted job, including manual training and deployment, and does not change the immutable scientific run or the earlier integrated test receipt.

Initial [CI run `39578705150`](https://github.com/ForLess01/asu/actions/runs/39578705150) completed with conclusion `skipped`. REST inspection showed `verify` and `database` both skipped, zero steps, and no assigned runner. No remotely executed tests or successful production release are inferred from this run. The external report preserves that exact distinction.

## Short path for the next maintainer

1. Read `PRODUCT.md`, `docs/OPERATIONS.md` and `artifacts/current/model-card.md` before changing semantics.
2. Run `python3 scripts/verify_project.py`; for database behavior also use the isolated PostgreSQL harness.
3. Run the development app on a free port, for example `npm run dev -- --host 127.0.0.1 --port 5174`.
4. Preserve the existing scientific run and prior report. Further experiments use new output directories.
5. Resolve the explicit gates rather than changing the experimental label to an approved claim.
