"""Neon structural guardrails: runtime SQL tests, not these checks, prove local RLS."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT/'neon/migrations/20261020000100_household_workspaces.sql'


def sql():
    assert MIGRATION.is_file(), 'Neon household workspace migration is missing'
    return MIGRATION.read_text(encoding='utf-8').lower()


def test_neon_identity_is_provider_owned_and_uuid_bound():
    source = sql()
    assert 'owner_id uuid not null unique references neon_auth."user"(id) on delete cascade' in source
    assert 'v_owner uuid := auth.uid()' in source
    assert source.count('using ((select auth.uid()) = owner_id)') == 2
    executable = re.sub(r'--[^\n]*', '', source)
    assert not re.search(r'\b(?:anon|service_role)\b', executable)
    assert not re.search(r'create\s+(?:or replace\s+)?(?:function\s+auth\.|role\b|extension\b)', executable)
    assert not re.search(r'grant\s+\w+\s+to\s+\w+\s*;', executable.replace('grant execute on', '').replace('grant select, delete on', ''))


def test_only_neon_authenticated_clients_can_use_public_api():
    source = sql()
    for object_name in ('schema asu_private', 'table public.household_workspaces', 'all functions in schema asu_private', 'function public.update_workspace(uuid, jsonb, integer)'):
        assert f'revoke all on {object_name} from public, anonymous, authenticated' in source
    assert 'grant select, delete on table public.household_workspaces to authenticated' in source
    assert 'grant execute on function public.update_workspace(uuid, jsonb, integer) to authenticated' in source
    assert 'enable row level security' in source
    assert not re.search(r'grant\s+(?:all|insert|update)\b.*\bto authenticated', source)


def test_native_validation_and_rpc_are_unchanged_from_legacy():
    source = sql()
    legacy = (ROOT/'supabase/migrations/20261020000100_household_workspaces.sql').read_text().lower()
    # Provider-specific DDL must not accidentally fork the domain/revision algorithm.
    for start, end in (
        ('create or replace function asu_private.workspace_trim', 'create table if not exists'),
        ('create or replace function asu_private.workspace_identity_immutable', 'revoke all on all functions'),
        ('create or replace function public.update_workspace(', '$$;'),
    ):
        assert source.split(start, 1)[1].split(end, 1)[0] == legacy.split(start, 1)[1].split(end, 1)[0]
    assert 'returns setof public.household_workspaces' in source
    assert "security definer set search_path = ''" in source
    assert 'for update' in source and 'on conflict do nothing' in source
    assert 'check (asu_private.workspace_payload_valid(payload))' in source


def test_fixture_is_explicitly_local_and_never_creates_supabase_identity():
    fixture = (ROOT/'neon/tests/auth_fixture.sql').read_text().lower()
    assert 'never apply' in fixture and 'hosted' in fixture
    assert 'create role anonymous nologin' in fixture
    assert 'create table neon_auth."user" (id uuid primary key)' in fixture
    assert 'create function auth.uid()' in fixture
    assert "current_setting('request.jwt.claims', true)" in fixture
    assert 'auth.users' not in fixture


def test_sql_suite_preserves_existing_cases_and_tests_neon_fk_and_helpers():
    source = (ROOT/'neon/tests/workspace_isolation.sql').read_text().lower()
    assert source.lstrip().startswith('\\set on_error_stop on')
    assert source.rstrip().endswith('rollback;')
    legacy = (ROOT/'supabase/tests/workspace_isolation.sql').read_text().lower()
    # Keep every existing labeled assertion/error case other than the absent service role.
    labels = re.findall(r", '([^'\n]+)'\);", legacy)
    for label in labels:
        if label != 'service role has no default rpc grant':
            assert f"'{label}'" in source
    for label in ('private helper execute denied', 'private schema usage denied', 'neon auth account deletion cascades', 'unknown neon auth subject', 'utf-16 text limit inclusive'):
        assert label in source
