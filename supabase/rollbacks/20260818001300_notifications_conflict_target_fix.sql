-- Rollback for 20260818001300_notifications_conflict_target_fix.sql
-- Restores the ORIGINAL partial index this file replaced. Note this
-- restores the known-bad shape (partial, unusable as an ON CONFLICT
-- target) -- that is what "rollback" means here, not "the better fix".
drop index if exists notifications_dedupe_idx;
create unique index if not exists notifications_dedupe_idx
  on notifications (user_id, dedupe_key) where dedupe_key is not null;
