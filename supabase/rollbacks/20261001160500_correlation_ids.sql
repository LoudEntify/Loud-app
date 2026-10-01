-- Rollback for 20261001160500_correlation_ids.sql
drop index if exists health_events_correlation_idx;
drop index if exists show_comments_correlation_idx;
drop index if exists reaction_events_correlation_idx;
drop index if exists wallet_transactions_correlation_idx;

alter table health_events       drop column if exists correlation_id;
alter table show_comments       drop column if exists correlation_id;
alter table reaction_events     drop column if exists correlation_id;
alter table wallet_transactions drop column if exists correlation_id;

notify pgrst, 'reload schema';
