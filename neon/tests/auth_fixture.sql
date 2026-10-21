-- Disposable LOCAL PostgreSQL fixture only: NEVER APPLY to a hosted Neon database.
-- These are test doubles, not Managed Neon Auth, JWT verification or the Data API.
-- The hosted migration uses provider-owned identity functions without replacing them.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then create role anonymous nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema neon_auth;
create table neon_auth."user" (id uuid primary key);
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;
grant usage on schema public, auth to anonymous, authenticated;
grant execute on function auth.uid() to anonymous, authenticated;
