# LOUDENTIFY — TECHNICAL HANDOVER

5 September 2026 · `main` at `9a9ccb4` (MVP round 3 merged)

Written for a developer joining with no prior context. It explains the
reasoning as well as the decisions, because the reasoning is what stops
you re-litigating settled questions or repeating solved mistakes.

**Where this document is uncertain it says so.** Nothing here is claimed
as working unless it has been device-tested or can be shown in the code,
and the two are distinguished throughout.

---

# 1 · WHAT LOUDENTIFY IS

## The product

An **AI-directed live music broadcast platform for independent and
unsigned artists.** An artist performs live; multiple cameras cover them;
an autonomous director engine cuts between those cameras the way a
television director would, without anybody operating it. Fans watch,
react, and spend tokens.

The distinguishing features:

- **Multi-camera live performance.** The artist's own device plus paired
  phones acting as extra cameras (wide / close / side).
- **An autonomous director.** A rules-based engine (Layer 1) choosing
  shots on a choreographed cycle, with every human override recorded as
  training signal for a later learned director (Layer 3).
- **Versus.** Two artists in one show, each directing their own cameras,
  split-screen, with the running order agreed between them verbally.
- **A token economy.** Fans buy tokens, spend them on reactions and
  gifts; artists cash out. Append-only ledger.
- **Cue sheets.** An artist can pre-programme camera cuts against
  timestamps in their own backing track, so a performance is directed to
  a plan they wrote.

**Originals-only at launch** — artists perform their own material, which
sidesteps mechanical licensing entirely for the pilot. **18+ only**,
enforced at three layers (signup, the token route, and the participants
route).

**Artists perform primarily from a phone.** This is the single most
load-bearing product decision in the codebase. It is why the layout
stacks vertically on narrow screens, why capability differences between
mobile browsers matter so much, and why CPU pressure on a handset is
treated as a first-class problem rather than an optimisation.

## The technical shape

| Layer | Technology | Why |
|---|---|---|
| App | **Next.js 14, App Router**, deployed on **Vercel** | One repo for UI and API routes; preview deployments per branch are how everything is device-tested |
| Real-time media | **LiveKit Cloud** (`livekit-client` 2.22.0) | WebRTC SFU. Publishes camera/audio, subscribes viewers, carries the data channel, and runs server-side **egress** for recording |
| Database, auth, storage | **Supabase** (Postgres, RLS, Realtime, Storage) | Row-level security is the actual authorization boundary for most tables; Realtime carries show state; Storage holds b-roll clips, backing tracks and recordings |

**What runs where, and why it matters:**

- **On the artist's device:** camera capture, microphone capture, the
  entire Web Audio processing chain (highpass → compressor → reverb →
  output bus), backing-track decode and playback, waveform rendering,
  and the director engine for their own slot. This is a lot, and it is
  the context for the CPU investigation in §3.
- **On LiveKit's servers:** forwarding media between participants,
  simulcast layer selection, and compositing the recording.
- **On Vercel:** API routes that need a secret or a privileged write —
  LiveKit token minting, service-role database writes, signed storage
  URLs. Nothing media-related.
- **In Postgres:** everything durable. The rule the codebase follows is
  that **the client never holds important state as the only copy**.

---

# 2 · WHAT IS BUILT AND WORKING

Each item says whether it has been **device-tested on real hardware** or
is **correct by reading** — believed right from the code but never
exercised end to end. That distinction is the most useful thing in this
section.

## The AI director and shot grammar — device-tested

`lib/shotTypes.js` defines every shot: `wide`, `mediumCU`, `closeUp`,
`bRoll`, `zoomIn`, `zoomOut`, `pan`, `staccato`, `bRollClip`. Each
declares which source role it can resolve against, its transition, and
its transform.

`lib/autoDirector.js` walks a **fixed choreography cycle** — wide →
mediumCU → closeUp → bRoll → mediumCU — rather than picking randomly,
holding each shot for a per-framing duration (wide 12–18s, closeUp
6–10s). It skips a step whose feed is not live, or whose feed is the one
already showing (no angle change). If nothing in the pattern resolves to
a different feed it enters *single-camera mode*, where movement provides
the variety instead of cuts.

**Rules that are load-bearing and must not be casually changed:**

- **`decisionSource` is exactly `auto | human | cue`.** It is the weak
  label on every command and the training signal for Layer 3. A human
  overriding auto is the gold signal.
- **Motion is hard-capped at 1.2×.** Beyond that a zoom on a phone
  camera reads as a mistake.
- **Slot roles are intent-based, never device ID.** A camera is `wide`
  because the artist said it is, not because of which phone it is. A
  phone that turns around is still the SIDE camera.

`suspendedBy` in the director is **a set of named owners**, not a
boolean. Three things can hold auto down — `staccato`, `cue`, `broll` —
and a boolean let one release another's hold. See §5.

## `lib/trackSources.js` — the discriminator — device-tested

