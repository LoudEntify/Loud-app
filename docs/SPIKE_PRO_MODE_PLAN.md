# Device-zoom spike, phase 3: pro mode (plan)

Branch `spike/native-device-zoom`, built on commit `0d0b9b1` (the frame-path
build) without changing the frame path. Not merged. Companion to
docs/DIRECTOR_DATA_SPEC.md (the data) and docs/NEEDS_KOREY.md (the test).

## What "pro mode" is here

Manual camera control from the main device: ISO, shutter, white balance in
Kelvin, focus distance, exposure compensation, and locking or unlocking
auto-exposure (AE), auto-white-balance (AWB) and autofocus (AF), per
camera, over the same LiveKit data channel the zoom and pan commands use.
Plus one "Match cameras" command that locks every camera to the reference
camera's exposure and white balance. Everything is reported back with the
value actually achieved and a reason when it was clamped or unsupported,
and everything is logged as a decision.

**Off by default, free when off.** Pro mode is a set of Camera2 capture-
request options that are only sent when a pro command arrives; nothing is
read, computed or written per frame until the first `pro.enable`. The
capture-result callback already reads ISO and exposure for B4; the extra
reads pro mode needs (colour gains, lock states, frame duration) are
behind a flag that `pro.enable` sets and `pro.disable` clears.

## 1. Capability (B2, schema 3)

Per lens, from Camera2 characteristics alone (no camera opened), a `pro`
block:

| Field | Source |
|---|---|
| `hardwareLevel` | INFO_SUPPORTED_HARDWARE_LEVEL (`legacy`, `limited`, `full`, `level3`, `external`) |
| `manualSensor`, `manualPostProcessing`, `readSensorSettings` | REQUEST_AVAILABLE_CAPABILITIES |
| `isoRange` | SENSOR_INFO_SENSITIVITY_RANGE |
| `shutterNsRange`, `maxFrameDurationNs` | SENSOR_INFO_EXPOSURE_TIME_RANGE, SENSOR_INFO_MAX_FRAME_DURATION |
| `evRange`, `evStep` | CONTROL_AE_COMPENSATION_RANGE / _STEP |
| `focus.minDiopters`, `focus.hyperfocalDiopters`, `focus.calibration`, `focus.afModes` | LENS_INFO_MINIMUM_FOCUS_DISTANCE, LENS_INFO_HYPERFOCAL_DISTANCE, LENS_INFO_FOCUS_DISTANCE_CALIBRATION, CONTROL_AF_AVAILABLE_MODES |
| `awbModes`, `awbLockAvailable`, `aeModes`, `aeLockAvailable` | CONTROL_AWB_AVAILABLE_MODES, CONTROL_AWB_LOCK_AVAILABLE, CONTROL_AE_AVAILABLE_MODES, CONTROL_AE_LOCK_AVAILABLE |
| `fpsRanges`, `stabilisation` | CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES, the video/optical stabilisation modes |

survey.js derives `proSupport` from it: for each control `supported`,
`reason` and the usable range (ISO needs MANUAL_SENSOR; shutter needs
MANUAL_SENSOR; white balance needs MANUAL_POST_PROCESSING, since Camera2
has no Kelvin API and we drive COLOR_CORRECTION_GAINS; focus needs a
minimum focus distance above 0 and AF mode OFF; EV needs a non-empty
compensation range; the locks need their *_LOCK_AVAILABLE flags).

iOS: the same block from AVCaptureDevice (`isExposureModeSupported(.custom)`,
`activeFormat.minISO/maxISO`, `min/maxExposureDuration`,
`isWhiteBalanceModeSupported(.locked)`, `isLockingFocusWithCustomLensPositionSupported`,
`min/maxExposureTargetBias`, lock modes, frame-rate ranges, stabilisation
modes). Written in `ios/CameraSurvey.swift`, not compiled (no macOS runner,
as before).

## 2. Commands (protocol v1, new types)

| Type | Fields | Camera does |
|---|---|---|
| `pro` | `control` ∈ iso, shutter, wb, focus, ev, lock, unlock, enable, disable; `value` | one capture-request change; ack with `{ control, requested, achieved, clamped, reason, supported, fpsExpected }` |
| `match` | `phase: 'read'` (to the reference) or `'apply'` + `{ iso, shutterMs, wbKelvin }` (to every camera) | read: ack with current values; apply: lock AE/AWB at the nearest achievable values, ack with the residual |
| `stage` | `stage: 'A' \| 'B'` | tags every record from then on |
| `survey` (existing type, now answered) | — | ack with the B2 `pro` block and frame source, so the controller can gate its controls |

