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

- Fields: make, model, OS, OS version, app version; lenses (id, facing, focal length mm, sensor mm, field of view, max zoom on that lens, the sensor behind it: active array px, pixel array px, cropping type `freeform`/`center-only`, max digital zoom, apertures; its physical lenses with their own sensors; which frame path it is eligible for and why); device zoom (available, min, max, reason, smooth ramp, switch-over factors, optical max, whether the HAL crops beyond optical); `zoomRanges` (each part of the range as `sensor-crop` on a named lens or an `optical-switch` to one); `qualityCeiling` (the default zoom ceiling: the most zoom before the sensor region feeding 1080p is narrower than 1920 px, with the per-lens basis; the director clamps zoom targets to it); max resolution; max frame rate; stabilisation modes; manual focus; manual exposure; logical multi-camera; the active mode the app chose (`device` or `digital`) and why; **pro mode capability** per lens (`pro`: hardware level, MANUAL_SENSOR / MANUAL_POST_PROCESSING / READ_SENSOR_SETTINGS, ISO range, shutter range and max frame duration, exposure-compensation range and step, focus minimum/hyperfocal diopters, calibration and AF modes, AWB modes and lock availability, AE modes and lock availability, frame-rate ranges, stabilisation modes) and the derived `proSupport` for the primary lens (per control: supported, the one-line reason when not, the usable range in wire units). Schema version 3 (docs/SPIKE_PRO_MODE_PLAN.md).
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

- Fields: frame source (`hardware` = HAL crop region, `gpu` = texture crop, `cpu` = libyuv) and why it was chosen; device zoom, digital factor, effective zoom, crop window, the HAL's applied crop region (hardware path: fractions of the 16:9 band, the zoom it implies, px) and how many region pushes so far; active physical lens, focal length, aperture, ISO, exposure (ns and ms), **scene EV** (the low-light measure: log2(f²/t) − log2(ISO/100), an exposure value at ISO 100, lower = darker; about 10 in a bright room, 5 in a dim one), focus distance, AE/AF state, output size, measured fps, frames, dropped frames, conversion ms per frame, moving flag; plus the shot the camera is holding (`shot_id`, `{zoom, cx, cy}`) stamped by the runtime; and a `pro` block: `{ enabled: false }` while pro mode is off (nothing extra is read per frame), else the applied manual state as the HAL reports it (`iso`, `shutterMs`, `colorGains`, `wbKelvin` estimated from the gains, `focusDiopters`, `evIndex`/`evStops`, `aeLock`, `awbLock`, `aeMode`, `awbMode`, `afMode`, `frameDurationMs`, `fps`).
- Pan region (docs/DECISIONS.md 2026-10-15): `requestedRegion` (the sensor region the camera was asked for, px), `appliedCrop` (the region the camera reports, as band fractions), `regionReasserts` (how many times the request was sent again because the camera reported something else for eight results running). A pan record with `requestedRegion` ≠ `appliedCrop` for more than a moment is a lost request.
- Orientation frame (docs/DECISIONS.md 2026-10-15): `contentRotation` (the rotation the plan asks for), `builtInRotation` (what the camera pipeline already applies to the texture, measured once on the first frame), `correction` (what the capturer still applies), `uprightMethod` (`texture`, or `metadata (not a texture)` when the frame could not be corrected in the texture and carries the rotation as metadata instead), `bufferClass`, and `emittedWidth` / `emittedHeight` (the size actually published, which must match the chosen orientation).
- Orientation (docs/DECISIONS.md 2026-10-14): every sample carries `orientation` (`portrait` | `landscape`, the show's choice as applied on this camera), `rotation` (the fixed rotation the capturer applies to make the sensor's frame upright in it), `sensorOrientation`, `width`/`height` as the DISPLAY size of the published frame (1080x1920 or 1920x1080), and `orientationWarning` (the setup mount-check warning while it stands, else null). On the hardware path also `panPath` (`region` = the HAL honours an off-centre crop region; `gpu` = it re-centres, so pans are a GPU crop) and `regionProbe` (what the start-up probe asked and got).
- Rate: on change, and otherwise every 500 ms (2 Hz).
- Capture: the native capturer emits `onState`; `CaptureBuffer.state()` dedupes.
- Store: training only (too many rows for Postgres). Estimate 2 × 400 B = **2.9 MB raw per camera-hour, ~300 KB gzipped**; the spike measures the real figure.
- Retention: 90 days raw; aggregates (per decision: zoom before/after, drops) live in B5 for 2 years.
- Director question: "what was the camera doing between decisions, and did the picture settle?" (dropped frames and focus hunting during a move are the quality signal).
- Verdict: **collect; in this spike.**

