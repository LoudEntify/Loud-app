-- profiles migration (Accounts & Identity, Day 1 -- auth foundation)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Three things in one file, all part of the same round:
--   1. profiles -- the new table backing real Supabase Auth accounts.
--   2. shot_commands -- formalized for the first time (no migration file
--      for it existed anywhere in docs/ before this; its schema only
--      lived as a comment in lib/shotCommands.js). `create table if not
--      exists` is a safe no-op against whatever the live table already
--      looks like -- this file only ADDS the RLS posture that was
--      missing, it never redefines existing columns.
--   3. health_events -- closes a real gap: its own migration file never
--      had an `enable row level security` line at all, unlike every
--      other table here. Zero policies, matching its existing
--      service-role-only usage -- pure hardening, no behavior change.

-- ─── 1. profiles ──────────────────────────────────────────────
-- id = auth.uid(), one row per Supabase Auth user. role is chosen at
-- signup and never changes via this round's UI. genre is artist-only
-- (null for viewers) -- not enforced by a CHECK because "genre required
-- iff role='artist'" is a signup-form concern, not a data-integrity one
-- worth a trigger for at this stage.
--
-- Deliberately holds NO email/PII column -- email lives only in
-- auth.users, which no public policy below ever touches. That's what
-- lets the public-read policy be a plain row filter instead of needing
-- a column-level view: every column on this table is already safe to
-- expose for an artist row.
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('artist', 'viewer')),
  display_name  text not null,
  genre         text,
  created_at    timestamptz not null default now()
);

alter table profiles enable row level security;

-- Owner can always see their own row, regardless of role -- this is
-- what makes a viewer's own profile visible to themselves even though
-- the public policy below never exposes it to anyone else.
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

-- Owner can create exactly one row, at their own id -- lib/supabaseAuth.js
-- inserts this directly from the browser right after signUp() succeeds,
-- authenticated as the new user, no service-role route needed.
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

-- Owner can edit only their own row.
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Public (anon or authed) read of artist rows only. Combines with
-- profiles_select_own via OR (two permissive policies on the same
-- command) -- an artist's own row is visible either way; a viewer's row
-- is visible ONLY to themselves, since it fails this filter.
create policy "profiles_select_public_artists" on profiles
  for select using (role = 'artist');

-- ─── 2. shot_commands (formalized, not new) ──────────────────
-- Exact schema as documented in lib/shotCommands.js's own header
-- comment, including the two columns added later per
-- SHOW_LIFECYCLE_SPEC.md (show_phase) and the L6 addendum
-- (available_roles) -- `if not exists` throughout so this is a no-op
-- against whatever the live table already has.
create table if not exists shot_commands (
  command_id      uuid primary key,
  show_id         text not null,
  slot            text not null,
  shot            text not null,
  from_shot       text,
  source_role     text,
  transition      text,
  params          jsonb default '{}'::jsonb,
  decision_source text not null,
  fired_at        timestamptz not null,
  created_at      timestamptz default now()
);

create index if not exists shot_commands_show_idx
  on shot_commands (show_id, fired_at);

alter table shot_commands add column if not exists show_phase text default 'live';
alter table shot_commands add column if not exists available_roles jsonb;

alter table shot_commands enable row level security;

-- Real behavior change, flagged clearly: previously this table was
-- "wide open to the anon key today" (MULTI_PERFORMER_SPEC.md) -- any
-- unauthenticated request could insert. This tightens it to "any signed-
-- in session" (artist OR viewer -- lib/shotCommands.js's writer runs
-- from the performer's own client only in practice, but this policy
-- doesn't special-case that; scoping it to artist-only specifically is
-- a reasonable future refinement, not done here to avoid over-scoping
-- this round). No read policy -- nothing in the app reads this table
-- back through the anon client.
create policy "shot_commands_insert_authenticated" on shot_commands
  for insert to authenticated with check (true);

-- ─── 3. health_events (RLS-enable gap closed) ────────────────
-- The only table whose migration file never had this line at all.
-- Zero policies, matching every other service-role-only table here --
-- pure hardening, nothing currently reads/writes this except the admin
-- client in app/api/health-events/route.js.
alter table health_events enable row level security;
