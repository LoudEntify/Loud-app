# Streaming reliability and scalability evidence

Evidence source: [`artifacts/stream-reliability-report.json`](../../artifacts/stream-reliability-report.json)  
Recorded: 19 November 2026  
Environment: Node v26.13.1, Darwin arm64

## Scope statement

**TESTED, synthetic control plane.** The framework invokes no LiveKit, Supabase, Google, YouTube, encoder, payment, or production endpoint. Targets of 5, 10, 25 and 50 mean concurrent synthetic show objects for the multi-show scenario, not concurrent video encoders or YouTube broadcasts.

**NOT YET VALIDATED.** These results do not establish production capacity, stream endurance, network bandwidth, encoder saturation, YouTube ingest stability, or cloud cost.

## Reliability scenarios

**IMPLEMENTED / TESTED:** camera disconnect; main performer disconnect; identity-changing camera reconnect; inference unavailable with rules fallback; compositor crash/restart; YouTube ingest disconnect/recovery; OAuth revocation; repeated start; competing start workers; late viewer join; unexpected broadcast end; and multiple independent shows.

The recorded run executed three iterations of twelve scenarios for each target: 36 attempts per profile. All synthetic assertions passed, giving a fixture error rate of zero. That value describes test assertions only and must not be represented as a production error rate.

## Recorded profile measurements

| Target | Elapsed | CPU time | One-core ratio | RSS delta | Attempts | Mock YouTube calls |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 21.431 ms | 31.839 ms | 1.486 | +10,895,360 B | 36/36 | 147 |
| 10 | 34.205 ms | 35.249 ms | 1.031 | +3,031,040 B | 36/36 | 192 |
| 25 | 86.739 ms | 99.456 ms | 1.147 | +10,240,000 B | 36/36 | 327 |
| 50 | 165.682 ms | 170.562 ms | 1.029 | +10,600,448 B | 36/36 | 552 |

The one-core ratio may exceed 1 because process CPU time can include work across cores and short measurements amplify scheduling noise. RSS deltas are process observations from sequential profiles, not isolated per-show memory estimates.

## Image-metric microbenchmark

This benchmark executes the real deterministic Task 09 `imageQuality` function on synthetic 256×144 frames. It excludes MediaPipe pose inference.

| Target profile | Frames | Throughput | p50 | p95 | Maximum |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 60 | 2,975.27 fps | 0.304 ms | 0.366 ms | 1.606 ms |
| 10 | 120 | 3,533.84 fps | 0.278 ms | 0.306 ms | 0.352 ms |
| 25 | 300 | 3,505.29 fps | 0.278 ms | 0.314 ms | 0.609 ms |
| 50 | 600 | 3,631.47 fps | 0.275 ms | 0.308 ms | 0.342 ms |

**TESTED:** deterministic image-metric computation on this machine.  
**NOT YET VALIDATED:** concurrent camera capture, worker transfer overhead, pose inference at these targets, real video decode, thermal behavior, or sustained duration.

## Recovery and stability interpretation

The report contains sub-millisecond recovery values because faults are deterministic in-memory state transitions. They prove scenario logic executes, not that a real compositor or YouTube ingest recovers in that time. The nine synthetic interruptions per profile are injected test events, not observed outages.

## Infrastructure cost

**NOT YET VALIDATED.** Media-processing cost per show-hour is explicitly `null`. No encoder or billable cloud media service ran. Mock YouTube API-call counts are useful for relative scenario accounting but are not verified Google quota-unit consumption.

## Existing production-oriented controls

**IMPLEMENTED:** orchestration lifecycle, persistent lease acquisition, optimistic state/version writes, idempotent start/stop, output-before-ingest ordering, ingest confirmation before live transition, failure checkpoints, reconciliation, cleanup, and audit history.

**TESTED with mocks/in-memory repository:** happy lifecycle, repeated operations, lease contention, media unready, ingest inactive, partial stop, recovery and cancellation in [`scripts/show-orchestration-tests.mjs`](../../scripts/show-orchestration-tests.mjs).

## Required approved staging test

**PLANNED.** Before making a scalability claim, run a separately authorised non-production test with:

1. dedicated LiveKit, Supabase and YouTube test resources;
2. explicit concurrency/duration ceilings and emergency teardown;
3. provider quotas and budget alerts;
4. encoder CPU/GPU/RSS, bitrate, frame drops and output continuity;
5. real pose inference latency and sampling throughput;
6. ingest status, broadcast transitions, recovery time and API quota units;
7. cost per composed show-hour;
8. retained logs with environment, commit, configuration and timestamps.

Until this work is completed, all four concurrency values remain test targets rather than demonstrated capabilities.

## Reproduction

```sh
npm run check:stream-reliability
npm run test:stream-load
LOAD_TARGETS=5,10 LOAD_ITERATIONS=10 npm run test:stream-load
```
