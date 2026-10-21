# Asu: a household water plan, without an account

Asu runs locally as a guest-first React application. It separates household water planning from an experimental historical model of **reported outage duration**, which is not actual restoration prediction.

## Run and verify

| Command | Purpose |
|---|---|
| `npm install` | Install locked project dependencies. |
| `npm run dev -- --host 127.0.0.1` | Start Asu on port 5173; fails rather than taking another port. |
| `npm run dev -- --host 127.0.0.1 --port 5174` | Use a separate port when another application owns 5173. |
| `npm test` | Domain, schema, mock cloud adapter, and actual 10,000-vector Python/Node parity tests. |
| `npm run typecheck` | TypeScript validation without emission. |
| `npm run test:e2e` | Chromium desktop and 375px mobile flows against an isolated Vite server on 5184. Guest tests explicitly disable cloud; authentication UI tests mock its boundary. |
| `npm test -- apps/web/src/cloud.test.ts` | Focused Neon configuration, authentication-adapter and versioned snapshot tests, without network access. |
| `npm run test:e2e -- tests/e2e/cloud-auth.spec.ts` | Mocked authentication, validation, credential exclusion, logout, offline and example-isolation UI checks on 5184. No hosted users are created. |
| `npm run test:e2e -- --config playwright.capture.config.ts` | Capture the five report screenshots on 5174, with explicit example labels, viewport/UTC metadata, contrast, focus, and overflow checks. |

No application build, deployment, commit, or push is needed for these checks. Browser tests do not reuse an unrelated running server.

## A useful first session

1. Enter your household, district, utility, department, and occupancy. No exact address is required; geography is user-declared, not verified service coverage.
2. Add containers with measured or unknown available liters and capacity. Drinking/cooking and other uses stay separate. A selected use does not certify potability.
3. Enter whole-household activities and their own measured or estimated assumptions. Hourly demand is liters per use × uses per day ÷ 24; occupancy is not multiplied again.
4. Compare a planning horizon, defer optional activities, or assume a capacity-limited replenishment at the scenario start. This never changes measured inventory or confirms a delivery.
5. Record an outage and later confirm observed household restoration. Sources, timestamps, ongoing confirmations, and restoration corrections stay visible. Open incidents are not zero-duration outcomes or automatic training labels.

Settings supports Spanish/English, JSON export and validated restoration, and confirmed local reset. Example mode uses a distinct IndexedDB record and a persistent example banner; it never uploads example household data.

## Local storage and recovery

- IndexedDB database `asu-household-v1`, object store `workspaces`; separate `guest` and `example` records.
- Schema version 1 is validated before restoration and storage. Invalid JSON, unknown versions, duplicate IDs, over-capacity containers, and invalid incident ordering are rejected.
- One compare-and-swap transaction validates the expected local revision. Cross-tab announcements exclude their own tab sender. Conflicts require a visible reload, not a silent merge.
- Unreadable stored data is not silently replaced. Recovery requires confirmation. Browser-data deletion/private mode can lose local data; export backups.
- Checkbox interaction responds immediately while saving; durable-success feedback appears only after the IndexedDB transaction completes. Failed saves revert the temporary checkbox selection.
- Levels do not automatically decrease as time passes. The timeline is a labeled constant-demand calculation, not a sensor reading.
- Due-task and stale-measurement warnings refresh every 30 seconds while visible and immediately on visibility revalidation after a suspended tab resumes. This clock only refreshes the interface; it does not change stored measurements, task completion, or snapshot revisions.

## Optional cloud contract — Neon Auth and Data API

Guest use needs no account or environment variables. `apps/web/src/cloud-public.json` contains only the public provider/version, enabled flag, and actual provisioned Neon Auth/Data API URLs. It enables optional account connection by default, not automatic household uploads. The pinned browser SDK is `@neondatabase/neon-js` **0.8.0-beta**. Its `SupabaseAuthAdapter()` is a Neon Auth compatibility adapter, not a remaining Supabase service or direct `@supabase/supabase-js` dependency.

