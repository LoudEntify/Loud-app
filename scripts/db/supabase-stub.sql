-- scripts/db/supabase-stub.sql
-- ─────────────────────────────────────────────────────────────
-- The smallest slice of a Supabase project that our migrations depend on,
-- so that supabase/migrations/*.sql can be applied from scratch against a
-- plain Postgres 16 (CI, or a developer laptop) with no Supabase CLI and
-- no Docker.
--
-- What this mimics, and only this:
--   * the three Data API roles (anon, authenticated, service_role) and
--     the `authenticator` login role PostgREST would use;
--   * the `auth` schema: `auth.users` (the columns our migrations touch)
--     and `auth.uid()` / `auth.role()` / `auth.jwt()`, reading the same
--     request.jwt.claims setting PostgREST sets, so RLS policies behave
--     exactly as they do on Supabase when a test does
--       select set_config('request.jwt.claims', '{"sub":"...","role":"authenticated"}', true);
--       set role authenticated;
--   * the `storage` schema: buckets, objects and storage.foldername(), so
--     the avatar/broll storage policies in the migration history apply;
--   * Supabase's default privileges on `public` (anon/authenticated/
--     service_role get ALL on new tables/functions/sequences created by
--     the migration role) — this is what makes the audit-schema check
--     meaningful: a schema that is NOT public gets none of this.
--
-- It is deliberately not a copy of Supabase's init scripts. If a migration
-- needs something not stubbed here, add it here and say why.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
-- The migration role (whoever runs this file) must be able to SET ROLE to
-- the Data API roles so tests can run as them.
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
end $$;

-- ── graphql_public (exposed by PostgREST on Supabase; empty here) ──
create schema if not exists graphql_public;
grant usage on schema graphql_public to anon, authenticated, service_role;

-- ── extensions schema (Supabase puts extensions here; we just need it to exist) ──
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ── auth ──────────────────────────────────────────────────────
create schema if not exists auth;
alter schema auth owner to supabase_auth_admin;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb default '{}'::jsonb,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  last_sign_in_at     timestamptz
);
alter table auth.users owner to supabase_auth_admin;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
-- Supabase grants service_role read on auth.users via the admin API, not SQL;
-- anon/authenticated never read auth.users directly. Keep it that way here.
grant select on auth.users to service_role;

-- ── storage ───────────────────────────────────────────────────
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- ── public: Supabase's default privileges ──────────────────────
-- This is the "auto-expose new tables" behaviour: anything the migration
-- role creates in `public` is reachable by the Data API roles unless RLS
-- says otherwise. Supabase flips this default off during 2026 (see
-- supabase/config.toml); until then our migrations must assume it is ON
-- and rely on RLS, and must explicitly lock down anything that is NOT
-- supposed to be reachable (see the audit log).
-- Only DEFAULT privileges, never a blanket `grant all on all ... in schema
-- public`: this file is re-run before every apply, and a blanket grant on an
-- existing database would silently re-open a function a migration had
-- deliberately revoked (it did, once — caught by audit_log_access.sql).
grant usage on schema public to anon, authenticated, service_role;
do $$
begin
  execute format('alter default privileges for role %I in schema public grant all on tables to anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema public grant all on sequences to anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema public grant all on functions to anon, authenticated, service_role', current_user);
end $$;

-- PostgREST's exposed-schema list, as the `authenticator` role setting
-- Supabase uses (`pgrst.db_schemas`). Our audit check reads this back.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public';

-- ── realtime ──────────────────────────────────────────────────
-- Supabase creates this publication; migrations add tables to it so the
-- client can subscribe to row changes.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
