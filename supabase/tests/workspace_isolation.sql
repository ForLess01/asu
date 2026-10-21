\set ON_ERROR_STOP on
-- Run only against a disposable LOCAL Supabase database as postgres.
-- The server-side role/claim changes below are test fixtures, never client code.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

create function pg_temp.assert_ok(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.fixture() returns jsonb language sql as $$
  select '{"schema_version":1,"id":"a0000000-0000-4000-8000-000000000001",
    "revision":0,"locale":"es-PE","updatedAt":"2026-10-20T12:00:00Z",
    "household":null,"containers":[],"activities":[],"incidents":[],"tasks":[],"scenarios":[]}'::jsonb;
$$;
do $$
begin
  execute format('grant usage on schema %I to anon, authenticated',
    (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end;
$$;

-- Construct a schema-valid payload of an exact UTF-8 JSONB text size. This tests
-- bytes independently of unknown-key, string-length and collection rejection.
create function pg_temp.byte_fixture(target integer) returns jsonb language plpgsql as $$
declare result jsonb; padding integer;
begin
  select jsonb_set(pg_temp.fixture(), '{incidents}', jsonb_agg(jsonb_build_object(
    'id', n::text, 'startedAt', '2026-10-20T12:00:00Z', 'restoredAt', '2026-10-20T13:00:00Z',
    'source', 'x', 'scope', 'household', 'precision', 'exact', 'updates', '[]'::jsonb) order by n))
    into result from generate_series(1,1000) n;
  padding := target - octet_length(result::text);
  perform pg_temp.assert_ok(padding between 0 and 159000, 'byte fixture padding range');
  select jsonb_set(result, '{incidents}', jsonb_agg(jsonb_set(item, '{source}',
    to_jsonb(repeat('x', 1 + padding / 1000 + case when n <= padding % 1000 then 1 else 0 end))) order by n))
    into result from jsonb_array_elements(result -> 'incidents') with ordinality e(item, n);
  perform pg_temp.assert_ok(octet_length(result::text) = target, 'byte fixture exact size');
  return result;
end;
$$;

create function pg_temp.populated_fixture() returns jsonb language sql as $$
  select pg_temp.fixture() || '{"household":{"label":"Home","district":"Lima","department":"LIMA","eps":"SEDAPAL","occupancy":4},
    "containers":[{"id":"c1","name":"Tank","category":"other","capacity":600,"volume":420,"observedAt":"2026-10-20T12:00:00Z"}],
    "activities":[{"id":"a1","name":"Cooking","category":"drinking","liters":12,"timesPerDay":1,"essential":true,"source":"manual","updatedAt":"2026-10-20T12:00:00Z"}],
    "incidents":[{"id":"i1","startedAt":"2026-10-20T12:00:00Z","restoredAt":null,"source":"manual","scope":"household","precision":"exact","updates":[{"at":"2026-10-20T12:00:00Z","note":"Observed"}]}],
    "tasks":[{"id":"t1","title":"Check tank","done":false,"dueAt":null}],
    "scenarios":[{"id":"s1","at":"2026-10-20T12:00:00Z","hours":24,"deferredIds":["a1"],"replenishment":0,"category":"other","baseRevision":0,"inputs":{"reserves":{"drinking":null,"other":420},"rates":{"drinking":0,"other":2}}}]}';
$$;

-- Each rejection must preserve every visible row, payload, timestamp and counter.
create function pg_temp.expect_error(statement text, code text, message text, label text)
returns void language plpgsql as $$
declare before_rows jsonb; after_rows jsonb; observed_code text; observed_message text;
begin
  select coalesce(jsonb_agg(to_jsonb(w) order by id), '[]'::jsonb) into before_rows
    from public.household_workspaces w;
  begin
    execute statement;
  exception when others then
    get stacked diagnostics observed_code = returned_sqlstate, observed_message = message_text;
  end;
  perform pg_temp.assert_ok(observed_code = code and (message is null or observed_message = message),
    label || ' error: ' || coalesce(observed_code || ' / ' || observed_message, 'no error'));
  select coalesce(jsonb_agg(to_jsonb(w) order by id), '[]'::jsonb) into after_rows
    from public.household_workspaces w;
  perform pg_temp.assert_ok(before_rows = after_rows, label || ' unchanged');
end;
$$;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');

-- Privileges are part of the contract, not just the RLS predicates.
select pg_temp.assert_ok(not has_table_privilege('anon', 'public.household_workspaces', 'SELECT'), 'anonymous read denied');
select pg_temp.assert_ok(not has_function_privilege('anon', 'public.update_workspace(uuid,jsonb,integer)', 'EXECUTE'), 'anonymous rpc denied');
select pg_temp.assert_ok(not has_function_privilege('service_role', 'public.update_workspace(uuid,jsonb,integer)', 'EXECUTE'), 'service role has no default RPC grant');
select pg_temp.assert_ok(not has_table_privilege('authenticated', 'public.household_workspaces', 'INSERT'), 'direct insert denied');
select pg_temp.assert_ok(not has_table_privilege('authenticated', 'public.household_workspaces', 'UPDATE'), 'direct update denied');

set local role anon;
do $$
begin
  begin
    perform public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 0);
    raise exception 'FAIL: anonymous RPC allowed';
  exception when insufficient_privilege then raise notice 'PASS: anonymous RPC'; end;
