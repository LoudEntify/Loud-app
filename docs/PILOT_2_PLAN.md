# Pilot 2 Instrumentation — Plan

**Pilot date:** Sunday 20 September 2026, 30–50 viewers.
**Planned:** 10 September 2026. **Ten days, of which the last two are frozen.**
**Status:** PLAN ONLY — nothing built, no migrations written, awaiting approval.

Fallback `pilot-freeze-v2` stays bootable and untouched throughout.

---

## 0. Five things I found while scoping that change the shape of the work

Read this section first — three of the six pieces get cheaper because of it, and one gets a
different fix than the brief assumes.

**0.1 — The live viewer count already exists.** `components/PresenceCounter.jsx:32-50` derives
performer and viewer counts from LiveKit room state, correctly excluding egress participants,
`contestant-*` and `camfeed-*` (`:38-41`). It is on screen at `components/CommentsPanel.jsx:131`.
It is simply never written down. **Piece 2 does not need to build a concurrency count — it needs
to sample one that works.** (This corrects §1.3c of the evidence audit, which said no count was
computed. I've amended that document.)

**0.2 — Viewer identity is already unique per session, and nothing depends on its format.**
`components/LiveDemo.jsx:1143` mints `viewer-${userId8 || 'anon'}-${Date.now()}`. A grep for
`startsWith('viewer` across `app/`, `components/` and `lib/` returns **nothing** — unlike
`camfeed-` and `contestant-`, which `lib/trackSources.js:131,151` and four call sites do pattern
match. So the identity is already a usable per-session key. **Piece 2 does not need to change the
identity format at all** — it needs to *register* the one already being minted. Smaller diff,
smaller risk.

**0.3 — 'live' is derived, never stored, and the clock-derived END IS NEVER BROADCAST.**
`lib/showState.js:14-33`: a `soundcheck` row past its `slated_at` *is* live; and once
`showWindowClosesAt` passes, every client independently derives `'ended'`. But that derivation
**sends no SHOW_ENDED, stops no egress, and closes no room.** The durable half
(`lib/scheduling.js:183-196`, `sweepClosedShows`) only runs when the artist next opens their own
console. This is the mechanism behind the 6h26m room, and it means Piece 1's `actual_ended_at`
needs a defined answer for "nobody pressed the button" (§1.3 below).

**0.4 — Nothing in this codebase can close a LiveKit room.** `grep -rn "RoomServiceClient\|deleteRoom\|removeParticipant"`
across `app/`, `lib/` and `components/` returns **zero hits**, though `livekit-server-sdk ^2.7.0`
is installed and provides all three. Every teardown today is cooperative: it asks each client to
stop. A client that isn't listening never stops. **Piece 4 is a new server-side capability, not a
tweak.**

**0.5 — `ReleaseOnShowEnd` releases the camera on *any* disconnect, without reading the reason.**
`components/ReleaseOnShowEnd.jsx:105` — `function onDisconnected() { release('room_disconnected'); }`.
LiveKit's `Disconnected` event carries a `DisconnectReason` (confirmed present in the installed
`@livekit/protocol`: `CLIENT_INITIATED=1`, `DUPLICATE_IDENTITY=2`, `SERVER_SHUTDOWN=3`,
`PARTICIPANT_REMOVED=4`, `ROOM_DELETED=5`, `STATE_MISMATCH=6`, `JOIN_FAILURE=7`, `MIGRATION=8`).
The component ignores it and treats all eight identically.

**This is simultaneously the Piece 4 blocker and the leading explanation for the camfeed retry
loop** (§7). It is also, stated plainly, a live violation of the standing rule the brief cites:
*no code stops publishing on an interruption without a signal distinguishing intent.* Today a
duplicate-identity eviction, a server migration and a deliberate End Show all take the camera off
air identically — and on the camfeed page `onEnded` also sets `showOver`, which **stops the
follow-loop poll** (`components/CamPair.jsx:197`), so the camera cannot come back without a manual
reload.

Fixing this is a prerequisite for Piece 4, because Piece 4 introduces `ROOM_DELETED` — a
disconnect reason that has never occurred in this system before.

