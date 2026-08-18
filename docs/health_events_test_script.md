# Manual test script — health_events (Phase 3)

Laptop-performer setup, per the amended Phase 2 scope. Confirms the
health-event instrumentation lands the rows needed to diagnose Defect 1
(director stopped emitting shots) and Defect 2 (performer audio dead,
video fine) from a real 2-device pilot-style test.

## Before you start

1. Run `docs/health_events_migration.sql` in the Supabase SQL editor
   (not run automatically — this is the one step that needs to happen
   before any of this produces rows).

   **Verify it actually landed before doing anything else** — a
   fail-silent logger writing to a table that doesn't exist produces no
   error anywhere visible, just silent data loss. Don't trust that the
   migration ran cleanly just because the SQL editor didn't show a red
   error; run this and confirm it returns exactly one row:

   ```sql
   select table_schema, table_name
   from information_schema.tables
   where table_name = 'health_events';
   ```

   Zero rows means the table isn't there — stop and re-run the
   migration (check for an error you may have missed, wrong project/
   schema selected, etc.) before proceeding.

2. Confirm the preview deployment: `https://loud-app-git-main-korey-alashe.vercel.app`
   (this is a **Preview** deployment — production, currently served from
   `pilot-freeze-v3`, is untouched by this branch of work; see the
   updated deployment-branch-policy note if you want to re-verify that
   yourself before testing).
3. Devices:
   - **Device A — performer laptop.** Runs the show (`Claim & Go Live`,
     performer code required — same as before).
   - **Device B — viewer.** Any second device, phone or laptop, joins as
     a plain viewer.
   - **Device C — phone, secondary case only (Test 6).** Used to repeat
     a short segment AS the performer, specifically to re-check the
     mobile-suspend hypothesis from Phase 1 now that we have real
     instrumentation for it.
4. Start the show as normal (gate → mode → role → performer code →
   Claim & Go Live on Device A; join as viewer on Device B) and let auto
   run for at least 30s before starting Test 1, so you have a baseline
   `director_heartbeat` cadence to compare against.

5. **Smoke-test the logger before running any deliberate test actions.**
   With the show live and Device A/B both joined for at least 60s (so at
   least one batch from each has had time to flush — `lib/healthLog.js`
   flushes at most once/sec, well under a minute), run:

   ```sql
   select count(*) from health_events;
   ```

   This must be nonzero before you start Test 1. If it's still zero
   after 60s of a joined live session, something in the write path is
   broken (check the deployed function logs for `[health-events]`
   warnings before assuming the test itself is the problem) — don't
   spend time running the refresh/Bluetooth/wifi tests against a logger
   that isn't writing.

Every event type referenced below is exactly what's implemented in
`lib/healthLog.js` / `components/LiveDemo.jsx` / `lib/shotCommands.js` —
nothing here is aspirational.

---

## Test 1 — Refresh the performer tab mid-show (fixes (b)+(c) in place)

**Action:** With the show live and at least one `director_heartbeat`
already logged, hit refresh (Cmd+R / Ctrl+R) on Device A's tab. Wait
~10s, then manually redo the full rejoin flow (gate → mode → role →
performer code → Claim & Go Live) as quickly as you reasonably would in
a real show. **Watch Device B (viewer) throughout, not just Device A**
— the whole point of this test is that Device A's own screen looked
fine even when it was originally broken.

**Expected rows, healthy system:**
- `director_loop_stopped {reason: "unmount"}`, then `page_hide` /
  possibly `visibility_hidden` — the outgoing tab's last gasp (via
  `sendBeacon`), same as before.
- **A real gap**: zero `director_heartbeat` / `director_shot_emitted` /
  `shot_publish_success` rows for this show between refresh and
  completing the manual rejoin. This gap is expected and not itself a
  regression — it's the known session-loss gap (Phase 1, unchanged this
  round); its length is the production-impact number.
- After rejoin: `room_state_at_mount` (new `participant_identity`),
  `room_connected`. **Fix (b) — this is the row that changed:**
  `director_loop_started {reason: "recovery"}` should now appear *at or
  after* `room_connected`'s timestamp, not before it (previously
  confirmed firing ~280ms *before* `room_connected`). `track_local_published`
  for video should follow shortly after.
- `director_heartbeat` resumes on its normal 10s cadence, and
  `shot_publish_success` rows should appear on the normal auto cadence
  with **no `shot_publish_failure` rows at all** for the rest of the
  session. This is the expected outcome now — fix (b) narrows the race
  significantly for the common case where the rejoin's own connect
  completes before the director's first scheduled cut (~1s after
  start).
- **On Device B:** the viewer should see cuts/zooms resume normally,
  matching whatever's happening on Device A — this is the actual
  regression test. Previously this was the broken half (director
  visibly running locally, viewer stuck).

