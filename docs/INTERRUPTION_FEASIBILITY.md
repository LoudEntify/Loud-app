# INTERRUPTION HANDLING — what the platform can actually honour

Round-3 groundwork. 3 September 2026 · branch `feature/mvp-round-2`

**Status: the platform-independent pieces are built (§3a). The three interruption
RULES are not, and must not be until the redraft in §7 is approved.**

**Evidence held:** desktop (this repo's own show captures) and **iOS 26.6 /
Chrome** (probe run 2026-09-03, §4.1). **Still owed: Android, and iOS Safari.**

**Topology, decided:** the artist's **phone is the primary device** — the phone
they signed up on, their main camera, and the console. Additional camfeed phones
are secondary. Artist-on-laptop is supported but is not the case being optimised
for.

**Laptop rule, decided:** minimising and screensavers must not affect the show.
Where they currently stop nothing, they keep stopping nothing. No camera pause is
to be introduced there.

---

## 1 · Settled, and not dependent on any probe

| Decision | Why it needs no evidence |
|---|---|
| **DND becomes a pre-show prompt in Kit Check**, remembered per artist. The app never claims DND is on. | No web API exposes Focus/DND state, on any platform. But the rule is already true without code: with DND on, the call does not ring, the audio session is never interrupted, and the app sees nothing. The exception is enforced by the OS. What the app must never do is *assert* it, because it cannot verify it. |
| **Artist-facing wording is always "your audio was interrupted"**, never "you took a call". | A call, Siri, an alarm, a timer, another app taking the mic and a Bluetooth route change are the same event to a web page. Naming a cause the platform never reported is a guess printed as a fact. |
| **Holding state: "Back in a moment" over the held frame**, using the existing overlay, staying out of egress. Schedulable independently of the probe. | It is viewer-side rendering. It does not depend on what the artist's handset did, only on the fact that a feed stopped — which is already detected. |

---

## 2 · Evidence already held, before any probe runs

Sources are this repository and the device captures already in it. Nothing here
is inferred from general platform knowledge.

### 2.1 The audience side of all three rules is already built

`components/ShotRendering.jsx` snapshots the displayed layer to a canvas **at 1Hz
while the track is still alive**, and reveals it when nothing live remains. Its
own comment states the finding the spec was asking about:

> at the moment a track dies the element has already been cleared, so there is
> nothing left to read then — which is exactly why the previous best-effort hold
> rendered a dark blank instead of a held frame.

**So: the frame goes black if grabbed after the fact. Continuous snapshotting is
the fix and it already shipped.** It carries a `lostOverlay` slot filled by live
surfaces only (currently a `CAMERA LOST` pill); the egress template passes
nothing and gets the bare frame, deliberately, so status text is never baked into
a recording.

The fallback ladder — performer main → any live camfeed → freeze-frame — is also
already there, driven by `lib/trackLiveness.js`. **All three of the spec's rules
name the same audience behaviour, and that behaviour exists today.**

### 2.2 A locked phone cannot announce its own death

From the sitting recorded in `lib/trackLiveness.js` (v4) and `lib/useWakeLock.js`:
a camfeed phone locked by its power button halts capture while the publication
stays live and unmuted. `isMuted`, the subscription, `streamState` and
`readyState` are all unchanged, because iOS has suspended the JavaScript of the
one device that could report it. Only receiving-side frame progress catches it,
at a 3-second threshold.

Also measured there: **`mediaStreamTrack.muted` stayed false on all three clients
for 70+ seconds** through that freeze, and across every capture it fired twice —
both transient false positives at publish time. It was retired as a liveness
signal for exactly that reason. Any interruption design that leans on the mute
event is leaning on something this project has already measured and rejected.

The wake lock prevents the *accidental* path (the OS dimming a phone nobody
touched) and explicitly does not survive the power button.

### 2.3 On a laptop, minimising stops nothing — measured

Every artist device in `freeze-run-1.csv`, `freeze-run-2.csv`, `task1.csv` and
`countdown2.csv` is a MacBook Air (`deviceLabel: "MacBook Air Microphone
(Built-in)"`). Across those runs the tab was hidden repeatedly, including **one
270-second window**, and throughout it:

- JavaScript kept running, **maximum silent gap 2.0s**
- `pub_stats` every ~2s, `mic_level_sample` continuing, cues firing, shots publishing
- `audioContextState: "running"` recorded at both the hide and the return

This is the evidence behind the laptop rule. Nothing needs to be built to
preserve it; something would have to be built to break it.

### 2.4 There is no capture of an artist performing from a phone

Every run in this repository is a laptop. **With the phone now primary, the
device the spec is written for is the one there is no data on.** That is what
the probe is for.

---

## 3 · The four questions, answered

| Question | Answer | Basis |
|---|---|---|
| Can the app hold the last good frame once the camera stops? | **Yes — already does.** Post-hoc capture yields black; the shipped 1Hz continuous snapshot is what makes it work. | §2.1, shipped code |
| Can it read DND? | **No.** Not on any platform, from a web page. | Platform, no API exists |
| Can it tell a phone call from any other audio interruption? | **No.** No telephony API. Cause is unavailable; only *shape* is observable. | Platform + §2.2 |
| Can audio stay alive while the camera is suspended in the background? | **On a laptop, both stay alive (measured). On Android, expected yes for audio / no for camera — probe answers it. On iOS, expected no for both — needs an iPhone.** | §2.3 measured; rest pending |

---

## 3a · What has now been built

Shipped on `feature/mvp-round-2`, ahead of any probe run, because none of it
depends on the answers:

| Built | Where |
|---|---|
| Holding state — "Back in a moment" for the audience, specific cause on the artist's console | `holdingOverlay()` in `components/LiveDemo.jsx` |
| DND pre-show prompt, per artist per device, never claiming DND is on | `lib/dndPrompt.js`, `components/DndPrompt.jsx`, rendered in Kit Check |
| The shape classifier | `lib/interruptionState.js` |
| Departure announcement on capability loss | `lib/awaySignal.js`, consumed as the `announced_away` impairment reason in `lib/trackLiveness.js` |
| Resume affordance | `components/ResumeAffordance.jsx` |
| Capability language throughout | `describeInterruption()` — the single place artist-facing interruption copy is written |

### 3a.1 The two readers of one held frame — approved wording

Same pill, same position, different text depending on who is looking. Not
stacked: the console line replaces the audience line. The audience needs to know
the show is not broken and they should stay; the artist is the only person who
can fix it and needs to know what happened.

**Audience, every case:** Back in a moment

**Group A — the artist's own capture** (`describeInterruptionShort`):

| Branch | Console line |
|---|---|
| `audio_interrupted` | Your microphone was interrupted |
| `camera_taken` | Another app took your camera |
| `capture_lost` | Your sound and picture stopped |
| `backgrounded_degraded` | Your camera stopped while you were away |
| suspension, on return | The show paused while you were away |
| `backgrounded_running` | *(nothing — nothing was lost, so no frame is held)* |

**Group B — the held feed is not theirs** (`describeFeedLoss`, shapes from
`feedLossShape` in `lib/trackLiveness.js`):

| Shape | Console line |
|---|---|
| `froze` | This camera froze — check the phone |
| `lost_connection` | This camera lost connection |
| `switched_off` | This camera was switched off |
| `away` | The other performer is away |

Rules these obey, and which any future line must: under 40 characters, because
the console is a phone; plain English; **"check the phone" is the only
imperative in the set** — where the action depends on state the artist cannot
see, naming the fact beats guessing at an instruction, and the RESUME card
already carries the action for the cases that have one. The pill carries the
fact, the card carries the action. The backgrounded and suspended lines are past
tense and describe this device this time; neither promises what minimising does,
and neither claims to know whether the phone was locked or backgrounded, because
it cannot tell.

**Not built, and still blocked:** the per-case behaviours. What a call should do
that a minimise should not, whether audio pauses or continues, what resumes
automatically — all of it waits on §5.2.

**The one behaviour the announcement adds that nothing else could.** The frame
watchdog watches video. A performer whose microphone is taken while their camera
keeps running is, to every pre-existing signal, perfectly healthy: publication
live, unmuted, subscribed, frames arriving. The audience simply hears nothing,
indefinitely, and nothing in the system disagrees. The announcement is the only
mechanism that catches that, and it is why this piece was worth building before
the probe rather than after.

**The announcement expires by design.** An away claim stands for 20s and is
renewed every 6s while the loss lasts. If the `back` never arrives — device died,
message lost, tab discarded — the claim lapses and the ordinary signals take over;
by then a genuinely absent performer has stalled frames and the watchdog holds the
feed impaired on its own evidence. The fast path decays into the slow path rather
than overriding it forever.

---

## 4 · Classify by shape, never by cause

The platform will not say *what* interrupted the artist. It will say what still
works. That is enough, because the audience-side consequence is identical across
all three rules, so a misclassification costs the audience nothing — it only
changes what the artist is told.

| Observable | Reading | Spec rule |
|---|---|---|
| Audio interrupted, page still visible **and running** | something took the audio session | 1 |
| Page hidden, JS still running, capture alive | minimised, still performing | 2 |
| Page hidden, JS suspended | backgrounded on iOS **or** locked — not distinguishable locally | 3 |
| Everything alive, video track ended | another app took the camera | — |

**This table is a function of observations, not of platform.** That is why the
classifier can be designed and built before the iPhone exists: iPhone results do
not change the branches, they only tell us which branch iOS lands in. It also
keeps the codebase's standing rule — feature-detect and measure, never sniff the
user agent (`lib/brollPlayback.js`, `lib/useSourceDimensions.js`,
`components/LiveDemo.jsx`'s fullscreen note all follow it).

### 4.1 Branch verification status — from captures, not reasoning

**A branch marked unverified has never been observed and must not be described as
working** — in a report, a commit message or a conversation — until a capture
shows it. Updated from probe CSVs only.

#### Provenance of the iOS column

| | |
|---|---|
| **Run** | `interruption-ios-chrome.csv` (as exported: `interruption-probe-2026-09-03T18-31-28-384Z.csv`), 486 rows, 8 scripted steps |
| **Device** | iPhone, screen 390×844 @3x, front camera 480×640 @30fps, 48kHz audio |
| **OS / browser** | **iOS 26.6, Chrome (CriOS 152.0.7977.64)** — user agent reports `AppleWebKit/605.1.15`, so the engine is WebKit |
| **NOT Safari** | Chrome on iOS is WKWebView, so the rendering and media engine are Safari's. What is *not* shared is the app container and its audio-session configuration, which is exactly where call handling lives. **These rows are evidence about WebKit-on-iOS-in-Chrome. A Safari run is still owed**, and any row below could move. |

#### What each branch has actually reached

| Branch | Desktop | Android | iOS 26.6 / Chrome |
|---|---|---|---|
| `live` | **observed** — every capture in this repo | unverified | **observed** — baseline |
| `backgrounded_running` | **observed** — 270s hidden, nothing lost (§2.3) | unverified | **not reached** — every backgrounding muted the camera, so it lands in `backgrounded_degraded` instead |
| `backgrounded_degraded` | not expected | unverified | **observed** — minimise, lock, and camera-taken all produce it: video track muted, audio clock ratio **1.00** |
| `audio_interrupted` | unverified | unverified | **observed** — the assistant/alarm step: 9.8s at ratio **0.11** with the page visible and both tracks unmuted |
| `camera_taken` | unverified | unverified | **not reached** — opening the camera app backgrounds the browser, so it arrives as `backgrounded_degraded`. The branch may be unreachable on this platform rather than merely unseen |
| `capture_lost` | unverified | unverified | **observed** — call ringing: audio and video tracks mute together while the page is still visible, context → `interrupted` |
| `suspended_return` | not expected | unverified | **observed** — answered call only: one **19.6s** JS gap, and 2.9s on the outgoing call. **Not** produced by minimise or lock |

#### Measured windows

| Step | Hidden | Audio ratio | JS ticks while hidden | Longest gap |
|---|---|---|---|---|
| minimise | 6.9s | **1.00** | 7 | 1.0s |
| lock | 6.2s | **1.00** | 6 | 1.0s |
| call answered | 23.8s | **0.00** | 5 | **19.6s** |
| call outgoing | 23.7s | **0.02** | 23 | **2.9s** |
| assistant/alarm | 25.4s | **1.00** | 25 | 1.2s |
| camera taken | 53.2s | **1.00** | 53 | 1.0s |

Ratio is the AudioContext clock's advance divided by wall-clock advance across the
window: 1.00 means the audio thread never stopped.

#### ⚠️ The video half of this run is DECLARED STATE, not observed frames

`video_frames` reads **0 in all 486 rows**. Two causes, both real:

1. **A bug in the probe.** `sample()` does
   `q?.totalVideoFrames ?? videoEl.webkitDecodedFrameCount`. On WebKit,
   `getVideoPlaybackQuality()` exists but does not populate `totalVideoFrames`
   for a MediaStream-backed element — it returns **0**, which is a number, so
   `??` never falls through to the WebKit counter. The fallback could not fire.
2. **A limit no fix removes.** Even with a working counter, a *local* element
   stops being decoded while the page is hidden, so the count would read ~0
   whether the camera was capturing or not. **For the hidden cases a local frame
   counter can never be conclusive.**

So every video claim here rests on the track's `muted` flag — declared state,
read locally by a page that was running, which is the one situation where that
signal is sound (see the header note in `lib/interruptionState.js`). It is
sufficient to say *the browser stopped the camera*; it is **not** sufficient to
say what the room received. **Only a remote observer can settle that** — the
existing frame watchdog, in a real show, with a second device.

#### Minimise, lock and camera-taken are INDISTINGUISHABLE on this device

Stated plainly because a design decision rests on it. All three produced the
identical event sequence:

```
video_track_mute → window_blur → visibility_hidden
    → window_focus → visibility_visible → video_track_unmute
```

with identical `wake_lock`, `audio_ctx_state` and track columns throughout, and
an audio ratio of 1.00 in every case. **There is no signal in this capture that
separates them.** The earlier prediction — that iOS would suspend JavaScript in
both — was wrong, and wrong in the useful direction: nothing suspends, audio
never stops. But "behaves better than expected" is not "tells them apart", and
any rule needing to know *which* of the three happened cannot be built on this
evidence.

---

## 5 · What can be designed now, and what waits

### 5.1 Designable and buildable now — no iPhone dependency · ALL BUILT (see §3a)

1. **The holding state** — "Back in a moment" over the held frame. Existing
   overlay, existing freeze-frame, existing egress exclusion.
2. **The DND pre-show prompt** in Kit Check, remembered per artist.
3. **The wording rule** — capability language everywhere, never a named cause.
4. **The shape classifier** of §4, as an observation-driven module with no
   platform branches.
5. **The departure announcement, triggered by CAPABILITY LOSS — never by
   visibility.** This is the design consequence of the laptop rule, and it is
   worth stating as a rule of its own because the obvious implementation gets it
   wrong: announcing on `visibilitychange` would drop the show every time a
   laptop artist checks a message, which is exactly what §2.3 says must not
   happen. Announcing on *loss of audio or frames* is silent on a laptop that
   loses neither, and immediate on a phone that loses both. One trigger, correct
   on both, and it rides the `keepalive` teardown write proved in Task 3
   (`edfa161`) — so the audience reaches the holding state in roughly a second
   rather than waiting ~3s for the frame watchdog to infer it.
6. **The resume affordance**, expressed as a capability test: resume
   automatically if the capability returns by itself, offer a tap if it does not.
   On a platform that auto-resumes, the control never appears.

### 5.2 Genuinely blocked on iPhone evidence

1. **Whether rule 2 exists on the primary device at all.** "Minimised = still
   performing, audio keeps playing" is only meaningful if iOS keeps the audio
   session alive in the background. If it does not, rules 2 and 3 collapse into
   one behaviour on the phone the spec is written for.
2. **Whether minimise and lock are distinguishable on iOS.** If JS is suspended
   in both, they are not — locally or remotely.
3. **Whether audio auto-resumes on return, or needs a user gesture.** This
   decides whether rule 3's "resume when they unlock and return" is automatic or
   a tap. An interrupted AudioContext generally needs a gesture; that has to be
   measured, not assumed.
4. **Whether the "call while still visible" branch is reachable on iOS** — i.e.
   whether an incoming-call banner leaves the page foregrounded with the audio
   session interrupted, which is the only signature that separates rule 1 from
   rule 3.
5. **Any artist-facing copy that promises what minimising does.** Shipping
   "minimising keeps you live" before it is measured is precisely the iOS
   assumption-as-fact this document exists to prevent.

   **Enforced in one place.** Every artist-facing interruption sentence comes
   from `describeInterruption()` in `lib/interruptionState.js`, which carries
   this constraint as a comment above the map. The backgrounded strings describe
   what was observed on this device just now, in the past tense, and promise
   nothing about next time. `components/ResumeAffordance.jsx` and
   `components/DndPrompt.jsx` mention minimising nowhere at all. If a future
   change needs a sentence about it, that map is where the constraint must be
   argued with — not a new string somewhere else.

### 5.3 Adjacent consequence of the topology decision, flagged not solved

B-roll needs `HTMLMediaElement.captureStream()`, which Safari does not implement
(`lib/brollPlayback.js`). With the phone primary, **an artist on an iPhone has no
b-roll.** The feature already feature-detects and says so honestly, so nothing is
broken — but "primary device" and "cannot use b-roll" now describe the same
person, which was not true when the laptop was primary. Not this spec's problem;
it belongs on the round-3 list on its own.

---

## 6 · The probe

`/probe/interruption` — `components/InterruptionProbe.jsx`,
`lib/interruptionProbe.js`. Not linked from anywhere; reached by typing the URL.

### 6.1 What it is, and what it deliberately is not

It captures camera and mic with the **same audio constraints the show uses**
(EC/NS/AGC all off — those flags decide which OS audio session category the
browser requests, and the session category is what a call negotiates with), holds
a screen wake lock as the show does, and records what survives.

It does **not** connect to LiveKit, join a room, need a show, or need an account.
Publishing would insert a reconnect layer, a signalling channel and a server's
opinion between the interruption and the evidence, each with its own recovery
behaviour to subtract back out. The question here is prior to all of that: **when
the OS interrupts this page, what keeps running?**

Consequence, so nobody over-reads a run: **it measures the device, not the room.**
What viewers saw is a separate question, answered by `health_events` during a
real show.

It writes to **localStorage and a downloadable CSV, not to `health_events`** —
because the subject of the measurement is a device whose JavaScript has been
suspended, and a network flush is the first casualty of that exact condition. The
transport would be failing for the same reason as the subject.

### 6.2 The two measurements that survive a frozen page

The unintuitive part, and the reason this works at all: while the OS has frozen
the page, nothing in it runs. No listener fires, no sample is taken. **The absence
of rows proves only that the page was not running — never what the hardware was
doing.**

Two counters answer that anyway, because they are maintained outside the frozen
JavaScript and can be read afterwards:

- **AUDIO** — `AudioContext.currentTime` advances only while the audio thread
  runs. Compare its advance across the gap against wall-clock advance.
  **Ratio ≈ 1 → audio kept flowing. ≈ 0 → the session was suspended or
  interrupted**, whatever the page was told on return.
- **VIDEO** — the element's cumulative delivered-frame count. Its advance divided
  by the gap gives **the frame rate the camera actually sustained while nobody
  was watching.**

Both are ratios between two rows either side of the gap, so neither needs a timer
to have fired in between. That is what lets a frozen page report on its own
freeze.

### 6.3 Running it

Eight scripted steps, in this order: baseline · minimise · lock · call ringing
(declined) · call answered · outgoing call · assistant/alarm · camera taken by
another app. Tap **Begin** before each; do the thing; come back. About 20 minutes.
Needs a second person for the two incoming-call steps.

Then **Stop and summarise** — the on-screen verdict is computed from the rows, so
what is read on the phone and what is in the file cannot disagree — then
**Download CSV** (or copy to clipboard, which is the reliable path on a handset
where a download lands somewhere awkward).

The run also records a device fingerprint on start: user agent, platform, screen,
sample rate, video settings. The existing show captures carry none, which is why
establishing that every run so far had been on a MacBook took an inference from a
microphone label.

### 6.4 Reading the output

One line per gap. For each, three things decide the finding:

- **gap length** — was the page frozen, and for how long
- **audio ratio** — did the audio session survive it
- **video fps** — did the camera survive it

Then the resumption columns: `audio_ctx_state` on return (`interrupted` is
WebKit's own word for "something took the audio session" and is the single most
valuable string an iPhone run can produce), and whether the tracks came back
muted, ended, or needed re-acquiring.

### 6.5 What a run cannot tell you

- What the room saw. Device-side only.
- Whether WebRTC *transmission* survived — there is no peer connection. A page
  can hold live capture and still not be sending.
- Cause. It will never say "phone call". It says which capability stopped, which
  is the only thing the platform actually reports.

---

## 7 · The rules, redrafted against evidence — APPROVED 2026-09-03

The original three rules, rewritten from the iOS capture rather than from
expectation. **Two rules, not three.**

### RULE 1 · CALL — confirmed, unchanged

**Observed signature:** both tracks mute together **while the page is still
visible**, and the context goes to WebKit's `interrupted`. Answering suspends the
page outright (19.6s gap, audio ratio 0.00). An outgoing call does the same at
ratio 0.02.

**Behaviour:** the OS has taken audio and camera; the app does not get a vote.
The audience cuts to another camera if one exists, otherwise the holding state.
The artist is told their audio was interrupted, never that they took a call.

**DND:** a pre-show prompt in Kit Check, never a claim (§1). With DND on, the
call does not ring and none of this fires — the OS enforces the exception the app
cannot read.

**Still open:** resume was observed to be automatic for the *context*, but the
**mic track stayed muted for a further ~6 seconds** while the page looked
healthy. Until the targeted re-run in §8, "resume is automatic" is NOT settled,
and the RESUME affordance stays exactly where it is.

### RULE 2 · AWAY FROM THE SCREEN — merged, was rules 2 and 3

Minimise and lock are **one observed state**, because on the measured device they
are indistinguishable: identical event sequence, identical wake-lock and context
columns, audio ratio 1.00 in both. Opening another camera app produces the same
signature again. The app cannot tell which happened and does not pretend to.

**Observed signature:** camera track muted, audio clock keeping perfect pace,
JavaScript still running, page hidden. Classifier state `backgrounded_degraded`.

**Behaviour:**

1. **The camera pauses** — the platform's decision, reported, not caused by us.
2. **The audio keeps going out.** Ruled explicitly. The original rule 3 stopped
   both on the reading that a locked phone means the artist has stepped away;
   the app cannot distinguish that from a phone in a pocket mid-song, and cutting
   a performer's voice because their screen went dark is the worse of the two
   available failures. **No code may stop publishing on an interruption** without
   a signal that distinguishes intent, and no capture so far contains one.
3. **The audience cuts to another camera if one exists, otherwise the holding
   state.** Already works with no new code: the muted camera track fires
   `TrackMuted`, which is already `publication_muted` in the liveness registry.
4. **The artist is told clearly, on return** — `components/AwayReturnNotice.jsx`,
   wording approved 2026-09-03:

   > Your camera paused while you were away.
   > Your microphone stayed on.
   > *You were away for 41s.*

   A return notice rather than a live one, because the state only exists
   while nobody is looking at the screen. That constraint is what keeps the
   copy honest: it reports what just happened on this device, rather than
   describing how the platform behaves. Second line because the artist would
   never guess it and might have wanted to prevent it. Third line because it
   answers the only question worth asking on return — how bad was that — and
   four seconds and two minutes are different situations.

   Nothing about what the audience saw: this measured the phone, not
   delivery. Shown only past 5s away, top of console, auto-dismissed at 10s,
   tap to clear.

**What must never be built from this:** a line anywhere promising that minimising
or locking keeps the artist live. This is one run, on one handset, in one
browser. The state is *reported when observed*, in the past tense, and never
predicted.

### RULE 3 · (retired — merged into rule 2)

### A shape the spec did not have: BRIEF AUDIO GRAB

The assistant/alarm step produced something none of the three rules described:
**9.8 seconds of audio interruption with the page visible and both tracks
unmuted**, ratio 0.11, and the context's `interrupted` state arriving *after* the
app was already back in the foreground.

No mute event, no visibility change, no track flag moved. The only signal that
changed was the audio clock — which is what the classifier derives audio
liveness from, so the branch fires correctly and needs no new rule. The
late-arriving context state is informational and is deliberately not acted on.

Its one consequence is the **confirm-before-announce delay** (`lib/awaySignal.js`,
`ANNOUNCE_CONFIRM_MS`): a grab shorter than the sample window must not make the
audience's holding frame appear and vanish. Two samples, still ahead of the 3s
watchdog, and asymmetric — coming back is announced immediately, because a stale
away claim costs a held frame nobody should be seeing.

---

## 8 · Owed, and explicitly not settled

Carried forward so none of it can quietly become assumed:

1. **Every camera claim rests on declared state, not observed frames.** A local
   counter structurally cannot settle the hidden cases (§4.1). What the room
   actually received needs a real show with a second device and the existing
   receiving-side frame watchdog. Keep it marked that way.
2. **The 6-second post-call mic mute.** The context auto-resumed; the microphone
   track did not, for six further seconds, and the unmute coincided exactly with
   the next step's app switch, so the cause is not isolated. Owed: a targeted
   re-run that ends a call and then does nothing at all, to see when the track
   comes back on its own. Until then "resume is automatic" is not settled.
3. **A Safari run.** Chrome on iOS is WKWebView — the engine is Safari's, the app
   container and its audio-session configuration are not, and call handling lives
   exactly there.
4. **An Android run.** Every branch in the Android column of §4.1 is still
   unverified.
5. ~~Artist-facing wording for the merged state~~ — **closed 2026-09-03**,
   approved and shipped (§7, rule 2).