**Read this file before touching anything media-related.** It answers
"what kind of track is this" in one place. It exists because that
question used to be answered by parsing the participant identity
(`camfeed-a-wide-3f9c`, split on hyphens) in six places across three
files — which breaks the moment one participant publishes two tracks.

B-roll broke it: a clip is published by the *artist's own* participant,
so every parser saw `contestant-a-…` and answered "the performer's
camera". The director would tap B-ROLL CLIP and cut to the artist's
face, and the recorder would bake that in.

**The discriminator is now the publication's track NAME (`broll`), and
the source (`ScreenShare`, not a second Camera — `setCameraEnabled`
re-asserts itself on every `SignalConnected` and would fight a second
Camera track).** The rule stated in the file:

> No function in this file may ever resolve a b-roll track to a camera
> role, and no camera role may ever resolve to a b-roll track.

## The liveness registry — `lib/trackLiveness.js` — device-tested

Decides which tracks may be selected. Every condition is **derived from
currently-observable state on every evaluation, never accumulated**, so
anything that can clear, clears itself. Recovery serves a short
probation so a flapping publication cannot yank the on-air shot back and
forth.

Its most important part is the **frame-progress watchdog**, and the
reason is worth internalising: *a phone locked by its power button halts
capture while the publication stays live and unmuted.* Every declared
signal — `isMuted`, subscription state, `streamState`, `readyState` —
stays healthy, because the one device that could announce the death has
had its JavaScript suspended by the OS. Frames are the only thing that
changes. Measured as delivery counters (`framesDecoded`), never pixel
content, because a performer holding still still delivers frames.

B-roll is **exempt** from that watchdog: a clip is published by a browser
that is by definition awake, so its death is always announced, and the
watchdog could only produce false positives on a buffering clip.

## Show session state — device-tested

`show_session_state`, keyed `(show_id, artist_id)`, holds the deck's
durable state: `track_hash`, `track_name`, `cue_sheet_id`, `position_ms`,
`playback_state`, `set_list_id`, `broll_bindings`.

It exists because selection, cue binding and playhead used to live in
React state and were destroyed twice over — by the Kit Check → /live
route change, and by any layout change that remounted the panel.

The row is the source of truth; React state is a cache kept in sync by
Supabase Realtime (`lib/useShowSession.js`). **Shot commands are
deliberately NOT routed through it** — they are ephemeral and sub-second
and belong on the LiveKit data channel. This file deals with what must
*survive*; the data channel deals with what must be *fast*.

Writes reach it three ways (`components/AudioHostProvider.jsx`): an
immediate write on every play/pause/stop/seek transition, a 5-second
poll that keeps position current during playback, and a teardown write
on `pagehide`/`hidden` sent with `fetch(keepalive: true)` so it survives
the document that issued it.

## The audio host — `lib/audioHost.js` — device-tested

A **module singleton** holding the AudioContext, the vocal chain nodes,
and the decoded backing-track player. It is outside React entirely,
because the defect it fixes is that React state dies: Kit Check owned
the AudioContext and closed it on unmount, and the backing panel stopped
the player on unmount. Navigating or resizing killed the music.

`ensureAudioGraph()` is **single-flight**: two concurrent arrivals used
to each build a graph, and the second adoption released the first —
taking the backing track with it. Proven in telemetry by two
`audiocontext_statechange {state:running}` in the same millisecond.

**Mic mute is a gain node** (`micMuteGain`), not a track mute. Muting the
published MediaStreamTrack silenced the backing track too, because the
published track *is* the mix. This has a consequence that surprises
people: **mute state is invisible to other participants**, which is why
Versus needs `lib/micState.js` to broadcast it.

## Backing tracks and set lists — device-tested

- **Local files** (round 1): chosen from the device, decoded in-browser,
  never uploaded. Identity is the SHA-256 of the bytes.
- **Uploaded tracks** (round 2, `mvp2_01`): same bucket as b-roll under a
  `tracks/` prefix, one **500MB quota shared** between b-roll and tracks
  (`lib/mediaQuota.js` — the total lives in one place because it was
  previously declared twice and the UI promised a different number from
  the server).
- **Set lists** (round 2, `mvp2_02/03/04`): ordered items referencing
  uploaded tracks, assembled in Kit Check, bound to `show_session_state`
  so they survive both go-live triggers.

Two design points worth keeping: **tapping an item loads and binds but
does not play** (making it automatic would extend the expensive steady
state to every show), and **`position` is not unique** — a reorder
rewrites several rows and the intermediate states would be illegal under
a unique constraint.

## Cue sheets — device-tested

Keyed per artist per track hash. A sheet belongs to a *track*, so the
same track in three set lists is one sheet. `set_list_items.cue_sheet_id`
is an optional per-set override, null in the normal case. A cue may carry
`clip_id` for b-roll, and a b-roll cue *starts* the clip rather than
requiring it to be already playing.

## Versus — device-tested (two artists, two devices, a viewer)

