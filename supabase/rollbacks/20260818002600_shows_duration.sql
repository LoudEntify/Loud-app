-- Rollback for 20260818002600_shows_duration.sql
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shows_duration_sane') then
    alter table shows drop constraint shows_duration_sane;
  end if;
end $$;
alter table shows drop column if exists duration_minutes;
