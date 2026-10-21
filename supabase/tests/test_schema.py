"""Static guardrails only; these do not execute PostgreSQL or prove isolation."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations/20261020000100_household_workspaces.sql"


def sql():
    assert MIGRATION.is_file(), "household workspace migration is missing"
    return MIGRATION.read_text(encoding="utf-8").lower()


def test_real_table_and_owner_identity():
    source = sql()
    for declaration in (
        "create table if not exists public.household_workspaces",
        "id uuid primary key",
        "owner_id uuid not null unique references auth.users(id) on delete cascade",
        "payload jsonb not null",
        "revision integer not null",
        "updated_at timestamptz not null",
    ):
        assert declaration in source


def test_rls_and_no_direct_client_writes():
    source = sql()
    assert "enable row level security" in source
    assert "grant select, delete on table public.household_workspaces to authenticated" in source
    assert "revoke all on table public.household_workspaces from public, anon, authenticated" in source
    assert "for select to authenticated" in source
    assert "for delete to authenticated" in source
    assert source.count("using ((select auth.uid()) = owner_id)") == 2
    assert not re.search(r"grant\s+(?:all|insert|update)\b.*\bto authenticated", source)


def test_rpc_is_hardened_and_returns_rows():
    source = sql()
    rpc = source.split("create or replace function public.update_workspace(", 1)[1]
    assert "returns setof public.household_workspaces" in rpc
    assert "security definer" in rpc
    assert "set search_path = ''" in rpc
    assert "auth.uid()" in rpc
    assert "workspace-auth-required" in rpc
    assert "owner_id = v_owner" in rpc
    assert "for update" in rpc
    assert "on conflict do nothing" in rpc
    assert "v_row.revision <> p_expected_revision" in rpc
    assert "p_expected_revision <> 0" in rpc
    assert "revision = w.revision + 1" in rpc
    signature = "public.update_workspace(uuid, jsonb, integer)"
    assert f"revoke all on function {signature} from public, anon, authenticated, service_role" in rpc
    assert f"grant execute on function {signature} to authenticated" in rpc


def test_payload_is_validated_at_both_write_boundaries():
    source = sql()
    assert "check (asu_private.workspace_payload_valid(payload))" in source
    assert "if not asu_private.workspace_payload_valid(p_payload)" in source
    assert "pg_catalog.octet_length(p_payload::text) > 262144" in source
    assert "p_payload -> 'schema_version' <> '1'::jsonb" in source
    assert "p_value - array(select pg_catalog.jsonb_object_keys(p_shape))" in source
    for key in ("containers", "activities", "incidents", "tasks", "scenarios"):
        assert f'"{key}":"array"' in source
    assert "v_items := p_payload -> v_collection" in source
    assert "when 'incidents' then 2000 else 500" in source
    assert "pg_catalog.jsonb_array_length(v_item -> 'updates') > 1000" in source
    assert "pg_catalog.jsonb_array_length(v_item -> 'deferredids') > 500" in source


def test_identity_is_immutable_and_helpers_are_private():
    source = sql()
    assert "workspace-identity-immutable" in source
    assert "new.owner_id is distinct from old.owner_id" in source
    assert "new.id is distinct from old.id" in source
    assert "before update on public.household_workspaces" in source
    assert "revoke all on schema asu_private from public, anon, authenticated" in source
    assert "revoke all on all functions in schema asu_private from public, anon, authenticated" in source


def test_executable_sql_suite_covers_security_contract():
    source = (ROOT / "tests/workspace_isolation.sql").read_text(encoding="utf-8").lower()
    assert source.lstrip().startswith("\\set on_error_stop on")
    assert source.rstrip().endswith("rollback;")
    for case in (
        "anonymous rpc", "missing subject", "create owner a", "create owner b",
        "cross-owner read", "cross-owner write", "cross-owner delete",
        "stale revision", "one workspace", "direct insert", "direct update",
        "owner immutable", "successful update", "manual replacement",
        "unknown key", "nested unknown key", "payload byte limit", "array limit",
        "invalid scalar", "valid populated payload", "owner delete",
    ):
        assert case in source