end;
$$;
reset role;
select pg_temp.assert_ok((select count(*) = 0 from public.household_workspaces), 'anonymous RPC unchanged');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 0)$q$,
  '42501', 'workspace-auth-required', 'missing subject');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 1)$q$,
  '40001', 'workspace-revision-conflict', 'first save requires zero');
select pg_temp.expect_error($q$select * from public.update_workspace(null, pg_temp.fixture(), 0)$q$,
  '22023', 'invalid-workspace-arguments', 'null remote ID');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), null)$q$,
  '22023', 'invalid-workspace-arguments', 'null expected revision');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), -1)$q$,
  '22023', 'invalid-workspace-arguments', 'negative expected revision');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', null, 0)$q$,
  '22023', 'invalid-workspace-payload', 'SQL null payload');
select pg_temp.assert_ok((select id = 'a0000000-0000-4000-8000-000000000001' and revision = 1
  and owner_id = auth.uid() and payload = pg_temp.fixture() and updated_at is not null
  from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 0)), 'create owner A');
select pg_temp.assert_ok((select count(*) = 1 from public.household_workspaces), 'retrieve owner A');

select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 0)$q$,
  '40001', 'workspace-revision-conflict', 'stale revision');
select pg_temp.expect_error($q$select * from public.update_workspace('c0000000-0000-4000-8000-000000000003', pg_temp.fixture(), 0)$q$,
  '40001', 'workspace-revision-conflict', 'one workspace');
select pg_temp.expect_error($q$insert into public.household_workspaces(id, owner_id, payload, revision)
  values ('c0000000-0000-4000-8000-000000000003', auth.uid(), pg_temp.fixture(), 1)$q$,
  '42501', null, 'direct insert');
select pg_temp.expect_error($q$update public.household_workspaces set owner_id = '20000000-0000-4000-8000-000000000002'$q$,
  '42501', null, 'direct update');

-- Invalid payloads are rejected by the RPC, not silently stripped.
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture() || '{"access_token":"dummy"}', 1)$q$,
  '22023', 'invalid-workspace-payload', 'unknown key');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.fixture(), '{household}',
  '{"label":"Home","district":"Lima","department":"LIMA","eps":"SEDAPAL","occupancy":1,"cache":{}}'), 1)$q$,
  '22023', 'invalid-workspace-payload', 'nested unknown key');
savepoint byte_boundary;
select pg_temp.assert_ok((select revision = 2 and octet_length(payload::text) = 262144
  from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.byte_fixture(262144), 1)), 'payload byte limit inclusive');
rollback to savepoint byte_boundary;
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.byte_fixture(262145), 1)$q$,
  '22023', 'invalid-workspace-payload', 'payload byte limit');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.fixture(), '{tasks}',
  (select jsonb_agg(jsonb_build_object('id', n::text, 'title','Task','done',false,'dueAt',null)) from generate_series(1,501) n)), 1)$q$,
  '22023', 'invalid-workspace-payload', 'array limit');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.fixture(), '{revision}', '"1"'), 1)$q$,
  '22023', 'invalid-workspace-payload', 'invalid scalar');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', '[]', 1)$q$,
  '22023', 'invalid-workspace-payload', 'object required');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.fixture(), '{schema_version}', '2'), 1)$q$,
  '22023', 'invalid-workspace-payload', 'schema version');

