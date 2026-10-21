# Owner-isolated snapshots on Neon

Use `neon/migrations/20261020000100_household_workspaces.sql` for Managed Neon
Auth + the Neon Data API. It preserves the existing snapshot/RPC contract while
binding ownership to **Neon's actual Auth accounts**, not a Supabase compatibility
schema. Guest/local use remains independent of cloud sync.

## Quick path

1. Confirm Managed Better Auth and the Data API are enabled on the target branch.
   The provisioning task has verified a Free-plan organization, UUID
   `neon_auth."user".id`, `auth.uid()`, and the `anonymous` / `authenticated` roles
   on the target database. This document contains no credentials or account data;
   public resource identifiers are maintained separately in `neon/public-project.json`.
2. Have the authorized operator apply **only the migration**, as the trusted database
   owner. The application client must never apply DDL. The operator's existing SQL
   helper command is:

   ```sh
   python scripts/neon_sql.py --file neon/migrations/20261020000100_household_workspaces.sql
   ```

   This is the reproduction command. The migration has now been applied successfully
   to the dedicated Asu project and the live Data API schema refreshed; the separate
   hosted receipts, rather than this command text, establish live behavior.
   Never apply `neon/tests/auth_fixture.sql` or the fixture-dependent SQL suite to
   a hosted database. Do not apply the legacy `supabase/` migration to Neon.
3. Verify local SQL behavior with an installed PostgreSQL 16 toolchain:

   ```sh
   PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" python scripts/test_database.py --provider neon --evidence artifacts/verification/neon-database.json
   ```

The harness creates a fresh temporary cluster, applies the local fixture and real
migration, runs the SQL suite, then stops/removes the cluster. It never connects to
an existing user database. No Docker, hosted credentials, app build, paid resources,
or remote provider changes are needed. `--provider` accepts `supabase` or `neon`;
omitting it still selects **Supabase** so existing CI remains compatible. Evidence
includes the selected `provider`, engine, per-file exit codes and assertion counts.

## Identity and database boundary

| Boundary | Contract |
| --- | --- |
| Relation | `public.household_workspaces(id uuid, owner_id uuid, payload jsonb, revision integer, updated_at timestamptz)` |
| Identity | Unique, non-null `owner_id uuid` references `neon_auth."user"(id) ON DELETE CASCADE`. Remote row ID and owner are immutable. |
| Authentication | Neon validates the JWT at the Data API boundary. The provider-owned `auth.uid()` exposes its UUID subject; client JSON never supplies ownership. |
| Read/delete | RLS restricts `authenticated` to `owner_id = auth.uid()`. `anonymous` has no table or RPC privileges. |
| Save | Clients have no direct `INSERT` / `UPDATE` grant or policy. Only `public.update_workspace(uuid,jsonb,integer)` saves snapshots. |
| RPC hardening | `SECURITY DEFINER`, empty `search_path`, qualified objects, explicit owner filter, row locking. Execution revoked from `PUBLIC`, `anonymous`, `authenticated`, then granted only to `authenticated` (trusted owner retains ownership rights). |
| Private helpers | No schema usage or helper execution for `PUBLIC`, `anonymous` or `authenticated`. Helpers are not a Data API surface. |
| Revisions | First save requires expected revision `0` and returns `1`. Updates require the exact server revision and increment atomically under a row lock. Primary/owner uniqueness arbitrate concurrent first inserts. |

The migration neither creates/replaces provider identity functions nor changes
Neon's managed authenticator role membership. It references no nonexistent
`anon` / `service_role` roles, installs no extensions, and needs no superuser-only
extension creation. Use a trusted owner with permission to create application
schemas/functions/tables and reference `neon_auth."user"`. Guarded table/policy
creation and replaceable functions retain the legacy reapply pattern; this is not
a repair/migration tool for arbitrary existing tables, grants or policies.

