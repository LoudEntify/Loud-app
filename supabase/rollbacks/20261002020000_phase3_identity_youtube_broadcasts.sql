-- Rollback for 20261002020000_phase3_identity_youtube_broadcasts.sql
-- Refuses if any live connection exists: dropping tokens silently would
-- strand artists mid-onboarding. Disconnect them first.
do $$
begin
  if exists (select 1 from identity.youtube_connections where disconnected_at is null) then
    raise exception 'identity.youtube_connections has live connections; disconnect them before rolling back';
  end if;
end $$;
delete from schema_data_classification where table_name in ('identity.youtube_connections', 'identity.stream_keys', 'broadcasts');
drop function if exists public.stream_key_rotate(uuid);
drop function if exists public.stream_key_read(uuid);
drop function if exists public.stream_key_store(uuid, text, text);
drop function if exists public.youtube_connection_secret(uuid);
drop function if exists public.youtube_connection_disconnect(uuid);
drop function if exists public.youtube_connection_refresh_failed(uuid, text);
drop function if exists public.youtube_connection_readiness(uuid, boolean, text);
drop function if exists public.youtube_connection_upsert(uuid, text, text, text, text, timestamptz, text[], text, integer);
drop function if exists public.youtube_connection_status(uuid);
alter table shows drop column if exists measured_delay_seconds;
alter table shows drop column if exists delivery_state;
drop table if exists broadcasts;
drop table if exists identity.stream_keys;
drop table if exists identity.youtube_connections;
drop schema if exists identity;
notify pgrst, 'reload schema';
