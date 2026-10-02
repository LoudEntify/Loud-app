-- Phase 2: a public profile view, and the end of the public SELECT policy
-- on the profiles table.
--
-- PRD rows 66, 135, 147. docs/ARCHITECTURE.md: "The owner-mode profile is
-- the test case: a non-owner's request must not return owner fields at
-- all." docs/CLAUDE.md §3: "A non-owner request must never receive owner
-- fields."
--
-- The pilot's `profiles_select_public_artists` policy (role = 'artist')
-- let any caller, signed in or not, read every column of every artist's
-- row: full_name, date_of_birth, country, onboarding state, kyc_status,
-- deactivation reason. Row-level security cannot hide columns, so the
-- policy had to go and a view with only the public columns takes its
-- place. Owners still read their own full row (profiles_select_own).
--
-- The view is owned by the migration role and is NOT security_invoker, so
-- it reads profiles as its owner (bypassing RLS) and exposes exactly the
-- columns listed, nothing else. Deactivated accounts are hidden entirely
-- (soft delete: "profile hidden").
--
-- Protected path (permissions/RLS). Listed in docs/NEEDS_KOREY.md.

alter table profiles add column if not exists city text;

create or replace view public_profiles
with (security_invoker = false)
as
select id,
       role,
       display_name,
       username,
       bio,
       avatar_url,
       genres,
       country,
       city,
       created_at
  from profiles
 where deactivated_at is null;

grant select on public_profiles to anon, authenticated, service_role;

drop policy if exists profiles_select_public_artists on profiles;

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('profiles', 'city', 'personal', 'contract', 'life of the account', true, true, 'shown publicly for artists (local discovery); editable')
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. As anon: select full_name, date_of_birth from profiles -> zero rows.
-- V2. As anon: select * from public_profiles -> artists AND viewers, only
--     the listed columns; no deactivated accounts.
-- V3. As user X: select * from profiles -> exactly X's own row.
-- (supabase/tests/phase2_access.sql)
