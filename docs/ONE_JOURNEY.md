# One journey: the architecture before the next build

Written 6 November 2026, after Korey's note that the installed apps are
confusing, that the web app shows old pilot pages, and that Kit Check
leaves a user going in circles.

He is right, and this document says why, in terms of what is actually in
the repository rather than impressions. Everything he reported comes
from one root cause. Fixing the symptoms one at a time, which is what I
have been doing for a week, cannot reach it.

---

## 1. What is actually there

There are **two complete artist journeys** in this codebase, both live,
both routable on the web today.

### The pilot journey

| Route | Component | Size |
|---|---|---|
| `/kit-check` | `components/KitCheck.jsx` | 827 lines |
| `/pilot/live`, `/live` | `components/LiveDemo.jsx` | 6,591 lines |

Behind them sit the capability panels that made the pilot work:

| Component | Size | What it does |
|---|---|---|
| `BackingTrackPanel.jsx` | 700 | cueing and playing performance tracks |
| `AudioDeckPanel.jsx` | 671 | compressor, filter, reverb, voice/track balance |
| `DirectorShotPanel.jsx` | 464 | one-tap shot console |
| `CueEditorPanel.jsx` | 361 | cue sheets |
| `CalibrateSyncPanel.jsx` | 145 | headphone delay calibration |
| `PreshowAudio.jsx` | 120 | pre-show audio |
| `VideoDeckPanel.jsx` | 73 | B-roll playback |

About 7,400 lines, and every capability Korey remembers from the pilot
is in there and working. His own description: the flows were smooth, the
UI felt clumsy.

### The new journey

| Route | Component | Size |
|---|---|---|
| `/artist/kit-check` | `components/artist/KitCheckScreen.jsx` | 179 lines |
| `/artist/console/[id]` | `components/artist/ConsoleScreen.jsx` | 331 lines |

510 lines. It uses **none** of the seven capability panels above. Not
one import.

### And the mobile app mirrors the new journey

`native/app/artist/kit-check.js` and `native/app/artist/console/[id].js`
are built against the new journey, so they inherit the new journey's
gap. That is the whole of it.

---

## 2. Everything reported follows from this

| What Korey saw | Why |
|---|---|
| Old pilot pages on the web | The pilot journey was never retired. `/kit-check` and `/pilot/live` still route. |
| "The desktop doesn't run the same path" | Correct. There are two paths and the phone copies the thinner one. |
| Audio settings are empty | The chain is in `AudioDeckPanel`, which the new journey does not import. |
| No earphone calibration | `CalibrateSyncPanel` exists, in the pilot journey. |
| Cue and track upload missing or broken | `BackingTrackPanel` and `CueEditorPanel`, same story. |
| Kit Check goes in circles | It is a 179-line checklist with nothing behind it. There is no result to arrive at. |
| Clicking "Side" flips the camera | The rebuild defined `CAMERAS = [{Main, back}, {Side, front}]`. "Side" is the front **lens of the same phone**, not a second device. The label came from the design board; the model behind it did not. |

That last one is the clearest example of the real problem. The rebuild
took the boards' vocabulary without the boards' meaning, and nobody
would find that by testing one screen at a time.

---

## 3. What I got wrong

I rebuilt the app against the design boards and treated the pilot code
as the old thing being replaced. It was not. It was the specification,
in working form. The boards describe what a screen looks like; the pilot
describes what the product does. I shipped the first and left the second
behind, then spent a week discovering its absence one screen at a time
and writing honest little notices saying each piece was missing.

Those notices were true, which is why they survived review, and they
were the wrong artefact. "There is no vocal chain in the capturer yet"
is an accurate sentence about a product that should not have shipped
that screen at all.

---

## 4. The architecture

**One journey.** The new UI, with the pilot's capabilities behind it,
on both web and mobile. The pilot journey is then deleted rather than
left routable, because two paths is how they drift.

Three layers:

### Layer 1: shared logic (`lib/`, already aliased to `@loud/lib`)

Platform-independent rules, imported identically by the Next.js app and
by Metro. Twenty modules are already shared this way, including
`liveCuts`, `rig`, `showWindow`, `direction` and `pipeline/compositor`.
Everything that is a **decision** belongs here:

- which cuts are available, and what refuses one
- what the rig is and what each device may do
- cue sheet structure and timing
- the audio chain's parameters and presets, as data
- quota, limits, validation

If web and mobile can disagree about it, it goes here.

### Layer 2: platform capability

The parts that genuinely cannot be shared, because the platforms differ:

| Capability | Web | Mobile |
|---|---|---|
| Camera capture | `getUserMedia` | `loud-camera` native module |
| Audio processing | Web Audio API | `LoudVocalChain.kt` (6 Nov) |
| Publishing | `livekit-client` | `livekit-client` + RN WebRTC |
| File picking | `<input type=file>` | `expo-document-picker` |

Each exposes the **same interface** to layer 3, so a screen does not
know which platform it is on.

### Layer 3: the screens

Two sets, one per platform, both driven by layers 1 and 2 and both
following the design boards. They will not look identical, and should
not. They will behave identically, because the decisions are shared.

---

## 5. The audio question, stated plainly