---

## 1. Piece 1 — Actual show timings

**PRD:** Live Show / Director Experience · **S&I:** Database, Observability
**Lands first. Everything else measures against it.**

### 1.1 Where the anchors are

| Anchor | Site | Why this one |
|---|---|---|
| **Start** | `components/LiveDemo.jsx:4500-4512`, inside the `showLiveBroadcastSentRef` once-only guard, **after `runStartPreflight()` resolves** | This is the moment the broadcast genuinely begins: the room is `Connected`, the publisher pre-flight has passed, `SHOW_LIVE` goes out and egress starts. Every earlier candidate (`slated_at`, the `soundcheck` write, room connect) is before something is actually being broadcast. |
| **End, intentional** | `components/LiveDemo.jsx:3186-3203` (`endShow`) | The artist pressed the button. |
| **End, unattended** | `lib/scheduling.js:183` (`sweepClosedShows`) | Nobody pressed it. See §1.3. |

### 1.2 The write

`updateShowStateWithRetry` (`components/LiveDemo.jsx:289-308`) already writes `shows` from the
artist's **anon** client under the owner-scoped `update_shows` RLS policy, with one retry and a
persistent warning on final failure. Both timestamps ride that existing helper rather than opening
a second write path — it is the one write in this area already proven to matter and already
instrumented.

- Start: extend the helper to take a patch, and write `actual_started_at` alongside nothing else
  (the `state` row is already `soundcheck` by then; start does not change state).
- End: `updateShowStateWithRetry('ended', showId, { actual_ended_at, ended_by: 'artist' })`.

**Guard:** both writes use `coalesce` semantics — first-write-wins, never overwritten. A show that
reconnects and re-fires the live transition must not have its start time moved. Enforced in the
`update` (`.is('actual_started_at', null)`) rather than trusted to the client's once-only ref,
because the ref does not survive a page reload and the artist reloading mid-show is a case pilot 1
actually produced.

### 1.3 The decision I need from you: what `actual_ended_at` means when nobody pressed the button

Three states are genuinely different and I propose recording which one applies, in an `ended_by`
column, rather than flattening them:

| `ended_by` | Set by | `actual_ended_at` means |
|---|---|---|
| `artist` | `endShow` | The real end. Trustworthy. |
| `window_sweep` | `sweepClosedShows` | The window closed. An **upper bound**, not the real end — the show may have stopped an hour earlier. |
| `webhook` | `room_finished` ingestion (Piece 5) | LiveKit says the room emptied. Closest to real for an unattended end. |

This matches how `docs/mvp3_01_shot_commands_artist.sql:43-48` already reasons about not
backfilling a guess into an attribution column: a labelled inference is fine, an unlabelled one is
indistinguishable from a fact one query later.

**Alternative if you'd rather keep it simple:** one nullable `actual_ended_at`, written only by
`endShow`, left NULL otherwise. Honest, but it means an unattended show has no end at all and
every derived duration silently drops it. I recommend the three-state version; it is one text
column.

### 1.4 Offset calculations to change

Only one site computes an offset today:

- `components/LiveDemo.jsx:3233` — `const startedAt = show?.slated_at ? ... : null;`
  → prefer `show.actual_started_at ?? show.slated_at`.

I will add a single helper (`lib/showState.js` — `showOriginMs(show)`) so Pieces 2 and 3 cannot
each re-derive it differently, and so there is exactly one place to change when a fourth consumer
appears.

**Stated limit:** this fixes offsets *from Pilot 2 onward*. Pilot 1's `reaction_events.offset_ms`
values stay uncorrectable — no actual start time was recorded, so there is nothing to correct them
against.

### 1.5 Migration
`docs/pilot2_01_shows_actual_times.sql` — additive: `actual_started_at timestamptz`,
`actual_ended_at timestamptz`, `ended_by text` (all nullable, no default, no backfill), plus a
partial index on `(actual_started_at)` for the "which shows really ran" query.

---

## 2. Piece 2 — Anonymous viewer identity and leave events

**PRD:** Live Show, Accounts & Identity · **S&I:** Database, Auth, Observability

