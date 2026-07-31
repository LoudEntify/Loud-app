# Show Lifecycle Spec (Pilot-Lite) — v1

Implements the show state machine, Go Live / soundcheck flow, viewer
countdown, QR camera pairing, and re-keys the auto-director's start trigger.
Complements SHOT_INTEGRATION_LIVEDEMO.md (edits 1–7); adjusts Edit 6's
lifecycle wiring.

Locked decisions:
- Go-live is CLOCK-TRIGGERED at `slated_at`. The artist never taps a second
  button; they see their own countdown during soundcheck.
- Soundcheck window opens 30 minutes before `slated_at`.
- QR camera pairing is in scope for the pilot.

PRD: Live Show / Director Experience / AI Director Layer 1
S&I: Database (shows table), Real-time media, Auth (deferred hardening
noted), Observability (show_phase labelling)

Out of scope for pilot-lite (post-pilot): discover/profile page wiring to
real show data, multiple concurrent shows, real authentication on the Go
Live button, token signing/expiry hardening.

---

## 1. Show states

`scheduled → soundcheck → live → ended`

- **scheduled**: show exists with a `slated_at` time. Room may be empty.
- **soundcheck**: artist tapped Go Live (allowed from `slated_at` minus 30
  min). Cameras publish, audio runs, shot taps work. Viewers see a holding
  screen with countdown — never the feed.
- **live**: automatic at `slated_at`. Viewers cut from countdown to
  programme feed. Auto-director starts.
- **ended**: artist taps End Show (or leaves + timeout post-pilot).
  Auto-director stops.

`live` is DERIVED, not stored: a show whose stored state is 'soundcheck'
with `now >= slated_at` IS live. This avoids any background job/cron flipping
rows (Background jobs stay Phase 2). Stored states are only:
'scheduled' | 'soundcheck' | 'ended'.

```js
// lib/showState.js (new)
export function effectiveState(show, now = Date.now()) {
  if (!show) return 'scheduled';
  if (show.state === 'ended') return 'ended';
  const slated = new Date(show.slated_at).getTime();
  if (show.state === 'soundcheck') return now >= slated ? 'live' : 'soundcheck';
  return 'scheduled';
}
export const SOUNDCHECK_WINDOW_MS = 30 * 60 * 1000;
export function canGoLive(show, now = Date.now()) {
  const slated = new Date(show.slated_at).getTime();
  return show.state === 'scheduled' && now >= slated - SOUNDCHECK_WINDOW_MS;
}
```

## 2. Supabase: shows table

```sql
create table if not exists shows (
  id          uuid primary key default gen_random_uuid(),
  room_name   text not null unique,       -- LiveKit room, e.g. 'pilot-room'
  artist_name text not null,
  slot        text not null default 'a',
  slated_at   timestamptz not null,
  state       text not null default 'scheduled',  -- scheduled|soundcheck|ended
  created_at  timestamptz default now()
);

alter table shows enable row level security;
create policy "read_shows"  on shows for select using (true);
create policy "update_shows" on shows for update using (true) with check (true);
create policy "insert_shows" on shows for insert with check (true);
```

Pilot-honesty note: open update policy = anyone with the anon key could flip
state. Acceptable for a 40-person pilot with no money attached; goes on the
open-items list with the RLS tightening + auth work post-pilot.

Also add phase labelling to the flywheel:

```sql
alter table shot_commands add column if not exists show_phase text default 'live';
```

`buildShotCommand` gains a `showPhase` param ('soundcheck' | 'live') logged
into that column — soundcheck taps must not pollute Layer 3 training data.

## 3. Client flow (LiveDemo.jsx + one new page)

### 3a. Show fetch + state
On room page load, fetch the show row for ROOM_NAME (create one manually in
Supabase for the pilot show; a tiny admin insert is fine). Hold in state;
recompute `effectiveState` on a 1s interval (drives all countdowns and the
flip). At the moment soundcheck→live flips, the director device also
broadcasts `{ type: 'SHOW_LIVE' }` on the data channel as belt-and-braces
sync so all clients flip within a data-message hop even if clocks drift.
Clients treat EITHER local clock flip OR SHOW_LIVE receipt as live.

### 3b. Artist: Go Live + countdown
On the artist's join/broadcast screen (artist = whoever joins as contestant
for the show's slot, pilot-lite trust model):
- If `canGoLive(show)`: show a **Go Live** button → updates the shows row
  state to 'soundcheck' and enters the room publishing as today.
