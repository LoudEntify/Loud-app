-- Rollback for 20260801000000_genesis_shows_show_slots_participants.sql
--
-- Reverse dependency order: participants and show_slots both FK-reference
-- shows, so they go first. CASCADE on shows is a safety net, not an
-- expectation — by the time this rollback runs, every migration that
-- extended shows/show_slots/participants should already have had its own
-- rollback run first, so there should be nothing left depending on them.

drop table if exists participants;
drop table if exists show_slots;
drop table if exists shows cascade;

notify pgrst, 'reload schema';
