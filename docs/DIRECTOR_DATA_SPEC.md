# Director data specification

Status: draft for review, branch `spike/native-device-zoom`, 12 October 2026.
Migrations are written (`supabase/migrations/20261012010000_director_data_spike.sql`)
and rehearsed locally (applied, rolled back, re-applied, SQL tests green);
they are **not applied to staging** until this spec is approved.

Purpose: everything the AI director will learn from, named once, with what
it costs to collect and what question it answers. If a stream has no
director question it is not collected.

Rules that apply to every stream (docs/CLAUDE.md sections 3 and 4):

- Pseudonymous ids only. The artist is their auth uuid in the operational
  store and a salted hash of it in the training store. Devices are a
  make-model-build slug, never a serial number. Viewers never appear.
- No names, emails or chat text in either store. Feedback is codes.
- No face recognition and no face embeddings, now or later. B7 is body
  position only.
- Append-only where a row records something that happened. Retention is
  a scheduled delete by the table owner.
- `schema_version` on every record. Every timestamp carries server time
  (B12) and the clock error bound it was written with.
- Training-store writes are gated on the performer's training-data
  consent (`consent_records`, `training_data`). The operational store is
  needed to run the show and is not.

## Two stores

| Store | What | Where | Why |
|---|---|---|---|
| Operational | sessions, device profiles, placements, decisions with results, cue versions, feedback, clock offsets, an index of files | Postgres, `director_*` tables, RLS on, zero policies, service role only | the director and the artist query these row by row during and after a show |
| Training | the 2 Hz camera state and a copy of everything above, as gzipped NDJSON, one file per device per minute | private bucket `director-spike` (spike) → `director-data` (later), `<artist uuid>/<yyyy-mm-dd>/<device>/<name>.ndjson.gz` | row-by-row Postgres would be the largest table in the database within a month and nothing reads it that way |

Decision record: docs/DECISIONS.md, 2026-10-12.

## The streams

Rate is per camera unless stated. Store sizes are measured or estimated
as noted; the spike exports the measured numbers in its report file.

### B1 Isolated camera recordings

- Fields: the video of each camera as published (1080×1920, 30 fps, H.264), with the LiveKit track sid, device id, slot and server start time.
- Rate: continuous during a show.
- Capture: LiveKit track egress to the `recordings` bucket (the pipeline already used for the programme recording), one file per camera.
- Store: training only. ~3 Mbps → **1.35 GB per camera-hour**; a two-hour, three-camera show is 8.1 GB. Supabase storage at $0.021/GB-month makes that about $0.17 per show per month kept; LiveKit Cloud egress is billed per minute of recording and is the larger cost (three parallel track egresses for the whole show), to be read off the plan before this is switched on.
- Retention: 90 days, 2 years when the artist has training consent.
- Director question: "what did each camera see at the moment the director chose, and would the other choice have been better?" Nothing else answers it.
- Verdict: **collect, consented artists only, not in this spike.** The switch is per artist, off by default.

### B2 Device capability profile

- Fields: make, model, OS, OS version, app version; lenses (id, facing, focal length mm, sensor mm, field of view, max zoom on that lens); device zoom (available, min, max, reason, smooth ramp, switch-over factors, optical max, whether the HAL crops beyond optical); max resolution; max frame rate; stabilisation modes; manual focus; manual exposure; logical multi-camera; the active mode the app chose (`device` or `digital`) and why.
- Rate: once per session, and on demand (survey mode).
- Capture: `native/modules/loud-camera` survey (Camera2 characteristics on Android, AVCaptureDevice on iOS); no camera opened, no permission needed.
- Store: both. ~5 KB. `director_device_profiles.profile`.
- Retention: 2 years.
- Director question: "what can this camera do?" (whether a zoom-in is a lens move, a HAL crop or impossible; where lens switches will show).
- Verdict: **collect; in this spike.**

### B3 Camera placement

- Fields: device id, slot, role, distance to performer (m), height (m), angle (deg), mount.
- Rate: once per Kit Check.
- Capture: Kit Check asks for the numbers (sliders, not text).
- Store: operational (`director_camera_placements`), copied to training. < 1 KB.
- Retention: 2 years.
- Director question: "which camera is the close one, and how close?" so a tightness target can be turned into a zoom per camera.
- Verdict: **collect; not in this spike** (needs a Kit Check UI change).

### B4 Camera state

- Fields: device zoom, digital factor, effective zoom, crop window, active physical lens, focal length, ISO, exposure, focus distance, AE/AF state, output size, measured fps, frames, dropped frames, conversion ms per frame, moving flag.
- Rate: on change, and otherwise every 500 ms (2 Hz).
- Capture: the native capturer emits `onState`; `CaptureBuffer.state()` dedupes.
- Store: training only (too many rows for Postgres). Estimate 2 × 400 B = **2.9 MB raw per camera-hour, ~300 KB gzipped**; the spike measures the real figure.
- Retention: 90 days raw; aggregates (per decision: zoom before/after, drops) live in B5 for 2 years.
- Director question: "what was the camera doing between decisions, and did the picture settle?" (dropped frames and focus hunting during a move are the quality signal).
- Verdict: **collect; in this spike.**

### B5 Director decisions

