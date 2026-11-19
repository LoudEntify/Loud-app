-- Artist-owned YouTube Live connection and broadcast state.
-- Server-only tables: OAuth refresh tokens and ingestion state must never
-- be readable through the browser client. Safe to re-run.

begin;

create table if not exists public.youtube_connections (
  artist_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text not null,
  refresh_token_ciphertext text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.youtube_oauth_states (
  state_hash text primary key,
  artist_id uuid not null references auth.users(id) on delete cascade,
  pkce_verifier_ciphertext text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists youtube_oauth_states_expiry_idx on public.youtube_oauth_states (expires_at);

alter table public.youtube_connections add column if not exists last_verified_at timestamptz;
alter table public.youtube_oauth_states add column if not exists pkce_verifier_ciphertext text;

create table if not exists public.youtube_broadcasts (
  show_id uuid primary key references public.shows(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  youtube_broadcast_id text,
  youtube_stream_id text,
  livekit_egress_id text,
  watch_url text,
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  stopped_at timestamptz,
  last_error text,
  constraint youtube_broadcasts_state_check check (state in ('pending','prepared','starting','live','stopping','complete','failed'))
);
create unique index if not exists youtube_broadcasts_broadcast_id_idx on public.youtube_broadcasts (youtube_broadcast_id) where youtube_broadcast_id is not null;
create unique index if not exists youtube_broadcasts_stream_id_idx on public.youtube_broadcasts (youtube_stream_id) where youtube_stream_id is not null;

alter table public.youtube_connections enable row level security;
alter table public.youtube_oauth_states enable row level security;
alter table public.youtube_broadcasts enable row level security;

-- Zero browser policies and explicit revocation. Every operation goes
-- through an authenticated server route using the service role.
revoke all on public.youtube_connections from anon, authenticated;
revoke all on public.youtube_oauth_states from anon, authenticated;
revoke all on public.youtube_broadcasts from anon, authenticated;

notify pgrst, 'reload schema';
commit;
