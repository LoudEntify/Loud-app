-- GENESIS: shows, show_slots, participants.
--
-- These three tables were never captured as a migration file anywhere —
-- not in docs/, not in the original supabase/migrations/ restructure. They
-- only exist as hand-run SQL inside two root-level spec documents:
--
--   SHOW_LIFECYCLE_SPEC.md §2  -- shows + its original three policies
--   MULTI_PERFORMER_SPEC.md §1 -- show_slots, participants, and the
--                                  shows.active_performer_slot column
--
-- Every later migration (starting at 20260818000100) ALTERs one or more of
-- these three tables and silently assumes they already exist. Applied to a
-- genuinely empty database, the whole restructured history fails on its
-- first ALTER TABLE shows. This file is that missing foundation, copied
-- verbatim from the two spec docs (not redesigned), timestamped before
-- everything else because that is when it was actually run.
--
-- `participants` is flagged separately in docs/REPO_AUDIT.md: it is this
-- codebase's only table holding raw email PII, and it was exactly as
-- uncaptured as the other two.

-- ─── shows ──────────────────────────────────────────────────────
create table if not exists shows (
  id                     uuid primary key default gen_random_uuid(),
  room_name              text not null unique,
  artist_name            text not null,
  slot                   text not null default 'a',
  slated_at              timestamptz not null,
  state                  text not null default 'scheduled',
  created_at             timestamptz default now(),
  active_performer_slot  text not null default 'a' -- MULTI_PERFORMER_SPEC.md §1
);

alter table shows enable row level security;

-- Original, wide-open policies exactly as SHOW_LIFECYCLE_SPEC.md's own
-- "pilot-honesty note" names them. `update_shows` and `insert_shows` are
-- later tightened by 20260818000500_ownership_columns.sql (drop + recreate
-- with an owner check) — leave them wide here, that is the real history.
-- `read_shows` is never touched by any later file; shows are public by
-- design (Discover needs to read them with no account), so this stays.
create policy "read_shows" on shows
  for select using (true);

create policy "update_shows" on shows
  for update using (true) with check (true);

create policy "insert_shows" on shows
  for insert with check (true);

-- ─── show_slots ─────────────────────────────────────────────────
-- `code` and `session_token` are the whole secret-code pairing mechanism a
-- performer uses to claim a slot without an account. MULTI_PERFORMER_SPEC.md
-- is explicit that this table must have ZERO anon-key access to any column,
-- read or write — not "mostly closed", fully closed. Only
-- lib/supabaseAdmin.js (service role) may touch it.
create table if not exists show_slots (
  show_id                  uuid not null references shows(id),
  slot                     text not null,
  code                     text not null,
  claimed_by_email         text,
  claimed_at               timestamptz,
  session_token            text,
  session_token_issued_at  timestamptz,
  primary key (show_id, slot)
);

alter table show_slots enable row level security;
-- No policies. That absence is the control, not an oversight.

-- ─── participants ───────────────────────────────────────────────
-- The entry-gate email capture. Same posture as show_slots: no policies at
-- all, because this is the app's first (and still only) table storing a
-- raw email address, and only app/api/participants and
-- app/api/account/export (both service-role) may ever touch it.
create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id),
  email       text not null,
  role        text not null,
  slot        text,
  consent     boolean not null default false,
  created_at  timestamptz default now()
);

alter table participants enable row level security;
-- No policies. Same reasoning as show_slots.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. All three tables exist with RLS on:
--     select relname, relrowsecurity from pg_class
--      where relname in ('shows','show_slots','participants');
--     -- EXPECT 3 rows, relrowsecurity = true on all three.
--
-- V2. shows has exactly its three original policies:
--     select policyname, cmd from pg_policies where tablename = 'shows' order by policyname;
--     -- EXPECT: insert_shows|INSERT, read_shows|SELECT, update_shows|UPDATE
--
-- V3. show_slots and participants have zero policies:
--     select tablename, count(*) from pg_policies
--      where tablename in ('show_slots','participants') group by tablename;
--     -- EXPECT: no rows (zero policies on either, confirmed by absence).
--
-- V4. A fresh anon-key client cannot read show_slots or participants at all:
--     -- (run from a non-service-role session)
--     select * from show_slots limit 1;    -- EXPECT: empty result, not an error (RLS denies silently)
--     select * from participants limit 1;  -- EXPECT: same.
