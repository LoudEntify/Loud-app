# Loudentify technical innovation report

Evidence date: 19 November 2026  
Repository: `LoudEntify/Loud-app`  
Purpose: technical due diligence for an Innovator Founder endorsement application

## Evidence standard and claim labels

This report describes only evidence present in the repository and reproducible commands. It does not treat a design document, passing mock, or synthetic benchmark as proof of production performance.

- **IMPLEMENTED** — source code or database migration exists.
- **TESTED** — a repository test or recorded measurement exists; the test scope is stated.
- **EXPERIMENTAL** — implemented research code, disabled or shadowed by default.
- **PLANNED** — documented future work without a completed implementation.
- **NOT YET VALIDATED** — implemented or proposed, but not supported by representative production evidence.

## Executive technical finding

Loudentify combines multi-device WebRTC production, a rules-based live director, artist-owned YouTube delivery, latency-aware audience interaction, and an experimental performer-aware camera assessment/recommendation layer.

The defensible innovation evidence is the architecture and experimental method: visual analysis runs outside the critical media path; decisions are explainable and constrained; the existing director remains the fallback; human commands retain precedence; and learned ranking is gated on leakage-safe evidence. **NOT YET VALIDATED:** the repository does not demonstrate that a learned model outperforms the deterministic director or that the system sustains 5–50 real concurrent media shows.

## 1. Existing rules-based director architecture

**IMPLEMENTED.** [`lib/autoDirector.js`](../../lib/autoDirector.js) contains the Layer 1 director. It cycles through `wide → mediumCU → closeUp → bRoll → mediumCU`, skips unavailable sources, avoids same-feed cuts when another angle exists, applies shot-specific hold ranges, and limits animated techniques. Automatic, cue, and human cuts use the same command path in [`lib/shotCommands.js`](../../lib/shotCommands.js) and [`components/LiveDemo.jsx`](../../components/LiveDemo.jsx).

**IMPLEMENTED.** Commands contain shot, source role, concrete `targetIdentity`/`targetSourceKey`, previous shot, and `decisionSource`. They are distributed through LiveKit's reliable data channel and logged to `shot_commands`. Human selections are therefore distinguishable from automatic weak labels.

**TESTED.** Existing director, window/liveness, orchestration, and build checks exercise state and failure behavior. These are software correctness tests, not an artistic-quality evaluation.

## 2. Original technical limitations

The rules director is deterministic choreography rather than perception:

- **IMPLEMENTED limitation:** it knows track availability and source roles but does not understand performer visibility, pose, blur, exposure, composition, or stability.
- **IMPLEMENTED limitation:** hold durations and technique substitutions are heuristic.
- **NOT YET VALIDATED:** artistic quality has not been measured against representative human-directed shows.
- **NOT YET VALIDATED:** historical engineering records identify incomplete app-level session recovery and previously unverified egress behavior in [`docs/BUILD_AUDIT_2026-08.md`](../BUILD_AUDIT_2026-08.md). That audit is historical and should not be read as the current state without checking later commits.

## 3. Proposed AI Director innovation

**EXPERIMENTAL.** The proposed system ranks live camera sources from performer-aware visual features while keeping inference outside the media path. Its safety structure is:

1. sample low-resolution frames without altering published tracks;
2. generate timestamped, versioned feature vectors;
3. reject stale, unavailable, unhealthy, or low-visibility sources;
4. score remaining cameras deterministically;
5. apply minimum hold, cooldown, and switching-margin constraints;
6. compare recommendations with the rules director in shadow mode;
7. permit controlled activation only through a feature flag;
8. preserve human override and rules fallback.

This is not described as a trained autonomous director.

## 4. Implemented computer-vision components

**EXPERIMENTAL / IMPLEMENTED.** Commit `9ded421` added EXP-VD-001:

- [`lib/visualAssessment.mjs`](../../lib/visualAssessment.mjs): versioned feature schema, luminance/exposure, Laplacian sharpness, pose visibility/framing/composition, frame delta, and stability heuristics;
- [`lib/visualAssessmentService.js`](../../lib/visualAssessmentService.js): sampling and adaptive CPU backoff;
- [`workers/visualAssessment.worker.js`](../../workers/visualAssessment.worker.js): MediaPipe Pose Landmarker Lite and deterministic image metrics;
- [`components/CameraAssessmentProbe.jsx`](../../components/CameraAssessmentProbe.jsx): operator-side observation of existing LiveKit tracks;
- [`docs/EXP_VD_001.md`](../EXP_VD_001.md): schema, failure behavior, and baseline record.

**IMPLEMENTED safety:** default disabled; 256×144 sampling every two seconds; stale-frame detection; worker isolation; hidden-page/user-input yielding; structured unavailable results; no modification of broadcast tracks.