**If a `shot_publish_failure` still appears** (fix (b) narrows the race,
it doesn't provably close it — see the caveat in the commit/code
comment): expect exactly the fix (c) recovery sequence described in
Test 1b below, ending in either normal `shot_publish_success` resuming
or the visible warning banner. That's not a failure of this test by
itself — it's fix (c) doing its job. What *would* indicate a real
regression: `shot_publish_failure` rows with no `publish_recovery_attempt`
following within a few seconds (means the 3-consecutive-failures
detection isn't firing), or `director_loop_started` reading `"mount"`
instead of `"recovery"` on the rejoin (means the reason classification
broke), or no `director_loop_started` row at all despite completing the
rejoin (means auto never started at all — a real regression, not the
known session-loss gap).

---

## Test 1b — Forced-failure path (verify the recovery + warning UI)

This exercises fix (c) directly rather than hoping Test 1 happens to hit
the race. **Caveat up front:** the underlying SDK race (a publish
landing in the split-second window before the engine's publisher
transport is ready) is narrow and not deterministically reproducible by
hand — treat this as "best effort, repeat if it doesn't trigger" rather
than a guaranteed one-shot repro. The `health_events` rows are the
authoritative confirmation either way, not what you see on screen.

**Action:** Repeat Test 1's refresh + rejoin, but this time, the instant
you tap "Claim & Go Live", open Chrome DevTools → Network tab → set
throttling to **Offline** for ~1–2 seconds, then set it back to **No
throttling**. The goal is to have the room's signaling connection
complete (or appear to) while the underlying transport is still
unsettled, timed around the director's first scheduled cut (~1s after
`director_loop_started`). If nothing fails, try again — this may take a
few attempts.

**Expected rows if the race is hit:**
- Three consecutive `shot_publish_failure` rows (`error: "PC manager is
  closed"` or similar) with `connectionState: "connected"` each time.
- `publish_recovery_attempt {trigger: "auto"}` immediately after the 3rd
  failure, followed by `publish_recovery_outcome` with either
  `outcome: "reconnected"` or `outcome: "failed"`.
- **If `"reconnected"`:** the next real shot (auto or a manual tap)
  should log `shot_publish_success`, and Device B should start receiving
  cuts again. No warning banner should appear (or it should appear
  briefly then clear — `publishWarning` clears on the next
  `shot_publish_success`).
- **If `"failed"`, or if failures continue after a `"reconnected"`
  outcome:** the live banner on Device A should show **"⚠ Viewers can't
  see your cuts — tap to reconnect"** with a **Reconnect** button.
  Confirm it's actually visible on screen, not just in the data. Tap
  **Reconnect** and confirm a `publish_recovery_attempt {trigger:
  "manual"}` row appears, and that a manual tap is repeatable (tapping
  again after another failure fires another `trigger: "manual"` attempt
  — only the *automatic* path is limited to one attempt, per spec).
