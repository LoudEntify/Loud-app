# Dolly zoom: offline experiment and design note

Status: experiment only. Branch `experiment/dolly-zoom`. No app code, no migrations, nothing deployed, not merged. Code lives in `experiments/dolly_zoom/`. Korey approved dolly zoom as a rare "big moment" technique, added alongside the existing shot grammar without changing it.

## Versions compared

Each run produces one side-by-side MP4: original, V1, V2, V3.

- **V1, performer/background split.** MediaPipe Selfie Segmentation mask. The performer stays at constant scale, and the background is a clean plate scaled by the background law.
- **V2, layered parallax.** MediaPipe mask. The background is split into five horizontal bands at assumed depths, each scaled separately. **The depth source is a stand-in proxy, not Depth Anything Small.** The model weights are on a host the sandbox cannot reach, so V2 does not test the model.
- **V3, split with a matting model.** Robust Video Matting (MobileNetV3, ONNX) mask with exponential temporal smoothing (weight 0.6 on the previous frame). Same split compositing as V1.

## Variants of the effect

- **Grow (default).** Dolly out and zoom in. The background grows behind a constant-size performer (background output scale 1.27 at the end of the 1.5 s ramp). The enlarged background covers the whole frame, so no picture is needed beyond the frame edge.
- **Shrink.** Used only when the device starts at 1.3x zoom or more. Simulated here with a 1.5x start. The camera zooms out during the effect, the background shrinks to exactly the full frame at the end, and the performer is kept at the 1.5x size by the compositor. The revealed background is real picture from the full clip. The performer's pixels are upscaled 1.5x, so the performer is softer than the background.

Neither variant uses blurred fill at the frame edges, and neither uses a digital crop.

Background law: scale(d) = ((ds - m) * d) / (ds * (d - m)). Defaults ds = 3, d = 8. Grow ramps m to 0.9. Shrink solves m for a 1/1.5 background scale, giving m = 1.333.

## Test clip

One clip so far: 12.3 s, 1080p portrait, one performer, hand gestures, no instrument, short hair. Processed at 720x1280. Trigger at 4.0 s. The synthetic clip from the earlier round is no longer used.

Clips 2 to 4 have not arrived. Results below rest on this one clip.

## Results

Edge flicker is the mean change in alpha between frames, measured on edge pixels. Lower is steadier.

| Matte | Edge flicker |
|---|---|
| MediaPipe (V1, V2) | 0.180 |
| RVM raw | 0.209 |
| RVM smoothed (V3) | 0.104 |

Smoothing roughly halves the RVM flicker. Raw RVM is steadier than MediaPipe only after smoothing.

Visual findings at the end of the grow ramp:

- **Head and hair.** All three versions give a clean outline on this clip. The hair is short, so this clip does not test hair properly.
- **Background near the subject.** V1 and V2 show grey smears where the clean plate is blurred. V3 shows a doubled edge on the red box. Likely cause: soft matte values let the unscaled frame mix with the scaled background. Not yet verified. A fix is to composite the unscaled frame only where the matte is confident.
- **Movement.** The hands moved through the mask. No failure was counted on this clip beyond the table-area issues above.
- **Instruments and mic stands.** Not present in this clip. Still untested.
- **Shrink.** The reveal uses real picture from the clip. The performer is visibly softer than the background.

## Cost, measured on CPU

Effect window, 720x1280, 4-core CPU, per frame:

| Part | Grow | Shrink |
|---|---|---|
| MediaPipe mask (every frame) | 61 ms | 61 ms |
| RVM mask (every frame) | 186 ms | 186 ms |
| V1 composite | 45 ms | 54 ms |
| V2 composite | 182 ms | 203 ms |
| V3 composite | 45 ms | 49 ms |
| One-off clean plate per clip | 25 s | reused |

Per frame total: V1 about 106 ms, V2 about 243 ms, V3 about 235 ms. Scaled to 1080p by pixel count, multiply by 2.25.

