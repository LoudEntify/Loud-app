# EXP-VD-001 — Performer-aware camera assessment

Status: experimental, disabled by default. This is a visual measurement
component, not a trained AI Director. The existing rules-based `autoDirector`
remains the only automatic shot selector and does not consume these features.

## Architecture

The operator/director client observes separate muted video elements attached to
existing LiveKit camera tracks. At most one 256×144 frame per camera is copied
every two seconds to a module Web Worker. The broadcast tracks are not replaced,
processed, paused, or delayed.

The worker runs MediaPipe Pose Landmarker Lite on CPU and calculates deterministic
image-quality metrics. Results go to existing health telemetry as
`visual_camera_assessment` and are also emitted as the browser event
`loudentify:camera-feature` for experimental inspection. No shot command reads
that event.

Enable only in an experiment deployment:

```text
NEXT_PUBLIC_EXP_VD_001_ENABLED=true
```

Defaults live in `DEFAULT_VISION_CONFIG` in `lib/visualAssessment.mjs`:

- sample: 256×144 every 2,000 ms;
- stale threshold: 5,000 ms without media-time progress;
- one pose, confidence threshold 0.45;
- CPU inference, 250 ms soft budget;
- adaptive interval backoff up to 8× when inference exceeds budget;
- skip while the page is hidden or `isInputPending()` reports user work.

The MediaPipe WASM and Lite model currently load from version-pinned Google/CDN
URLs. Production activation should self-host reviewed immutable assets, record
their hashes and licences, and update the two configuration URLs.

## Camera feature schema

Schema version: `exp-vd-001.v1`.

| Field | Meaning |
| --- | --- |
| `cameraId` | Existing Loudentify source key, not a new identity |
| `sampledAt`, `frameTimestampMs` | Wall-clock sample and source media time |
| `available`, `stale`, `unavailableReason` | Frame availability verdict |
| `dimensions` | Sample dimensions, never assumed source dimensions |
| `pose.detected`, `confidence` | Pose result and mean visible-landmark confidence |
| `pose.visibleLandmarkRatio` | Visible landmarks divided by returned landmarks |
| `pose.boundingBox`, `coverage` | Normalized performer extent and frame area |
| `pose.centerOffset`, `headroom` | Composition measurements |
| `pose.framing` | Experimental `wide`, `medium`, `close`, or `unknown` |
| `pose.compositionQuality` | Heuristic 0–1 score; not a learned aesthetic score |
| `image.averageLuma` | Normalized mean luminance |
| `image.underexposedRatio`, `overexposedRatio` | Clipped-pixel ratios |
| `image.exposureQuality` | Heuristic 0–1 exposure score |
| `image.laplacianVariance`, `sharpnessQuality` | Edge energy and normalized blur heuristic |
| `stability.poseCenterMovement` | Normalized performer-center movement between samples |
| `stability.frameDelta`, `stabilityQuality` | Sparse luminance change and heuristic stability |
| `costs.frameCopyMs`, `workerMs`, `modelMs`, `qualityMs`, `totalMs` | Measured processing cost |
| `costs.modelError` | Sanitized local model failure, if quality metrics still completed |

Scores are features for evaluation, not quality labels or director decisions.
Camera motion and performer motion are not separable from one RGB feed, so
`stabilityQuality` must not be interpreted as tripod shake without validation.

## Failure and stale behavior

No frame, failed copy, worker/model initialization failure, inference failure,
and five seconds without source-media progress produce structured unavailable
features. They never block rendering or LiveKit. `trackLiveness` remains the
authoritative rules-director eligibility system.

## Initial measured baseline

Measured locally on 19 November 2026 in the installed headless Chromium, using
MediaPipe Pose Landmarker Lite on CPU and a synthetic 256×144 blank frame:

- model and WASM initialization: **2,558 ms**;
- first inference: **73.5 ms**;
- next nine inferences: **16.06 ms mean**;
- maximum of ten: **73.5 ms**;
- detections: **0**, expected because the test frame contains no person.

The deterministic image-quality pass measured separately in Node over 100
256×144 synthetic frames: **33.5–35.6 ms total, 0.33–0.36 ms/frame** across
the initial and final verification runs.

These are engineering timing baselines, not accuracy, production-device, thermal,
or multi-camera benchmarks. A representative labelled performer dataset and real
operator hardware are required before assessing detection/framing quality.

## Tests

- `npm run check:vision` tests exposure, blur, pose visibility/framing,
  stability, stale features, schema versioning and the deterministic pipeline.
- `npm run baseline:vision:model` loads the actual WASM/model in Chromium and
  measures initialization plus ten inference calls. It requires network access
  to the official model URL and is intentionally separate from the offline build.
