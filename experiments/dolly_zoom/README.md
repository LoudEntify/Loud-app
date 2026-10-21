# Dolly zoom experiment (offline)

Offline test of two dolly-zoom versions. Not app code. Design note: `docs/DOLLY_ZOOM_DESIGN.md`.

## Run on a clip

```bash
python -m venv venv && source venv/bin/activate
pip install "mediapipe==0.10.14" "numpy<2" "opencv-python-headless<4.11"
python dolly.py --input clip.mp4 --out-dir out/clip1 --trigger 5.0
```

Output in `out/clip1/`: `side_by_side.mp4` (original | Option 1 | Option 2), `stats.json`, and `frames/` PNGs at trigger + 0.75 s and + 1.5 s.

Options: `--ds`, `--d`, `--m-end` (zoom term, must be below ds), `--crop` (0 disables), `--layers` (4 to 8).

## Synthetic test clip

```bash
python make_synthetic.py clips/synthetic.mp4
```

A public-domain photo with gentle sway. Tests that the pipeline runs. Not a look test.

## Known limits

- Option 2 uses a stand-in depth proxy, not Depth Anything Small. Swap `depth_proxy_bands()` when weights are available.
- The clean plate assumes a locked camera and a performer who moves away from the background at some point.
- Timings are CPU only. No GPU was available.

## Current run (v2)

```bash
python dolly.py --input work/clip.mp4 --out-dir out/clip --cache-dir cache/clip \
  --rvm-onnx models/rvm_mobilenetv3_fp32.onnx --variant grow --trigger 4.0
python dolly.py ... --variant shrink --zoom-start 1.5 --trigger 4.0   # reuses the cache
```

- Input must be upright. Pre-rotate phone clips with ffmpeg (OpenCV ignores the rotation tag).
- RVM weights: `rvm_mobilenetv3_fp32.onnx` from the RobustVideoMatting v1.0.0 release.
- Outputs: `side_by_side_<variant>.mp4` (original | V1 | V2 | V3), `stats_<variant>.json`, and frames.

## v3: the crisp-edge pass (21 Oct)

`dolly_v3.py` renders ORIGINAL | OLD (the 15 Oct V3) | NEW, streamed in two
passes with 8-bit mattes on disk (the full-resolution stacks did not fit in
7 GB). NEW: the RVM matte at downsample ratio 0.4 (432x768 internal on
1080p) refined with a fast guided filter against the frame, tightened
(0.08..0.92), eroded a pixel, smoothed in time only where the edge is not
moving; cubic background scaling with a light unsharp mask when enlarged;
a full-resolution clean plate with a 9 px subject margin and a pull-push
fill for the never-seen area; the plate band blended over 5 px.

Finding: the GROW variant cannot be crisp. The strip of background nearest
the subject in the output comes from behind the subject, which the camera
never sees, so it is invented; a sharp matte exposes the invented strip
as a pale cut-out. The SHRINK variant (start 1.5x, background shrinks)
takes every pixel next to the subject from real picture further out, and
ends with the background at native resolution. Stats in `results/v3/`:
shrink at 7 s, halo 3.11 -> 1.07, background sharpness ratio 1.19 -> 1.96,
edge flicker 0.087 -> 0.143 (the old matte's heavy smoothing also ghosted),
render 81 -> 107 ms per frame on a 2-core CPU; the matte itself 354 ms per
frame at ratio 0.4 (188 ms at 512 px). The 15 Oct decision (not live, GPU
cost) stands; the dolly cue should start from a 1.5x framing and pull back.
