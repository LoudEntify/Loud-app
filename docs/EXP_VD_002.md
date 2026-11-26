# EXP-VD-002 — camera recommendation

Task 09 emits `exp-vd-001.v1` feature vectors outside the media path. The baseline scorer accepts only fresh, healthy cameras with a sufficiently visible performer, then applies minimum-hold time, cooldown, and quality-margin hysteresis.

The rules director stays authoritative when `NEXT_PUBLIC_EXP_VD_002_MODE` is unset, `off`, or `shadow`. Shadow mode logs `camera_recommendation` events with the rules choice, recommendation, confidence, reasons, and fallback. `active` may replace an automatic choice only when that exact live track still exists. Human commands bypass recommendation, and missing inference falls back to rules.

Start with `NEXT_PUBLIC_EXP_VD_001_ENABLED=true` and `NEXT_PUBLIC_EXP_VD_002_MODE=shadow`. Do not use `active` until shadow evidence is reviewed.

## Dataset and evaluation

The available label is `shot_commands.decision_source='human'`. A training row requires a human `targetSourceKey` and at least two same-session vectors from the previous five seconds. Auto/cue cuts are excluded. Performer + session groups are hashed wholly into train or test to prevent leakage.

```sh
npm run prepare:camera-dataset -- events.jsonl artifacts/camera-ranking-dataset.json
npm run train:camera-ranker -- artifacts/camera-ranking-dataset.json artifacts/camera-ranker-report.json
```

Suitability requires 500 choices, 10 groups, two held-out groups, and zero group leakage. If those gates pass, the pipeline fits a versioned pairwise logistic ranker and compares held-out top-1 accuracy and evaluation latency with the deterministic baseline. Otherwise it produces no model. There is no approved event export in the repository, so no learned model or improvement claim exists yet. Unit fixtures establish baseline correctness only; production accuracy, latency comparison, and failure cases remain unmeasured until a qualifying export exists.
