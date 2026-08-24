# Write-path audit — every write the overnight round added

Written after the sitting where three new write paths failed in a row.
The common cause was real: reads had been exercised, writes had not.
This is the sweep so the rest don't arrive one failure per test.

Method: enumerate every `insert`/`upsert`/`update`/`delete`/storage write
the new code performs, name the client it uses, and check that against
the policy or constraint that governs it.

**Method amended (Go Live threading retest).** The original sweep checked
*permission* — can this client legally issue this verb — and it was right
about all eleven. It never checked whether an `upsert`'s **conflict
target is resolvable**, which is a different question with a different
failure mode: permission failures show up as 401/403, an unresolvable
conflict target shows up as a **400** and looks nothing like an RLS
problem. The `notifications` reminder upsert had a perfectly good unique
index that `ON CONFLICT` could not infer, and the audit had no column
that would have caught it.

So every upsert now gets a second column, and the rule for filling it is:
name the index by its real name, and state whether it is **partial**.
A partial unique index (`... where x is not null`) cannot be inferred
from `ON CONFLICT (cols)` unless the statement repeats the predicate —
and PostgREST's `on_conflict=` parameter cannot emit one. A partial index
in this column is a defect, not a note.

| # | Write | Client | Governed by | Conflict target → index | Verdict |
|---|-------|--------|-------------|------------------------|---------|
| 1 | `shows` insert (Schedule Show) | anon+auth | `insert_shows` (authenticated, check true) | n/a — plain insert | **WAS BROKEN** — policy admitted it, but `artist_name` was NOT NULL. Fixed: column made nullable *and* populated from the profile. |
| 2 | `broll_clips` insert + storage upload | anon+auth | `broll_insert_own` / **no storage policy on the bucket** | n/a | **WAS BROKEN** — the bucket has no storage policies by design (recordings are signed server-side), so the client storage write could never succeed. Fixed: both writes moved to `/api/broll/upload` (service role); direct-write policies dropped. |
| 3 | `camfeed_pairings` insert (Add Camera) | service role | table constraints | n/a | **WAS BROKEN** — `show_id` was NOT NULL, and Kit Check correctly sends null when the artist has no upcoming show. Fixed: column made nullable, and the route omits the key entirely rather than sending null. |
| 4 | `broll_clips` delete + storage remove | anon+auth → **service role** | — | n/a | Moved to `/api/broll/delete` in the same change as #2. |
| 5 | `notifications` upsert (show reminders, `lib/scheduling.js`) | anon+auth | `notifications_insert_own` + `notifications_update_own` | `user_id,dedupe_key` → `notifications_dedupe_idx` — **PARTIAL** (`where dedupe_key is not null`) | **WAS BROKEN — 400.** Policy was fine; the target was uninferrable. Fixed by `docs/notifications_conflict_target_migration.sql` (drops the predicate). |
| 6 | `recordings` update visibility | anon+auth | `recordings_update_own` | n/a | **OK** — owner-scoped, and only the owner sees the toggle. |
| 7 | `show_slots` upsert (join-show) | service role | zero-policy table | `show_id,slot` → `show_slots_show_slot_idx` — plain unique on `(show_id, slot)`, `docs/show_access_migration.sql:46` | **OK — verified, not assumed.** Read the index definition: no predicate. |
| 8 | `profiles` update (become-artist / become-viewer) | service role | — | n/a | **OK.** |
| 9 | `cue_sheets` upsert (named sheets) | service role | zero-policy table | `track_hash,artist_email,name` → `cue_sheets_track_artist_name_idx` — plain unique, `docs/scheduling_migration.sql:73` | **OK** — but only once that migration has been run; it *replaced* the two-column `cue_sheets_track_artist_idx`, so a database at the older revision would 400 here for the same reason as #5. |
| 10 | `wallet_transactions` | — | select-only policy | n/a | **OK by construction** — nothing writes it; there is deliberately no insert policy. |
| 11 | `shows` update state (`LiveDemo`) | anon+auth | `update_shows` (artist_id null or own) | n/a — keyed on `id` since the threading round | Policy **OK** — see the closed finding below. |
| 12 | `show_slots` upsert (invite minting, `/api/performer/invite`) | service role | zero-policy table | `show_id,slot` → `show_slots_show_slot_idx`, as #7 | **OK** — missed by the original sweep, which folded it into row 7's parenthetical rather than listing it. |
| 13 | `notifications` upsert (downgrade cancellation notices, `/api/profile/become-viewer`) | service role | zero-policy path | `user_id,dedupe_key` → same index as #5 | **WAS BROKEN — same 400, same cause, same fix.** Also missed originally. Service role bypasses RLS but *not* conflict-target inference, which is exactly why "service role, therefore fine" was the wrong instinct. |

Two rows (#12, #13) are new: the original sweep listed writes by table and
lost the second call site each time. Enumerating by **call site** rather
than by table is the other method fix — #13 in particular was a live 400
sitting behind a route the first audit marked OK.

---

## ✅ CLOSED — the Go Live threading round

**This finding is fixed.** `LiveDemo` resolves `?show={id}` to a row and
threads that row's `room_name` through every call site listed below; the
constant is gone and nothing defaults to it (`/api/token` and `/cam` now
refuse a missing room rather than substituting one). The two failures
this predicted both showed up live in the window-opening test before the
fix landed, exactly as described. See DECISIONS.md §16 and
`docs/go_live_threading_test_script.md`.

The original finding is preserved below, unedited — it called the shot.

---

## ⚠️ FINDING (ORIGINAL): the scheduled-show → live handoff is not wired

Not one of the three failures, and bigger than all of them. Surfaced by
row 11.

`components/LiveDemo.jsx` is hardcoded to a single room:

```js
const ROOM_NAME = 'pilot-room';
```

It is used in eleven places — the show lookup, the token request, the
state write, both egress triggers, the director's `showId`, the QR panel.
**LiveDemo does not read `?show=` at all.**

Consequences, all of which will show up the first time GO LIVE is
pressed on a scheduled show:

- `GO LIVE` links to `/live?show={id}`; the parameter is ignored.
- LiveDemo loads whichever show has `room_name = 'pilot-room'` — not the
  one that was scheduled.
- `join-show` is therefore called with the *wrong* show id, so the
  window check, slot binding and invite all evaluate against the wrong
  row.
- Egress records into `pilot-room`, not the show's room.

**Recommendation: do not test GO LIVE on a scheduled show yet.** It is
not a small fix — making the live path show-aware means threading a
resolved `room_name` through all eleven call sites, and that is a change
to the one flow that currently works end to end. It deserves its own
round with its own device test, not a hurried patch at the end of this
one.

Everything else in the fix list is safe to retest now.
