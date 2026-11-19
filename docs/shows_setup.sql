-- Loudentify show scheduling foundation.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- This project may not have the legacy `shows` table, so this migration
-- creates the complete base table instead of assuming an earlier pilot.

begin;

create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references auth.users(id) on delete cascade,
  artist_name text,
  room_name text not null unique,
  title text,
  slated_at timestamptz not null,
  duration_minutes integer not null default 60,
  ends_at timestamptz,
  performance_mode text not null default 'solo',
  state text not null default 'scheduled',
  active_performer_slot text not null default 'A',
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  ended_by text,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  constraint shows_duration_sane check (duration_minutes between 15 and 180),
  constraint shows_performance_mode_check check (performance_mode in ('solo', 'versus')),
  constraint shows_state_check check (state in ('scheduled', 'soundcheck', 'ended')),
  constraint shows_active_slot_check check (active_performer_slot in ('A', 'B')),
  constraint shows_ended_by_check check (ended_by is null or ended_by in ('artist', 'window_sweep', 'webhook'))
);

-- Bring an older installation up to the same shape without removing data.
alter table public.shows
  add column if not exists artist_id uuid references auth.users(id) on delete cascade,
  add column if not exists artist_name text,
  add column if not exists title text,
  add column if not exists duration_minutes integer not null default 60,
  add column if not exists ends_at timestamptz,
  add column if not exists performance_mode text not null default 'solo',
  add column if not exists active_performer_slot text not null default 'A',
  add column if not exists actual_started_at timestamptz,
  add column if not exists actual_ended_at timestamptz,
  add column if not exists ended_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists shows_room_name_key on public.shows (room_name);
create index if not exists shows_artist_slated_idx on public.shows (artist_id, slated_at desc);
create index if not exists shows_state_slated_idx on public.shows (state, slated_at);

alter table public.shows enable row level security;

-- Show cards and audience holding screens are public. Only the owning
-- authenticated artist can create or change the broadcast lifecycle.
drop policy if exists shows_select_public on public.shows;
create policy shows_select_public on public.shows for select using (true);

drop policy if exists shows_insert_own on public.shows;
create policy shows_insert_own on public.shows
  for insert to authenticated with check (auth.uid() = artist_id);

drop policy if exists shows_update_own on public.shows;
create policy shows_update_own on public.shows
  for update to authenticated
  using (auth.uid() = artist_id)
  with check (auth.uid() = artist_id);

drop policy if exists shows_delete_own on public.shows;
create policy shows_delete_own on public.shows
  for delete to authenticated using (auth.uid() = artist_id);

grant select on public.shows to anon, authenticated;
grant insert, update, delete on public.shows to authenticated;

notify pgrst, 'reload schema';
commit;

-- Verification:
-- select id, title, artist_id, slated_at, state from public.shows order by created_at desc;
