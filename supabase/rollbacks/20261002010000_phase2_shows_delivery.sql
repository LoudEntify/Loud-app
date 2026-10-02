-- Rollback for 20261002010000_phase2_shows_delivery.sql
alter table shows drop column if exists is_synthetic;
alter table shows drop column if exists visibility;
alter table shows drop column if exists cover_url;
alter table shows drop column if exists description;
alter table shows drop column if exists genre;
alter table shows drop column if exists artist_b_id;
alter table shows drop column if exists versus_view;
alter table shows drop column if exists youtube_broadcast_id;
alter table shows drop column if exists youtube_video_id;
alter table shows drop column if exists delivery;
notify pgrst, 'reload schema';