- **Invitations are delivered, not copied.** The artist searches for
  another artist while scheduling (`/api/artists/search`), selects them,
  and the invite route mints the token *and* writes the notification. A
  copyable link survives only for artists with no account to notify.
- **The token model is unchanged** underneath: single-use, on the
  `show_slots` row, resolved by `/join/[token]`.
- **The layout is a split**, both performers at whatever ratio each
  participant has dragged their own divider to. Stacked below 1:1, side
  by side above, decided by **measuring the stage element with a
  ResizeObserver** rather than sniffing the pointer — the only version
  that survives a foldable changing shape mid-show.
- **The split ratio is per-participant and never broadcast.** It is
  stored as a percentage share, so it survives an orientation flip on the
  new axis rather than resetting.
- **The glow** (`lib/glowLevels.js`): each artist's panel lit by their
  own voice — solo teal, Versus A teal and B orange. Driven from
  `participant.audioLevel`, which LiveKit already computes, on **no
  timer** (event-driven off `ActiveSpeakersChanged`), writing only when a
  16-step quantisation moves, animating only `opacity` and `transform`.
- **Each performer directs their own cameras.** A Versus is two artists
  who each know their own set; directing two artists while performing is
  too much to hold mid-show.
- **An invited artist can see and enter their own show** — pending
  invitations and accepted bookings on their profile, the countdown and
  both doors in Kit Check.

## Notifications — device-tested

`notifications` with `kind` (`show_reminder | show_live | comment |
follow | system | versus_invite`), `dedupe_key` under a **partial unique
index**, and `read_at`. Unread count badge in the sidebar, cleared by
`markAllNotificationsRead` when the panel opens.

**Read state and visibility are deliberately different things** — a
notification stays in the list after being read, because a person should
be able to look back at what they were sent. Do not "fix" this.

RLS allows insert for the row's **owner only**. A cross-user
notification (an invite) must therefore be written by a service-role
route. That is deliberate: a client-insertable cross-user notification is
a spam primitive.

## Wallet and ledger — correct by reading, partially device-tested

Tokens can be bought, spent and cashed out. The ledger is
**append-only, enforced by a database trigger** rather than by
application code. 18+ is enforced at all three layers. **Payments run
through a provider that is not connected** — `/api/wallet/provider`
reports `live: false`, BUY TOKENS renders disabled with an explanatory
line, and `/wallet/checkout` is a dev-only settlement page. This is
deliberate; see §4.

## Egress and recording — partially device-tested

`components/EgressPage.jsx` is a headless page LiveKit's egress renderer
loads to composite the recording. It subscribes to the same track sources
and applies the same shot commands as a live viewer, so **the recording
is what the audience saw**, not a separate layout.

Two rules baked in: the egress template passes **no status text overlay**
(`CLEAN_PLACEHOLDER`) because readable status burned into footage makes
it unusable; and **Versus records at a fixed 50/50 split**, because a
battle recorded with one performer larger reads as a verdict. It used to
lay out by active performer — that was a live defect, fixed in round 3.

**Unverified:** no recorded egress file has ever been pulled for a
*b-roll* clip, and the recorder-side behaviour of the Versus split has
not been checked against an actual file.

## Health telemetry — device-tested

`lib/healthLog.js` batches events to `health_events` via an API route,
flushing once a second and on `pagehide` via `sendBeacon`. Every export
is fail-silent by construction: **logging must never break the show.**

`lib/publisherStats.js` samples encoder stats every 2s per publishing
client — bitrate, frames encoded vs sent, QP, simulcast layer,
`qualityLimitationReason` — and since round 3 does it **per sender**,
with a `pub_aggregate` row carrying the total across senders against
`availableOutgoingBitrate`.

---

# 3 · WHAT IS PARKED, AND WHY

## B-roll — four rounds, one root cause, still not reaching viewers

**Branch `feature/mvp-round-3` — built, deployed, unmerged, intact.**
Full shelf notes are in `DECISIONS.md` under "PARKED — B-ROLL TO VIEWERS
AND EGRESS". Read that before touching `lib/brollPlayback.js`.

### What the feature is meant to do

An artist uploads short video clips; during a show they cue one and it
plays into the broadcast as a real LiveKit track, so viewers and the
recording see it. The playback path: signed URL → hidden muted `<video>`
→ `captureStream()` → publish the captured track.

### The faults, in the order they were found

**1 · The bitrate collapse.** Publishing a second 1080×1920 track
mid-show knocked the congestion controller over: `availableOutgoingBitrate`
collapsed 6.9 → 1.0 Mbps in ~4s, `qualityLimitationReason` flipped to
`bandwidth`, uplink hit zero for ~4s, fps went 30 → 26 → 20 → none → 3,
simulcast dropped the top layer, recovery ~11s. Proven from the artist's
own telemetry across five episodes. **Not the connection**: steady state
used 3.0 of 6.9 Mbps and `framesNotSent` was zero across all 309 samples.

