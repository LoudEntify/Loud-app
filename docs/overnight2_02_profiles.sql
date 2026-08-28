-- overnight2_02_profiles.sql
-- Overnight build #2 — EVERY profiles change from tonight, in one file.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- One file per table per round, deliberately: three separate migrations
-- each adding two columns to `profiles` is how a schema drifts out of
-- anyone's head. Everything tonight adds to this table is here, grouped
-- by the phase that needs it, and the whole file is safe to re-run.
--
-- Phase 1 (onboarding)      → onboarding
-- Phase 2 (account closure) → deactivated_at, deactivation_reason,
--                             retained_stage_name
-- Phase 3 (payouts)         → kyc_status, kyc_updated_at
--
-- PRE-MIGRATION BEHAVIOUR: every one of these is optional to the app.
-- Onboarding falls back to localStorage, closure and cash-out are
-- feature-gated off and say so on screen. The branch preview renders and
-- is usable with none of this applied.

-- ─── PHASE 1 · onboarding ─────────────────────────────────────
-- A single jsonb blob rather than a column per step.
--
-- The reasoning, since a column-per-step is the obvious alternative:
-- onboarding steps are PRODUCT, and product changes weekly. Adding a
-- step should not be a migration, and reordering steps should never be
-- able to reinterpret existing progress. The blob stores step KEYS in
-- `completed` / `skipped` arrays, so an unknown key is simply ignored
-- and a removed step's progress harmlessly lingers.
--
-- Shape (lib/onboarding.js is the authority):
--   { "v":1, "role":"artist"|"viewer",
--     "completed":["identity"], "skipped":["schedule"],
--     "done":false, "completedAt":null }
--
-- NOT NULL with a default so `state.completed` is never a null deref on
-- the client, and every existing account reads as "hasn't started" —
-- which is exactly what they are.
alter table profiles add column if not exists onboarding jsonb not null default '{}'::jsonb;

-- ─── PHASE 2 · account closure (soft delete) ──────────────────
-- deactivated_at is THE flag. Non-null means: login is refused, the
-- profile is hidden from every public surface, recordings are private,
-- scheduled shows are cancelled. It does NOT mean the row is going away.
--
-- This is deliberately not a hard wipe and the UI says so in as many
-- words. Financial records (wallet_transactions) are retained in full,
-- because a ledger you can delete is not a ledger; the stage name is
-- retained against the record so a closed account's name cannot be
-- silently taken over by someone else and attached to their history.
--
-- deactivation_reason: free text, optional, whatever the person chose to
-- tell us. Kept because "why did people leave" is the single most useful
-- thing a young platform can know and the hardest to reconstruct later.
--
-- retained_stage_name: a copy of display_name/username taken at closure.
-- The live columns can legitimately be cleared or changed by a support
-- action; this one is the record of who this account was.
alter table profiles add column if not exists deactivated_at       timestamptz;
alter table profiles add column if not exists deactivation_reason  text;
alter table profiles add column if not exists retained_stage_name  text;

create index if not exists profiles_active_idx
  on profiles (role) where deactivated_at is null;

-- ─── PHASE 3 · payout eligibility ─────────────────────────────
-- kyc_status gates cash-out and NOTHING ELSE. Buying tokens, spending
-- them, receiving them — none of that is gated on identity checks,
-- because none of it moves money OUT of the platform.
--
-- 'none'     — never asked. Every account starts here.
-- 'pending'  — a request exists and is being worked.
-- 'verified' — cash-out is permitted.
-- 'rejected' — cash-out is refused; the person is told, and can re-apply.
--
-- A CHECK constraint here (unlike camera roles) IS right: this is a
-- compliance boundary, the value set is small and stable, and a typo
-- reading as 'verifed' must never silently fail open.
--
-- The actual identity-verification integration is STUBBED and
-- documented, not built — see docs/MORNING_BRIEF.md. What exists is the
-- gate, the request flow and the audit trail the real provider will
-- write into.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'profiles' and column_name = 'kyc_status'
  ) then
    alter table profiles add column kyc_status text not null default 'none';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_kyc_status_valid') then
    alter table profiles
      add constraint profiles_kyc_status_valid
      check (kyc_status in ('none','pending','verified','rejected'));
  end if;
