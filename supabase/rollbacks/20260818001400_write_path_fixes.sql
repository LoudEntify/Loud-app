-- Rollback for 20260818001400_write_path_fixes.sql
-- Both changes in the forward file relax a NOT NULL to nullable. Neither
-- is safely reversible by this rollback alone: restoring NOT NULL would
-- fail if any row written after the forward migration ran has a null
-- value in that column (exactly the case the forward migration exists to
-- allow -- a show with no artist_name, a pairing with no show_id). This
-- rollback is therefore a documented no-op rather than a blind ALTER that
-- could fail or silently corrupt data.
--
-- To actually revert: confirm no row has shows.artist_name IS NULL or
-- camfeed_pairings.show_id IS NULL, then run by hand:
--   alter table shows alter column artist_name set not null;
--   alter table camfeed_pairings alter column show_id set not null;

-- The broll_clips policy drops ARE reversible -- restoring owner-write
-- policies this migration deliberately removed in favour of service-role
-- writes:
create policy "broll_insert_own" on broll_clips
  for insert with check (auth.uid() = artist_id);
create policy "broll_update_own" on broll_clips
  for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "broll_delete_own" on broll_clips
  for delete using (auth.uid() = artist_id);
