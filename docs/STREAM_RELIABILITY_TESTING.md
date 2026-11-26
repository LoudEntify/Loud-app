# Streaming reliability and scalability testing

## Safe default

`npm run test:stream-load` runs locally and invokes no LiveKit, Supabase, Google, YouTube, encoder, payment, or production endpoint. It exercises deterministic control-plane state and fault contracts for all twelve Task 11 scenarios. Output is written to `artifacts/stream-reliability-report.json` (ignored operational output, not a capability claim).

The default profiles are 5, 10, 25, and 50 concurrent synthetic shows, repeated three times. Override repetitions with `LOAD_ITERATIONS` (maximum 100), or select a subset with `LOAD_TARGETS=5,10`. These numbers are test targets only.

```sh
npm run check:stream-reliability
LOAD_ITERATIONS=10 LOAD_TARGETS=5,10 npm run test:stream-load
```

## What is measured

The report records process CPU time, single-core CPU ratio, RSS before/after/delta, scenario error rate, synthetic recovery time, unexpected interruptions, and mocked YouTube API call counts. It also runs the real Task 09 image-metric function over 256×144 synthetic frames and reports its latency and throughput separately. Pose-model inference is not included in that benchmark and is marked accordingly. The harness labels stream stability as synthetic.

Media-processing cost per show-hour is deliberately `null`: this harness starts no encoder and incurs no cloud media bill. Likewise, the results do not prove WebRTC bandwidth, composed-program stability, YouTube ingest endurance, encoder saturation, or production capacity.

## Scenario mapping

The harness covers camera and main-performer loss, identity-changing reconnect, unavailable inference with rules fallback, compositor restart, ingest recovery, revoked OAuth, idempotent repeated start, competing start leases, live viewer catch-up, unexpected broadcast completion, and independent concurrent shows.

Existing `check:orchestration` remains the deeper test for real orchestration ordering, persistent lease refusal, idempotency, partial failure reconciliation, and audit events. Task 11 composes those guarantees into repeatable load profiles rather than duplicating the production orchestrator.

## Approved staging phase

A real media test must be separately approved and configured against non-production projects. It should use dedicated LiveKit rooms, test YouTube channels with quota limits, isolated Supabase data, an explicit maximum duration/concurrency, teardown ownership, and cloud-budget alerts. Do not point this local runner at external services; it intentionally has no endpoint or credential options.

The staging report must add encoder CPU/GPU and memory, outbound bitrate and dropped frames, YouTube ingest health over time, end-to-end recovery time, API quota consumption, and actual provider cost. Until then, 5/10/25/50 are unvalidated capacity targets.
