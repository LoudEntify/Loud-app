# Shot Grammar + Auto-Director → LiveDemo.jsx Integration Spec (v3)

This is the single, complete integration spec. It supersedes the original
INTEGRATION.md Steps 1–3 and the v2 spec. Supabase setup steps (table SQL,
RLS policy) from INTEGRATION.md still stand.

The live system is `components/LiveDemo.jsx` + `app/api/token/route.js`.
There are no separate CameraCapture/DirectorView/ViewerStage LiveKit
components — mock pages with those names exist but are UI shells only.

PRD: Director Experience / AI Director Layer 1
S&I: Real-time media, Observability

## Prerequisites (already done — verify, don't redo)

- `lib/shotTypes.js`, `lib/shotCommands.js`, `lib/supabaseClient.js`,
  `lib/autoDirector.js` in `lib/`
- `components/ShotRenderer.jsx`, `components/DirectorShotPanel.jsx` in
  `components/`
- `@supabase/supabase-js` installed
- Supabase `shot_commands` table + insert RLS policy created
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in Vercel
  (and `.env.local` if developing locally)

## The system rule (context for every edit below)

1. **Auto-director runs by default** when a show starts — a solo artist
   never touches anything.
2. **Any human tap wins instantly** (last-command-wins on the pipe) and
   silences auto for a 45s cooldown; each tap resets the cooldown; auto
   resumes seamlessly after.
3. **Staccato suspends auto entirely** until stopped (exclusive mode).
   An Auto ON/OFF toggle covers full-manual shows.
4. Every cut — human or auto — flows through the same SHOT_COMMAND pipe,
   obeys the same grammar (transition rules), and is logged to Supabase
   (`decision_source`: 'human' = gold label, 'auto' = weak label).

---

## Edit 1 — Camera roles at join (LiveDemo.jsx, join flow ~lines 93–116)

Camera position (wide/close/side) does not exist yet. Add it:

1. New state: `const [camRole, setCamRole] = useState('wide');`
2. In the join UI, when the selected role starts with `camfeed-`, show a
   three-button picker: **Wide / Close / Side** → sets `camRole`.
3. Change the camfeed identity construction (~line 107) from:
   ```js
   identity = `camfeed-${camfeedSlot}-${Date.now()}-${name || 'cam'}`;
   ```
   to:
   ```js
   identity = `camfeed-${camfeedSlot}-${camRole}-${Date.now()}-${name || 'cam'}`;
   ```

New identity format: `camfeed-{slot}-{role}-{timestamp}-{name}`.
The contestant device is the implicit **main** role (no identity change).
Token route needs no change — it receives the full identity string as-is.

CHECK: grep for `split('-')` on camfeed identities anywhere else — the role
is now segment index 2. (`tracksForSlot` uses startsWith prefixes only, so
it is unaffected.)

## Edit 2 — Role vocabulary + role→identity resolution

### 2a. Update SHOT_TYPES sources (lib/shotTypes.js)

Replace the conceptual 'close' source with the real vocabulary:
- `mediumCU.source` → `['main', 'wide']`
- `closeUp.source` → `['main']`
- `bRoll.source` → `['side']`
- `dolly.source` → `['side']`
- `follow.source` → `['main', 'side']`

