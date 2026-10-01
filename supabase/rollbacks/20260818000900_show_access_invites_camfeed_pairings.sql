-- Rollback for 20260818000900_show_access_invites_camfeed_pairings.sql
alter table camfeed_pairings disable row level security;
drop table if exists camfeed_pairings;

drop index if exists show_slots_show_slot_idx;
drop index if exists show_slots_show_idx;
drop index if exists show_slots_invite_token_idx;
-- `code` was made nullable from a NOT NULL state this file could not
-- read back (it only knows the then-current state), so it is not
-- restored to NOT NULL here -- doing so blindly could fail against rows
-- with a null code written after this migration ran.
alter table show_slots drop column if exists invite_accepted_at;
alter table show_slots drop column if exists invited_username;
alter table show_slots drop column if exists invite_token;
