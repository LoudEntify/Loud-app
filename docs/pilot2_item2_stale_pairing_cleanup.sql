-- pilot2_item2_stale_pairing_cleanup.sql
-- Item 2 — revoke the stale pairing rows already in the table.
--
-- NOT A SCHEMA MIGRATION. No DDL. This is a one-off data cleanup so the
-- 20th starts from a clean rig regardless of what accumulated during
-- rehearsals.
--
-- ⚠️ RUN BEFORE THE DRESS REHEARSAL (Sat 19), not before it is needed.
-- The code fix in app/api/camfeed/pair/route.js is what stops this
-- recurring; this only clears what is already there. Running the cleanup
-- without the code fix buys a few days at most, because every rehearsal
-- between now and the 27th refills it.
--
-- ── WHAT "STALE" MEANS ────────────────────────────────────────
-- Exactly what isLivePairing() means in lib/camfeedPairing.js, and the
-- two definitions have to stay in step. A row is stale when it is:
--
--   not redeemed AND expired        nobody ever picked up the phone
--   redeemed AND unseen for 6h+     a phone from a previous rehearsal
--
-- `expires_at` is deliberately not consulted for a redeemed row: it stops
-- meaning anything once a single-use code is redeemed, and the migrate
-- path pushes it out six hours anyway.
--
-- `coalesce(last_seen_at, used_at)` because last_seen_at is only
-- maintained on the multi-camera path. A row redeemed before that column
-- was written has a null there and an old used_at, and falling back to it
-- asks the honest question: when did we last have any evidence this
-- device existed?
--
-- ── REVOKE, NOT DELETE ────────────────────────────────────────
-- revoked_at is how this table already retires a row (the revoke action
-- in the pair route sets exactly this), every read path already filters
-- on it, and a revoked row still answers "what rig did this artist have
-- in September" for the 21st. A DELETE would answer nothing and could not
-- be undone at 7pm on show night.

-- ══════════════════════════════════════════════════════════════
-- V0 · LOOK FIRST. Run this alone and read it before running anything
-- below. Nothing is modified.
--
-- EXPECT: `live` rows are the rig you can actually see in the room right
-- now. If a phone you are holding appears under `stale`, STOP — the
-- liveness window is wrong for your setup, not the data.
-- ══════════════════════════════════════════════════════════════

select
  case
    when revoked_at is not null then 'already revoked'
    when used_at is null and expires_at > now() then 'live (code outstanding)'
    when used_at is null then 'stale (code never redeemed)'
    when now() - coalesce(last_seen_at, used_at) < interval '6 hours' then 'live (camera seen recently)'
    else 'stale (phone from a previous rehearsal)'
  end as state,
  count(*) as rows,
  min(created_at) as oldest,
  max(created_at) as newest
from camfeed_pairings
group by state
order by rows desc;

-- ══════════════════════════════════════════════════════════════
-- V1 · The individual rows about to be revoked, per artist.
-- Read this before the UPDATE. If a row here belongs to a camera you
-- intend to use on the 20th, do not run the UPDATE.
-- ══════════════════════════════════════════════════════════════

select id, created_by, slot, role, context,
       created_at, expires_at, used_at, last_seen_at,
       coalesce(last_seen_at, used_at) as last_evidence
from camfeed_pairings
where revoked_at is null
  and (
    (used_at is null and expires_at <= now())
    or (used_at is not null and now() - coalesce(last_seen_at, used_at) >= interval '6 hours')
  )
order by created_by, created_at;

-- ══════════════════════════════════════════════════════════════
-- V2 · THE CLEANUP. Wrapped in an explicit transaction with the
-- verification INSIDE it, so the whole block is pasted and run as one
-- unit and the count is read before anything is durable.
--
-- Read `still_live_after` before deciding. If it is 0 for an artist who
-- has a phone in their hand, ROLL BACK: the window is wrong.
--
-- Change the last line to `commit;` only once the numbers look right.
-- As written this block CHANGES NOTHING.
-- ══════════════════════════════════════════════════════════════

begin;

update camfeed_pairings
   set revoked_at = now()
 where revoked_at is null
   and (
     (used_at is null and expires_at <= now())
     or (used_at is not null and now() - coalesce(last_seen_at, used_at) >= interval '6 hours')
   );

select created_by,
       count(*) filter (where revoked_at is null) as still_live_after,
       count(*) filter (where revoked_at is not null) as revoked_total
  from camfeed_pairings
 group by created_by
 order by still_live_after desc;

rollback;
-- ^ change to `commit;` to apply. Left as rollback so that pasting this
--   file wholesale is safe, and applying it is a deliberate edit.

-- ══════════════════════════════════════════════════════════════
-- V3 · AFTER COMMITTING. The cap the route now enforces, computed the
-- same way the route computes it.
--
-- EXPECT: every artist at or below 6. An artist above 6 here means the
-- cleanup predicate and isLivePairing() have drifted apart, which is the
-- one way this file can be wrong.
-- ══════════════════════════════════════════════════════════════

select created_by, count(*) as live_cameras
  from camfeed_pairings
 where revoked_at is null
   and (
     (used_at is null and expires_at > now())
     or (used_at is not null and now() - coalesce(last_seen_at, used_at) < interval '6 hours')
   )
 group by created_by
 order by live_cameras desc;