- Before window opens: disabled button with "Soundcheck opens at {time}".
- During soundcheck: banner "SOUNDCHECK — you go public in {mm:ss}" (teal
  #2ec4b6 on ink #011627). Shot taps allowed (showPhase: 'soundcheck').
- At zero: banner flips to "LIVE" (red #e71d36, mildly neonized).

### 3c. Viewers: holding screen
While effectiveState is 'scheduled' or 'soundcheck', viewers joining the
room render a holding screen INSTEAD of renderSlot output: Loudentify mark,
artist name, "Starting {time}" + countdown (porcelain #fdfffc on ink).
Viewers may connect to the room early (simpler than gating the connection);
they simply don't render video/audio until live. Mute/skip audio rendering
during holding — soundcheck audio must not leak. At live: hard cut from
holding screen to programme feed (this is the show's first "shot" — make it
land like one).
- 'ended': "Show ended" card.

### 3d. Auto-director trigger (adjusts Edit 6)
- `auto.start()`: on the director device when effectiveState transitions
  → 'live' (from SHOW_LIVE broadcast or local clock, whichever first).
- `auto.stop()`: on transition → 'ended', and on unmount.
- Never runs during soundcheck. Artist shot taps during soundcheck are
  human commands with showPhase 'soundcheck'.
- Single-client gate unchanged: only the director device (pilot: the
  artist's/owner's device showing the director panel).

### 3e. End Show
Artist-side button during live → sets shows.state = 'ended' + broadcasts
`{ type: 'SHOW_ENDED' }`. Viewers flip to ended card; auto stops.

## 4. QR camera pairing

New route: `app/cam/page.jsx` (client component), reached via QR.

URL shape: `/cam?room={room_name}&slot={slot}&role={wide|close|side}`

Page behaviour:
1. Reads params; if `role` missing, shows the Wide/Close/Side three-button
   picker (reuses Edit 1's picker).
2. Fetches a token from the existing `/api/token` route with a camfeed
   identity: `camfeed-{slot}-{role}-{Date.now()}-qr` (Edit 1 format).
3. Connects, publishes camera (video only; mic off by default for extra
   phones — mic comes from the main/contestant device), `canPublishData:
   false` as today.
4. Fullscreen self-view with a large role label overlay ("WIDE" etc., ink
   background bar, porcelain text) so a propped phone is identifiable from
   across the room. Wake-lock via navigator.wakeLock.request('screen')
   wrapped in try/catch (keeps the phone from sleeping mid-show; silently
   ignored where unsupported).

Artist-side: in the broadcast screen (sibling panel from RoomInner, same
placement rule as DirectorShotPanel — do NOT edit PerformerDeck internals),
an **Add camera** section showing three QR codes (Wide / Close / Side), each
encoding the /cam URL with that role. Generate QRs client-side with the
`qrcode` npm package (add dependency). Under each QR: the role name + a
copyable link fallback.

Pilot-honesty note: the QR link carries no secret — anyone with the URL
could join a camera to the room. Same trust level as the current open join
screen, so no regression; token scoping/expiry is listed post-pilot
alongside auth.

## 5. Build order & checkpoints (continue the per-edit protocol)

- **L1**: lib/showState.js + shows table SQL + show fetch/interval in
  LiveDemo + showPhase on buildShotCommand/logShotCommand.
- **L2**: Artist Go Live button + soundcheck/live banners + End Show.
- **L3**: Viewer holding screen + SHOW_LIVE/SHOW_ENDED handling + audio
  gating during holding.
- **L4**: Auto-director re-keyed to lifecycle (replaces the Edit 6
  first-video trigger).
- **L5**: /cam page + QR panel (+ `qrcode` dependency).

After each: summary (full code for L3 and L4), build must pass, no commit
until all pass and approved.

## 6. Test plan additions (runs before the shot-grammar test plan)

1. Create the pilot show row with slated_at ~35 min out. Artist screen shows
   disabled Go Live with the open time; button enables at T-30.
2. Tap Go Live → soundcheck banner + countdown. Viewer device shows holding
   screen + countdown; NO video or audio leaks.
3. Tap shots during soundcheck → cuts work on artist/director view;
   Supabase rows show show_phase 'soundcheck'; auto never fires.
4. Scan each QR with the spare phones → cam page opens, role label correct,
   feeds appear in the director panel with camfeed-{slot}-{role}-… identities.
5. At slated_at: viewer hard-cuts from countdown to programme feed; auto
   begins cutting within ~10s; rows show show_phase 'live',
   decision_source 'auto'.
6. Human override mid-live → cooldown behaviour per shot-grammar test plan.
7. End Show → viewers get ended card; auto stops; no further rows.
8. Clock-drift sanity: put one viewer device's clock 2 min off — it should
   still flip on SHOW_LIVE receipt.