**2 · The 3–4 second teardown — which was never a b-roll defect.** Clips
were unpublished 3–4s after going on air. The off-air grace is 500ms and
only starts once the shot has already left the clip. What moved the shot
was **the auto director's own hold timer, already running when the clip
was cued.** `cueDirector` and staccato both suspend auto; the b-roll path
never did. Nothing in the b-roll code was wrong.

**3 · The blank stage — two causes, only one obvious.** After the first
fix, cueing a clip produced a blank stage. The camera was muted 2.354s
before the clip went live (1.066s on the second clip), so the audience
had nothing. *And* the cut fired when `replaceTrack()` resolved — which
means the sender **accepted** a track, not that it **encoded** one.
Fixing only the visible cause would have left the second to surface on a
slow connection later.

**4 · The root cause: the publication does not survive a reconnect.**
B-roll was **the only publication in the app with no reconnect story.**
Audio has `ensureAudioPublished` on `Reconnected`/`SignalConnected`; the
camera is re-asserted by `<LiveKitRoom video>` on every
`SignalConnected`. B-roll held a publication object captured once at
session start.

On a full reconnect, `livekit-client`'s `republishAllTracks` (line 30721,
called from `applyJoinResponse`) unpublishes every local track and
publishes it again — **a new publication with a new trackSid**. Three
`broll_source_ended` rows with three different sids in one capture is
three reconnects.

**It then failed two different ways from that one cause:**

- **Silently.** `setMediaStreamTrack` attaches to the sender only `if
  (this.sender && sender.transport?.state !== 'closed')` — otherwise it
  **skips the attach and resolves successfully**. No throw, so no error
  row. `getSenderStats()` then returns `[]`, the frame poll sums zero for
  four seconds, and the result reads `no_frames` — describing the clip
  rather than the fault.
- **Loudly**, once `unpublishTrack` had cleared `.track`:
  `Cannot read properties of undefined (reading 'replaceTrack')`.

`broll_late_prewarm` never fired because its guard was `if (!publication)`
and a stale object is truthy. See the validity rule in §5.

### What was tried and what is now in place (unmerged)

- The publication is **established once at session start** from a
  1080×1920 black canvas via `captureStream(0)` — one frame on demand,
  then nothing. Playing a clip is `replaceTrack()` on a sender every
  viewer negotiated at join.
- Capped at **2 Mbps, single layer**.
- **No muting anywhere in the feature** (see §5).
- A **reconnect story**: `ensurePublication()` on `Reconnected` and
  `SignalConnected`, idempotent and single-flight.
- The publication is **never stored** — resolved fresh by track name at
  every use.
- **Structural no-ops report immediately** (`broll_swap_noop`,
  `broll_publication_stale`).
- Auto is held for the clip's duration under owner `broll`.

### The state of the evidence

**It worked in a clean session and has failed in every session that
reconnected.** `show-xpl6ky7m` had no reconnects during its b-roll
window. In the final capture, a reconnect at 10:49:41 preceded the first
clip attempt at 10:50:15 — **not one attempt ever ran against a live
publication.**

### For whoever picks it up

**Try first, in this order:**

1. **Get a session that does not reconnect** and confirm the clean path
   works end to end with a viewer on a second device. Until that exists
   nothing else can be attributed. See the connection instability item in
   §4 — it may be the whole story.
2. **Pull a recorded egress file.** It is the only thing that answers the
   recorder-side question, and it has never been done.
3. **Read `pub_aggregate` with `phase:"clip_on_air"` and
   `activeSenders:2`** — it settles whether the camera ever needed muting,
   which is currently open with the mute removed.

**Do NOT retry:**

- **The `captureStream(0)` placeholder theory.** Checked against the SDK
  source and falsified: there is no persistent "never started encoding"
  state; `replaceTrack` swaps the source and encoding follows.
- **Muting the camera during a clip.** Three failures came from it. If it
  ever returns it happens only after frame confirmation, never on a
  timer — the invariant is written in `LiveDemo.jsx` at the line the mute
  used to occupy.
- **Swapping the clip onto the CAMERA publication.** It solves the
  bitrate problem and breaks `trackSources.js`'s founding rule: a clip
  would be classified as the performer's face, in recordings and in the
  training data those recordings become.
- **Re-investigating the original bitrate collapse.** Cause proven from
  telemetry; the fix removes the mechanism.

## The camera CPU investigation — paused, instruments live

Symptom: intermittent freezing and stuttering, with
`qualityLimitationReason` reaching `cpu`. Two suspects survive; see §4
for the full statement and the session design.

Instruments are already in place and shipping: `backing_deck_loaded`
(fires once per track at the moment the waveform first exists, carrying
`approxBufferBytes` and `waveformPoints`) and `backing_deck_raf` (every
30s, carrying `idleFrames`, `activeFrames`, `changedWidth`,
`playingFrames`).