- Confirm **no more than one** `publish_recovery_attempt {trigger:
  "auto"}` appears per session — a second automatic attempt without a
  manual tap in between would be a real bug (the "no infinite retry
  loops" constraint).

**Known side effect to expect, not a new bug:** if audio was already
publishing successfully before this test, a reconnect (auto or manual)
may mute it — `mst_muted {which: "published"}` and/or a gap in
`mic_level_sample`'s `outputRms`. This is the audio={false}-vs-manual-
publish conflict from Part 3, explicitly deferred this round; the audio
publish/mute logging added this round (`audio_publish_attempt/success/
failure`, `signal_connected`) is what will let us fix it properly next
round, not something to chase down now.

---

## Test 2 — Switch to another tab for 60s (performer)

**Action:** While live, on Device A, switch to a different browser tab
(not minimized) for 60s, then switch back.

**Expected rows, healthy system:** `visibility_hidden
{audioContextState: "running"}` on switch-away, `visibility_visible
{audioContextState: "running"}` on return. In between,
`mic_level_sample` should keep arriving every 5s with `audioContextState:
"running"` throughout and `outputRms`/`inputRms` unaffected —
desktop Chrome does not suspend a background tab's AudioContext the way
mobile Safari does. `director_heartbeat` should be unaffected too.

**What would be a new finding:** `mic_silent` firing during this window,
or `audiocontext_statechange` to `"suspended"` appearing — would mean
desktop background-tabbing also triggers the suspend behavior Phase 1
only predicted for mobile lock/background.

---

## Test 3 — Minimize the browser window for 60s

**Action:** Minimize the whole browser window (not just switch tabs) for
60s, then restore it.

**Expected rows, healthy system:** Same shape as Test 2 —
`visibility_hidden` / `visibility_visible` bracketing the window, no
`mic_silent`, `mic_level_sample` unaffected, `audioContextState` stays
`"running"` throughout.

**What would be a new finding:** any silence signature here — would mean
minimizing (not just backgrounding a tab) is enough to trigger
suspension on this OS/browser combination, worth knowing since a
performer minimizing to check something is very plausible mid-show.

---

## Test 4 — Connect then disconnect a Bluetooth audio device mid-show

**Action:** While live and performing through the built-in mic, pair and
connect a Bluetooth headset (or any external audio input) mid-show.
Wait ~15s, then disconnect/power it off. Wait ~15s more.

**Expected rows, healthy system:** `audio_devicechange` fires on
connect, with the new device now present in `audioInputs`. Watch
`mic_level_sample`'s `deviceId`/`deviceLabel` fields across this
window — the app never pins `deviceId` in its `getUserMedia` call
(`lib/audioProcessing.js:39-45`), so whether the OS silently switches
the active capture device to the Bluetooth input is itself something
this test observes rather than assumes. `audio_devicechange` fires
again on disconnect.

**This is the signature that would confirm the new Defect 2
hypothesis:** an `mst_muted` or `mst_ended` event on the **raw** track
(`{which: "raw", ...}`) around the disconnect moment, with **no**
corresponding LiveKit-level `track_muted`/`track_unpublished` row —
i.e. the publication looks fine but the underlying device died — followed,
if it persists ≥10s, by `mic_silent` with both `outputRms` and
`inputRms` near zero. Recovery (OS falling back to the built-in mic)
should show up as `mst_unmuted` and/or `mic_recovered`.

**Healthy/no-op outcome:** if the OS keeps using the built-in mic
throughout and nothing about the active device actually changes, you'd
just see `audio_devicechange` rows with steady `mic_level_sample`
readings in between — also a valid, useful result (rules the hypothesis
out on this specific machine/OS combination).

---

## Test 5 — Kill wifi 15s and restore

**Action:** While live, disable Device A's wifi (or unplug ethernet) for
15s, then restore it.

**Expected rows, healthy system:** `room_reconnecting` shortly after the
drop, `room_connection_state_changed` rows bracketing it, `room_reconnected`
once restored. If a `director_shot_emitted` happens to land mid-outage,
expect a `shot_publish_failure` with `connectionState` reflecting the
degraded state (Phase 1 D1 hypothesis 2's staccato precedent —
`UnexpectedConnectionState`, expected and self-healing). Critically,
`director_heartbeat` should **keep logging throughout the outage** on
its own 10s cadence — it's a local `setInterval`, independent of
connection state — confirming the loop itself survives a network blip
even while publishing fails. After `room_reconnected`,
`shot_publish_success` should resume on the next cut.

**Note on `mic_level_sample` during this test:** it taps the *local* Web
Audio graph, before anything reaches the network — so it will show
normal readings throughout a network-only outage regardless of what a
viewer actually received. That's expected and not evidence either way
for this specific test; it's `shot_publish_failure` /
`room_reconnected` you're watching here, not mic level.

**What would indicate the reconnect gap Phase 1 flagged:** `room_reconnected`
fires, but `shot_publish_success` never resumes afterward (would confirm
the manually-published track isn't actually surviving/being re-verified
after a reconnect, per the Phase 1 B finding that nothing handles
`Reconnected` explicitly).

---

## Test 6 (secondary case) — phone performer, leave screen untouched past auto-lock

**Action:** Repeat a short live segment using a **phone** as the
performer device (Device C) instead of the laptop. Don't touch it —
let the screen auto-lock on its own timeout, and leave it locked for at
least 60s past that point, then unlock.

**Expected rows, healthy-instrumentation (regardless of whether the
underlying behavior is "good" or "bad" — this test is about confirming
Phase 1's original mobile hypothesis, which is expected to reproduce
here):** `visibility_hidden` at lock, followed by
`audiocontext_statechange {state: "suspended"}` — this is the exact
mechanism Phase 1 named. `mic_level_sample` may either stop entirely
(if the sampling interval itself gets throttled while backgrounded) or
keep reporting with `outputRms` near zero and `audioContextState:
"suspended"` — both are useful, record whichever happens.
`mic_silent` should fire once the threshold passes.

**The key signature to watch for on unlock:** `visibility_visible`
fires, but — because nothing in this codebase calls
`audioContext.resume()` (confirmed in Phase 1) — `audiocontext_statechange`
back to `"running"` may **not** follow automatically. If `mic_recovered`
never fires even though the screen is unlocked and the tab is visible
again, that's the confirming signature: silence that outlives the
visibility-restored point, not just coincides with it.

---

## Timeline reconstruction query

Run this in the Supabase SQL editor after the test session, against the
`health_events` table from `docs/health_events_migration.sql`:

```sql
select
  client_ts,
  participant_identity,
  role,
  event_type,
  detail
from health_events
where show_id = 'pilot-room'
order by client_ts asc;
```

This is the one query — every event from every device/role is
interleaved in true chronological order (`client_ts`, not insertion
order), so `mic_silent`/`mic_recovered` windows can be read directly
against whatever `mst_muted`/`mst_ended`/`audio_devicechange`/
`visibility_hidden`/`room_reconnecting`/`director_loop_stopped` rows
bracket them, without a join. Narrow to one device while debugging with
`and participant_identity = '<identity from the row you're chasing>'`.