An explicit pair of `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` overrides the public configuration. If either override is present, both must be valid HTTPS URLs without embedded credentials, query parameters or fragments; a partial or blank pair disables cloud rather than mixing projects or silently falling back. With no override, setting the public JSON's `enabled` to false disables cloud. Legacy `VITE_SUPABASE_*` variables are not used. The unconfigured UI says local-only. Never place a database connection string, database password, API key or owner/service-role credential in browser configuration. Data API requests use the SDK's session-derived JWT, and server-side authorization owns identity and row isolation; the browser never supplies an owner ID.

Settings offers optional email/password sign-up and sign-in in Spanish and English. Sign-up includes an account name. Passwords remain in the mounted form/request only and are cleared on submission; account identity is not part of workspace exports or uploads. A session is required before showing an account as connected. Email verification or an unconfirmed post-signup session remains visibly pending and does not claim registration, delivery of a verification message, or synchronization. Google remains optional and requires provider configuration; its errors are shown, and a redirect is not a connected-session or sync claim. Logout checks the service response before clearing account UI and leaves local household data intact. Local reset does not delete a hosted account or remote snapshot.

The beta SDK preserves `getSession()` → `{ data: { session }, error }`, `onAuthStateChange()` → `{ data: { subscription } }`, and PostgREST `from()`/`rpc()` calls. The beta Google compatibility method discards a returned Better Auth error, so the frontend uses its public `getBetterAuthInstance().signIn.social()` API and validates the result before redirecting. A signup requiring verification can surface `session_not_found`; it is treated as an unconfirmed session, never success. Dependency installation currently reports transitive Better Auth peer-version and React Email deprecation warnings; the lockfile records the resolved tree.

The application uploads its validated current `Workspace` shape, not an older hypothetical schema: `schema_version`, `id`, `revision`, `locale`, `updatedAt`, `household`, `containers`, `activities`, `incidents`, `tasks`, and `scenarios`. Unknown top-level fields, authentication credentials, and device caches are excluded by the shared parser.

Expected service interface from the integration contract:

- Relation: `household_workspaces(id, owner_id, payload, revision, updated_at)`, owner-only RLS.
- RPC: `update_workspace(p_workspace_id, p_payload, p_expected_revision)` returns a row/object containing `id` and the new remote `revision` (or an array containing that row).
- First write expects remote revision 0. Later writes preserve the fetched remote revision; conflict errors are surfaced without retrying a write or merging.
- Remote revision is separate from `payload.revision`, which represents local changes.
- Synchronization is manual and explicit. A remote fetch precedes a choice to upload or restore. One account supports one household; member sharing is not implemented.
- Disconnect preserves local guest data. Reset affects only the current local workspace, not remote copies or the other example/guest record.

The remote version must be fetched before upload/restore choices appear. A failed sync invalidates that choice and requires fetching again. Auth changes invalidate fetched snapshots, and late responses from a previous authentication generation are ignored. The frontend does not automatically merge, retry writes, or upload example data.

Provisioning and hosted verification are separate from the mocked frontend checks. The dedicated Free Neon project has now been provisioned and the native migration applied. Opt-in real-browser receipts under `artifacts/verification/neon-hosted*.json` pass 32 checks at each of `localhost:5186`, `127.0.0.1:5186` and the actual app at `127.0.0.1:5174`: email signup/sign-in, reload, JWT-backed RPC, tenant isolation, second-device recovery, stale revisions and logout. Disposable users are removed; `neon-provisioned.json` independently observes zero remaining users/workspaces after testing. These checks do not establish interactive Google login, public frontend deployment or a different origin's allowlisting.

The standard browser suite explicitly supplies blank Neon overrides to preserve deterministic local-only guest flows; it does not reuse running servers on 5173/5174. Hosted tests are separate, require `ASU_RUN_HOSTED_TESTS=1`, and disable traces, videos, screenshots and failure DOM snapshots while credentials are present. See `docs/OPERATIONS.md` for exact commands. Report screenshots use a separate capture configuration.

