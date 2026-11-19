-- Server-authoritative, latency-aware Loudentify interaction identity.
-- Safe to re-run after pilot2_06 and pilot2_07.
begin;

alter table public.show_prompts add column if not exists opens_at timestamptz;
alter table public.show_prompts add column if not exists closes_at timestamptz;
alter table public.show_prompts add column if not exists latency_allowance_ms integer not null default 30000;
update public.show_prompts set opens_at = coalesce(opens_at, pushed_at, created_at) where opens_at is null;
update public.show_prompts set closes_at = closed_at where closes_at is null and closed_at is not null;

create table if not exists public.interaction_sessions (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  token_hash text not null unique,
  fingerprint_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists interaction_sessions_show_idx on public.interaction_sessions(show_id, expires_at);

alter table public.prompt_responses add column if not exists interaction_session_id uuid references public.interaction_sessions(id) on delete set null;
alter table public.prompt_responses add column if not exists voter_key text;
alter table public.prompt_responses add column if not exists estimated_latency_ms integer;
alter table public.prompt_responses add column if not exists playback_position_ms bigint;
alter table public.prompt_responses add column if not exists received_at timestamptz not null default now();
drop index if exists public.prompt_responses_prompt_voter_idx;
create unique index prompt_responses_prompt_voter_idx on public.prompt_responses(prompt_id, voter_key);

create table if not exists public.interaction_audit_events (
  id bigint generated always as identity primary key,
  show_id uuid not null references public.shows(id) on delete cascade,
  prompt_id uuid references public.show_prompts(id) on delete set null,
  interaction_session_id uuid references public.interaction_sessions(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
alter table public.interaction_audit_events add column if not exists actor_id uuid references auth.users(id) on delete set null;
create index if not exists interaction_audit_show_idx on public.interaction_audit_events(show_id, occurred_at, id);

alter table public.interaction_sessions enable row level security;
alter table public.interaction_audit_events enable row level security;
revoke all on public.interaction_sessions from anon, authenticated;
revoke all on public.interaction_audit_events from anon, authenticated;
notify pgrst, 'reload schema';
commit;
