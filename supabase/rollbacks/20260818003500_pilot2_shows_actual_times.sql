-- Rollback for 20260818003500_pilot2_shows_actual_times.sql
drop index if exists shows_actual_started_idx;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shows_ended_by_check') then
    alter table shows drop constraint shows_ended_by_check;
  end if;
end $$;
alter table shows drop column if exists ended_by;
alter table shows drop column if exists actual_ended_at;
alter table shows drop column if exists actual_started_at;
