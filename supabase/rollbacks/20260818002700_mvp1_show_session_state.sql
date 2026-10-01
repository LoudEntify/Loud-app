-- Rollback for 20260818002700_mvp1_show_session_state.sql
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'show_session_state'
  ) then
    alter publication supabase_realtime drop table show_session_state;
  end if;
end
$$;

drop policy if exists show_session_state_delete_own on show_session_state;
drop policy if exists show_session_state_update_own on show_session_state;
drop policy if exists show_session_state_insert_own on show_session_state;
drop policy if exists show_session_state_select_own on show_session_state;

drop trigger if exists show_session_state_touch_trg on show_session_state;
drop function if exists show_session_state_touch();

drop index if exists show_session_state_show_artist_idx;
drop table if exists show_session_state;
