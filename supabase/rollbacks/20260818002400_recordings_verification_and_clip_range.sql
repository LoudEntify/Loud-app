-- Rollback for 20260818002400_recordings_verification_and_clip_range.sql
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'recordings_clip_range_sane') then
    alter table recordings drop constraint recordings_clip_range_sane;
  end if;
end $$;
alter table recordings drop column if exists clip_end_ms;
alter table recordings drop column if exists clip_start_ms;

drop index if exists recordings_unverified_idx;
drop index if exists recordings_egress_idx;
alter table recordings drop column if exists ended_reason;
alter table recordings drop column if exists verification;
alter table recordings drop column if exists verified_at;
alter table recordings drop column if exists has_video;
alter table recordings drop column if exists size_bytes;
alter table recordings drop column if exists duration_ms;