('main' = contestant's own phone, facing them; 'wide'/'side' = camfeeds.)

### 2b. Add resolveTargetIdentity (lib/shotCommands.js)

```js
// Maps a shot's desired role to a concrete participant identity from the
// live track list. Falls back: exact role → main (contestant) → any feed.
export function resolveTargetIdentity(tracks, slot, role) {
  const slotTracks = tracks.filter(
    (t) =>
      t.participant.identity.startsWith(`contestant-${slot}-`) ||
      t.participant.identity.startsWith(`camfeed-${slot}-`)
  );
  if (role && role !== 'main') {
    const match = slotTracks.find((t) =>
      t.participant.identity.startsWith(`camfeed-${slot}-${role}-`)
    );
    if (match) return match.participant.identity;
  }
  const main = slotTracks.find((t) =>
    t.participant.identity.startsWith(`contestant-${slot}-`)
  );
  return (main || slotTracks[0])?.participant.identity ?? null;
}
```

`buildShotCommand` gains a `targetIdentity` field: the director resolves the
identity BEFORE broadcasting. Viewers never do role-matching — they display
the identity they're told.

### 2c. Available roles helper (LiveDemo.jsx)

```js
const availableRoles = (slot) => {
  const roles = new Set();
  tracks.forEach((t) => {
    const id = t.participant.identity;
    if (id.startsWith(`contestant-${slot}-`)) roles.add('main');
    if (id.startsWith(`camfeed-${slot}-`)) roles.add(id.split('-')[2]);
  });
  return [...roles];
};
```

## Edit 3 — SHOT_COMMANDs on the existing data channel (LiveDemo.jsx ~273–315)

LiveDemo routes data messages by `type` inside one `useDataChannel` callback.
Match that convention:

1. In `lib/shotCommands.js` `broadcastShotCommand`: drop the `topic` option —
   messages are distinguished by `type: 'SHOT_COMMAND'` like `comment` and
   `active-camera`. `subscribeToShotCommands` is not needed in this
   integration (delete or leave unused).
2. In LiveDemo's `useDataChannel` callback, add:
   ```js
   if (payload.type === 'SHOT_COMMAND') {
     setActiveShot((prev) => ({ ...prev, [payload.slot]: payload }));
   }
   ```
3. New state: `const [activeShot, setActiveShot] = useState({});` — the full
   command per slot becomes the source of truth (contains targetIdentity,
   shot, transition, params). Keep the old `active-camera` handler during
   transition; remove once the feed picker is rewired (Edit 5).

## Edit 4 — ShotVideo: conditional transitions + transforms (~lines 30–74, 317–325)

**The critical edit.** `CrossfadeVideo` currently fades every switch (400ms) —
the grammar requires hard cuts for staccato/zoom. Upgrade it into `ShotVideo`:

### 4a. Conditional transition
- `command.transition === 'cut'` → replace layers in ONE state set: no fade
  layer, no 450ms overlap, no opacity transition. Instant swap.
- `command.transition === 'fade'` → existing crossfade path.
- Standardise duration: import `FADE_MS` from `lib/shotTypes.js` (350ms) and
  use it in place of the hardcoded 400/450ms so all clients agree.

### 4b. Transform wrapper
Port the transform `useEffect` from `components/ShotRenderer.jsx` into
ShotVideo: crop / animatedZoom / animatedPan styles computed from `command`,
applied to a wrapper div around `<VideoTrack>` (outer div `overflow: hidden`;
inner element gets transform + transformOrigin + transition; use the
double-requestAnimationFrame kick for animated transforms; last command
cancels any in-flight animation).

`components/ShotRenderer.jsx` then serves as the reference implementation —
delete it once ShotVideo passes the test plan, or keep for future standalone
stages.

### 4c. renderSlot rewrite

```js
const renderSlot = (letter) => () => {
  const candidates = tracksForSlot(letter);
  const cmd = activeShot[letter];
  const chosen =
    (cmd?.targetIdentity &&
      candidates.find((t) => t.participant.identity === cmd.targetIdentity)) ||
    candidates.find((t) => t.participant.identity.startsWith(`contestant-${letter}-`)) ||
    candidates[0];
  const placeholder = <span>waiting for {performanceMode === 'solo' ? 'performer' : `contestant ${letter}`}...</span>;
  return <ShotVideo trackRef={chosen} command={cmd} placeholder={placeholder} />;
};
```

## Edit 5 — Mount DirectorShotPanel + rewire the feed picker

In the director's UI area (where `onPickCamera` / VideoDeckPanel controls
render), per slot:

```jsx
<DirectorShotPanel
  room={room}
  showId={ROOM_NAME}
  slot={letter}
  availableRoles={availableRoles(letter)}
  tracks={tracks}                        // for resolveTargetIdentity
  onExclusiveMode={(on) => on ? auto.suspend() : auto.resume()}  // staccato ↔ auto
  onHumanCommand={() => auto.notifyHumanCommand()}               // cooldown reset
  onCommand={(cmd) => setActiveShot((prev) => ({ ...prev, [cmd.slot]: cmd }))}
/>
```

DirectorShotPanel changes required:
- Accept `tracks` prop; its `fire()` resolves `targetIdentity` via
  `resolveTargetIdentity(tracks, slot, sourceRole)` and puts it on the command.
- Accept `onHumanCommand` prop; call it inside `fire()` for every human tap
  (NOT for sequencer auto-cuts).
- `onCommand` applies the shot locally so the director sees the result
  without waiting for their own data-message echo.

