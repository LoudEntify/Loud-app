-- Rollback for 20260818002100_payment_intents.sql
drop policy if exists "payment_intents_select_own" on payment_intents;
drop index if exists payment_intents_user_idx;
drop index if exists payment_intents_provider_ref_idx;
drop table if exists payment_intents;
