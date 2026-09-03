# INTERRUPTION HANDLING — what the platform can actually honour

Round-3 groundwork. 3 September 2026 · branch `feature/mvp-round-2`

**Status: nothing built. This is the feasibility record and the probe protocol.**
The interruption rules themselves are not implemented and must not be until the
Android run is done and the iPhone run is scheduled.

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
| Holding state — "Back in a moment" over the held frame, live surfaces only | `HOLDING_OVERLAY` in `components/LiveDemo.jsx` |
| DND pre-show prompt, per artist per device, never claiming DND is on | `lib/dndPrompt.js`, `components/DndPrompt.jsx`, rendered in Kit Check |
| The shape classifier | `lib/interruptionState.js` |
| Departure announcement on capability loss | `lib/awaySignal.js`, consumed as the `announced_away` impairment reason in `lib/trackLiveness.js` |
| Resume affordance | `components/ResumeAffordance.jsx` |
| Capability language throughout | `describeInterruption()` — the single place artist-facing interruption copy is written |

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

### 4.1 Branch verification status — UNVERIFIED UNTIL OBSERVED

The branches ship as written. What has actually been *reached on a device* is a
separate question from whether the branch is correct, and this table is the
record. **A branch marked unverified has never been observed; it must not be
described as working, in a report, a commit message or a conversation, until a
capture shows it.** Update this table from probe CSVs, not from reasoning.

| Branch (`lib/interruptionState.js`) | Desktop | Android | iOS |
|---|---|---|---|
| `live` | **observed** — every capture in this repo | unverified | unverified |
| `backgrounded_running` | **observed** — 270s hidden, nothing lost (§2.3) | unverified | unverified |
| `backgrounded_degraded` | not expected (desktop loses nothing) | unverified — **the branch Android is most likely to settle**, if the camera is released on backgrounding while audio continues | unverified |
| `audio_interrupted` | unverified | unverified — reachable if a call leaves the page foregrounded | unverified — **the branch that decides whether rule 1 is separable from rule 3** |
| `camera_taken` | unverified | unverified — the "camera taken" probe step targets exactly this | unverified |
| `capture_lost` | unverified | unverified | unverified |
| `suspended_return` (retrospective, not a branch) | not expected | unverified | unverified — expected on both minimise and lock, which is what would collapse rules 2 and 3 |

Two branches Android **cannot** settle on its own, whatever the run shows:

1. **`audio_interrupted` on iOS.** Android reaching it proves the branch works; it
   says nothing about whether iOS leaves the page foregrounded during a call
   banner. If iOS does not, rule 1 has no separate shape there.
2. **Any claim that a branch is *not* reachable.** A branch not seen in one
   20-minute run is a branch not seen, not a branch that cannot happen. Absence of
   a row is the weakest evidence in this document and is never a verdict.

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

## 7 · Spec revisions to expect

Provisional, pending both runs:

1. **Rule 2 needs an iOS clause, or has to be dropped on iOS.** If the audio
   session does not survive backgrounding there, "the artist is still performing"
   is not a state that exists on the primary device, and the nearest achievable
   behaviour is to make the stop *fast and announced* rather than silent.
2. **Rule 3's automatic resume may be a tap.** Design the affordance either way;
   let the capability test decide which fires.
3. **Rule 1's DND exception comes out** and becomes the pre-show prompt (§1).
4. **Rule 1 is detectable as "something took your audio", not as a call.** The
   ringing-versus-answered split may or may not be observable on iOS; §5.2.4.
