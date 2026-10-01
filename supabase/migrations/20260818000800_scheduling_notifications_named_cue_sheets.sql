-- scheduling + notifications + named cue sheets (overnight product round)
-- Run manually in the Supabase SQL editor. Idempotent -- safe to re-run.
--
-- The app degrades gracefully without this: scheduling and the
-- notification centre show empty states rather than erroring, and Kit
-- Check works entirely without it (Kit Check touches no database at all).

-- ─── 1. shows: the columns scheduling needs ───────────────────
-- title: what the artist calls this show. Nullable -- an untitled show
--   is a real thing and should not block scheduling.
-- performance_mode: 'solo' | 'versus'. Defaulted to 'solo' because that
--   is the single-artist case and the one that needs no coordination.
-- ends_at: the close of the broadcast window. Everything about Kit Check
--   depends on knowing when the window SHUTS, not just when it opens.
alter table shows add column if not exists title            text;
alter table shows add column if not exists performance_mode text
  not null default 'solo' check (performance_mode in ('solo', 'versus'));
alter table shows add column if not exists ends_at          timestamptz;

create index if not exists shows_artist_slated_idx on shows (artist_id, slated_at desc);

-- ─── 2. notifications ─────────────────────────────────────────
-- One row per thing a user should know about. `kind` drives the icon in
-- components/Notifications.jsx.
--
-- dedupe_key is the important column: show reminders are generated
-- lazily (see DECISIONS.md -- there is no cron in this stack), so the
-- SAME reminder can be computed many times as the artist reloads. A
-- unique index on it makes re-inserting a no-op instead of spamming the
-- feed.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('show_reminder','show_live','comment','follow','system')),
  body        text not null,
  href        text,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
create unique index if not exists notifications_dedupe_idx
  on notifications (user_id, dedupe_key) where dedupe_key is not null;

alter table notifications enable row level security;

-- A user reads and manages only their own notifications. Insert is
-- allowed for the owner because reminders are generated client-side by
-- the owner's own session -- there is no server job to do it.
create policy "notifications_select_own" on notifications
  for select using (auth.uid() = user_id);
create policy "notifications_insert_own" on notifications
  for insert with check (auth.uid() = user_id);
create policy "notifications_update_own" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications_delete_own" on notifications
  for delete using (auth.uid() = user_id);

-- ─── 3. named cue sheets ──────────────────────────────────────
-- The schema already keys sheets on (track_hash, artist_email). A name
-- makes them a reusable LIBRARY rather than one-sheet-per-track: an
-- artist can keep several treatments of the same song and pick one.
alter table cue_sheets add column if not exists name text;

-- The old unique index allowed exactly one sheet per (track, artist),
-- which is precisely what a named library must not have. Replaced with a
-- three-part key so several NAMED sheets can coexist for one track.
-- Existing rows get 'Default' so they keep working and stay selectable.
update cue_sheets set name = 'Default' where name is null;

drop index if exists cue_sheets_track_artist_idx;
create unique index if not exists cue_sheets_track_artist_name_idx
  on cue_sheets (track_hash, artist_email, name);

-- ─── 4. reload PostgREST's schema cache ───────────────────────
notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. shows columns:
--    select column_name, data_type, column_default
--      from information_schema.columns
--     where table_name='shows' and column_name in ('title','performance_mode','ends_at')
--     order by column_name;
--    -- expect 3 rows; performance_mode default ''solo''::text.
--
-- 2. notifications table + policies:
--    select count(*) from information_schema.tables where table_name='notifications';
--    -- expect 1
--    select policyname from pg_policies where tablename='notifications' order by policyname;
--    -- expect 4: delete_own, insert_own, select_own, update_own
--
-- 3. dedupe index really dedupes (should ERROR on the second insert):
--    begin;
--      insert into notifications (user_id, kind, body, dedupe_key)
--        select id, 'system', 'probe', 'zz-probe' from auth.users limit 1;
--      insert into notifications (user_id, kind, body, dedupe_key)
--        select id, 'system', 'probe again', 'zz-probe' from auth.users limit 1;
--    rollback;
--    -- expect: duplicate key value violates unique constraint
--
-- 4. named cue sheets:
--    select indexname from pg_indexes
--     where tablename='cue_sheets' and indexname like 'cue_sheets_track_artist%';
--    -- expect ONLY cue_sheets_track_artist_name_idx (the 2-part one is dropped)
--    select count(*) from cue_sheets where name is null;
--    -- expect 0
--
-- 5. round-trip from the app: schedule a show on the preview, then:
--    select title, performance_mode, slated_at, state from shows
--     order by slated_at desc limit 1;
--    -- expect your values, state='scheduled'.
