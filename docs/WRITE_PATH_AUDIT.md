# Write-path audit — every write the overnight round added

Written after the sitting where three new write paths failed in a row.
The common cause was real: reads had been exercised, writes had not.
This is the sweep so the rest don't arrive one failure per test.

Method: enumerate every `insert`/`upsert`/`update`/`delete`/storage write
the new code performs, name the client it uses, and check that against
the policy or constraint that governs it.

| # | Write | Client | Governed by | Verdict |
|---|-------|--------|-------------|---------|
| 1 | `shows` insert (Schedule Show) | anon+auth | `insert_shows` (authenticated, check true) | **WAS BROKEN** — policy admitted it, but `artist_name` was NOT NULL. Fixed: column made nullable *and* populated from the profile. |
| 2 | `broll_clips` insert + storage upload | anon+auth | `broll_insert_own` / **no storage policy on the bucket** | **WAS BROKEN** — the bucket has no storage policies by design (recordings are signed server-side), so the client storage write could never succeed. Fixed: both writes moved to `/api/broll/upload` (service role); direct-write policies dropped. |
| 3 | `camfeed_pairings` insert (Add Camera) | service role | table constraints | **WAS BROKEN** — `show_id` was NOT NULL, and Kit Check correctly sends null when the artist has no upcoming show. Fixed: column made nullable, and the route omits the key entirely rather than sending null. |
| 4 | `broll_clips` delete + storage remove | anon+auth → **service role** | — | Moved to `/api/broll/delete` in the same change as #2. |
| 5 | `notifications` upsert (show reminders) | anon+auth | `notifications_insert_own` + `notifications_update_own` | **OK** — upsert can issue either verb and both policies exist. |
| 6 | `recordings` update visibility | anon+auth | `recordings_update_own` | **OK** — owner-scoped, and only the owner sees the toggle. |
| 7 | `show_slots` upsert (join-show, invites) | service role | zero-policy table | **OK** — service role bypasses RLS, which is the intended access path. |
| 8 | `profiles` update (become-artist / become-viewer) | service role | — | **OK.** |
| 9 | `cue_sheets` upsert (named sheets) | service role | zero-policy table | **OK.** |
| 10 | `wallet_transactions` | — | select-only policy | **OK by construction** — nothing writes it; there is deliberately no insert policy. |
| 11 | `shows` update state (`LiveDemo`) | anon+auth | `update_shows` (artist_id null or own) | Policy **OK** — but see the finding below. |

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
