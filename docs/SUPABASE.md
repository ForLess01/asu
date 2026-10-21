# Owner-isolated household snapshots

Cloud sync is optional. Guest use needs no Supabase configuration. This migration
stores one workspace per authenticated account; it does not implement sharing or
provision a hosted project. No remote project, plan, quota or deployment is verified.

## Local setup

Use an installed [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
and its Docker-compatible local runtime. From the repository root, initialize local
configuration **once**, only if `supabase/config.toml` does not exist:

```sh
supabase init
supabase start
supabase migration up --local
```

`start` starts local services and applies migrations; `migration up --local` applies
any subsequent pending migrations. These commands are operator instructions, not
evidence they were run. Do not use `--linked`, `db push`, remote project creation or
`db reset` for this setup. Local images may need downloading on first start.
See the current [migration guide](https://supabase.com/docs/guides/deployment/database-migrations)
and [CLI reference](https://supabase.com/docs/reference/cli/introduction).

The existing web adapter reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. Use the local API URL and publishable/anon key
reported by your local stack; configure these locally, never in committed files.
Never put a service-role key, secret key or database password in `VITE_*` variables.
Sign in through Supabase Auth: no client-supplied owner field or fabricated claims.
Configure Auth redirect URLs for your actual local web origin before using PKCE.

## Database contract

| Boundary | Behavior |
| --- | --- |
| Relation | `public.household_workspaces(id uuid, owner_id uuid, payload jsonb, revision integer, updated_at timestamptz)` |
| Identity | Primary key `id`; unique, non-null `owner_id` references `auth.users(id)` with account-deletion cascade. Both identity columns are immutable on update. |
| Read/delete | Only `authenticated`, only rows whose `owner_id = auth.uid()`, enforced by RLS. Anonymous users have no table privileges. |
| Save | No client `INSERT` or `UPDATE` privilege/policy. Only `public.update_workspace(uuid,jsonb,integer)` can save snapshots. |
| RPC | `SECURITY DEFINER`, empty `search_path`, qualified objects, explicit owner filter; default execution grants revoked from `PUBLIC`/`anon`/`service_role`, granted to `authenticated` only (besides the trusted function owner). Private validators are not an API. |
| Revision | First save requires expected revision `0` and returns server revision `1`. Updates lock the owner's row and require the exact server revision, then increment it. Primary/owner unique constraints arbitrate concurrent first saves. |
| Result | A one-row set, exposed by PostgREST as an array of `{id, owner_id, payload, revision, updated_at}`; `revision` is a JSON number. Compatible with the existing adapter. |

RPC arguments are `p_workspace_id`, `p_payload`, `p_expected_revision`. Ownership
always comes from `auth.uid()`, never JSON. `payload.id` is the **local document ID**
and may differ from the remote row ID during manual replacement of an owned
workspace. Neither value can authorize access to another account. `payload.revision`
and `payload.updatedAt` describe local edits; only the returned row revision is the
remote concurrency token. The server does not overwrite these local fields.

| SQLSTATE | Exact RPC message |
| --- | --- |
| `42501` | `workspace-auth-required` (authenticated SQL role without an Auth subject) |
| `22023` | `invalid-workspace-arguments` (null ID, null/negative expected revision) |
| `22023` | `invalid-workspace-payload` |
| `40001` | `workspace-revision-conflict` (stale, missing row with nonzero expected revision, occupied ID, or second workspace) |

Anonymous calls fail with PostgreSQL permission denial before entering the RPC.
Cross-owner requests and ordinary revision collisions use the same error and return
no foreign row. Refetch your own snapshot before retrying a conflict; never retry by
changing ownership or forcibly resetting the expected revision. Trusted database
owners/service roles bypass normal client isolation and must never reach browsers.

## Accepted payload

The native PostgreSQL validator follows `packages/domain/src/index.ts` schema v1.
It requires all known fields and rejects unknown keys, including nested keys;
credentials, sessions, tokens and device caches have no structured payload field.
Free-text notes are not a secret scanner: users must not paste credentials into them.

- The whole JSONB document's UTF-8 text representation is at most **262,144 bytes
  (256 KiB)**, including JSONB spacing. The API/proxy may impose additional limits.
- Top-level keys: `schema_version`, `id`, `revision`, `locale`, `updatedAt`,
  `household`, `containers`, `activities`, `incidents`, `tasks`, `scenarios`.
- Types, required fields, category/locale enums, nullable values, UUIDs, calendar
  timestamps with an explicit offset, and domain numeric ranges are validated.
  Numbers must remain finite in JavaScript; integer counters must be safe integers.
  Calendar dates must also be supported by PostgreSQL (no year zero).
- Collections: 500 containers, activities, tasks and scenarios each; 2,000 incidents;
  1,000 updates per incident; **500 deferred IDs per scenario** (an additional cloud
  bound, matching the maximum number of activities). Text fields are 1–160 UTF-16
  units after JavaScript-compatible whitespace trimming, like the domain validator.
  Stored JSON is not silently stripped or normalized. The document byte limit can
  be reached before an individual collection limit.
- IDs must be unique within each collection after trimming. Volume cannot exceed a
  known capacity; restoration cannot precede the incident; at most one incident can
  be active. Scenario inputs require both `drinking` and `other` reserves/rates.

Validation runs in the RPC and a table CHECK constraint. Installation is re-runnable
for this schema (guarded table/policies, replaceable functions/trigger); it is not a
repair tool for arbitrary pre-existing tables, policies or grants. Apply as the
trusted database owner in a reviewed migration, never as `authenticated`.

## Verification

### Disposable PostgreSQL cluster

The repository harness creates a fresh temporary cluster, applies the test Auth
compatibility fixture and real migration, runs the transactional SQL suite, then
stops and removes the cluster. It does not connect to an existing user database or
require Docker, a hosted project or paid resources. With Homebrew PostgreSQL 16:

```sh
PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH" python3 scripts/test_database.py --evidence artifacts/verification/database.json
```

`supabase/tests/auth_fixture.sql` supplies only test roles, a minimal `auth.users`
table and an `auth.uid()` compatibility function. **Never apply that fixture to an
existing or hosted Supabase database.** This verifies actual PostgreSQL SQL/RLS
behavior, not Supabase OAuth, JWT verification, PostgREST or browser synchronization.

### Existing disposable Supabase stack

Run the executable SQL suite only against a **disposable local Supabase database**
with the migration already applied; do not apply the compatibility fixture there.
It creates two dummy Auth user IDs and sets server-side claims/roles, then rolls the
entire transaction back. It requires a trusted local `postgres` connection. These
fixtures do not create browser sessions or authorize fake client claims.

```sh
psql -X -v ON_ERROR_STOP=1 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f supabase/tests/workspace_isolation.sql
```

The URL above is the conventional local CLI database, not a hosted credential.
If your local port/password differs, use your local connection configuration instead.
Tests cover success/read/delete, role grants, absent authentication, cross-owner
access, stale writes, the one-workspace limit, identity immutability, manual
replacement, strict object validation and payload/array limits. Every rejected
authenticated operation checks that visible rows, payloads and revisions are
unchanged; an owner-level check also verifies the other account's row survives.
Concurrent scheduling is not exercised by this single-session suite; locking and
uniqueness need a separate two-session check before production use.

### Static guardrails

Python + pytest must already be installed; no dependency installation is required:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -p no:cacheprovider --confcutdir=supabase/tests supabase/tests/test_schema.py
```

### Observed runtime evidence

On 2026-10-21, the isolated harness passed on **PostgreSQL 16.15 (Homebrew)**:

```text
auth_fixture.sql: exit=0, assertions=0
20261020000100_household_workspaces.sql: exit=0, assertions=0
workspace_isolation.sql: exit=0, assertions=132
```

Evidence is written to `artifacts/verification/database.json`. The initial runtime
run caught a PL/pgSQL parse error in the array-limit condition; parenthesizing its
`CASE` expression resolved it. All 132 assertions then passed without changing the
Auth fixture or harness. **Static checks alone would not have established this.**
Hosted Supabase integration and concurrent-session interleavings remain unverified;
no remote resources or application builds were used.