### 2.1 The design, in one paragraph

A `viewer_id` (UUID) is minted on first page load and kept in `localStorage`. It is **never sent
over the LiveKit wire.** At join, the client POSTs `{ showId, viewerId, livekitIdentity }` to a new
route, which writes a `viewer_sessions` row and returns its id. At leave, a `pagehide` beacon
closes the row. The LiveKit identity — already unique per session (§0.2), already carried by every
`health_events` row and by LiveKit's own webhooks — is the join key between the three systems.

### 2.2 Why the viewer_id stays off the wire

A LiveKit identity is visible to **every other participant in the room.** Putting a stable
cross-show identifier there would let any viewer with a console open track any other viewer across
shows. Keeping the mapping server-side costs one extra column and removes that entirely. The
identity on the wire stays per-session and opaque, exactly as it is today.

This also means **no change to the identity format**, so nothing downstream can break (§0.2).

### 2.3 What this replaces

The audit's narrower fix — "send an Authorization header from `lib/reactions.js`" — is **dropped**,
as you directed. It would attribute only signed-in viewers, and pilot 1 showed most are not. The
`viewer_id` column does the same job for everyone. Signed-in viewers still get `user_id` populated
as well where a session exists, so the two are complementary, not competing.

### 2.4 Leave events — three sources, ranked, and why more than one

| Source | Reliability | Availability |
|---|---|---|
| `pagehide` beacon | Good — same mechanism `lib/reactions.js:104-121` and `lib/healthLog.js` already prove works | **Day one, no external dependency** |
| LiveKit `participant_left` webhook (Piece 5) | Authoritative — server-side, survives a killed tab | Only if Piece 5 lands and the LiveKit config allows it |
| Stale-session sweep | Backstop — closes rows with no `left_at` past the show window | Day one |

The beacon is primary precisely because Piece 5 is cuttable. If Piece 5 lands, the webhook
overwrites the beacon's `left_at` and sets `left_source = 'webhook'`; the beacon's value is kept if
no webhook arrives. Same labelled-provenance discipline as §1.3.

**Honest limit:** `pagehide` does not fire on every mobile kill path — an iOS tab discarded under
memory pressure, a phone that dies. The sweep bounds those at the window close, which is an upper
bound, and `left_source` says so.

### 2.5 Concurrency sampling (the cheap win from §0.1)

`PresenceCounter` already has the number. A small sampler writes it — viewer count, performer
count, timestamp — every 30s from **the artist's device only** (one writer, no fan-out from 50
viewers), into `health_events` as a `presence_sample` event. No new table, no new route, and it
gives a real concurrency curve independent of both the beacon and the webhook.

30s × a 60-minute show = 120 rows. Negligible.

### 2.6 Migration
`docs/pilot2_02_viewer_sessions.sql` — new table:
`id, show_id uuid → shows(id), viewer_id text, user_id uuid → auth.users(id) nullable,
livekit_identity text, joined_at, left_at, left_source text, user_agent text, created_at`.
RLS on, service-role only (same posture as `reaction_events` and `health_events` — this holds
per-person behaviour and no product surface reads it).

`docs/pilot2_04_reaction_events_viewer_id.sql` — additive `viewer_id text` + index. Separate file,
per the one-file-per-table rule.

---

## 3. Piece 3 — Comment persistence

**PRD:** Live Show / Director Experience · **S&I:** Database, Real-time media

### 3.1 The shape

Exactly the shape `sendReaction` already uses, and for the same reasons.
`components/LiveDemo.jsx:3253-3264` keeps its two existing lines untouched — local state, then
`send()` over the data channel. **One call is added after them**, batched and beaconed through a
new `lib/comments.js` modelled directly on `lib/reactions.js`.

**Each client persists only its own comments.** No dedup problem, no arbitration, no "which client
is responsible" question. Same asymmetry `lib/reactions.js` already relies on.

Row: `show_id, viewer_id, livekit_identity, author_name, body, offset_ms (from
showOriginMs — Piece 1), client_ts, created_at (server)`.

### 3.2 Two things I want your ruling on before building