Neon's [Auth flow](https://neon.com/docs/auth/authentication-flow) documents
`auth.user_id()` as text and **`auth.uid()` as UUID**, returning null for a non-UUID
subject. The UUID helper matches the target's verified SQL type; there is no reason
to redefine it or cast a fake client claim. See also
[Data API access control](https://neon.com/docs/data-api/access-control) and
[pg_session_jwt](https://neon.com/docs/extensions/pg_session_jwt).

### RPC compatibility

Arguments remain `p_workspace_id`, `p_payload`, `p_expected_revision`. The result is
a one-row set with `{id, owner_id, payload, revision, updated_at}`, with numeric
server `revision`, matching the existing frontend snapshot contract. Hosted HTTP
serialization and frontend integration are exercised by the separate live Data API
receipts described below, not inferred from the function declaration alone.

`payload.id` is the local document ID and may differ from the immutable remote row
ID during manual replacement of an owned workspace. `payload.revision` and
`payload.updatedAt` remain local document fields, not the remote concurrency token.

| SQLSTATE | Exact message |
| --- | --- |
| `42501` | `workspace-auth-required` (authenticated role without subject) |
| `22023` | `invalid-workspace-arguments` (null ID or null/negative expected revision) |
| `22023` | `invalid-workspace-payload` |
| `40001` | `workspace-revision-conflict` (stale revision, missing row with nonzero expected revision, occupied ID or second workspace) |

Anonymous RPCs fail permission checks before function entry. Conflicts reveal no
foreign row. Refetch the caller's own row before retrying; never change ownership
or force revision zero to overwrite. Trusted SQL owners bypass client isolation;
database credentials must never be shipped to browsers. A UUID subject absent from
the Auth table cannot create a snapshot (foreign-key rejection).

## Payload contract retained from the legacy implementation

The native SQL validators, identity trigger, and RPC body are deliberately copied
unchanged from `supabase/migrations/20261020000100_household_workspaces.sql`, which
is retained for legacy/local Supabase use. Structural tests compare those blocks
to catch accidental divergence. Provider-specific DDL and grants are separate.

- Schema v1 requires every known key and rejects unknown keys at every object
  boundary, including nested inputs. No token, session or cache fields are accepted.
  Free text is not a secret scanner; never paste credentials into notes.
- JSONB UTF-8 text is at most **262,144 bytes (256 KiB)**, including JSONB spacing.
  Proxy/API limits may be lower. Stored payloads are not silently stripped or normalized.
- Required types, UUIDs, locale/category enums, nullable values, calendar timestamps
  with offsets, finite JavaScript numbers and safe integer counters are validated.
- Collections are bounded to 500 containers, activities, tasks and scenarios each;
  2,000 incidents; 1,000 updates per incident; 500 deferred IDs per scenario.
  The whole-document byte bound can be reached before a collection bound.
- Text is 1–160 UTF-16 units after JavaScript-compatible trimming, including BOM
  and nonbreaking whitespace. IDs must be unique within a collection after trimming.
  Volume cannot exceed known capacity; restoration cannot precede onset; only one
  incident may be active. Scenario reserves/rates require both categories.

Validation runs both before the RPC write and in the table CHECK constraint.

## Verification evidence and remaining gates

### Hosted execution update

The real Neon Auth and Data API were exercised through Chromium without request or
SDK mocks. Each of the three receipts `neon-hosted.json`,
`neon-hosted-loopback.json`, and `neon-hosted-local-app.json` records 32 checks at
its exact origin: `localhost:5186`, `127.0.0.1:5186`, and `127.0.0.1:5174`.
They cover actual email signup/sign-in, reload, owner save/read, cross-owner and
direct-write rejection, invalid JWT/anonymous rejection, second-device restore,
stale revision preservation and logout. Every created account was disposable and
allowlisted for cleanup; no identifiers, passwords or tokens are in the receipts.

The operator independently queried aggregate counts afterward:
`remaining_auth_users=0`, `remaining_workspaces=0`, `rls_enabled=true`, two policies
and authenticated-only RPC execution. That later query is recorded separately in
`artifacts/verification/neon-provisioned.json`; it does not rewrite the earlier
receipts' capture-time cleanup caveats.

Explicit Auth trusted origins are needed as well as Data API CORS. The default
localhost permission did not establish loopback-IP support; intended 5174/5186
origins were registered explicitly and retested. No claim is made about arbitrary
ports. Google is listed as configured, but interactive Google login is not verified.
Public frontend packaging/deployment, scientific G0 and prospective acceptance
remain separate gates.

On **2026-10-21**, the isolated PostgreSQL **16.15 (Homebrew)** run passed:

```text
auth_fixture.sql: exit=0, assertions=0
20261020000100_household_workspaces.sql: exit=0, assertions=0
workspace_isolation.sql: exit=0, assertions=146
```

The legacy suite has 132 assertions. The Neon adaptation retains its cases except
the absent `service_role` grant check (131 retained), and adds 15 assertions:
10 private-helper/schema privilege checks, two checks for unknown-account FK
rejection and unchanged rows, one inclusive UTF-16 boundary, and two account-delete
cascade/preservation checks. The unchanged default harness also passed all **132**
legacy Supabase assertions.

Coverage includes two account fixtures, anonymous/missing-subject denial, owner
create/read/update/delete, direct-write denial, cross-owner read/write/delete,
stale revisions and one-workspace enforcement, identity immutability, manual
replacement, strict payloads, exact byte bounds, collection bounds and Unicode.
Rejected authenticated operations compare all visible rows, payloads, timestamps
and revisions before/after; an owner-level check also verifies the foreign row
survives cross-owner actions. The account cascade is an administrative SQL deletion,
not evidence of the hosted Auth account-deletion workflow.

Static/CLI guardrails (Python + pytest already installed):

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -p no:cacheprovider --confcutdir=neon/tests neon/tests/test_neon_schema.py scripts/tests/test_database_runner.py
```

These **10 passing Python tests are structural/runner checks, not proof of RLS**.
The 146 SQL assertions execute real PostgreSQL behavior with a local identity
test double. Neither suite verifies hosted JWT signature validation, Neon Auth
sign-in, live Data API grants/schema exposure, browser synchronization or
concurrent-session interleavings. Before declaring hosted sync ready, separately
exercise two real account JWTs through the actual Data API: own CRUD, foreign
read/write/delete denial, unauthenticated rejection, stale revision rejection,
and owner deletion. Concurrent first saves/updates need a two-session test; the
single-session suite verifies collision outcomes but not concurrent scheduling.
Hosted application and this verification gate remain operator-owned.

## Free-plan constraints (2026 pricing)

The provisioning task verified that the selected organization is on Free, rather
than inferring its plan from a project name. Published allowances checked on
2026-10-21 from Neon's [plans](https://neon.com/docs/introduction/plans) and
[pricing](https://neon.com/pricing) documentation are:

| Resource | Free allowance |
| --- | --- |
| Postgres storage | 1 GB per project (up to 20 GB across projects) |
| Compute | 100 CU-hours per project per monthly billing period |
| Public network transfer | 5 GB per project per monthly billing period |
| Managed Better Auth | Up to 60,000 monthly active users |
| Idle compute | Mandatory scale to zero after 5 minutes of inactivity |

Allow for cold starts and finite storage/compute/transfer budgets; do not describe
Free as unlimited or an uptime guarantee. Recheck current quotas and usage before
any rollout. This database migration does **not** change the independent G0/model
promotion gate, approve label semantics, retrain models or authorize ML promotion.
