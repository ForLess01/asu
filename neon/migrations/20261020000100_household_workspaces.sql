-- Apply as the trusted Neon database owner, never as a Data API client role.
-- Requires Managed Neon Auth (neon_auth."user".id UUID) and Data API auth.uid().
-- Provider identity functions/roles are managed by Neon: do not redefine them here.
-- Native validators and RPC copied from the retained legacy Supabase migration
-- of the same name; only provider identity/role bindings differ.
create schema if not exists asu_private;
revoke all on schema asu_private from public, anonymous, authenticated;

-- Match JavaScript String.trim(), including BOM and non-breaking whitespace.
create or replace function asu_private.workspace_trim(p_value text)
returns text language sql immutable strict set search_path = '' as $$
  select pg_catalog.btrim(p_value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

-- All fields are required; unknown keys fail closed at every object boundary.
-- A trailing ? permits JSON null, not a missing field.
create or replace function asu_private.workspace_object_valid(p_value jsonb, p_shape jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_key text; v_kind text; v_value jsonb; v_text text; v_number numeric;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'object' then return false; end if;
  if p_value - array(select pg_catalog.jsonb_object_keys(p_shape)) <> '{}'::jsonb then return false; end if;
  for v_key, v_kind in select * from pg_catalog.jsonb_each_text(p_shape) loop
    if not p_value ? v_key then return false; end if;
    v_value := p_value -> v_key;
    if pg_catalog.right(v_kind, 1) = '?' then
      if v_value = 'null'::jsonb then continue; end if;
      v_kind := pg_catalog.left(v_kind, -1);
    end if;
    v_text := v_value #>> '{}';
    if v_kind in ('object', 'array', 'boolean') then
      if pg_catalog.jsonb_typeof(v_value) <> v_kind then return false; end if;
    elsif v_kind in ('text', 'uuid', 'timestamp', 'category', 'locale', 'scope', 'precision') then
      if pg_catalog.jsonb_typeof(v_value) <> 'string' then return false; end if;
      if v_kind = 'text' then
        v_text := asu_private.workspace_trim(v_text);
        if pg_catalog.char_length(v_text) not between 1 and 160 then return false; end if;
        -- Zod/JavaScript string length counts UTF-16 units, not Unicode points.
        if (select pg_catalog.sum(case when pg_catalog.ascii(c) > 65535 then 2 else 1 end)
          from pg_catalog.regexp_split_to_table(v_text, '') c) > 160 then return false; end if;
      elsif v_kind = 'uuid' then
        if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and pg_catalog.lower(v_text) not in ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff') then return false; end if;
      elsif v_kind = 'timestamp' then
        if v_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then return false; end if;
        perform v_text::timestamptz;
      elsif v_kind = 'category' and v_text not in ('drinking', 'other') then return false;
      elsif v_kind = 'locale' and v_text not in ('es-PE', 'en') then return false;
      elsif v_kind = 'scope' and v_text <> 'household' then return false;
      elsif v_kind = 'precision' and v_text not in ('exact', 'approximate') then return false;
      end if;
    elsif v_kind in ('number', 'nonnegative', 'positive', 'integer') then
      if pg_catalog.jsonb_typeof(v_value) <> 'number' then return false; end if;
      v_number := v_text::numeric;
      -- JSON is read by JavaScript: reject values that would become Infinity.
      if pg_catalog.abs(v_number) > 1.7976931348623157e308 then return false; end if;
      if v_kind in ('nonnegative', 'integer') and v_number < 0 then return false; end if;
      if v_kind = 'positive' and (v_number <= 0 or v_number::double precision <= 0) then return false; end if;
      if v_kind = 'integer' and (v_number <> pg_catalog.trunc(v_number) or v_number > 9007199254740991) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create or replace function asu_private.workspace_payload_valid(p_payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_collection text; v_items jsonb; v_item jsonb; v_child jsonb; v_shape jsonb;
  v_active integer := 0;
begin
  if p_payload is null or pg_catalog.octet_length(p_payload::text) > 262144 then return false; end if;
  if not asu_private.workspace_object_valid(p_payload, '{"schema_version":"integer","id":"uuid","revision":"integer","locale":"locale","updatedAt":"timestamp","household":"object?","containers":"array","activities":"array","incidents":"array","tasks":"array","scenarios":"array"}') then return false; end if;
  if p_payload -> 'schema_version' <> '1'::jsonb then return false; end if;
  if p_payload -> 'household' <> 'null'::jsonb then
    if not asu_private.workspace_object_valid(p_payload -> 'household', '{"label":"text","district":"text","department":"text","eps":"text","occupancy":"integer"}') then return false; end if;
    if (p_payload #>> '{household,occupancy}')::numeric not between 1 and 500 then return false; end if;
  end if;
  foreach v_collection in array array['containers', 'activities', 'incidents', 'tasks', 'scenarios'] loop
    v_items := p_payload -> v_collection;
    if pg_catalog.jsonb_array_length(v_items) > (case v_collection when 'incidents' then 2000 else 500 end) then return false; end if;
    v_shape := case v_collection
      when 'containers' then '{"id":"text","name":"text","category":"category","capacity":"positive?","volume":"nonnegative?","observedAt":"timestamp"}'::jsonb
      when 'activities' then '{"id":"text","name":"text","category":"category","liters":"nonnegative","timesPerDay":"positive","essential":"boolean","source":"text","updatedAt":"timestamp"}'::jsonb
      when 'incidents' then '{"id":"text","startedAt":"timestamp","restoredAt":"timestamp?","source":"text","scope":"scope","precision":"precision","updates":"array"}'::jsonb
      when 'tasks' then '{"id":"text","title":"text","done":"boolean","dueAt":"timestamp?"}'::jsonb
      when 'scenarios' then '{"id":"text","at":"timestamp","hours":"positive","deferredIds":"array","replenishment":"nonnegative","category":"category","baseRevision":"integer","inputs":"object"}'::jsonb
    end;
    for v_item in select * from pg_catalog.jsonb_array_elements(v_items) loop
      if not asu_private.workspace_object_valid(v_item, v_shape) then return false; end if;
      if v_collection = 'containers' then
        if v_item -> 'capacity' <> 'null'::jsonb and v_item -> 'volume' <> 'null'::jsonb
          and (v_item ->> 'volume')::numeric > (v_item ->> 'capacity')::numeric then return false; end if;
      elsif v_collection = 'activities' then
        if (v_item ->> 'timesPerDay')::numeric > 1000 then return false; end if;
      elsif v_collection = 'incidents' then
        if v_item -> 'restoredAt' = 'null'::jsonb then v_active := v_active + 1;
        elsif (v_item ->> 'restoredAt')::timestamptz < (v_item ->> 'startedAt')::timestamptz then return false;
        end if;
        if v_active > 1 or pg_catalog.jsonb_array_length(v_item -> 'updates') > 1000 then return false; end if;
        for v_child in select * from pg_catalog.jsonb_array_elements(v_item -> 'updates') loop
          if not asu_private.workspace_object_valid(v_child, '{"at":"timestamp","note":"text"}') then return false; end if;
        end loop;
      elsif v_collection = 'scenarios' then
        if (v_item ->> 'hours')::numeric > 720 or pg_catalog.jsonb_array_length(v_item -> 'deferredIds') > 500 then return false; end if;
        for v_child in select * from pg_catalog.jsonb_array_elements(v_item -> 'deferredIds') loop
          if not asu_private.workspace_object_valid(pg_catalog.jsonb_build_object('id', v_child), '{"id":"text"}') then return false; end if;
        end loop;
        if not asu_private.workspace_object_valid(v_item -> 'inputs', '{"reserves":"object","rates":"object"}') then return false; end if;
        if not asu_private.workspace_object_valid(v_item #> '{inputs,reserves}', '{"drinking":"nonnegative?","other":"nonnegative?"}') then return false; end if;
        if not asu_private.workspace_object_valid(v_item #> '{inputs,rates}', '{"drinking":"nonnegative","other":"nonnegative"}') then return false; end if;
      end if;
    end loop;
    -- The domain trims operation IDs before checking uniqueness.
    if (select pg_catalog.count(distinct asu_private.workspace_trim(e ->> 'id'))
      from pg_catalog.jsonb_array_elements(v_items) e) <> pg_catalog.jsonb_array_length(v_items) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create table if not exists public.household_workspaces (
  id uuid primary key,
  owner_id uuid not null unique references neon_auth."user"(id) on delete cascade,
  payload jsonb not null constraint household_workspace_payload check (asu_private.workspace_payload_valid(payload)),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.household_workspaces enable row level security;
revoke all on table public.household_workspaces from public, anonymous, authenticated;
grant select, delete on table public.household_workspaces to authenticated;

-- CREATE POLICY lacks OR REPLACE; retain an identical installation on reapply.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.household_workspaces'::regclass and polname = 'household_workspace_owner_select') then
    create policy household_workspace_owner_select on public.household_workspaces
      for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.household_workspaces'::regclass and polname = 'household_workspace_owner_delete') then
    create policy household_workspace_owner_delete on public.household_workspaces
      for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end;
$$;

create or replace function asu_private.workspace_identity_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
    raise exception using errcode = '23514', message = 'workspace-identity-immutable';
  end if;
  return new;
end;
$$;
create or replace trigger household_workspace_identity_immutable
  before update on public.household_workspaces
  for each row execute function asu_private.workspace_identity_immutable();
revoke all on all functions in schema asu_private from public, anonymous, authenticated;

create or replace function public.update_workspace(
  p_workspace_id uuid,
  p_payload jsonb,
  p_expected_revision integer
)
returns setof public.household_workspaces
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_row public.household_workspaces%rowtype;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'workspace-auth-required';
  end if;
  if p_workspace_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid-workspace-arguments';
  end if;
  if not asu_private.workspace_payload_valid(p_payload) then
    raise exception using errcode = '22023', message = 'invalid-workspace-payload';
  end if;
  select w.* into v_row from public.household_workspaces w
    where w.id = p_workspace_id and w.owner_id = v_owner for update;
  if found then
    if v_row.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'workspace-revision-conflict';
    end if;
    update public.household_workspaces w
      set payload = p_payload, revision = w.revision + 1, updated_at = pg_catalog.clock_timestamp()
      where w.id = p_workspace_id and w.owner_id = v_owner and w.revision = p_expected_revision
      returning w.* into v_row;
  else
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'workspace-revision-conflict';
    end if;
    -- Both unique constraints arbitrate concurrent first saves atomically.
    -- A collision reveals neither the other owner nor their workspace contents.
    insert into public.household_workspaces(id, owner_id, payload, revision)
      values (p_workspace_id, v_owner, p_payload, 1)
      on conflict do nothing returning * into v_row;
    if not found then
      raise exception using errcode = '40001', message = 'workspace-revision-conflict';
    end if;
  end if;
  return next v_row;
end;
$$;
-- Revoke default client grants using only roles present in the Neon installation.
revoke all on function public.update_workspace(uuid, jsonb, integer) from public, anonymous, authenticated;
grant execute on function public.update_workspace(uuid, jsonb, integer) to authenticated;
