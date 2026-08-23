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
--   * shows / show_slots / cue_sheets rows. Those reference auth.users
--     WITHOUT `on delete cascade`, so they would BLOCK the delete
--     outright. Step 2 detaches them; step 5 clears them if you want a
--     true clean slate.

-- ─── STEP 1: look before you leap ─────────────────────────────
-- Run this FIRST, on its own. It changes nothing.
select
  (select count(*) from auth.users)          as users,
  (select count(*) from profiles)            as profiles,
  (select count(*) from recordings)          as recordings,
  (select count(*) from broll_clips)         as broll_clips,
  (select count(*) from shows)               as shows,
  (select count(*) from cue_sheets)          as cue_sheets;

-- ─── STEP 2: detach the three non-cascading references ────────
-- shows.artist_id, show_slots.claimed_by_user_id and cue_sheets.artist_id
-- reference auth.users with no cascade rule, so the delete in step 3
-- fails with a foreign-key violation unless these are cleared first.
update shows          set artist_id          = null where artist_id          is not null;
update show_slots     set claimed_by_user_id = null where claimed_by_user_id is not null;
update cue_sheets     set artist_id          = null where artist_id          is not null;

-- ─── STEP 3: delete every account ─────────────────────────────
-- Wrapped in a transaction so you can inspect the count and ROLLBACK if
-- it looks wrong. Change `rollback` to `commit` when you are sure.
begin;

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
-- Then, if you want them gone (this is also irreversible):
--
--   delete from storage.objects where bucket_id = 'recordings';
--
-- Avatars live under their own prefix/bucket depending on how you set it
-- up — check `select distinct bucket_id from storage.objects;` first.

-- ─── STEP 5: OPTIONAL true clean slate ────────────────────────
-- Step 2 left shows/slots/cue_sheets in place with null owners. That is
-- strictly what "delete the accounts" means — but those rows are now
-- ownerless and will still appear in Discover. If you want them gone
-- too, run this AFTER step 3 is committed:
--
--   delete from cue_sheets;
--   delete from show_slots;
--   delete from shows;
--   delete from health_events;
--   delete from participants;

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