**(a) Retention and visibility.** A stored comment log is a different privacy object from a
comment that scrolls past live. `docs/overnight2_11_reaction_events.sql:76-82` already makes this
argument about reactions and concludes service-role-only with zero read policies. I propose the
same for comments, plus a stated retention period. **What retention?** My recommendation: keep
indefinitely for the pilot, revisit before any public launch — but it should be your decision and
it should be in the participant notice (Piece 6b) either way.

**(b) Length cap and moderation.** I propose a hard `char_length` cap in the schema (1,000) and no
moderation. With 30–50 known-ish viewers that is proportionate. Flagging it because "we now store
chat" and "we have no way to remove a stored comment" are worth deciding together, not
discovering on the day.

### 3.3 Migration
`docs/pilot2_03_show_comments.sql` — new table, RLS on, service-role only, indexed
`(show_id, client_ts)`.

---

## 4. Piece 4 — Close the room when the show ends

**PRD:** Live Show · **S&I:** Real-time media, Stateless hosting, Database
**The cost fix. 2.54GB up / 12.8GB down of pilot 1 waste.**

### 4.1 Root cause, as far as code can establish it

Four things had to line up, and all four are in the code:

1. Nothing server-side can close a room (§0.4).
2. The clock-derived end broadcasts nothing (§0.3) — so if End Show was never pressed,
   `SHOW_ENDED` never went out and `ReleaseOnShowEnd` never fired.
3. `shows.state` stayed `'soundcheck'` because `sweepClosedShows` only runs when the artist next
   opens their console (`lib/scheduling.js:172-179` says so explicitly).
4. The camfeed's server-side safety check reads that stale `shows.state`
   (`app/api/camfeed/session/route.js:108-113`), so every 4-second poll kept re-authorising a
   camera whose show had been over for hours.

A LiveKit room auto-closes on `emptyTimeout` — but it was never empty, because of (4).

### 4.2 The fix, in four layers, cheapest first

**Layer A — one line, closes the biggest hole.** Change the camfeed session route's ended-check
from `show.state === 'ended'` to the **derived** rule already used everywhere else
(`effectiveState(show) === 'ended'`, which needs `slated_at`, `ends_at`, `duration_minutes` added
to that select). Server-side, no new infrastructure, and it alone would have stopped the 5h39m
camera within 4 seconds of the window closing.

**Layer B — authoritative teardown.** New `POST /api/room/close`, artist-authenticated, calling
`RoomServiceClient.deleteRoom(roomName)`. Called from `endShow` after `triggerEgress('stop')`.
This is what makes End Show actually end the show for devices that aren't listening.

Ordering matters and is not obvious: **egress stop must complete before the room is deleted**, or
the recorder is evicted mid-file. `triggerEgress` is fire-and-forget today
(`components/LiveDemo.jsx:311-316`); the close call must await the stop, with a bounded timeout
(~5s) and then close regardless. A recording that loses its last two seconds is a far better
outcome than a room that stays open six hours.

**Layer C — the unattended path.** Any client that derives `'ended'` from the clock calls
`/api/room/close`. Idempotent, artist-authenticated, and safe to be called by three devices at
once. Covers "the artist closed their laptop without pressing End Show" as long as *one* browser
somewhere noticed. Also writes `actual_ended_at` with `ended_by: 'window_sweep'` (Piece 1).

**Layer D — recommended, but it is new infrastructure.** A Vercel cron sweeping shows whose window
closed with a room still open. This is the only layer that survives *every* client being gone.

⚠️ **There is no `vercel.json` in this repo and no cron exists today.** On Hobby, Vercel crons run
**once per day** — useless here; Pro allows minute-level. **I need to know the plan tier before
committing to Layer D.** If it's Hobby, Layers A–C still fix every scenario except "nobody had a
browser open at all", and I'd cut D rather than fake it.

### 4.3 The standing-rule prerequisite

Piece 4 introduces `ROOM_DELETED` disconnects, which have never happened in this system. Before
Layer B ships, `ReleaseOnShowEnd` must read `DisconnectReason` (§0.5) and split:

| Reason | Meaning | Action |
|---|---|---|
| `CLIENT_INITIATED`, `ROOM_DELETED`, `PARTICIPANT_REMOVED` | **Intent.** Someone decided this. | Release the camera. Terminal. |
| `DUPLICATE_IDENTITY`, `SIGNAL_CLOSE`, `STATE_MISMATCH`, `JOIN_FAILURE`, `MIGRATION`, `UNKNOWN_REASON` | **Transport failure.** Nobody decided anything. | Do **not** release. Keep the poll alive, let it recover. |

That is the standing rule applied literally, and it is currently violated (§0.5).

---

## 5. Piece 5 — Room webhook ingestion

**PRD:** Live Show · **S&I:** Observability, Real-time media · **CUTTABLE**

### 5.1 The change is small; the dependency is not

`app/api/egress/webhook/route.js:69-71` discards everything but `egress_ended`. Widening it to
also handle `room_started`, `room_finished`, `participant_joined`, `participant_left` and write
each to an append-only `room_events` table is a contained change — signature verification, raw-body
handling and idempotency posture are all already correct in that file.

**The dependency is LiveKit project configuration, which I cannot verify from the repository.**
`egress_ended` arriving proves the URL is reachable and the signature checks out; it does **not**
prove room and participant events are enabled — those are separate checkboxes in the LiveKit
project's webhook settings.

**First action on this piece is a five-minute check in the LiveKit console, not code.** If they're
already on, the rest is a day. If they need enabling, that is your call to make in your account.

### 5.2 Why it stays cuttable
LiveKit's console retains this data as a fallback, and Piece 2's beacon covers join/leave
independently. Cutting it costs authority, not coverage.

### 5.3 Migration
`docs/pilot2_05_room_events.sql` — `room_name text, event text, participant_identity text,
participant_name text, occurred_at timestamptz, raw jsonb, received_at`. Append-only,
service-role only, indexed `(room_name, occurred_at)`. Joins to `viewer_sessions` on
`participant_identity`.

---

## 6. Piece 6 — Two small items

**6a — `shot_commands` SELECT policy.** `docs/pilot2_06_shot_commands_select_policy.sql`.
Given 3,061 rows across 40 shows, the INSERT path is confirmed working, so this is purely about
reading back through the API.

⚠️ **One decision:** a SELECT policy scoped how? `shot_commands.show_id` is the **room name**, not
a show UUID (`components/LiveDemo.jsx:4745`), so an owner-scoped policy has to join through
`shows.room_name`. And `artist_id` is NULL on every pre-`mvp3_01` row, so it cannot carry the
policy alone. **My recommendation: scope to the show's owner via `room_name`, and accept that rows
whose room no longer resolves stay unreadable through the API** (they remain readable via
service-role, which is how any export would run anyway). Flagging it because "add a SELECT policy"
has a non-obvious shape here.
**PRD:** AI Director Layer 1 · **S&I:** Database

**6b — Participant notice.** Placed on the `HoldingScreen` (`components/LiveDemo.jsx:1474`) — the
pre-window screen every viewer sees before entry, and the only screen in the flow where nobody is
mid-show. Short, plain, and specific about the two new things: chat is stored, and a
non-identifying viewer id is kept on this device. No sign-in, no consent gate — it is a notice, not
a modal, and blocking entry on a checkbox for 30–50 pilot viewers would cost more than it earns.

I'll draft the exact wording for your approval before it ships, same as the interruption copy.
**PRD:** Accounts & Identity · **S&I:** Auth

---

## 7. Separate investigation — the camfeed pairing retry loop

**REPORT ONLY. No fix included in the scope above except where it coincides with §0.5.**

### 7.1 What the evidence can and cannot show

Your figures — four `camfeed-a` sessions between 18:03 and 18:07 lasting 1s to ~2min, then one
holding at 18:08 — must have come from the **LiveKit console**, because `health_events` cannot
produce them: `components/CamViewfinder.jsx` calls `initHealthLog` at `:133` but logs **no
room-lifecycle events at all** (no `room_connected`, no `room_disconnected`, no reconnect events —
only `camfeed_on_air`/`off_air`, facing and rotation events). The camfeed pages are the least
instrumented surface in the app.

