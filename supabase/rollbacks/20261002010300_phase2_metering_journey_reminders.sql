-- Rollback for 20261002010300_phase2_metering_journey_reminders.sql
delete from schema_data_classification where table_name in ('metering_events', 'journey_events', 'show_reminders');
drop table if exists show_reminders;
drop table if exists journey_events;
drop table if exists metering_events;
notify pgrst, 'reload schema';