## 5. Implemented camera recommendation components

**EXPERIMENTAL / IMPLEMENTED.** Commit `b904c1e` added:

- [`lib/cameraRecommendation.mjs`](../../lib/cameraRecommendation.mjs): deterministic scoring, eligibility constraints, confidence/reasons, minimum hold, cooldown, switching margin, and safe director selection;
- [`lib/cameraRecommendationRuntime.js`](../../lib/cameraRecommendationRuntime.js): feature snapshot registry, shadow telemetry, and mode selection;
- integration in [`components/LiveDemo.jsx`](../../components/LiveDemo.jsx), limited to automatic decisions and live tracks;
- `NEXT_PUBLIC_EXP_VD_002_MODE=off|shadow|active`, defaulting to `off`.

**TESTED.** [`scripts/camera-recommendation-tests.mjs`](../../scripts/camera-recommendation-tests.mjs) covers stale/unhealthy rejection, holding, switching, shadow selection, activation, human override, and fallback.

## 6. Research hypotheses and experiment methods

| Hypothesis | Method | Status |
| --- | --- | --- |
| Performer-aware features can be extracted cheaply outside the critical media path. | Versioned 256×144 sampling, worker timing fields, model and image-metric baselines. | **EXPERIMENTAL; partially TESTED for timing only** |
| Visibility/health constraints reduce unsafe camera recommendations. | Synthetic fixtures for stale, unhealthy, missing-pose and low-visibility vectors. | **TESTED in unit fixtures; NOT YET VALIDATED live** |
| Hysteresis prevents rapid switching. | Minimum hold, cooldown and score-margin tests. | **TESTED deterministically** |
| A learned ranker can predict human camera choices better than the baseline. | Join feature snapshots to human cuts, split by performer/session, fit pairwise logistic ranker, compare held-out top-1 accuracy. | **PLANNED method implemented; NOT YET VALIDATED** |
| AI can be introduced without destabilising output. | Shadow comparison, exact-live-track check, human bypass, rules fallback, inference-failure scenario. | **IMPLEMENTED and synthetically TESTED; NOT YET VALIDATED in production** |

## 7–9. Model results, baseline comparison, and human dataset

**IMPLEMENTED.** [`scripts/prepare-camera-ranking-dataset.mjs`](../../scripts/prepare-camera-ranking-dataset.mjs) accepts JSONL evidence, includes only human decisions, requires the selected camera plus at least one alternative in the preceding five seconds, and assigns the complete performer/session group to one split using a stable hash.

**IMPLEMENTED.** [`scripts/train-camera-ranker.mjs`](../../scripts/train-camera-ranker.mjs) requires at least 500 matched choices, 10 performer/session groups, two held-out groups, and zero group leakage. If sufficient, it fits a versioned pairwise logistic ranker and compares held-out top-1 accuracy with the deterministic baseline.

**NOT YET VALIDATED.** No approved matched event export exists in the repository. No trained model, accuracy result, baseline delta, or evidence of improvement exists. This absence is a substantive research result: the evidence gate prevented an unsupported model claim.

## 10. Technical limitations and known failures

- **NOT YET VALIDATED:** pose accuracy on performers, stages, occlusion, low light, diverse skin tones, mobile cameras, and thermal throttling.
- **IMPLEMENTED limitation:** stability cannot distinguish camera shake from performer motion using a single RGB feed.
- **PLANNED:** self-host and hash the currently version-pinned MediaPipe WASM/model assets before production activation.
- **NOT YET VALIDATED:** learned ranking, multi-camera inference capacity, artistic acceptance, and long-duration inference stability.
- **NOT YET VALIDATED:** the output-worker adapter described by orchestration is not evidence of a production RTMP compositor/encoder. [`docs/SHOW_ORCHESTRATION.md`](../SHOW_ORCHESTRATION.md) explicitly distinguishes existing recording egress from YouTube delivery output.
- **NOT YET VALIDATED:** real YouTube ingest recovery, quota behavior under load, and production broadcast endurance.

## 11. Media and streaming architecture

**IMPLEMENTED.** Artist devices publish camera/audio tracks to LiveKit. Loudentify's directed programme is represented through shot commands and a composed renderer. Existing LiveKit room-composite egress supports recording. Artist-owned YouTube connection, readiness, broadcast resources, and official embedded playback are implemented server-side/client-side at their appropriate boundaries.

**IMPLEMENTED.** OAuth uses one-time hashed state, PKCE, server-side code exchange, encrypted refresh-token storage, ownership checks, and server-only token handling. Broadcast management stores YouTube resource identifiers and encrypted ingestion credentials. Relevant evidence: [`lib/youtubeServer.js`](../../lib/youtubeServer.js), [`lib/youtubeBroadcastManager.mjs`](../../lib/youtubeBroadcastManager.mjs), and [`docs/youtube_live_setup.sql`](../youtube_live_setup.sql).

