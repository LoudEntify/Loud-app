-- docs/waitlist_migration.sql
-- ─────────────────────────────────────────────────────────────
-- Pre-launch waitlist capture.
--
-- SECURITY MODEL (same as health_events / show_slots):
--   RLS is ENABLED and there are ZERO policies. That means NO anon or
--   authenticated key can read, insert, update or delete a single row.
--   The ONLY way in is the service-role client (lib/supabaseAdmin.js),
--   used server-side by app/api/waitlist/route.js after it has validated
--   and rate-limited the request. Personal details (name, email, city)
--   are therefore unreadable by anything the browser holds -- even if the
--   public site were fully compromised, the anon key cannot select a name
--   or an email out of this table.
--
--   The public artist counter does NOT read this table with the anon key
--   either. app/api/waitlist/count returns a single integer, computed
--   server-side with the service role. No column of personal data ever
--   crosses to the client.
--
-- PRD S&I: Database, Auth, Rate limiting
-- ─────────────────────────────────────────────────────────────

create table if not exists public.waitlist_signups (
  id               uuid primary key default gen_random_uuid(),
  role             text not null check (role in ('artist', 'viewer')),
  email            text not null,
  name             text not null,
  city             text,            -- artists only; null for viewers
  genre            text,            -- artists only; null for viewers
  consent          boolean not null default false check (consent = true),
  consent_version  text not null,
  consent_at       timestamptz not null default now(),
  source           text not null default 'landing',
  created_at       timestamptz not null default now()
);

-- One person may appear once per role (so the same email can be both an
-- artist and a viewer, but not two artist rows). A repeat submission is
-- absorbed by the route as an idempotent success, never a duplicate row
-- and never an error that would reveal whether the email is already in.
create unique index if not exists waitlist_signups_email_role_uidx
  on public.waitlist_signups (lower(email), role);

-- Fast count for the public artist counter.
create index if not exists waitlist_signups_role_idx
  on public.waitlist_signups (role);

-- RLS on, no policies: service-role only. Do NOT add an anon policy.
alter table public.waitlist_signups enable row level security;

-- Make the schema cache pick up the new table immediately.
notify pgrst, 'reload schema';