Units on the wire: ISO as a number, shutter in milliseconds, white balance in
Kelvin, focus in diopters (0 = infinity), EV in stops. `lock`/`unlock` take
`value` ∈ ae, awb, af.

How each lands on Android (Camera2 through CameraX interop,
`Camera2CameraControl.setCaptureRequestOptions`):

- ISO or shutter: CONTROL_AE_MODE OFF, SENSOR_SENSITIVITY, SENSOR_EXPOSURE_TIME (the other one held at its current value), SENSOR_FRAME_DURATION = max(1/fps, exposure). Clamped to the sensor ranges.
- White balance: CONTROL_AWB_MODE OFF, COLOR_CORRECTION_MODE TRANSFORM_MATRIX, COLOR_CORRECTION_GAINS from Kelvin (a Planckian approximation, documented in proMode.js), COLOR_CORRECTION_TRANSFORM = the last matrix the HAL reported while AWB was auto. Clamped to 2000–10000 K. The achieved value is the Kelvin the applied gains map back to.
- Focus: CONTROL_AF_MODE OFF, LENS_FOCUS_DISTANCE (diopters), clamped to [0, minimum focus distance].
- EV: CameraX `setExposureCompensationIndex` (AE must be on; with AE off the reason says so).
- Locks: CONTROL_AE_LOCK, CONTROL_AWB_LOCK; AF lock = AF_MODE OFF at the distance the HAL last reported (Camera2 has no "lock here" for AF outside a trigger sequence; the reason says so).
- `disable`: clears every option (`clearCaptureRequestOptions`), AE/AWB/AF back to auto, flag off.

Achieved values come from the capture results after the change (the
capturer waits for the next three frames, then reads SENSOR_SENSITIVITY,
SENSOR_EXPOSURE_TIME, COLOR_CORRECTION_GAINS, LENS_FOCUS_DISTANCE, the
lock states and SENSOR_FRAME_DURATION).

## 3. Match cameras

Two phases, run by the controller (`matchCameras()`):

1. `match read` to the reference camera → its current ISO, shutter, Kelvin estimate (from the colour gains the HAL reports) and focus.
2. `match apply` with those targets to every camera, the reference included → each locks AE and AWB at the nearest values it can achieve and acks `{ target, achieved, residual: { isoStops, shutterStops, wbKelvin } }`.

The controller's report gets a `match` section: per camera the target, the
achieved values and the residual. With one phone the reference matches
itself, which proves the read→apply path and the residual arithmetic; the
multi-camera case is the same code with more participants.

## 4. Gating

The controller asks the camera for its `pro` block (`survey` command) when
it joins, and renders only the controls `proSupport` marks supported, each
unsupported one as a greyed row with its one-line reason. Warnings
(`proWarnings`, platform-free):

- shutter longer than one frame at the target fps → "will drop the frame rate to about N fps";
- ISO above half the sensor's maximum → "noise: expect visible grain";
- any manual control on a `legacy` or `limited` device without MANUAL_SENSOR → "this device runs manual controls through a slower path; expect dropped frames".

The same warnings travel in the ack (`warnings`) so the camera's log and
the B5 result carry them.

## 5. Data

- B5: every pro command is a decision: intent `{ type: 'pro', control, value, stage }`, result `{ control, requested, achieved, clamped, reason, supported, warnings, stage }`; `match` likewise with both phases.
- B4: when pro mode is on, a `pro` block in every state sample: `enabled, aeMode, awbMode, afMode, aeLock, awbLock, wbKelvin, colorGains, focusDiopters, evIndex, frameDurationMs`; ISO, exposure and scene EV were already there. Off: the block is `{ enabled: false }` and nothing extra is read.
- Stage: every record (B2, B4, B5, B12, COST) carries `stage` (`A`, `B`, or null before the first stage command); the reports split latency, cost and shot counts per stage.

## 6. LUTs

Not on the phone. A design note in docs/DIRECTOR_DATA_SPEC.md: LUTs are
applied in the egress compositor; raw feeds stay ungraded (the training
store sees what the sensor saw); the active LUT id is logged per frame on
the programme output stream.

## Not in this phase

- iOS compilation (as before).
- Per-frame pro telemetry above the 2 Hz B4 rate.
- Any change to the frame path or the shot model from `0d0b9b1`.