The live budget at 30 fps is 33 ms per frame. Nothing here runs live on CPU.

## GPU estimate from published figures

No GPU is available in the sandbox, so these are not measured here.

- **RVM.** The repo's own table gives model throughput, not end-to-end time. At "HD", 104 FPS on a GTX 1080 Ti (FP32) and 172 FPS on an RTX 3090 (FP16). That is roughly 6 to 10 ms per frame for the model alone. The README does not define "HD" in pixels, so the frame size behind these numbers is unverified. Source: the RVM README, <https://github.com/PeterL1n/RobustVideoMatting>. The paper quotes 76 FPS at 4K on a 1080 Ti.
- **MediaPipe selfie segmentation.** Google reports about 34 ms per frame on a Pixel 6 CPU, and about the same on GPU, so the GPU does not help on that phone. Source: <https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/index>. A third-party blog claims 1 to 3 ms on WebGPU with a laptop, but it cites no method, so it is unverified.
- **Compositing.** The composite is a few warps and blends per frame. It maps well to a GPU shader. Not measured.

Working assumption for pricing: about 10 ms per frame for matting on a modern GPU at HD, plus a few milliseconds for compositing. That is roughly 15 ms per effect frame.

## Pricing unit per show

Each dolly moment ramps for 1.5 s, which is 45 frames at 30 fps.

- On CPU, V1 costs about 4.8 s of compute per dolly moment at 720p.
- On a GPU at the working assumption, about 0.7 s per dolly moment.

The price per GPU second is not known here, so the cost in dollars is left open.

One design point matters for cost. The experiment holds the end state after the ramp, so compositing would run for the rest of the shot. A live version should either return to the plain view after the ramp, or hold the end state as a static frame. This is a product call.

## Decisions and open questions

1. **Shot grammar.** Dolly zoom is approved as a rare big-moment technique alongside the existing shot grammar. Recorded in `docs/DECISIONS.md`.
2. **Clips 2 to 4.** Needed before judging across performers and instruments. Steps are in `docs/NEEDS_KOREY.md`.
3. **Hold after ramp.** Decide whether the effect returns to the plain view or holds (see cost).
4. **Matte edge fix.** Confirm the doubled-edge cause on the red box, then test a confident-only composite.

## Design: running the effect in the egress compositor

- The egress already renders the directed view in a headless browser (`components/EgressPage.jsx`). The effect is a per-frame warp and composite, so it fits a WebGL shader on that page. Segmentation or matting would run on the GPU through MediaPipe's or ONNX's web runtime. This is a proposal to measure, not a built path.
- The show must never stop. If the effect fails, the page falls back to the plain directed view and records the fallback. This follows section 4, rule 1 of `docs/CLAUDE.md`.
- The effect is triggered from the show's director log, so the recording shows the same cut the audience saw.
- Target: under 33 ms per frame at 720p on the egress host. Measure the GPU path before committing.

## Tiers

- **Option 1 (V1 or V3) for all shows.** Cheapest path. V3 needs the matting model and its extra GPU cost.
- **Option 2 as premium.** Needs a real depth model and a license check. Charge only after it beats V1 on real clips.

## Assisted optical dolly zoom

A moving camera on a gimbal, with device zoom counter-moving so the performer stays the same size. Uses lens zoom only, which fits section 5 of `docs/CLAUDE.md`. Not built. Needs gimbal integration and a camera API that exposes lens zoom per phone model.

## Option 3: 3D reprojection, post-show highlights only

Reproject the scene in 3D from a depth estimate, then render a virtual dolly. Too slow and heavy for live. Only for offline highlight clips after the show. Not started.

## Next steps

1. Korey attaches clips 2 to 4 in the session.
2. Run `experiments/dolly_zoom/dolly.py` on each clip, grow and shrink, at a chosen trigger.
3. Check the doubled-edge cause and the table-area smears on real clips.
4. Decide the hold-after-ramp behaviour and the price unit.
