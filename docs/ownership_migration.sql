-- ownership migration (Accounts & Identity, Day 2 -- deferred Day-1 items)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Three tables, each getting a real auth.uid() ownership column now that
-- one exists to attach (Day 1 shipped the profiles/auth layer this depends
-- on). See docs/BUILD_AUDIT_2026-08.md and the Day 1 round for why these
-- were deferred rather than done alongside the auth foundation itself.

-- ─── 1. shows ─────────────────────────────────────────────────
-- Nullable -- existing hand-inserted show rows (this table has no insert
-- path anywhere in the app; rows are created via SQL by the operator) have
-- no value here, and that's fine. NOT backfilled by this script -- instead,
-- app/api/performer/claim-slot/route.js now sets this on first successful
-- claim (first-claim-wins ownership), so it fills in naturally as shows get
-- claimed rather than needing a guess-the-artist backfill query here.
alter table shows add column if not exists artist_id uuid references auth.users(id);

-- select stays wide open -- viewers/camfeed devices must keep reading show
-- state anonymously (components/LiveDemo.jsx, components/EgressPage.jsx both
-- read this via the anon client directly, confirmed no route indirection
-- exists for either). Not touching this policy; re-stated here only so the
-- three shows policies are visible together in one place.
-- (read_shows already exists from the original SHOW_LIFECYCLE_SPEC.md setup
-- -- left untouched.)

-- update: tightened from `using (true)` to owner-or-unclaimed. The
-- `artist_id is null` clause is the grandfather clause -- without it, any
-- show whose artist_id hasn't been set yet (which, right after this
-- migration runs, is EVERY existing show, including whatever is currently
-- running) would become permanently un-updatable, breaking the live show
-- flow this round is explicitly not allowed to break.
drop policy if exists "update_shows" on shows;
create policy "update_shows" on shows
  for update using (artist_id is null or artist_id = auth.uid())
  with check (artist_id is null or artist_id = auth.uid());

-- insert: tightened to authenticated-only. Safe -- confirmed no anon-client
-- insert path exists anywhere in the app today (shows rows are hand-created
-- via SQL), so this closes unused attack surface with zero behavior change
-- for anything that currently works.
drop policy if exists "insert_shows" on shows;
create policy "insert_shows" on shows
  for insert to authenticated with check (true);

-- ─── 2. show_slots ────────────────────────────────────────────
-- Already zero-policy / service-role-only (confirmed: no client-side access
-- to this table exists anywhere, RLS unchanged here) -- this column is pure
-- data model, not a security change. Populated by claim-slot alongside its
-- existing claimed_by_email write, same moment, same row.
alter table show_slots add column if not exists claimed_by_user_id uuid references auth.users(id);

-- ─── 3. cue_sheets ────────────────────────────────────────────
-- Nullable. Backfilled ONCE, here, by matching existing artist_email values
-- to a real account by email -- safe because it's a plain UPDATE, not a
-- destructive rekey: rows with no matching auth.users row simply keep
-- artist_id null and remain fully reachable exactly as before, via
-- artist_email, through the service-role client only (unchanged access
-- path for those legacy rows).
alter table cue_sheets add column if not exists artist_id uuid references auth.users(id);

update cue_sheets
set artist_id = auth.users.id
from auth.users
where cue_sheets.artist_id is null
  and lower(auth.users.email) = cue_sheets.artist_email;

-- Real RLS policies for the first time on this table (previously zero-policy
-- /service-role-only throughout). artist_email and its unique index are NOT
-- dropped -- app/api/cue-sheets/route.js still upserts on
-- (track_hash, artist_email) unchanged; this just adds an owner-access path
-- alongside the existing service-role one, for any future client-side reads.
alter table cue_sheets enable row level security;

create policy "cue_sheets_select_own" on cue_sheets
  for select using (auth.uid() = artist_id);

create policy "cue_sheets_insert_own" on cue_sheets
  for insert with check (auth.uid() = artist_id);

create policy "cue_sheets_update_own" on cue_sheets
  for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);

-- ─── Verification query ──────────────────────────────────────
-- Expect: shows -- read_shows/update_shows/insert_shows (3 rows).
-- cue_sheets -- cue_sheets_select_own/insert_own/update_own (3 rows).
-- show_slots -- 0 rows (still zero-policy by design, not a bug).
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('shows', 'show_slots', 'cue_sheets')
order by tablename, policyname;

-- Sanity check on the cue_sheets backfill -- run this after the above and
-- eyeball the ratio; a low match rate isn't necessarily wrong (plenty of
-- Day-1-era test sheets used throwaway emails with no real account behind
-- them), just worth knowing.
select count(*) as total_rows,
       count(artist_id) as matched_to_account
from cue_sheets;