end $$;

alter table profiles add column if not exists kyc_updated_at timestamptz;

-- ─── RLS — unchanged, and re-stated ───────────────────────────
-- profiles already has four policies (docs/profiles_migration.sql):
--   profiles_select_own            SELECT  auth.uid() = id
--   profiles_insert_own            INSERT  auth.uid() = id
--   profiles_update_own            UPDATE  auth.uid() = id
--   profiles_select_public_artists SELECT  role = 'artist'
--
-- NOTHING IS ADDED HERE, and one consequence needs stating plainly
-- because it is a real limitation and not an oversight:
--
--   profiles_update_own lets an account write ANY column on its own row,
--   including kyc_status and deactivated_at. So a determined user with a
--   browser console can set their own kyc_status to 'verified'.
--
-- That is why cash-out is NOT authorised by reading kyc_status from the
-- client. app/api/wallet/cashout re-reads it server-side through the
-- service-role client, and no client-supplied value is trusted anywhere
-- in that path. Tightening the policy to a column allow-list needs a
-- trigger or a split table; it is the correct next hardening step and is
-- named in the morning brief rather than left implicit.
--
-- CONFLICT TARGETS on profiles: `profiles_pkey` (id) is the only one any
-- upsert could use, and the app performs no upserts here — inserts go
-- through ensureProfile() (plain insert, one per account) and everything
-- else is UPDATE … WHERE id. `profiles_username_key` is partial
-- (WHERE username IS NOT NULL) and therefore NOT usable as an
-- ON CONFLICT target; if a future round wants upsert-by-username it must
-- drop the predicate first. Recorded here because that exact partial-index
-- trap cost a previous round a live 400 on `notifications`.

-- ─── reload PostgREST's schema cache ──────────────────────────
notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Columns present with the right types and defaults:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'profiles'
--        and column_name in ('onboarding','deactivated_at','deactivation_reason',
--                            'retained_stage_name','kyc_status','kyc_updated_at')
--      order by column_name;
--     -- EXPECT exactly 6 rows:
--     --   deactivated_at      | timestamp with time zone | YES | (null)
--     --   deactivation_reason | text                     | YES | (null)
--     --   kyc_status          | text                     | NO  | 'none'::text
--     --   kyc_updated_at      | timestamp with time zone | YES | (null)
--     --   onboarding          | jsonb                    | NO  | '{}'::jsonb
--     --   retained_stage_name | text                     | YES | (null)
--
-- V2. The kyc CHECK exists and is valid:
--     select conname, convalidated from pg_constraint
--      where conname = 'profiles_kyc_status_valid';
--     -- EXPECT: 1 row, convalidated = t
--     -- (added without NOT VALID on purpose — every existing row has the
--     --  default 'none', so there is nothing that could fail it.)
--
-- V3. The CHECK actually bites:
--     begin;
--       update profiles set kyc_status = 'verifed' where id = (select id from profiles limit 1);
--     rollback;
--     -- EXPECT: ERROR — new row violates check constraint "profiles_kyc_status_valid"
--
-- V4. Index present:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'profiles' and indexname = 'profiles_active_idx';
--     -- EXPECT: 1 row, indexdef containing "WHERE (deactivated_at IS NULL)"
--
-- V5. Policies UNCHANGED — four, exactly as before tonight:
--     select policyname, cmd from pg_policies
--      where tablename = 'profiles' order by policyname;
--     -- EXPECT exactly 4 rows:
--     --   profiles_insert_own            | INSERT
--     --   profiles_select_own            | SELECT
--     --   profiles_select_public_artists | SELECT
--     --   profiles_update_own            | UPDATE
--     -- If there are five, something added one that this file did not.
--
-- V6. Round-trip from the app: sign up a new account on the preview and
--     walk one onboarding step, then:
--       select username, onboarding, kyc_status, deactivated_at
--         from profiles order by created_at desc limit 1;
--     -- EXPECT: onboarding shows {"v":1,...,"completed":["identity"],...},
--     -- kyc_status 'none', deactivated_at null.
