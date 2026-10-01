-- Rollback for 20260818002800_mvp2_backing_tracks.sql
drop policy if exists backing_tracks_delete_own on backing_tracks;
drop policy if exists backing_tracks_update_own on backing_tracks;
drop policy if exists backing_tracks_insert_own on backing_tracks;
drop policy if exists backing_tracks_select_own on backing_tracks;
drop index if exists backing_tracks_artist_idx;
drop index if exists backing_tracks_artist_sha_idx;
drop table if exists backing_tracks;