So I can give you a strong hypothesis from code and the two queries that confirm or kill it. I
cannot confirm it from data alone.

### 7.2 Leading hypothesis: a self-reinforcing release loop

The mechanism, entirely in code:

1. Something disconnects the phone. The most likely candidates, in order:
   **duplicate identity** (the session route deliberately reuses the stored `device_identity` —
   `app/api/camfeed/session/route.js:127-128` — so any second tab, a resumed background tab, or a
   re-pair with the same pairing evicts the first with `DUPLICATE_IDENTITY`); a signal drop on
   venue wifi; or a server-side `MIGRATION`.
2. `ReleaseOnShowEnd` fires `release('room_disconnected')` **without reading the reason** (§0.5,
   `components/ReleaseOnShowEnd.jsx:105`). It unpublishes and calls `track.stop()` — the camera
   light goes out.
3. `onEnded` sets `showOver` (`components/CamPair.jsx:316`).
4. `showOver` **stops the follow-loop poll** (`components/CamPair.jsx:197`) and releases the wake
   lock (`:252`).
5. The phone is now terminal. It cannot recover on its own. The operator sees a dead camera,
   reloads, gets a fresh session — and step 1 can happen again immediately.

That produces exactly the observed shape: several short sessions in quick succession, ending when
whatever was causing the disconnect stopped happening (or the operator stopped touching it).

**Ruled out:** token expiry. `SHOW_TOKEN_TTL` is `'4h'` (`lib/camfeedPairing.js:53`), so it cannot
explain disconnects four minutes apart.

**Not ruled out, and worth checking on the night:** repeated `generation` bumps. A generation
change intentionally remounts the whole `<LiveKitRoom key={room:generation}>`
(`components/CamPair.jsx:305`), which is also a short session followed by a new one. If the artist
went in and out of Kit Check during setup, that alone could produce several of the four
**with no bug at all.** Query 2 below separates these.

### 7.3 Is it a fix or a rehearsal problem?

**Both, and the split matters.** My honest read:

- **The trigger is very likely a rehearsal problem** — setup churn at 18:03–18:07 (Kit Check
  transitions, a second tab, re-scanning the QR) is exactly what a paired phone experiences during
  final setup and not during a show.
- **The failure to recover is a fix**, and it's the same fix Piece 4 needs anyway (§4.3). Today,
  one transient disconnect at any point in a live show permanently kills that camera with no
  automatic recovery — the phone will not come back until a human picks it up and reloads it. With
  30–50 people watching, that is the risk, not the setup churn.

So: I would fix §0.5 regardless (it is already required by Piece 4), and I would **also** treat
"cameras are paired, held, and untouched by T−15" as a rehearsal rule.

### 7.4 The two queries that settle it

Run against the pilot 1 data before I build anything:

```sql
-- 1. Every camera release, with its reason. If the four dead sessions each ended
--    with reason 'room_disconnected', the §7.2 hypothesis is confirmed.
--    'show_ended' instead would mean something quite different and I'd re-diagnose.
select h.show_id, h.participant_identity, h.client_ts,
       h.detail ->> 'reason' as reason,
       h.detail ->> 'role'   as role,
       h.detail ->> 'stopped' as tracks_stopped
from health_events h
where h.event_type = 'local_devices_released'
order by h.client_ts;

-- 2. Did the pairing's generation change during the window? Several bumps between
--    18:03 and 18:07 means intentional remounts (setup churn), not a bug.
select id, slot, role, context, generation, device_identity,
       created_at, updated_at, revoked_at
from camfeed_pairings
order by updated_at desc;
```

**Also worth doing, and time-sensitive:** the LiveKit console shows a disconnect reason per
session. That is the direct answer and it will age out.

### 7.5 The instrumentation gap this exposes

Whatever the cause, **the camfeed page cannot currently be diagnosed after the fact.** I'd add
`room_connected` / `room_disconnected` (with the reason) / `room_reconnecting` logging to
`CamViewfinder.jsx` — four lines, matching what `LiveDemo.jsx:1793-1800` already does for the main
room. Cheap, and it means Pilot 2 can answer this question from its own data instead of a
third-party console. **Not in the six pieces; tell me if you want it in.**