### B5 Director decisions

- Fields, intent row: decision id, `kind: intent`, source (director, artist, main-device, rule), the proposal it overrode, decided/sent timestamps, the shot the camera held when the command was received (`shot_id`, `shot`), and the intent (type, target zoom or tightness as a fraction of the wide reference, pan direction, degree = share of the visible frame, window, duration, easing).
- Fields, result row: `kind: result` always (the move's own kind is `move_kind`: zoom | pan), received/started/completed timestamps, frame source, mode (how the framing was realised: `region` = one HAL crop region, `device` = CONTROL_ZOOM_RATIO, `device+crop`, `digital`), requested, achieved, clamped, reason, lens before and after, lens switch, dropped frames during the move, frames during, actual and planned duration, steps planned/applied, cancelled, the HAL's applied crop region, the shot before and after (`shotIdBefore`/`shotBefore`, `shotId`/`shot`). `reason` is a real refusal or failure only: CameraX cancelling an older zoom value because a newer step landed is filtered out on the device. For a zoom: requested and achieved are effective zoom, `releasedCrop` says a pan's crop was released as part of it. For a pan: `refused` (true = the move did not run; `reason` says why, e.g. `at frame edge: left has 0.0128 of the frame left and this pan needs 0.0672`), path (`pan` = the shot's window just moved; `tighten-pan` = the shot was wider than the pan window and tightened to it as part of the same eased move), direction, requested = travel asked (fraction of the frame), achieved = travel the camera reports (the HAL's own region on the hardware path, the plan elsewhere), clamped = the two differ by more than 0.01, room (what was left to the edge), window, zoom at pan, tightened, and `effectiveZoomAchieved`.
- Pro-mode decisions (docs/SPIKE_PRO_MODE_PLAN.md): intent `{ type: pro, control, value }`, `{ type: match, phase, targets }`, `{ type: stage, stage_requested }`, `{ type: survey }`; result `{ move_kind: pro | match | stage | survey, control, requested, planned, achieved, clamped, supported, reason, warnings, fpsExpected, readback, proEnabled }`; a match `read` result carries `targets` (the reference's ISO, shutter ms, Kelvin), a match `apply` result `targets`, `achieved`, `residual { isoStops, shutterStops, exposureStops, wbKelvin }` and `reasons`. `achieved` is the value the HAL reported after the change, `planned` what the clamp asked for.
- Orientation decisions: intent `{ type: orientation, orientation_requested }`; result `{ move_kind: orientation, requested, achieved, refused, reason, rotation, sensorOrientation, width, height, physical, mismatch, warning, fix }` (`physical` is the one gravity reading classified: portrait | portrait-down | landscape-left | landscape-right | flat | unknown; a camera that is live refuses with `refused: true`). Pro results add `framesToApply`, `settleMs` and `settled` (the answer is read only once a capture result reflects the request). Move results add `panPath`, `orientation`, `maxStepLateMs`, `lateSteps` (steps applied more than 50 ms late) and `maxFrameGapMs` (the longest gap between frames during the move: a visible jerk shows here).
- Slow-command diagnostics (both copies): the intent carries `sent_local_ms` / `offset_at_send_ms` (controller) or `received_local_ms` / `offset_at_receipt_ms` (camera); the controller's result copy adds `camera_diag` (the ack's `diag`: the camera's local receipt time, its offset, any JS-thread stall and connection-state change in the minute before) and `slow_command` (commands.slowCommandDiagnosis, for a leg out over 2 s: clock step, camera stall, link change, or unexplained). Two spike-only streams support this: `LINK` (a LiveKit connection-state change: `state`, `detail`) and `STALL` (a JS-thread stall: `lag_ms`); B12 gains `step_ms` when a sync moved the offset by more than a second.
- Every record in every stream carries `stage` (`A` | `B` | null before the first stage command), so the frame-path soak (A) and the pro-mode tests (B) separate in analysis; the reports split latency, cost and shot counts per stage.
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

### Design note: LUTs are applied in the egress compositor, never on the phone

- The phone sends what the sensor saw. Pro mode (manual exposure, white balance, focus) changes what the sensor captures, which is a camera decision the director can learn from; a look is a grading decision and belongs after the record. No LUT, tone curve or colour transform runs in the capturer or in the WebRTC path on the phone: the frame path stays as measured (B4 `convertMsPerFrame`), the per-frame CPU budget stays for the director's own work (B7 later), and a LUT bug can never cost a show its picture.
- The raw feeds stay ungraded. B1 (isolated camera recordings) and the training store see the camera's output before any look, so a model trained on them learns exposure and framing, not a grade that may change next season. A LUT applied on the phone would be baked into every training frame with no way back.
- The look is applied once, in the egress compositor (lib/pipeline/egress.js, the process that composes the programme output), as a 3D LUT (.cube) per show or per camera, chosen by the artist in Direction settings. The compositor already owns the composed picture; a LUT there is one shader pass on the frame it sends to YouTube and costs nothing on any phone.
- The active LUT is logged per frame on the programme output: the B9 programme output stream (the YouTube archive plus our offset) gains `lut_id` and `lut_version` stamped at the composed-frame rate, so any viewer-side signal (B8 reactions, B10 feedback) can be read against the look that was on screen, and a show can be re-rendered from B1 with a different look. The LUT files themselves live with the show's assets (content-addressed, so a `lut_id` is reproducible).
- Director data: a LUT change is a B5 decision (`type: lut`, source artist, the id before and after) like any other control, so the training store can tell a reaction to a camera move from a reaction to a look.
- Not in the spike: no LUT is applied anywhere yet; this note fixes where it will be. CLAUDE.md section 5 ("LUTs and background blur are not at launch") stands.

### Design note: camera colour matching belongs in the egress compositor, with the LUTs

- What the phones can do differs: on the Moto G35 manual white balance is unsupported (no MANUAL_POST_PROCESSING; the HAL takes no COLOR_CORRECTION_GAINS) while AWB lock works; ISO and shutter are honoured. Match cameras (docs/SPIKE_PRO_MODE_PLAN.md section 3) therefore matches what every phone can hold, exposure and a locked AWB, and reports the white-balance residual it could not remove (`match.results[].reasons`).
- The colour match itself is done once, in the egress compositor, as a per-camera colour transform (gains or a small matrix from the two feeds' grey-world or a chart, stored with the show like a LUT and logged on the programme output as `colour_match_id` beside `lut_id`), applied BEFORE the show's LUT. The compositor sees every feed side by side; a phone never does.
- The raw feeds and the training store stay unmatched, as with the LUT: B1 and B4 record what each sensor saw and what the camera was told (`pro.wbKelvin` estimated from the gains where the HAL reports them, AWB lock state).
- Not in the spike: nothing matches colour yet; this note fixes where it will.

### Session context: orientation

- The report (`orientation`) carries the show's orientation as chosen on the controller, what the camera's capturer did with it (`camera`: rotation, sensor orientation, display size), the setup mount check (`mount`: physical, mismatch, warning, fix, the raw gravity reading), every change (`log`), and on the camera the hardware pan path and the region probe. The same orientation is on every B4 sample and every B5 move result, so a frame can always be read in the format it was published in.

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
