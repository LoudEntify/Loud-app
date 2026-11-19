-- Loudentify Versus invitations and in-app notifications.
-- Run in the Supabase SQL Editor after docs/shows_setup.sql.
-- Idempotent: safe to run again.

begin;

create table if not exists public.show_slots (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  slot text not null,
  code text,
  claimed_by_email text,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  session_token text,
  session_token_issued_at timestamptz,
  invite_token uuid,
  invited_username text,
  invited_user_id uuid references auth.users(id) on delete set null,
  invite_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint show_slots_slot_check check (slot in ('a', 'b')),
  constraint show_slots_show_slot_unique unique (show_id, slot)
);

alter table public.show_slots
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claimed_by_email text,
  add column if not exists claimed_at timestamptz,
  add column if not exists session_token text,
  add column if not exists session_token_issued_at timestamptz,
  add column if not exists invite_token uuid,
  add column if not exists invited_username text,
  add column if not exists invited_user_id uuid references auth.users(id) on delete set null,
  add column if not exists invite_accepted_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists show_slots_show_slot_idx on public.show_slots (show_id, slot);
create unique index if not exists show_slots_invite_token_idx on public.show_slots (invite_token) where invite_token is not null;
create index if not exists show_slots_claimed_user_idx on public.show_slots (claimed_by_user_id);
create index if not exists show_slots_invited_user_idx on public.show_slots (invited_user_id);

alter table public.show_slots enable row level security;
-- Deliberately zero-policy: invitation and session tokens are only read or
-- written by authenticated server routes using the service role.
revoke all on public.show_slots from anon, authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('show_reminder', 'show_live', 'comment', 'follow', 'system')),
  body text not null,
  href text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
-- Non-partial on purpose: PostgREST upsert(onConflict) cannot target the
-- older partial index that only covered non-null dedupe keys.
create unique index if not exists notifications_user_dedupe_full_idx on public.notifications (user_id, dedupe_key);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated using (auth.uid() = user_id);
drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own on public.notifications for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.notifications to authenticated;

notify pgrst, 'reload schema';
commit;

-- Verification:
-- select to_regclass('public.show_slots'), to_regclass('public.notifications');
