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

- Fields: make, model, OS, OS version, app version; lenses (id, facing, focal length mm, sensor mm, field of view, max zoom on that lens, the sensor behind it: active array px, pixel array px, cropping type `freeform`/`center-only`, max digital zoom, apertures; its physical lenses with their own sensors; which frame path it is eligible for and why); device zoom (available, min, max, reason, smooth ramp, switch-over factors, optical max, whether the HAL crops beyond optical); `zoomRanges` (each part of the range as `sensor-crop` on a named lens or an `optical-switch` to one); `qualityCeiling` (the default zoom ceiling: the most zoom before the sensor region feeding 1080p is narrower than 1920 px, with the per-lens basis; the director clamps zoom targets to it); max resolution; max frame rate; stabilisation modes; manual focus; manual exposure; logical multi-camera; the active mode the app chose (`device` or `digital`) and why. Schema version 2.
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

- Fields: frame source (`hardware` = HAL crop region, `gpu` = texture crop, `cpu` = libyuv) and why it was chosen; device zoom, digital factor, effective zoom, crop window, the HAL's applied crop region (hardware path: fractions of the 16:9 band, the zoom it implies, px) and how many region pushes so far; active physical lens, focal length, aperture, ISO, exposure (ns and ms), **scene EV** (the low-light measure: log2(f²/t) − log2(ISO/100), an exposure value at ISO 100, lower = darker; about 10 in a bright room, 5 in a dim one), focus distance, AE/AF state, output size, measured fps, frames, dropped frames, conversion ms per frame, moving flag; plus the shot the camera is holding (`shot_id`, `{zoom, cx, cy}`) stamped by the runtime.
- Rate: on change, and otherwise every 500 ms (2 Hz).
- Capture: the native capturer emits `onState`; `CaptureBuffer.state()` dedupes.
- Store: training only (too many rows for Postgres). Estimate 2 × 400 B = **2.9 MB raw per camera-hour, ~300 KB gzipped**; the spike measures the real figure.
- Retention: 90 days raw; aggregates (per decision: zoom before/after, drops) live in B5 for 2 years.
- Director question: "what was the camera doing between decisions, and did the picture settle?" (dropped frames and focus hunting during a move are the quality signal).
- Verdict: **collect; in this spike.**

### B5 Director decisions

- Fields, intent row: decision id, `kind: intent`, source (director, artist, main-device, rule), the proposal it overrode, decided/sent timestamps, the shot the camera held when the command was received (`shot_id`, `shot`), and the intent (type, target zoom or tightness as a fraction of the wide reference, pan direction, degree = share of the visible frame, window, duration, easing).
- Fields, result row: `kind: result` always (the move's own kind is `move_kind`: zoom | pan), received/started/completed timestamps, frame source, mode (how the framing was realised: `region` = one HAL crop region, `device` = CONTROL_ZOOM_RATIO, `device+crop`, `digital`), requested, achieved, clamped, reason, lens before and after, lens switch, dropped frames during the move, frames during, actual and planned duration, steps planned/applied, cancelled, the HAL's applied crop region, the shot before and after (`shotIdBefore`/`shotBefore`, `shotId`/`shot`). `reason` is a real refusal or failure only: CameraX cancelling an older zoom value because a newer step landed is filtered out on the device. For a zoom: requested and achieved are effective zoom, `releasedCrop` says a pan's crop was released as part of it. For a pan: `refused` (true = the move did not run; `reason` says why, e.g. `at frame edge: left has 0.0128 of the frame left and this pan needs 0.0672`), path (`pan` = the shot's window just moved; `tighten-pan` = the shot was wider than the pan window and tightened to it as part of the same eased move), direction, requested = travel asked (fraction of the frame), achieved = travel the camera reports (the HAL's own region on the hardware path, the plan elsewhere), clamped = the two differ by more than 0.01, room (what was left to the edge), window, zoom at pan, tightened, and `effectiveZoomAchieved`.
- Controller copy of the result row adds: `move_cycle_ms` (send → ack arrived on the controller's clock: the whole cycle INCLUDING the 2-3 s move; the old reports called this "rtt"), `command_latency_ms` (sent → received, server clock: the network leg out), `ack_leg_ms` (completed → ack arrived, server clock: the leg back), and `from` (the camera's identity).
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
