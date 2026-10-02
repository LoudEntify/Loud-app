-- Rollback for 20261002010200_phase2_support_events.sql
-- Refuses if any support has been recorded: support_events mirrors ledger
-- pairs and dropping it would orphan money history.
do $$
begin
  if (select count(*) from support_events) > 0 then
    raise exception 'support_events has rows; refusing to drop a money table. Reverse entries instead.';
  end if;
end $$;
delete from schema_data_classification where table_name = 'support_events'
   or (table_name = 'profiles' and column_name in ('spending_limit_daily_tokens'));
alter table consent_records drop column if exists document_version;
alter table profiles drop column if exists spending_limit_daily_tokens;
drop table if exists support_events;
notify pgrst, 'reload schema';
