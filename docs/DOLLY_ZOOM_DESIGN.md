# Dolly zoom: offline experiment and design note

Status: experiment only. Branch `experiment/dolly-zoom`. No app code, no migrations, nothing deployed, not merged. Code lives in `experiments/dolly_zoom/`.

## What the experiment is for

Decide whether a simulated dolly zoom looks convincing on real Loudentify footage before anything is built live. The verdict still needs real clips. See the open item in `docs/NEEDS_KOREY.md`.

## What was built

- **Option 1, performer/background split.** MediaPipe Selfie Segmentation (legacy model bundled with the pip wheel) gives a soft subject mask. The performer stays at scale 1. The background is a clean plate (temporal median of background-only pixels, locked camera assumed), scaled by the background law below. Revealed edges show a blurred, enlarged copy of the frame.
- **Option 2, layered parallax.** The background is split into five horizontal bands at assumed depths. Each band is scaled by the same law, far bands first, with the blurred fill underneath. **The depth source is a stand-in proxy, not Depth Anything Small.** The Hugging Face host is blocked from the sandbox, so the weights could not be downloaded. Option 2 results here do not test the model.
- **Background law.** scale(d) = ((ds - m) * d) / (ds * (d - m)). The zoom term m ramps from 0 to m_end over 1.5 s with smoothstep easing. The defaults are ds = 3, d = 8, m_end = 0.9, which shrinks the background to about 0.79 at the end of the ramp.
- **Trigger.** Original footage until the chosen timestamp, then the 1.5 s ramp, then the end state holds.
- **Slight crop.** A 3% centre crop ramps in with the effect. This is a digital zoom and enlarges the performer by up to 3%. See the decisions below.

## Results so far

Tested on one synthetic clip only: a public-domain photo with gentle sway, 15 s, 720x960, 30 fps. This checks that the pipeline runs. It does not show whether the effect looks right.

| Measure | Value |
|---|---|
| One-off clean plate (per clip) | 16 s on 4-core CPU |
| Segmentation and alpha, every frame | 47 ms mean, 77 ms p95 |
| Option 1 composite, effect frames | 184 ms mean, 231 ms p95 |
| Option 2 composite, effect frames | 262 ms mean, 301 ms p95 |
| GPU | Not available in sandbox, not measured |

The live budget at 30 fps is 33 ms per frame. The current code is about 5 to 8 times too slow for live use on CPU. Offline it is fine: one 1.5 s effect is about 45 frames, roughly 8 to 12 s of CPU.

Visual findings on the synthetic clip:

- The scaled background shows a dark rectangle at the photo edge. This is an artifact of the test canvas, not of the method, but it shows the edge fill behaves as intended.
- A grey halo sits above the performer's hair. Segmentation loses hair edges and the halo carries into the composite. Both options show it.
- Option 1 and Option 2 look almost the same. Expected: the stand-in depth adds little beyond the subject mask.

## Expected failure modes (to confirm on real clips)

- **Hair.** Segmentation halo at the crown and flyaways. Likely visible at the 1.5 s ramp.
- **Instruments and mic stands.** A guitar neck or mic stand crosses the mask boundary. It may be cut out, or it may ghost when the background shrinks.
- **Fast movement.** Mask lag at arm swings. The clean plate also fails if the performer stands still for the whole clip, because the performer gets baked into the plate.
- **Moving camera.** The clean plate assumes a locked camera. Handheld phone footage will smear.
- **Lighting changes.** Spotlights on the background change the plate.

## Decisions and open questions for Korey

1. **Slight crop versus "lens zoom only".** `docs/CLAUDE.md` section 5 says zoom is lens zoom only, never digital. The crop is digital and enlarges the performer. Recommend zero crop with edge fill, unless the test shows the fill is visibly worse.
2. **New shot type versus "do not change the shot grammar".** Section 5 says the AI director's shot grammar must not change. A dolly zoom is a new shot type. Needs a product call on whether it becomes a switchable shot.
3. **Which footage counts.** Only Korey's own phone clips, as instructed. No pilot recordings or other artists' footage.

## Design: running the effect in the egress compositor

- The egress already renders the directed view in a headless browser (`components/EgressPage.jsx`). The effect is a per-frame warp and composite, so it fits a WebGL fragment shader on that page, with segmentation on the GPU through MediaPipe's web runtime. This is a proposal to measure, not a built path.
- The show must never stop. If the effect fails at any point, the page falls back to the plain directed view and records the fallback. This follows section 4, rule 1.
- The effect is triggered by the show's director log, so the recording shows the same cut the audience saw.
- Target: under 33 ms per frame at 720x960 on the egress host. Measure the GPU path before committing to it.

## Tiers

- **Option 1 for all shows.** One segmentation pass, one plate per camera position. Cheapest path that still gives the effect.
- **Option 2 as premium.** Needs a real depth model, which means the GPU path and a model license check. Charge for it only after Option 2 proves better than Option 1 on real clips.

## Assisted optical dolly zoom

A moving camera on a gimbal, with device zoom counter-moving so the performer stays the same size. Uses lens zoom only, which fits section 5. The performer's size comes from the subject mask, and the zoom is adjusted from that. Not built. It needs a gimbal integration and a camera API that exposes lens zoom on each phone model.

## Option 3: 3D reprojection, post-show highlights only

Reproject the scene in 3D from a depth estimate, then render a virtual dolly. Too slow and too heavy for live use. Only for offline highlight clips after the show, from the recording. Not started.

## Next steps

1. Korey adds 3 or 4 phone clips to the session (see `docs/NEEDS_KOREY.md`).
2. Run `experiments/dolly_zoom/dolly.py` on each clip with the trigger time set for it.
3. Record which failure modes appear on real footage, and pick Option 1 or Option 2 for the next step.
