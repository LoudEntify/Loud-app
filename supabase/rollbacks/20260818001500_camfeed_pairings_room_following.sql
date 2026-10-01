-- Rollback for 20260818001500_camfeed_pairings_room_following.sql
drop index if exists camfeed_pairings_device_idx;
drop index if exists camfeed_pairings_owner_live_idx;

alter table camfeed_pairings drop column if exists last_seen_at;
alter table camfeed_pairings drop column if exists revoked_at;
alter table camfeed_pairings drop column if exists device_identity;
alter table camfeed_pairings drop column if exists device_secret_hash;
alter table camfeed_pairings drop column if exists generation;
alter table camfeed_pairings drop column if exists target_room;
alter table camfeed_pairings drop column if exists context;
alter table camfeed_pairings drop column if exists role;