## Experimental model boundary

The standalone evaluator is `packages/inference/src/index.ts`; the UI executes it in `apps/web/src/model.worker.ts`. Files are read from `/models/current/`; the frontend does not generate or modify them.

- `label_semantics_approved` must be false; actual-restoration requests are refused. Historical exploratory results are not prospective validation.
- Categories, supported EPS/department **combinations**, calibration, version, source hash, and cutoff come from the actual artifact. Two known categories do not make an unseen pair eligible.
- Historical start times use America/Lima and Monday-zero weekdays. Malformed dates and missing/unsupported combinations are rejected. The lab rejects current dates beyond the artifact cutoff and nonzero elapsed-time requests; it never subtracts elapsed time from initial quantiles.
- Array lengths, finite values, tree reachability, cycles/shared nodes, 8,191-node/tree limit, 64-edge depth limit, and 1,000-tree/quantile limit bound validation and traversal. These limits are software safety limits, not scientific support claims.
- Node parity loads the real `artifacts/current/parity-fixtures.json` and public `model.json`; every p10/p50/p90 value must match Python within 1e-4 hours across at least 10,000 vectors. Synthetic tree tests additionally cover float32 thresholds.
- Metrics are loaded from the published `metrics.json`, not hardcoded. Missing models or metrics never replace household planning with invented values.
- Activation verifies one stable public checksum set: fetch `checksums.json`, SHA-256 the exact model/metrics/model-card bytes with Web Crypto, and fetch the checksum set again to detect a release change during downloading. Source hashes must agree across model, metrics, and the hashed model card; the metrics run must match that card. An optional metrics model version must match the model. The v1 model has no run ID of its own: a receipt binds its model version/hash to the metrics run through the same checksum set. The Worker publishes model, metrics, and receipt together or rejects all of them; the UI never independently fetches metrics or reports readiness on a partial load.
- These checks establish consistency with the same-origin published checksum set, not a signed authenticity guarantee, scientific approval, or approval of actual-restoration semantics. `label_semantics_approved` remains false.

## Offline and remaining operational limits

A manifest and public-resource service worker are supplied. The worker is registered only in production mode, never caches authenticated/API responses, and deliberately does not cache model resources. On successful online root navigation, it stages the HTML-declared entry modules, styles and modulepreloads before replacing the cached root HTML; a failed entry download leaves the previous shell active for offline fallback. Older content-addressed assets remain available to already-open clients. Auth callback query URLs and unsuccessful HTML do not replace the root shell. A deterministic service-worker-logic harness covers A → online B → offline and failed-B-entry recovery, without generating an application build. First-use offline and offline model availability are not promised. Production installation/cache recovery was not validated because builds are prohibited for this task.

There is no live official-outage feed, paid messaging, medical recommendation, water-potability guarantee, automatic depletion, or demonstrated household impact. In-app reminders are not background push notifications.

## Visual evidence

Report screenshots are written only to the explicitly authorized external directory `../informes/asu/figures/screenshots/`: `dashboard-desktop.png`, `dashboard-mobile.png`, `reserve-editor.png`, `model-lab.png`, and `incident-history.png`. Desktop captures are 1440 × 1000; mobile is 390 × 844 at device scale 1. `captions.json` records each absolute path, viewport, capture UTC, example state, and limitations. The household and incident are visibly fictional; the laboratory executes the real published historical artifact.

Use `ASU_CAPTURE_ONLY=model-lab.png npm run test:e2e -- --config playwright.capture.config.ts` to refresh only the lab screenshot and its metadata entry while preserving the other report captures.

The interface uses the original Asu marks, self-hosted Montserrat, teal `#007D77`, mint for visualization rather than small text, semantic controls, 48px main touch targets, visible keyboard focus, and reduced-motion support. Screenshot checks measure the rendered primary-button and secondary-body text contrast against their actual backgrounds; they are focused checks, not a claim of a comprehensive accessibility audit.
