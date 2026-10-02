-- Phase 3: the artist's YouTube connection, broadcasts and stream keys.
--
-- PRD rows 111, 140, 141, 142. docs/ARCHITECTURE.md Data isolation:
-- "Identity: credentials, sessions, passkeys, date of birth, YouTube OAuth
-- tokens and stream keys — separate schema, separate credentials, no join
-- to application data; third-party tokens encrypted with per-tenant keys,
-- never returned to a client, never logged."
--
-- Same posture as the audit log (20261002000100): an `identity` schema
-- that no Data API role can reach, with SECURITY DEFINER functions in
-- `public` as the only doors, callable by service_role alone. Token
-- values arrive here already encrypted by the application (AES-GCM with a
-- key derived per artist from YOUTUBE_TOKEN_KEY, lib/youtube/crypto.js);
-- the database never sees a plaintext token.
--
-- HONEST LIMIT: a single Supabase project has one database, so "separate
-- credentials" is a schema boundary here, as with the audit log. See
-- docs/NEEDS_KOREY.md for the separate-project option.
--
-- Protected path (identity). Listed in docs/NEEDS_KOREY.md.

create schema if not exists identity;
revoke all on schema identity from public, anon, authenticated, service_role;

create table if not exists identity.youtube_connections (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  channel_id         text not null,
  channel_title      text,
  -- encrypted blobs (base64 of iv|ciphertext|tag); the key never lives here
  access_token_enc   text not null,
  refresh_token_enc  text,
  key_version        integer not null default 1,
  token_expires_at   timestamptz,
  scopes             text[] not null default '{}',
  -- channel readiness, checked at onboarding (docs/YOUTUBE_ADDENDUM.md)
  live_enabled       boolean,
  readiness_checked_at timestamptz,
  readiness_error    text,
  connected_at       timestamptz not null default now(),
  disconnected_at    timestamptz,
  last_refresh_error text,
  -- 'mock' (test double) | 'google'
  provider           text not null default 'google'
);

create table if not exists identity.stream_keys (
  id            uuid primary key default gen_random_uuid(),
  broadcast_id  uuid not null,
  key_enc       text not null,
  ingest_url    text,
  created_at    timestamptz not null default now(),
  rotated_at    timestamptz
);
create index if not exists stream_keys_broadcast_idx on identity.stream_keys (broadcast_id);

do $$
begin
  execute format('alter default privileges for role %I in schema identity revoke all on tables from public, anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema identity revoke all on sequences from public, anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema identity revoke all on functions from public, anon, authenticated, service_role', current_user);
end $$;

-- ── broadcasts: one per show per channel (two in Versus) ─────────────
-- Application data, not identity: the video id is public by intent (it is
-- the embed), the stream key is NOT here (identity.stream_keys).
create table if not exists broadcasts (
  id                   uuid primary key default gen_random_uuid(),
  show_id              uuid not null references shows(id) on delete cascade,
  channel_user_id      uuid not null references auth.users(id) on delete cascade,
  youtube_broadcast_id text,
  youtube_video_id     text,
  youtube_stream_id    text,
  -- created | ready | live | complete | failed | revoked
  state                text not null default 'created',
  -- idle | ok | reconnecting | failed
  delivery_state       text not null default 'idle',
  attempts             integer not null default 0,
  last_error           text,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  ended_at             timestamptz,
  key_rotated_at       timestamptz,
  chat_disabled        boolean,
  provider             text not null default 'google',
  constraint broadcasts_state_check check (state in ('created', 'ready', 'live', 'complete', 'failed', 'revoked')),
  constraint broadcasts_delivery_check check (delivery_state in ('idle', 'ok', 'reconnecting', 'failed'))
);
create index if not exists broadcasts_show_idx on broadcasts (show_id, created_at desc);
alter table broadcasts enable row level security;
-- The artist may read the broadcasts for their own shows (state, video id,
-- delivery state: what the console shows). Nobody writes from a client.
create policy "broadcasts_select_own_show" on broadcasts
  for select using (
    channel_user_id = auth.uid()
    or exists (select 1 from shows s where s.id = broadcasts.show_id and (s.artist_id = auth.uid() or s.artist_b_id = auth.uid()))
  );

-- Delivery state on the show itself, for the viewer's honest reconnecting
-- state (shows is publicly readable; this carries no secret).
alter table shows add column if not exists delivery_state text not null default 'idle';
alter table shows drop constraint if exists shows_delivery_state_check;
alter table shows add constraint shows_delivery_state_check check (delivery_state in ('idle', 'ok', 'reconnecting', 'failed', 'ended'));
-- Measured delay between the composed picture and playback, seconds.
alter table shows add column if not exists measured_delay_seconds numeric(6, 2);

-- ── the doors ────────────────────────────────────────────────────────
create or replace function public.youtube_connection_status(p_user_id uuid)
returns table (connected boolean, channel_id text, channel_title text, live_enabled boolean, readiness_checked_at timestamptz, readiness_error text, connected_at timestamptz, token_expires_at timestamptz, provider text, last_refresh_error text)
language sql security definer set search_path = identity, pg_temp as $$
  select (disconnected_at is null), channel_id, channel_title, live_enabled, readiness_checked_at, readiness_error, connected_at, token_expires_at, provider, last_refresh_error
    from identity.youtube_connections where user_id = p_user_id and disconnected_at is null;
$$;

