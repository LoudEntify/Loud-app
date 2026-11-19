# AI Director experiment results

Evidence date: 19 November 2026

## Result summary

| Experiment | Classification | Result |
| --- | --- | --- |
| EXP-VD-001 visual assessment | **EXPERIMENTAL / TESTED** | Feature extraction and failure handling implemented; local timing baseline recorded. |
| EXP-VD-002 deterministic recommendation | **EXPERIMENTAL / TESTED** | Constraint, hysteresis, shadow, override and fallback fixtures pass. |
| Learned camera ranking | **NOT YET VALIDATED** | No qualifying matched human dataset; no model or accuracy result claimed. |
| Baseline versus learned AI | **NOT YET VALIDATED** | Evaluation pipeline exists, but there are no production metrics to compare. |

## EXP-VD-001 method

**IMPLEMENTED.** Existing LiveKit camera tracks are attached to hidden muted video elements on the operator client. At most one 256×144 frame per camera is copied every 2,000 ms into a Web Worker. MediaPipe Pose Landmarker Lite and deterministic image analysis produce `exp-vd-001.v1` vectors.

Recorded features include pose confidence, landmark visibility, normalized bounding box, frame coverage, centre offset, headroom, framing class, composition heuristic, luminance, clipped-pixel ratios, Laplacian variance, sharpness, temporal delta, stability, timestamps, availability, stale status, and processing costs.

**IMPLEMENTED safety:** inference does not alter, delay, replace, or gate media tracks. A 250 ms soft budget triggers sampling backoff. Missing frames/model failures produce unavailable vectors. The existing rules director remains available.

## Measured visual baseline

The following values are copied from [`docs/EXP_VD_001.md`](../EXP_VD_001.md), recorded locally on 19 November 2026 using installed headless Chromium, MediaPipe Pose Landmarker Lite on CPU, and a blank synthetic 256×144 frame:

| Measurement | Recorded result | Interpretation |
| --- | ---: | --- |
| Model/WASM initialization | 2,558 ms | One local initialization measurement; not a production SLA. |
| First inference | 73.5 ms | Blank synthetic frame. |
| Next nine inference mean | 16.06 ms | Warm local inference on the same synthetic input. |
| Maximum of ten | 73.5 ms | Includes first inference. |
| Person detections | 0 | Expected for blank input; not an accuracy test. |
| Deterministic image metrics | 0.33–0.36 ms/frame | 100 synthetic 256×144 frames across recorded verification runs. |

**NOT YET VALIDATED:** person/pose accuracy, framing quality, false positives/negatives, real-device thermal behavior, representative performer diversity, multi-camera pose throughput, or artistic usefulness.

## EXP-VD-002 baseline scorer

**IMPLEMENTED.** The scorer rejects unavailable, stale, unhealthy, missing-pose, low-confidence and low-visibility sources. Eligible scores combine visibility, composition, exposure, sharpness, stability, and pose confidence. Minimum hold, switch cooldown, and a quality margin prevent rapid switching. Recommendations carry confidence and reasons.

**TESTED.** Synthetic unit fixtures verify:

- fresh feature acceptance;
- stale and degraded stream rejection;
- minimum hold behavior;
- switching after a material quality difference;
- shadow mode preserving the rules choice;
- active mode selecting an eligible recommendation;
- human override bypassing recommendation;
- rules fallback when no camera is eligible.

These are functional assertions, not camera-selection accuracy results.

## Human-directed dataset method

**IMPLEMENTED.** The preparation script treats `decision_source='human'` shot commands as editorial labels and excludes automatic/cue cuts. A usable example requires:

- a concrete selected `targetSourceKey`;
- matching visual vectors from the same show/session during the preceding five seconds;
- at least two candidate cameras;
- performer and session identifiers.

The entire `performerId:sessionId` group is assigned to either train or test using a deterministic SHA-256-derived split. This prevents frames from the same performance appearing on both sides of evaluation.

**EXPERIMENTAL gate.** Training requires at least 500 matched choices, 10 performer/session groups, two held-out groups, and zero group leakage. The versioned pairwise logistic ranker uses six declared features and reports held-out top-1 accuracy, deterministic-baseline accuracy, delta, and evaluation time.

## Model training and baseline comparison

**NOT YET VALIDATED.** The repository contains no approved event export satisfying the gate. Therefore:

- model status: no qualifying model produced;
- learned accuracy: unavailable;
- deterministic baseline accuracy on representative labels: unavailable;
- improvement delta: unavailable;
- learned inference latency: unavailable;
- failure-case comparison: unavailable.

No statement that “AI improves directing” is supported at this stage. The implemented contribution is the controlled experimental pipeline and its refusal to train/report when evidence is insufficient.

## Reproduction

```sh
npm run check:vision
npm run baseline:vision:model
npm run check:recommendation
npm run prepare:camera-dataset -- approved-events.jsonl artifacts/camera-ranking-dataset.json
npm run train:camera-ranker -- artifacts/camera-ranking-dataset.json artifacts/camera-ranker-report.json
```

Only the first and third commands are fully offline. The model baseline downloads pinned model assets unless they are already cached. Dataset commands require an approved export and must not be run on personal data without appropriate governance.
