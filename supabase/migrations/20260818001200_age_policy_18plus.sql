-- age policy: 18+ (spec correction)
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- The platform floor is 18, not 13. Standing launch policy rather than a
-- preference: paid voting mechanics, UK Online Safety Act exposure and
-- safeguarding all land on the same number.
--
-- Self-declaration is sufficient at this stage. Formal age assurance
-- (document or estimation-based) is a documented later phase, and this
-- constraint is what that phase will tighten around.
--
-- Enforced in three places on purpose, because each can be bypassed
-- alone: the signup form (components/Auth.jsx), the upgrade route
-- (app/api/profile/become-artist), and here -- the only one a browser
-- cannot route around.

-- Existing rows are not touched: NOT VALID means the constraint applies
-- to new and updated rows only. Legacy rows with a null or under-age
-- date of birth stay readable rather than breaking the migration; the
-- upgrade route refuses them separately.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_min_age_18') then
    alter table profiles drop constraint profiles_min_age_18;
  end if;

  alter table profiles
    add constraint profiles_min_age_18
    check (date_of_birth is null or date_of_birth <= (current_date - interval '18 years'))
    not valid;
end $$;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. Constraint exists:
--    select conname, convalidated from pg_constraint where conname = 'profiles_min_age_18';
--    -- expect 1 row; convalidated = false is expected (added NOT VALID).
--
-- 2. It actually bites (should ERROR):
--    begin;
--      update profiles set date_of_birth = current_date - interval '15 years'
--       where id = (select id from profiles limit 1);
--    rollback;
--    -- expect: new row for relation "profiles" violates check constraint
--    --         "profiles_min_age_18"
--
-- 3. A valid adult DOB still saves:
--    begin;
--      update profiles set date_of_birth = current_date - interval '25 years'
--       where id = (select id from profiles limit 1);
--    rollback;
--    -- expect: UPDATE 1, no error.
--
-- 4. Who is already non-compliant (should be empty on a fresh database):
--    select id, date_of_birth from profiles
--     where date_of_birth is not null
--       and date_of_birth > (current_date - interval '18 years');
--    -- any rows here predate this policy and need a decision, since the
--    -- constraint was added NOT VALID and will not have caught them.
