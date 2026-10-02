-- Phase 5: messages sent from the website's contact form.
--
-- The form is public (no account). Rows are written by the server with
-- the service role after a rate-limit check; nobody reads them through
-- the Data API: RLS on, zero policies, and the only readers are
-- operators with database access until there is an inbox screen.
-- No grants to anon/authenticated are made, and the default privileges
-- in the stub mirror Supabase's (none on new tables), so the SQL test
-- below asserts both roles are refused.

create table if not exists site_messages (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  topic         text not null check (topic in ('general', 'artist_support', 'payments', 'press', 'report')),
  name          text not null check (char_length(name) between 1 and 120),
  email         text not null check (char_length(email) between 3 and 254),
  message       text not null check (char_length(message) between 1 and 4000),
  -- Where it came from, for follow-up and abuse handling. Never the IP in
  -- clear: a salted hash, the same one lib/rateLimit.js keys on.
  client_hash   text,
  user_id       uuid references auth.users(id) on delete set null,
  correlation_id uuid,
  handled_at    timestamptz,
  handled_note  text
);

create index if not exists site_messages_received_idx on site_messages (received_at desc);
create index if not exists site_messages_unhandled_idx on site_messages (received_at) where handled_at is null;

alter table site_messages enable row level security;
revoke all on site_messages from anon, authenticated;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. as anon:  insert into site_messages (topic, name, email, message) values ('general','a','a@b.c','hi');
--     EXPECT: permission denied for table site_messages
-- V2. as authenticated: select * from site_messages;  EXPECT: permission denied
-- V3. as service_role: the insert works and the row has received_at set.