---

## 8. Migrations — the numbered set

Each ships as a copy-pasteable file in `docs/` with the full ritual inline: FK type check,
`information_schema` column check per altered table, conflict-target audit, policy check,
verification queries with stated expected results, and `notify pgrst, 'reload schema'`.
One file per table, never split.

| # | File | Touches | Type |
|---|---|---|---|
| 01 | `pilot2_01_shows_actual_times.sql` | `shows` | Additive: 3 nullable columns + index |
| 02 | `pilot2_02_viewer_sessions.sql` | `viewer_sessions` | New table |
| 03 | `pilot2_03_show_comments.sql` | `show_comments` | New table |
| 04 | `pilot2_04_reaction_events_viewer_id.sql` | `reaction_events` | Additive: 1 nullable column + index |
| 05 | `pilot2_05_room_events.sql` | `room_events` | New table |
| 06 | `pilot2_06_shot_commands_select_policy.sql` | `shot_commands` | Policy only, no schema change |

All additive. No type changes, no drops, no backfills, nothing destructive.
**Production and preview share one database — every one of these is a production migration.**

---

## 9. Schedule, and where the cut lines are

Ten days. **Freeze Friday 18 September**, dress rehearsal Saturday 19th, pilot Sunday 20th.

| Day | Work | Gate |
|---|---|---|
| **Thu 11** | Your approval + the §7.4 queries + **LiveKit webhook config check** (§5.1) + Vercel plan tier (§4.2 Layer D) | Answers before code |
| Fri 12 | Migrations 01–04 written; you run them | Verification queries pass |
| Sat 13 | Piece 1 (timings) + `showOriginMs` helper | Device test |
| Sun 14 | Piece 2 (viewer sessions, beacon, presence sampling) | Device test |
| Mon 15 | Piece 3 (comments) + Piece 6b notice copy for approval | Device test |
| Tue 16 | **Piece 4** — §4.3 first, then Layers A–C | Device test on **two** devices + a paired phone |
| Wed 17 | Piece 5 **if** the config check passed; migration 05–06; else cut | **Cut line for Piece 5** |
| **Thu 18** | Merge, deploy to production, grep the served bundle | Deploy verification |
| **Fri 18 EOD** | **FREEZE** | Nothing merges after this |
| **Sat 19** | **Dress rehearsal** — full show on real hardware, paired camera, second viewer device, then run the whole §2 SQL pack against it | **Pilot-ready gate** |
| Sun 20 | Pilot 2 | — |

**Cut order if I fall behind**, hardest to cut last: Piece 5 → the presence sampler (§2.5) →
Piece 6b's polish → Layer D of Piece 4. **Pieces 1, 2, 3 and Piece 4 Layers A–C do not get cut** —
1 because everything measures against it, 4A–C because it is the cost bug and the on-air risk.

### The rule I'll hold myself to
Nothing is called pilot-ready without Saturday's dress rehearsal producing rows I have actually
queried. A green local commit is not shipped; a deployed commit whose tables are empty is not
instrumented.

---

## 10. What I need from you before writing any code

1. **§1.3** — three-state `ended_by`, or one plain nullable `actual_ended_at`? *(I recommend the
   three-state.)*
2. **§3.2** — comment retention, and the 1,000-char cap with no moderation.
3. **§4.2 Layer D** — Vercel plan tier. Hobby means cron is once-daily and I'd cut Layer D.
4. **§5.1** — are room/participant webhooks enabled in the LiveKit project? *(Console check, five
   minutes, and it decides whether Piece 5 is a day or a cut.)*
5. **§6a** — SELECT policy scoped through `shows.room_name` to the show's owner, accepting that
   orphaned rows stay service-role-only?
6. **§7.5** — do you want camfeed room-lifecycle instrumentation added? It is outside the six
   pieces but it is the difference between diagnosing Pilot 2 from our own data or from LiveKit's
   console.

Plus the two §7.4 queries run against pilot 1, which decide how I write up the camfeed diagnosis.