This is the one place where "the same on both" is not available for
free, and it should be decided rather than discovered.

The pilot's chain is the Web Audio API: `AudioContext`,
`createDynamicsCompressor`, `createConvolver`, `getUserMedia`. It is
browser technology. React Native has none of it, and more importantly
LiveKit on a phone publishes the microphone from the native layer, so
there is no point in JavaScript where processed audio can be inserted
between the mic and the broadcast.

Three options:

1. **Native DSP in `loud-camera`.** Filter, compressor and reverb in
   Kotlin and again in Swift, feeding the WebRTC audio source. The
   phone becomes a standalone studio. This is real engineering work on
   two platforms, and it is the only option that makes the phone
   self-sufficient.
2. **Perform from desktop web, phone as camera.** The chain already
   exists and works. This is what the pilot did. Available immediately.
3. **Process in the compositor.** Rejected: LiveKit egress offers no
   DSP hooks, and the artist's monitoring would not match what goes out.

**My recommendation: (2) now, (1) next.** It gets a full pilot test
without waiting on native DSP, and the artist position is where the
chain matters. The phone is already a working camera with sound. Korey
decides; this is his call on time and money, not mine.

---

## 6. Kit Check, redesigned

The current screen is a checklist that confirms things and arrives
nowhere. What the pilot's Kit Check did, and what this should do, is
**get the rig ready and prove it**.

One screen, four bands, each of which either shows a result or offers
the one action that produces it:

1. **Your rig.** Every device as a live tile. Add a camera. Each tile
   names the device and its job. Tapping one sets the opening shot.
   The tiles are **devices**, never lenses. Front and back is a setting
   on a device, inside that device's tile.
2. **Sound.** Live input meter, the vocal preset, voice and track
   balance, headphone calibration. Each either works or says what to do.
3. **Connection and phone.** Uplink, battery, Do Not Disturb. Already
   real, already honest.
4. **Ready.** One line that is either "ready to go live" with the button,
   or the single thing stopping it. No circles.

The rule that keeps it out of circles: **every row ends in a result or
an action, never in a statement about the build**.

---

## 7. Sequence

Each step ends with something testable rather than a half-migration.

| # | Step | Ends with |
|---|---|---|
| 1 | Lift the audio chain's parameters and presets into `lib/` as data | Web unchanged, shared definitions |
| 2 | Put the capability panels behind the new web artist screens | Desktop web does the full pilot flow in the new UI |
| 3 | Retire the pilot journey: delete `/kit-check`, `/pilot/live`, `/live`, the spike routes | One path on the web |
| 4 | Rebuild Kit Check to section 6, web first, then mobile | No circles, on both |
| 5 | Camera list shows devices, not lenses, on both | The confusion Korey hit is gone |
| 6 | Full pilot test: desktop artist, phone cameras, real viewers | Evidence |
| 7 | Native audio chain, if chosen | Phone is self-sufficient |

### Where this stands, 6 November

| # | State |
|---|---|
| 1 | Done. `lib/audio/chain.js` holds the parameters; the web reads from it. |
| 5 | Done. `lib/kitCheck.js` makes the camera list devices, on both platforms. |
| 7 | Done, and taken out of "if chosen": Korey's ruling was build it. `lib/audio/dsp.js` derives the coefficients, `LoudVocalChain.kt` runs the loop. iOS still outstanding. |
| 2, 3, 4, 6 | Not started. |

Step 4 is partly paid for: the Ready band is now a verdict with one
action rather than a score, shared by both screens, which was the
specific thing that made the screen feel like circles. The four-band
layout of section 6 is still to build.

### A correction to section 5 above

Section 5 said the mobile audio chain was "not yet built" and listed
three options. That was right about audio and wrong by omission about
everything else: when Korey asked for the camera, technique and colour
work to be integrated, I found all ten modules already written and
tested — `proMode` (manual ISO, shutter, white balance, exposure, locks),
`zoomPlan`, `survey`, `facing`, `frameRate`, `region`, `orientation`,
`commands`, `clock`, `capture` — in `native/src/spike/`, reachable only
by the spike route.

And the web was importing them across the boundary:
`components/spike/ControllerScreen.jsx` had
`import { proWarnings } from '../../native/src/spike/proMode.js'`.

So the layer-2 table above was wrong in a way that mattered: these are
not platform capabilities at all. They are decisions, they were always
platform-free, and they are now `lib/camera/`. The lesson for the
remaining steps is the one Korey gave on 5 November and I have now had to
learn twice in a week: survey what exists before describing what is
missing.

Steps 1 to 5 are the "architect before building" Korey asked for. Step 6
is the test he wants. Step 7 is the decision above.

---

## 8. What this does not cover

- **The broadcast still reaches YouTube as audio over a black frame.**
  Unresolved since 2 Nov and independent of everything above. The
  console's full-screen stage was built to split the question: picture
  on the console and not on YouTube means the compositor; black on both
  means the room. That answer is still needed and still outstanding.
- **iOS.** Everything here is Android and web. The iOS build has not
  been exercised.
- **Effort.** No estimates. I have been wrong about scope twice this
  week by taking a library's latest version instead of the pinned one,
  which is a small thing, but the lesson generalises: I should measure
  before promising.