do $$
declare bad record; sample jsonb := pg_temp.populated_fixture(); oversized jsonb; collection text; limit_count integer;
begin
  for bad in select * from (values
    ('missing field', pg_temp.fixture() - 'locale'),
    ('JSON null', 'null'::jsonb),
    ('invalid timestamp', jsonb_set(sample, '{updatedAt}', '"2026-02-30T12:00:00Z"')),
    ('invalid locale', jsonb_set(sample, '{locale}', '"xx"')),
    ('invalid UUID', jsonb_set(sample, '{id}', '"not-a-uuid"')),
    ('invalid boolean', jsonb_set(sample, '{tasks,0,done}', '"false"')),
    ('oversized text', jsonb_set(sample, '{tasks,0,title}', to_jsonb(repeat('x',161)))),
    ('UTF-16 text length', jsonb_set(sample, '{tasks,0,title}', to_jsonb(repeat('😀',81)))),
    ('blank text', jsonb_set(sample, '{tasks,0,title}', '"  "')),
    ('Unicode blank text', jsonb_set(sample, '{tasks,0,title}', '"\uFEFF\u00A0"')),
    ('negative volume', jsonb_set(sample, '{containers,0,volume}', '-1')),
    ('zero capacity', jsonb_set(sample, '{containers,0,capacity}', '0')),
    ('volume exceeds capacity', jsonb_set(sample, '{containers,0,volume}', '601')),
    ('zero occupancy', jsonb_set(sample, '{household,occupancy}', '0')),
    ('excess occupancy', jsonb_set(sample, '{household,occupancy}', '501')),
    ('fractional occupancy', jsonb_set(sample, '{household,occupancy}', '1.5')),
    ('excess frequency', jsonb_set(sample, '{activities,0,timesPerDay}', '1001')),
    ('positive number underflow', jsonb_set(sample, '{activities,0,timesPerDay}', '1e-4000')),
    ('infinite JS number', jsonb_set(sample, '{activities,0,liters}', '1e309')),
    ('excess scenario hours', jsonb_set(sample, '{scenarios,0,hours}', '721')),
    ('missing scenario input', sample #- '{scenarios,0,inputs,rates,other}'),
    ('nested credential', jsonb_set(sample, '{scenarios,0,inputs,rates,access_token}', '"dummy"')),
    ('duplicate trimmed ID', jsonb_set(sample, '{tasks}', (sample -> 'tasks') || jsonb_build_array(jsonb_set(sample #> '{tasks,0}', '{id}', '" t1 "')))),
    ('duplicate Unicode trimmed ID', jsonb_set(sample, '{tasks}', (sample -> 'tasks') || jsonb_build_array(jsonb_set(sample #> '{tasks,0}', '{id}', '"\uFEFFt1\u00A0"')))),
    ('two active incidents', jsonb_set(sample, '{incidents}', (sample -> 'incidents') || jsonb_build_array(jsonb_set(sample #> '{incidents,0}', '{id}', '"i2"')))),
    ('restoration before start', jsonb_set(sample, '{incidents,0,restoredAt}', '"2026-10-20T11:00:00Z"')),
    ('incident update limit', jsonb_set(sample, '{incidents,0,updates}', (select jsonb_agg(sample #> '{incidents,0,updates,0}') from generate_series(1,1001)))),
    ('deferred ID limit', jsonb_set(sample, '{scenarios,0,deferredIds}', (select jsonb_agg('"a1"'::jsonb) from generate_series(1,501))))
  ) cases(label, payload) loop
    perform pg_temp.expect_error(format('select * from public.update_workspace(%L::uuid,%L::jsonb,1)',
      'a0000000-0000-4000-8000-000000000001', bad.payload::text),
      '22023', 'invalid-workspace-payload', bad.label);
  end loop;
  foreach collection in array array['containers', 'activities', 'incidents', 'tasks', 'scenarios'] loop
    limit_count := case collection when 'incidents' then 2000 else 500 end;
    -- Distinct IDs ensure this is not merely the duplicate-ID rejection.
    select jsonb_set(sample, array[collection], jsonb_agg(jsonb_set(sample #> array[collection,'0'], '{id}', to_jsonb(n::text))))
      into oversized from generate_series(1,limit_count + 1) n;
    perform pg_temp.expect_error(format('select * from public.update_workspace(%L::uuid,%L::jsonb,1)',
      'a0000000-0000-4000-8000-000000000001', oversized::text),
      '22023', 'invalid-workspace-payload', collection || ' collection limit');
  end loop;
end;
$$;

savepoint array_boundary;
select pg_temp.assert_ok((select revision = 2 and jsonb_array_length(payload -> 'tasks') = 500
  from public.update_workspace('a0000000-0000-4000-8000-000000000001', jsonb_set(pg_temp.fixture(), '{tasks}',
    (select jsonb_agg(jsonb_build_object('id', n::text, 'title','Task','done',false,'dueAt',null)) from generate_series(1,500) n)), 1)), 'array limit inclusive');
rollback to savepoint array_boundary;

-- A different local payload.id is allowed for manual replacement of the OWN row.
select pg_temp.assert_ok((select id = 'a0000000-0000-4000-8000-000000000001' and revision = 2
  and owner_id = auth.uid() and updated_at is not null
  and payload = jsonb_set(pg_temp.fixture(), '{id}', '"d0000000-0000-4000-8000-000000000004"')
  from public.update_workspace('a0000000-0000-4000-8000-000000000001',
    jsonb_set(pg_temp.fixture(), '{id}', '"d0000000-0000-4000-8000-000000000004"'), 1)), 'successful update / manual replacement');
select to_jsonb(w)::text as owner_a_before from public.household_workspaces w \gset

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_ok((select count(*) = 0 from public.household_workspaces), 'cross-owner read');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 2)$q$,
  '40001', 'workspace-revision-conflict', 'cross-owner write');
select pg_temp.expect_error($q$select * from public.update_workspace('a0000000-0000-4000-8000-000000000001', pg_temp.fixture(), 0)$q$,
  '40001', 'workspace-revision-conflict', 'cross-owner creation collision');
with removed as (delete from public.household_workspaces where id = 'a0000000-0000-4000-8000-000000000001' returning *)
  select pg_temp.assert_ok((select count(*) = 0 from removed), 'cross-owner delete');
reset role;
select pg_temp.assert_ok((select to_jsonb(w) = :'owner_a_before'::jsonb
  from public.household_workspaces w where id = 'a0000000-0000-4000-8000-000000000001'), 'cross-owner actions preserve owner A');
select pg_temp.expect_error($q$update public.household_workspaces set owner_id = '20000000-0000-4000-8000-000000000002'
  where id = 'a0000000-0000-4000-8000-000000000001'$q$, '23514', 'workspace-identity-immutable', 'owner immutable');
select pg_temp.expect_error($q$update public.household_workspaces set id = 'c0000000-0000-4000-8000-000000000003'
  where id = 'a0000000-0000-4000-8000-000000000001'$q$, '23514', 'workspace-identity-immutable', 'remote ID immutable');

set local role authenticated;
-- Claims remain owner B after RESET ROLE; only the SQL role changed.
select pg_temp.assert_ok((select revision = 1 and owner_id = auth.uid() from public.update_workspace(
  'b0000000-0000-4000-8000-000000000002', pg_temp.populated_fixture(), 0)), 'create owner B / valid populated payload');
select pg_temp.assert_ok((select count(*) = 1 from public.household_workspaces), 'retrieve only owner B');
with removed as (delete from public.household_workspaces where id = 'b0000000-0000-4000-8000-000000000002' returning *)
  select pg_temp.assert_ok((select count(*) = 1 from removed), 'owner delete');
select pg_temp.assert_ok((select count(*) = 0 from public.household_workspaces), 'owner delete empty');
reset role;
select pg_temp.assert_ok((select count(*) = 1 from public.household_workspaces), 'owner A survives owner B delete');
rollback;