Old per-feed picker (`onPickCamera`): keep as a small "Feeds" list under the
shot panel, but rewire it to emit a SHOT_COMMAND (nearest shot key for that
feed's role, `decisionSource: 'human'`) instead of the old `active-camera`
message — so direct feed picks are logged too. Then remove the
`active-camera` handler from Edit 3.

## Edit 6 — Auto-director wiring (LiveDemo.jsx)

```js
import { createAutoDirector } from '../lib/autoDirector';
```

Create once per show (e.g. useMemo/useRef after room connect):

```js
const auto = useMemo(() => createAutoDirector({
  fireShot: (shotKey, decisionSource) => {
    const sourceRole = resolveSourceRole(shotKey, availableRoles(activeSlot));
    const command = buildShotCommand({
      showId: ROOM_NAME,
      slot: activeSlot,               // solo: 'a'; versus: alternate or per-slot autos
      shotKey,
      fromShotKey: activeShot[activeSlot]?.shot ?? null,
      sourceRole,
      targetIdentity: resolveTargetIdentity(tracks, activeSlot, sourceRole),
      decisionSource,                  // 'auto'
    });
    broadcastShotCommand(room, command);
    setActiveShot((prev) => ({ ...prev, [command.slot]: command }));
  },
  getAvailableShots: () => {
    const roles = availableRoles(activeSlot);
    return Object.keys(SHOT_TYPES).filter((k) => {
      const src = SHOT_TYPES[k].source;
      if (src === 'currentOrSelected') return roles.length > 0;
      if (src === 'multi') return false;      // staccato is never auto-picked
      return src.some((r) => roles.includes(r));
    });
  },
}), [room, tracks, activeSlot]);
```

Lifecycle:
- `auto.start()` when the show/broadcast begins (NOT on page mount — only
  when a performer is live).
- `auto.stop()` on show end / unmount.
- **Only one client runs auto** — the show owner/director device. Gate the
  creation on the same condition that shows the director panel. If auto ran
  on every client, viewers would each broadcast duplicate commands.

Add to the director panel UI: an **Auto** indicator-toggle showing
`auto.state` ('running' teal / 'cooldown' orange / 'suspended' or 'off'
dimmed), wired to `auto.enable()/auto.disable()`.

Versus shows for the pilot: run auto on slot 'a' only, or duplicate the
createAutoDirector per slot — director's choice; simplest is one auto on the
active performing slot.

## Edit 7 — Token route audit (app/api/token/route.js)

No change expected — verify only:
- Camfeed identities: `canPublishData: false` (correct, keep).
- Contestant + viewer identities: `canPublishData: true` (needed for
  commands from a director device and fan reactions; confirmed by commit
  6789146).

---

## Test plan (solo, three phones + laptop)

1. **Join & identities:** phone 1 = contestant A (main), phones 2–3 =
   camfeed A picking Wide and Side. LiveKit dashboard shows
   `camfeed-a-wide-...` / `camfeed-a-side-...`.
2. **Auto runs hands-free:** start the show, touch nothing. Cuts happen
   every ~8–20s across wide/main/b-roll with occasional zooms, never the
   same shot twice in a row. All rows in Supabase show
   `decision_source = 'auto'`.
3. **Human override:** tap Close Up → instant cut, Auto badge flips to
   'cooldown' (orange). No auto cuts for 45s, then auto resumes (badge
   teal). The override row logs `decision_source = 'human'` with
   `from_shot` = whatever auto was showing (gold negative signal).
4. **Grammar enforcement:** tap B-Roll from Wide → fade (the only default
   fade). Tap Zoom In → smooth 4s push, hard cut in. Tap Wide mid-zoom →
   instant cancel (last-command-wins).
5. **Staccato:** start it → rapid HARD cuts, no crossfade (verifies 4a);
   Auto badge 'suspended'. Stop → auto resumes.
6. **Auto OFF:** toggle off → no auto cuts at all; manual taps still work.
7. **Sync:** second viewer device shows the same shot within a blink.
8. **Flywheel check:** Supabase `shot_commands` has both label types,
   `from_shot` populated from the second cut, `targetIdentity` on every row.

Tuning knobs after the first run: crop `scale`/`originY` values and animation
durations in `lib/shotTypes.js`; `OVERRIDE_COOLDOWN_MS`, `AUTO_POOL` weights,
and `MIN/MAX_HOLD_MS` in `lib/autoDirector.js`.

## Claude Code handoff instruction

> Implement docs/SHOT_INTEGRATION_LIVEDEMO.md edits 1 through 7 in order.
> After each edit, show me a summary of what changed before moving on.
> Do not commit until all edits pass a local build.