create or replace function public.youtube_connection_upsert(
  p_user_id uuid, p_channel_id text, p_channel_title text, p_access_token_enc text, p_refresh_token_enc text,
  p_token_expires_at timestamptz, p_scopes text[], p_provider text, p_key_version integer default 1
) returns void
language plpgsql security definer set search_path = identity, pg_temp as $$
begin
  insert into identity.youtube_connections (user_id, channel_id, channel_title, access_token_enc, refresh_token_enc, token_expires_at, scopes, provider, key_version, connected_at, disconnected_at)
  values (p_user_id, p_channel_id, p_channel_title, p_access_token_enc, p_refresh_token_enc, p_token_expires_at, coalesce(p_scopes, '{}'), coalesce(p_provider, 'google'), coalesce(p_key_version, 1), now(), null)
  on conflict (user_id) do update set
    channel_id = excluded.channel_id, channel_title = excluded.channel_title, access_token_enc = excluded.access_token_enc,
    refresh_token_enc = excluded.refresh_token_enc, token_expires_at = excluded.token_expires_at, scopes = excluded.scopes,
    provider = excluded.provider, key_version = excluded.key_version, connected_at = now(), disconnected_at = null, last_refresh_error = null;
end $$;

create or replace function public.youtube_connection_readiness(p_user_id uuid, p_live_enabled boolean, p_error text)
returns void language sql security definer set search_path = identity, pg_temp as $$
  update identity.youtube_connections set live_enabled = p_live_enabled, readiness_checked_at = now(), readiness_error = p_error where user_id = p_user_id;
$$;

create or replace function public.youtube_connection_refresh_failed(p_user_id uuid, p_error text)
returns void language sql security definer set search_path = identity, pg_temp as $$
  update identity.youtube_connections set last_refresh_error = p_error where user_id = p_user_id;
$$;

-- Disconnect takes effect immediately and deletes the tokens (ARCHITECTURE
-- v2: "closing also disconnects the YouTube channel and deletes the tokens").
create or replace function public.youtube_connection_disconnect(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = identity, pg_temp as $$
declare n integer;
begin
  update identity.youtube_connections set disconnected_at = now(), access_token_enc = 'revoked', refresh_token_enc = null where user_id = p_user_id and disconnected_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- The one reader of token material: the egress/lifecycle service, which
-- holds service_role. Returns the ENCRYPTED blobs; decryption needs the
-- application key, so even this door never yields a usable token on its own.
create or replace function public.youtube_connection_secret(p_user_id uuid)
returns table (access_token_enc text, refresh_token_enc text, key_version integer, token_expires_at timestamptz, provider text, channel_id text)
language sql security definer set search_path = identity, pg_temp as $$
  select access_token_enc, refresh_token_enc, key_version, token_expires_at, provider, channel_id
    from identity.youtube_connections where user_id = p_user_id and disconnected_at is null;
$$;

create or replace function public.stream_key_store(p_broadcast_id uuid, p_key_enc text, p_ingest_url text)
returns uuid language plpgsql security definer set search_path = identity, pg_temp as $$
declare new_id uuid;
begin
  insert into identity.stream_keys (broadcast_id, key_enc, ingest_url) values (p_broadcast_id, p_key_enc, p_ingest_url) returning id into new_id;
  return new_id;
end $$;

create or replace function public.stream_key_read(p_broadcast_id uuid)
returns table (id uuid, key_enc text, ingest_url text, created_at timestamptz)
language sql security definer set search_path = identity, pg_temp as $$
  select id, key_enc, ingest_url, created_at from identity.stream_keys where broadcast_id = p_broadcast_id and rotated_at is null order by created_at desc limit 1;
$$;

-- Rotation after the show: the old key is overwritten, not kept.
create or replace function public.stream_key_rotate(p_broadcast_id uuid)
returns integer language plpgsql security definer set search_path = identity, pg_temp as $$
declare n integer;
begin
  update identity.stream_keys set key_enc = 'rotated', rotated_at = now() where broadcast_id = p_broadcast_id and rotated_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.youtube_connection_status(uuid)',
    'public.youtube_connection_upsert(uuid, text, text, text, text, timestamptz, text[], text, integer)',
    'public.youtube_connection_readiness(uuid, boolean, text)',
    'public.youtube_connection_refresh_failed(uuid, text)',
    'public.youtube_connection_disconnect(uuid)',
    'public.youtube_connection_secret(uuid)',
    'public.stream_key_store(uuid, text, text)',
    'public.stream_key_read(uuid)',
    'public.stream_key_rotate(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('identity.youtube_connections', 'access_token_enc', 'identity_credential', 'contract', 'until the artist disconnects or closes the account', false, true, 'encrypted; deleted on disconnect; never exported'),
  ('identity.youtube_connections', 'channel_id', 'personal', 'contract', 'until disconnect', true, true, null),
  ('identity.stream_keys', 'key_enc', 'identity_credential', 'contract', 'rotated after each show', false, true, 'never logged, never sent to a client'),
  ('broadcasts', 'youtube_video_id', 'public', 'contract', 'life of the show record', true, false, 'the public embed id')
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION (supabase/tests/phase3_access.sql) ─────────────────
-- V1. anon/authenticated/service_role: no USAGE on schema identity.
-- V2. authenticated cannot call youtube_connection_secret / stream_key_read.
-- V3. service_role can upsert, read status (no token columns), read secret, disconnect; after disconnect status returns no row and secret returns no row.
-- V4. an artist sees broadcasts for their own show only.
