-- Rollback for 20260818003300_mvp3_notifications_versus_invite.sql
-- Restores the narrower (pre-versus_invite) kind set. Will fail loudly,
-- as it should, if any row already has kind = 'versus_invite' -- that is
-- the correct behaviour (see the forward file's own superset argument
-- run in reverse) rather than silently orphaning those rows.
begin;

alter table notifications
  drop constraint if exists notifications_kind_check;

alter table notifications
  add constraint notifications_kind_check
  check (kind in ('show_reminder','show_live','comment','follow','system'));

commit;