**IMPLEMENTED.** Lifecycle orchestration uses legal states, persistent database leases, optimistic version checks, idempotent operations, checkpoints, reconciliation, and audit events. Evidence: [`lib/showOrchestrator.mjs`](../../lib/showOrchestrator.mjs), [`lib/showOrchestrationRepository.js`](../../lib/showOrchestrationRepository.js), and [`docs/show_orchestration.sql`](../show_orchestration.sql).

## 12–13. Infrastructure cost and scalability

**NOT YET VALIDATED.** No actual encoder/cloud media cost per show-hour is recorded. The safe harness intentionally invokes no billable media service and reports the value as `null`.

**TESTED, synthetic scope only.** Commit `4e5d5ed` added twelve deterministic fault scenarios and target profiles of 5, 10, 25 and 50 shows. All 36 attempts per profile passed in the recorded run. These exercise local control-plane objects, not real concurrent media shows. Detailed evidence is in [scalability-evidence.md](scalability-evidence.md) and [`artifacts/stream-reliability-report.json`](../../artifacts/stream-reliability-report.json).

## 14. Security and reliability controls

**IMPLEMENTED:**

- Supabase authentication and artist ownership checks on protected routes;
- encrypted OAuth refresh tokens and YouTube ingestion credentials;
- OAuth state, PKCE, expiry and one-time consumption;
- no client exposure of Google client secret, refresh token, or ingestion secret;
- RLS/revoked browser access for server-only YouTube tables;
- scoped show ownership for egress and broadcast operations;
- database lease and optimistic concurrency for show start/stop;
- idempotent YouTube resource creation and transitions;
- explicit external API error handling and sanitized logging;
- rules fallback and human override for experimental recommendations;
- rate limiting and documented auth models across API routes.

**TESTED:** YouTube mocked API tests, route-auth scan, orchestration lifecycle/concurrency/recovery tests, recommendation tests, and synthetic reliability tests.

**NOT YET VALIDATED:** an independent current penetration test, disaster-recovery exercise, real provider failover drill, and sustained external load test.

## 15. Commit and contributor evidence

The primary innovation sequence in Git is:

| Commit | Date | Repository author | Evidence |
| --- | --- | --- | --- |
| `478dd9b` | 2026-11-19 | Ugochukwu Onah | YouTube OAuth connection |
| `b93b9b4` | 2026-11-19 | Ugochukwu Onah | YouTube readiness |
| `ca0ca6d` | 2026-11-19 | Ugochukwu Onah | Broadcast management |
| `a994456` | 2026-11-19 | Ugochukwu Onah | Lifecycle orchestration |
| `cbb8763` | 2026-11-19 | Ugochukwu Onah | YouTube viewer integration |
| `243c553` | 2026-11-19 | Ugochukwu Onah | Latency-aware interactions |
| `9ded421` | 2026-11-19 | Ugochukwu Onah | EXP-VD-001 visual assessment |
| `b904c1e` | 2026-11-19 | Ugochukwu Onah | EXP-VD-002 recommendation engine |
| `4e5d5ed` | 2026-11-19 | Ugochukwu Onah | Reliability/load framework |

Git records several contributors and automated/AI author identities. Git metadata proves repository attribution, not legal identity, employment, authorship originality, or founder status. See [founder-contributions.md](founder-contributions.md).

## 16. Technical roadmap and future R&D

1. **PLANNED:** collect consented, representative human-directed feature/cut pairs with dataset governance.
2. **PLANNED:** audit coverage, label timing, operator intent, class imbalance and performer/session diversity.
3. **PLANNED:** run the leakage-safe ranker and publish held-out results whether positive or negative.
4. **PLANNED:** shadow the deterministic and learned recommendations during controlled rehearsals.
5. **PLANNED:** study failure cases, bias, temporal smoothness, operator rejection and inference budgets.
6. **PLANNED:** approve a non-production end-to-end media test with dedicated accounts, budget limits and teardown.
7. **PLANNED:** measure encoder CPU/GPU, memory, bitrate, dropped frames, recovery, quota and cost per show-hour.
8. **PLANNED:** activate recommendations only after documented safety and quality thresholds; preserve manual control and rules fallback.

## Reproduction commands

```sh
npm run check:vision
npm run baseline:vision:model
npm run check:recommendation
npm run check:orchestration
npm run check:stream-reliability
npm run test:stream-load
npm run check:youtube
npm run check:build
```

The model baseline requires network access to the pinned model assets. The load command remains local and does not contact production services.
