-- ⚠️  DESTRUCTIVE — DELETES EVERY ACCOUNT ON THE APP  ⚠️
--
-- Run manually in the Supabase SQL editor. There is no undo. Read the
-- whole file before running any of it.
--
-- WHAT THIS DELETES
--   Every row in auth.users, and everything that cascades from it:
--     profiles            (on delete cascade)
--     recordings          (on delete cascade)   ← the DB rows, not the files
--     broll_clips         (on delete cascade)   ← the DB rows, not the files
--     notifications       (on delete cascade)
--     wallet_transactions (on delete cascade)
--
-- WHAT THIS DOES NOT DELETE
--   * Files in Storage. Deleting a database row does not delete the
--     object it points at. Recordings, B-roll and avatars will still be
--     sitting in the bucket, now orphaned. See step 4.
--   * LiveKit egress. Egress is NOT a Supabase account and has no row in
--     auth.users. Its LiveKit identity is minted by LiveKit's own egress
--     service, and its only Supabase touch is the ANONYMOUS client
--     reading a `shows` row (components/EgressPage.jsx). The S3
--     credentials it writes recordings with are Storage keys in project
--     settings, not user rows. Nothing here affects its ability to
--     record.
--
-- ⚠️ BUT NOTE WHAT EGRESS PRODUCED ⚠️
--   Recording ROWS are owned by an artist -- app/api/recordings/sync
--   stamps them with `artist_id = auth.uid()`, and that column cascades.
--   So deleting every account deletes every recording row, including
--   from shows egress recorded, while the MP4 files themselves remain in
--   the bucket with nothing describing them. Same for broll_clips.
--
--   To keep them: note the storage paths first (step 0 below), then
--   re-run "Sync recordings" from the dashboard once you have a fresh
--   account -- that route scans the bucket and re-creates rows. Verify
--   that works for your files BEFORE committing step 3 if those
--   recordings matter.
--
--   * shows / show_slots / cue_sheets rows. Those reference auth.users
--     WITHOUT `on delete cascade`, so they would BLOCK the delete
--     outright. Step 2 detaches them; step 5 clears them if you want a
--     true clean slate.
--
-- ─── STEP 0: inventory what you are about to orphan ───────────
-- select r.id, r.title, r.storage_path, r.recorded_at, r.visibility
--   from recordings r order by r.recorded_at desc;
-- -- Save this output somewhere. After step 3 these rows are gone and
-- -- storage_path is the only way back to the files.

-- ─── STEP 1: look before you leap ─────────────────────────────
-- Run this FIRST, on its own. It changes nothing.
select
  (select count(*) from auth.users)          as users,
  (select count(*) from profiles)            as profiles,
  (select count(*) from recordings)          as recordings,
  (select count(*) from broll_clips)         as broll_clips,
  (select count(*) from shows)               as shows,
  (select count(*) from cue_sheets)          as cue_sheets;

-- ─── STEPS 2+3: detach, then delete — ONE atomic block ────────
--
-- HOW TO RUN THIS:
--   1. Select this whole block and run it AS IS. It ends in `rollback`,
--      so nothing is saved -- you just get to see the count.
--   2. Check `users_remaining` reads 0.
--   3. Change the LAST LINE from `rollback;` to `commit;`.
--   4. Run the whole block again. Now it persists.
--
-- Steps 2 and 3 are deliberately inside ONE transaction. The three
-- UPDATEs below have to happen first -- shows.artist_id,
-- show_slots.claimed_by_user_id and cue_sheets.artist_id reference
-- auth.users with no cascade rule, so the delete fails with a
-- foreign-key violation without them -- but if they sat outside the
-- transaction they would commit on the dry run, detaching ownership
-- from your shows even though you had not deleted anything yet. A dry
-- run that changes data is not a dry run.
begin;

  update shows      set artist_id          = null where artist_id          is not null;
  update show_slots set claimed_by_user_id = null where claimed_by_user_id is not null;
  update cue_sheets set artist_id          = null where artist_id          is not null;

  delete from auth.users;

  -- Should read 0. If it does not, something re-created a row mid-run.
  select count(*) as users_remaining from auth.users;

-- ⚠️ CHANGE THIS TO `commit;` ONCE THE COUNT ABOVE READS 0 ⚠️
rollback;

-- ─── STEP 4: orphaned storage objects ─────────────────────────
-- Run AFTER committing step 3. These are the files whose owning rows are
-- now gone. Look first:
--
--   select bucket_id, name, (metadata->>'size')::bigint as bytes
--     from storage.objects
--    where bucket_id = 'recordings'
--    order by created_at desc;
--
--   select distinct bucket_id from storage.objects;
--
-- ⚠️ DELETING FILES IS NOT A SQL JOB. Storage has a `protect_delete`
-- trigger, so `delete from storage.objects` is REJECTED -- confirmed the
-- hard way. Remove files from the Storage section of the Supabase
-- dashboard, or via the storage API / CLI. Never from the SQL editor.

-- ─── STEP 5: OPTIONAL true clean slate ────────────────────────
-- Step 2 left shows/slots/cue_sheets in place with null owners. That is
-- strictly what "delete the accounts" means — but those rows are now
-- ownerless and will still appear in Discover. If you want them gone
-- too, run this AFTER step 3 is committed:
--
--   -- ORDER MATTERS: participants references shows, so participants
--   -- must go first or the shows delete fails on a foreign key.
--   delete from cue_sheets;
--   delete from show_slots;
--   delete from participants;
--   delete from health_events;
--   delete from shows;

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. Everything is empty:
--    select
--      (select count(*) from auth.users)          as users,
--      (select count(*) from profiles)            as profiles,
--      (select count(*) from recordings)          as recordings,
--      (select count(*) from broll_clips)         as broll_clips,
--      (select count(*) from notifications)       as notifications,
--      (select count(*) from wallet_transactions) as wallet_tx;
--    -- expect 0 across the board.
--
-- 2. No orphaned owner references left behind:
--    select
--      (select count(*) from shows      where artist_id          is not null) as shows_owned,
--      (select count(*) from show_slots where claimed_by_user_id is not null) as slots_claimed,
--      (select count(*) from cue_sheets where artist_id          is not null) as sheets_owned;
--    -- expect 0, 0, 0.
--
-- 3. In the browser: you will still appear logged in until the local
--    session token is cleared, because the token is cached client-side
--    and does not know its user was deleted. Use the new LOG OUT button
--    on /profile (or /artist), or hard-refresh after clearing site data.
--    Signing up again with the same email now works, because the old
--    auth.users row is gone.
