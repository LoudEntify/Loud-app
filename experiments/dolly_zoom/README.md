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