**An analyser exists**: `scripts/cpu-attribution.mjs` on branch
`chore/cpu-attribution-tooling`. Hand it a capture CSV and it segments by
load, reports cpu seconds accrued per segment, and prints the two
correlations. It has been run against a real capture (`task1.csv`) and
correctly reported that capture as a null.

---

# 4 · WHAT IS OUTSTANDING

Exhaustive and honest. Where something is unverified it says so.

## Rehydrate — unresolved whether gap or regression

**Reloading `/live` does not restore the backing track**, and **Kit Check
has never had rehydration at all.** The row holds `track_hash` and
`track_name`; for an *uploaded* track the hash resolves to a storage
object via the unique `(artist_id, sha256)` index, so the app can refetch
and resume without asking. `BackingTrackPanel` has that path
(`loadUploaded` + `findUploadedTrackByHash`).

Whether it fails because the path is broken, because the row was not
current at reload, or because the panel was not mounted at the moment it
would have run, **has not been established.** It is the third segment of
the CPU session's design precisely because it is also unproven.

For a *locally picked* file no amount of state can fix it — the browser
cannot reopen a local file without a fresh user gesture, which is what
`needsRepick()` and the re-pick prompt exist for.

## Open design question: resume position

**Should a restored track resume at the saved position or at the start?**
Currently the code seeks to the saved position (bounded by
`currentPositionMs`'s extrapolation limit) and leaves the deck **paused**.

The argument for the start: an artist who crashed 2:14 into a song
probably wants to restart it, not drop into the middle in front of an
audience. The argument for the saved position: a brief blip mid-song
should not lose the performance.

**Not decided. Needs a product ruling, not a technical one.** The
mechanism supports either.

## The CPU attribution — unrun, and the session design needs amending

**Two suspects, both surviving:**

1. **The rAF/waveform loop** in `BackingTrackPanel.jsx` — writes
   `style.width` and a text label **every frame regardless of change**,
   across a 360-point waveform, at 60fps, **with no play-state gate**.
   It runs while the deck is merely loaded and paused.
2. **The decoded `AudioBuffer`** — roughly 106MB for a five-minute
   stereo track, resident for the session.

**Already ruled out:** bandwidth (a 120Mbps downlink says nothing about
uplink, and the uplink evidence is clean), and fetch/decode on timing —
cpu appeared **91 seconds after** the work finished, and a one-off cost
appears when the work happens, not a minute and a half later.

**⚠️ The agreed session cannot separate the two, and this must be fixed
before it is run.** Every loaded segment contains **both** survivors: a
loaded deck has a resident buffer *and* a running loop. Local, uploaded
and rehydrate differ in how the bytes arrived, not in what is present
afterwards. Anything that rises with time rises with both.

Nor is there a reachable state with one and not the other: collapsing
the deck applies a CSS class, and `SwipePages` mounts every tab
regardless of which is active, so the panel stays mounted and the loop
keeps running.

**What would separate them:** a `deck_loop_suspended` instrument — a
switch that stops the loop's DOM writes without unmounting anything, so
the buffer stays resident and everything else is identical. Alternate it
within one segment and cpu either follows the loop or it does not.
`scripts/cpu-attribution.mjs` already reads those rows and prints the
verdict. **The instrument is not built.**

**What a null looks like:** `qualityLimitationDurations.cpu` never moves
and `qualityLimitationReason` never reads `cpu`. That does **not** clear
either hypothesis — it means the condition did not occur. A capture with
no symptom cannot name a cause. Check segment length, whether
`activeFrames` was non-zero (did the waveform actually run), and median
fps (was the encoder under any load at all) before concluding anything.

## Connection instability — nobody has investigated this

**Four reconnects, including one full `room_disconnected`, inside a
six-minute window on a developer's connection.** It surfaced only because
b-roll was the one publication without a recovery path; camera and audio
hide it because they recover.

This may be **upstream of problems already attributed elsewhere.**
Anything diagnosed as a media, encoder or selection fault during a
session that was silently reconnecting deserves re-reading with this in
mind.

Nothing currently surfaces it: the rows exist
(`room_connection_state_changed`, `pub_reconnecting`, `pub_reconnected`)
but nothing summarises how often a show reconnected, so a session with
four reconnects and a clean one look identical in every report the app
produces. **First questions:** is it network, LiveKit server-side, the
token's TTL, or something the app does — and does it correlate with
anything (b-roll publish, show phase, device, duration)?

## Guest capability depends on the guest's browser

`HTMLMediaElement.captureStream()` is unimplemented in Safari, so **an
invited artist on Safari has no b-roll.** The feature detects this
honestly and says so (`lib/brollPlayback.js`), but **nothing in the
invite flow warns either artist in advance.** A host can invite someone
into a show where they will silently have fewer capabilities, and neither
finds out until they are live. Product gap.

## A Versus where the guest is on a phone has never been tested

Every phone test so far has been a solo host. The guest path on a
handset — portrait split, mic mute, camera, the accept flow on a small
screen — is entirely unexercised.

## What happens when an opponent never accepts

The show stays scheduled with slot B pending and the host is told. They
can invite someone else (re-minting revokes the previous token).
**Declining is not built**: `show_slots` has no status column and
"declined" is a third state, which is its own decision. There is also no
prompt before showtime asking the host whether to go solo.

## Interruption handling — half built by design

`docs/INTERRUPTION_FEASIBILITY.md` is the authority. The audience side
works and is shipped: a held frame with "Back in a moment" for viewers,
the specific cause on the artist's console, an away announcement fired on
**capability loss rather than visibility**, and a resume affordance.

**The per-case rules are not built** — what a call should do that being
away should not. iPhone evidence is in (iOS 26.6, Chrome/WebKit): a call
takes both and suspends the page; minimise and lock do **not** suspend
JavaScript and do **not** stop audio, and are **indistinguishable from
each other**. §4.1 of that document has the per-branch verification
table.

**Still owed: an Android run, an iOS Safari run, and observed frames from
a real show with a second device.** Every camera claim in that document
rests on declared track state, not observed frames — a local counter
structurally cannot settle the hidden cases.

## Payments — deliberately deferred

Stripe is not connected, and that is a decision rather than an omission:
the token economy is built and provably gated, so connecting a provider
is configuration plus a webhook rather than a build. It waits until
everything else is done.

---

# 5 · THE STANDING ENGINEERING RULES, AND WHERE EACH CAME FROM

**Each of these is here because something went wrong.** Read the reason;
without it they look like bureaucracy and get dropped.

### Instrument before fixing

*Why:* the b-roll teardown was blamed on b-roll for two rounds. The cause
was the auto director's hold timer, in a different file, which no amount
of reading the b-roll code would have found. Telemetry named it in one
capture.

### Plan before implementing on anything structural

*Why:* the b-roll bitrate fix had an obvious solution — swap the clip
onto the camera publication — that would have broken the discriminator in
`trackSources.js` and mislabelled clips as the performer's face in
recordings **and in the training data those recordings become**. The plan
step is what caught it.

### Verify against the remote, never assert success

*Why:* "pushed" and "the remote has it" are different claims. Every merge
in this project queries `git ls-remote` and greps the **served** bundle
rather than trusting a local build. Chunk hashes differ between local and
Vercel builds, so a path-based grep can silently check nothing — enumerate
the scripts the rendered page actually loaded.

### Device test on real hardware before merge

*Why:* a headless browser with a fake camera cannot produce encoder CPU
pressure, cannot fold, and cannot take a phone call. Three of this
project's most important findings were only visible on a real handset.

### Never build on an unconfirmed hypothesis

*Why:* four things were nearly built on the assumption that the Versus
invite write path worked. It was tested first — and passed — but the
order mattered: everything downstream assumed it.

### Test for VALIDITY, not truthiness

> **"Does the reference exist" and "does the reference work" are
> different questions. Never answer the second by asking the first.**

*Why:* the b-roll guard was `if (!publication)`. After a reconnect that
object still existed and no longer worked, so the guard passed and the
swap ran against a dead handle — failing silently or throwing depending
on how far teardown had got. `isUsablePublication()` walks to the RTP
sender and its transport instead.

### The migration ritual

Every migration ships as a copy-pasteable file in `docs/` with its
verification queries inline: the full column list with a stated expected
count, the **FK definition with its type check**, the index definition
with `indpred`, RLS and policies before and after, and a live
insert/select probe with cleanup.

*Why the FK type check specifically:* round 1's
`show_session_state.cue_sheet_id` was declared `uuid` when `cue_sheets.id`
is `bigint generated always as identity`. Postgres rejects that at
create-table time with 42804 — but `create table if not exists`
short-circuits on any environment where the table already exists, so
re-running looked clean. **Idempotency hid the defect**, and the
environment that would actually have failed is a fresh one: staging or
production on first apply.

*Also:* every NOT NULL column without a default must appear in the probe.
`mvp3_01`'s first probe omitted `fired_at` and failed on a null violation.

### The keep-publishing invariant

> **No code may stop publishing on an interruption without a signal that
> distinguishes intent.**

*Why:* the original interruption spec had a locked phone pause both audio
and camera, on the reading that a locked phone means the artist stepped
away. The measurements killed it: on iOS 26.6 a lock does not stop audio,
does not suspend the page, and produces an event sequence **identical to
minimising**. The app cannot tell a phone set down from one in a pocket
mid-song, and cutting a performer's voice because their screen went dark
is the worse of the two available failures.

## Falsified theories — the clearest argument for the discipline

Each of these was plausible, was believed, and was wrong.

| Theory | How it died |
|---|---|
| **`captureStream(0)` caused the b-roll failure** — a sender built from a source that emits one frame might never start encoding | Checked against the SDK source. No such persistent state exists; `replaceTrack` swaps the source and encoding follows. The cause was reconnect survival. |
| **`audioHostActive()` was returning false for a closed-but-non-null context** | Read the code: it checks `state !== 'closed'`. The real cause was a check-then-act race with an `await` in between — both runs saw an empty host and both built a graph. |
| **The AudioContext closes when the app is backgrounded** | Measured. Across a 270-second hidden window the context read `running` at both the hide and the return, with JS still executing at a 2.0s maximum gap. |
| **The artist search was broken** — eight terms returned nothing | The test inputs were bad. Only two of the eight matched anything, and both matched the caller's own account, which is correctly excluded. `ad` → adex, `fa` → factz. |

## Recurring failure modes — watch for these

### Inheriting the placement or framing of the thing you are replacing

The Versus artist picker was built **where the code being replaced
happened to live** (the show card) rather than where the requirement said
(the scheduling form). It was correct, deployed, and unreachable at the
moment it was wanted. Same shape as blaming the b-roll teardown on b-roll
because the symptom appeared there. A faithful-feeling swap silently
discards the requirement.

### The owner-column assumption

**Shows were modelled as belonging to one artist** — `shows.artist_id =
me` — and Versus made that false everywhere at once. Three surfaces
asked the same wrong question independently and produced three different
symptoms: an accepted show invisible on the guest's profile; a guest with
no way back into the live room; a guest with no countdown in Kit Check.
**Three fixes, one wrong idea.**

**A fourth surface was requested and I searched. I found three more, all
still unfixed:**

1. **`/api/recordings/sync`** — `.eq('artist_id', auth.user.id)`. **A
   guest performer cannot see or access the recording of a show they
   performed in.** The most user-visible of the three.
2. **`/api/health-events/export`** — refuses when `show.artist_id !==
   auth.user.id`. A guest cannot pull telemetry for their own show. (This
   is what blocked an investigation into `show-xpl6ky7m`.)
3. **`/api/account/export`** — the GDPR "request my data" export selects
   `shows` by `artist_id`, so **a guest artist's data export omits every
   Versus they performed in.** Compliance-adjacent, not just cosmetic.

The general fix shape already exists: `/api/performer/my-slots` resolves
"shows I am in but did not create" behind the service role, because
`show_slots` is zero-policy and must stay that way — opening it would
expose every invite token in the table.

### Instruments that cannot write

`logHealthEvent` drops anything logged before `initHealthLog` has set a
`showId`. **A whole instrumented session was run and pulled before anyone
noticed the instruments had never been able to write** — "no rows" reads
identically to "nothing happened". Counters now report what was dropped,
and any new instrument firing during join must call `initHealthLog`
first. It nearly happened a second time with
`performance_mode_resolved`.

---

# 6 · THE SERVER-COMPUTE QUESTION

**An open decision, not a recommendation.** The case both ways.

## The context

Freezing and stuttering are observed, and device capability varies
enormously across the phones independent artists actually own. One
response is to move heavy processing off the device to a server so the
experience is consistent regardless of handset.

## What could actually move

- **The vocal processing chain** (highpass → compressor → reverb →
  output bus). Currently Web Audio on the device.
- **Backing-track decode and mixing.** The ~106MB `AudioBuffer` is a
  named CPU suspect.
- **B-roll playback.** Strongest candidate: a server could fetch and
  inject the clip directly, which would **fix the Safari capability gap
  and remove the second uplink track that caused the bitrate collapse.**
- **Compositing** — already server-side, via LiveKit egress.

## What cannot move

- **Camera and microphone capture.** Always on the device.
- **Video encoding of the artist's own camera.** Sending raw frames for
  server-side encoding is not viable on a mobile uplink.
- **The uplink itself.** If a venue's connection is bad, it is bad.
- **Anything that must respond to a tap instantly.** A server round trip
  between a director's tap and the cut is exactly the latency the current
  architecture exists to avoid.

## What it would cost

Honestly: **not precisely known, and that is itself an argument for
measuring first.** The shape is a per-show, per-performer continuous
compute cost — a media pipeline holding a process per stream for the
whole show, rather than a request-response workload that scales to zero.
Against a **30% commission model**, that cost is incurred whether or not
a show earns anything, on every show, including the ones nobody watches.
A show with no viewers currently costs LiveKit minutes; with server-side
processing it would also cost compute for the entire duration.

## What it would NOT fix

- The reconnects (§4) — those are transport, and a server pipeline adds
  a hop rather than removing one.
- The artist's own camera encode.
- A bad venue uplink.
- **The two named CPU suspects**, which are inefficiencies rather than
  hardware limits: a loop writing DOM every frame regardless of change,
  and a large resident buffer. **Moving inefficient code to a server
  means paying to run it inefficiently somewhere else** — and both would
  tax a fast phone, which is why they are suspects at all.

## What the current evidence says

The CPU attribution points at two specific in-app suspects, and **neither
is a device-capability limit.** The evidence does not currently support
"phones are too slow"; it supports "two specific things in our code may
be expensive, and we have not yet run the session that would name which".

That is the strongest argument for sequencing: **a device-capability
problem and a code-efficiency problem look identical from the outside**,
and only one of them is solved by servers.

## What we would need to know, in order

1. **Run the CPU attribution session** (with the loop-suspend instrument
   from §4, or it cannot answer). If the cause is the rAF loop, it is a
   gate and a change-check — a day's work, not an architecture.
2. **Establish whether stuttering correlates with the reconnects.** If
   the freezes are transport, no amount of compute moves them.
3. **Measure a genuinely low-end handset** under the current build, after
   any fix from step 1. "Device capability varies" is currently an
   assumption about a population we have not sampled.
4. **Price one show-hour** of the specific pipeline being proposed,
   against realistic token revenue per show.
5. **Only then** decide, and consider the narrow version first: **b-roll
   server-side alone** may be worth it on its own merits — capability
   parity across browsers and no second uplink track — regardless of what
   the CPU investigation concludes.

---

# 7 · HOW TO WORK ON THIS

## Repository and branches

- `main` is production. Merges are `--no-ff` with a substantial message —
  the commit log is the design record and is used as one.
- Feature branches: `feature/mvp-round-N`, `feature/mvp-round-N-topic`.
- **`feature/mvp-round-3` is the parked b-roll branch. Leave it.**
- `chore/cpu-attribution-tooling` holds the analyser.
- `DECISIONS.md` is the long-form record — read the section for anything
  you are about to change. It carries the reasoning that the code
  comments compress.

## Deployment and testing

- Vercel deploys every branch push. **Test the branch alias, never a hash
  URL** — `https://loud-app-git-<branch>-korey-alashe.vercel.app`. A hash
  URL is stale within the hour and pins you to one build.
- Production is `https://loud-app-umber.vercel.app`.
- **Preview deployments are SSO-protected.** Automation uses the
  `x-vercel-protection-bypass` header (`VERCEL_AUTOMATION_BYPASS` in
  `smoke.env`, gitignored). For a device that cannot sign in to Vercel,
  append the bypass as a query param with
  `&x-vercel-set-bypass-cookie=true`.
- **Grep the served bundle before asking anyone to re-test.** A green
  local build is not a shipped one.
- `npm run check` = TDZ lint + undefined lint + API-route auth check +
  window unit tests + a build that treats missing-import warnings as
  errors. **`npm run smoke`** signs in with a real browser and asserts
  each authenticated route renders a marker only the real surface
  produces — a login redirect returns 200 and would otherwise pass.

## ⚠️ Production and preview share ONE Supabase database

There is no staging copy. **Every migration is a production migration**,
and **every test creates real rows.** A scheduled test show appears in
Discover's COMING UP; a test invite puts a notification on a real
account. Clean up after yourself, and say so when you cannot.

## Pulling a capture

```
SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/freeze-csv.mjs <room_name> \
  --base https://loud-app-umber.vercel.app --out capture.csv
```

Signs in through the app's own login and uses the **owner-only** export
route — so it must be run as the account that owns the show. The script
distinguishes auth failure from authorization failure from a missing
route, because collapsing those into one message cost two debugging
sessions.

Then: `node scripts/cpu-attribution.mjs capture.csv`.

## `health_events` — the key event types

| Event | What it tells you |
|---|---|
| `pub_stats` | Encoder truth per sender, every 2s: bitrate, frames encoded vs sent, QP, simulcast layer, `qualityLimitationReason`. `framesNotSent` separates encoder pressure from send-side drop. |
| `pub_aggregate` | Total uplink across senders vs `availableOutgoingBitrate`, with `utilisation`. |
| `track_liveness_*` | The registry's verdicts, plus a heartbeat snapshot so a quiet window proves the evaluator ran rather than leaving it inferred from absence. |
| `backing_deck_raf` / `backing_deck_loaded` | The CPU investigation's instruments. |
| `broll_*` | The parked feature's full lifecycle, including `broll_swap_noop` and `broll_publication_stale`. |
| `interruption_state_changed`, `suspended_return` | The capability classifier. |
| `performance_mode_resolved` | Which path delivered `performanceMode` and what it carried — the fix for a Versus rendering solo for some participants. |
| `audiocontext_statechange`, `mic_level_sample` | Audio graph health. `mic_silent` fires after sustained digital silence. |

## The PRD

The PRD is the guiding document; `DECISIONS.md` records where reality
forced a departure from it and why. Every commit names the PRD rows and
the Scaling & Infrastructure area it touches — keep doing that, it is
what makes the log searchable by feature area.

## A closing note on tone

This codebase comments **why**, not what — often at length, usually
naming the specific failure a piece of code exists to prevent. That is
deliberate. Several of the notes in it are the only record of an
expensive lesson, and the comment is what stops the next person undoing
the fix because it looks redundant.

If you find one that is wrong, correct it and say what changed. If you
find one that seems excessive, check the git history before deleting it.