- Fields, intent row: decision id, kind, source (director, artist, main-device, rule), the proposal it overrode, decided/sent timestamps, and the intent (type, target zoom or tightness as a fraction of the wide reference, pan direction, degree, window, duration, easing).
- Fields, result row: received/started/completed timestamps, mode (device, digital, device+crop, crop), requested, achieved, clamped, reason, lens before and after, lens switch, dropped frames during the move, actual duration, round trip ms. For a pan also: path (`pull-back` = device zoom ramped out while the window closed in on the same frames; `crop-ease` = no zoom headroom, the window eased in as part of the move; `pan-only` = the window was already the asked size), window, digital factor, lead-in ms, travel (fraction of the frame actually moved), pull-back from/to device zoom.
- Rate: a few per minute.
- Capture: `commands.js` on the control phone writes the intent when it sends; the camera writes the intent on receipt and the result on completion; both ack over the data channel so either side's record is complete.
- Store: both. `director_decisions` (two rows share `decision_id`; `shot_commands.decision_id` links the compositor's record). ~0.4 MB raw per hour.
- Retention: 2 years.
- Director question: the core one: "given everything else, what was chosen, what happened, and how long did it take?"
- Verdict: **collect; in this spike.**

### B6 Cue sheet versions

- Fields: show id, cue sheet id, version, changed by, the sheet after the change, changed at.
- Rate: per edit.
- Capture: the cue sheet routes write a version row on save.
- Store: operational, copied to training. A few KB per version.
- Retention: 2 years.
- Director question: "what did the artist plan, and what did they change after the rehearsal?"
- Verdict: **collect; not in this spike** (route change).

### B7 Performer position

- Fields: per camera, body bounding box and up to 17 keypoints (no face landmarks), confidence, at 5 Hz. Never a face embedding, never identity.
- Rate: 5 Hz per camera.
- Capture: on-device pose model in the native capturer; only numbers leave the phone.
- Store: training only. ~5 × 300 B = 5.4 MB raw per camera-hour, ~600 KB gzipped.
- Retention: 90 days.
- Director question: "where is the performer in the frame, and did the pan keep them there?"
- Verdict: **collect later, after the zoom spike proves the frame path can afford it**; the phone CPU budget is the gate.

### B8 Audience reaction density

- Fields: reactions per 10 s window by playback position, per show.
- Rate: derived.
- Capture: already in `reaction_events` (playback-stamped).
- Store: a view over `reaction_events`; nothing new.
- Director question: "did the audience react to the shot?"
- Verdict: **not worth collecting separately**; derive.

### B9 Programme output

- Fields: what viewers saw.
- Capture: YouTube holds the broadcast archive for every show (`youtube_broadcasts`); our offset to the YouTube timeline is already recorded for playback stamping.
- Store: nothing new; keep the video id and offset.
- Director question: "what did the audience see at this decision?" Answered by B5's timestamps against the YouTube archive.
- Verdict: **not worth collecting a copy** while YouTube is the delivery; revisit for `loudentify-llhls`.

### B10 Artist feedback

- Fields: decision id, verdict (good/bad), reason code (too-late, too-early, too-tight, too-wide, wrong-camera, too-fast, too-slow, missed-moment, other), given at. No free text.
- Rate: a few per show.
- Capture: a thumbs control on the main device during and after the show.
- Store: both. `director_feedback`.
- Retention: 2 years.
- Director question: the label: "was this a good decision?"
- Verdict: **collect; not in this spike** (UI).

### B11 Audio levels and beat

- Fields: RMS level, peak, beat markers from the main device's mic, 10 Hz.
- Capture: main device audio analysis (already has the raw input for the watch-mic rule).
- Store: training only. ~10 × 60 B = 2 MB raw per hour, ~200 KB gzipped.
- Retention: 90 days.
- Director question: "cut on the beat; zoom on the build."
- Verdict: **collect later**; cheap, but needs the main-device audio path first.

### B12 Clock offsets

- Fields: device id, measured-at (device ms), offset ms, error bound ms, rtt ms, samples.
- Rate: once a minute per device.
- Capture: `clock.js`: five round trips to `/api/spike/clock`, lowest RTT wins, offset = server − (sent + rtt/2), error bound rtt/2.
- Store: both. 9 KB per hour.
- Retention: 90 days.
- Director question: none directly; it is what makes every other timestamp comparable across two phones and the web app.
- Verdict: **collect; in this spike.**

### Not collected, ever

Chat text, viewer identity, device serial numbers, raw audio, face data of
any kind, per-frame telemetry above 2 Hz outside B7.

## Storage per hour, per camera (estimates; the spike measures)

| Stream | Raw | Gzipped |
|---|---|---|
| B4 state | 2.9 MB | ~300 KB |
| B5 decisions | 0.4 MB | ~50 KB |
| B12 + cost counters | 0.15 MB | ~20 KB |
| B2 | 5 KB once | |
| Total without video | ~3.5 MB | ~0.4 MB |
| B1 video | 1.35 GB | (already compressed) |

## Spike (Part A and C) scope

Collected on the phones: B2, B4, B5, B12 and the spike's own cost counters
(CPU share, thermal status, battery, bytes sent). Batches every 60 s,
never during a move, never when collection is off, via a signed upload
URL from `/api/spike/upload-url` into `director-spike`.

The three `app/api/spike/*` routes are preview-only (`devHarnessAllowed`)
and are deleted when the spike ends; `director_stream_files` is written
by the real ingest route when there is one, not by the spike.

## Open questions for review

1. B1 consent default off is the proposed posture; confirm.
2. 90 days for raw B4/B7 versus 2 years for decisions: confirm the split.
3. Whether `director_sessions.artist_id` should be the hashed id even in the operational store (costs a join through a salt table for every artist-facing query).
