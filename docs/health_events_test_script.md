# Manual test script — health_events (Phase 3)

Laptop-performer setup, per the amended Phase 2 scope. Confirms the
health-event instrumentation lands the rows needed to diagnose Defect 1
(director stopped emitting shots) and Defect 2 (performer audio dead,
video fine) from a real 2-device pilot-style test.

## Before you start

1. Run `docs/health_events_migration.sql` in the Supabase SQL editor
   (not run automatically — this is the one step that needs to happen
   before any of this produces rows).
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

Every event type referenced below is exactly what's implemented in
`lib/healthLog.js` / `components/LiveDemo.jsx` / `lib/shotCommands.js` —
nothing here is aspirational.

---

## Test 1 — Refresh the performer tab mid-show

**Action:** With the show live and at least one `director_heartbeat`
already logged, hit refresh (Cmd+R / Ctrl+R) on Device A's tab. Wait
~10s, then manually redo the full rejoin flow (gate → mode → role →
performer code → Claim & Go Live) as quickly as you reasonably would in
a real show.

**Expected rows, healthy system:**
- `director_loop_stopped {reason: "unmount"}` — logged by the outgoing
  tab in the instant before the connection drops.
- `page_hide`, possibly `visibility_hidden` — the outgoing tab's last
  gasp (delivered via `sendBeacon`, so these should still arrive even
  though the tab is closing).
- **A real gap**: zero `director_heartbeat` / `director_shot_emitted` /
  `shot_publish_success` rows for this show for the entire time between
  refresh and completing the manual rejoin. This gap is the actual
  finding — its length is the production-impact number.
- After rejoin completes: `room_state_at_mount` (new
  `participant_identity`), `room_connected`, `track_local_published`
  (audio + video), then **`director_loop_started {reason: "recovery"}`**
  — this is the row that confirms the mount/transition/recovery
  classification actually works: it should read `"recovery"`, not
  `"mount"`, because this browser tab's `sessionStorage` remembers it
  already ran the director for this show once before.
- `director_heartbeat` resumes on its normal 10s cadence from the new
  identity.

**What would indicate something's actually broken (beyond the known
Phase 1 gap):** `director_loop_started` reads `"mount"` instead of
`"recovery"` on the rejoin (means the reason classification itself has a
bug); or no `director_loop_started` row at all despite completing the
rejoin (means auto never actually started — a real regression, not just
the known session-loss gap).

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
