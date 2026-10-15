#!/usr/bin/env python3
"""Offline dolly-zoom experiment, Options 1 and 2. Not app code.

Usage:
  python dolly.py --input clip.mp4 --out-dir out/clip1 --trigger 5.0

Option 1: performer/background split using MediaPipe Selfie Segmentation.
Option 2: layered parallax. Depth comes from a STAND-IN proxy (see
          depth_proxy_bands) because the Depth Anything weights could not
          be downloaded in the sandbox. Option 2 numbers are therefore NOT
          a test of Depth Anything.

Both use the same background law:
    scale(d) = ((ds - m) * d) / (ds * (d - m))
ds = subject distance (subject stays at scale 1), d = background distance,
m = zoom term, ramped 0 -> m_end over the effect. scale(d) == 1 at m == 0.
"""
import argparse
import json
import os
import platform
import subprocess
import time

import cv2
import mediapipe as mp
import numpy as np

EFFECT_SECONDS = 1.5


def bg_scale(m, ds, d):
    """Background scale relative to a constant-size subject."""
    return ((ds - m) * d) / (ds * (d - m))


def smoothstep(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3.0 - 2.0 * u)


def scale_about_center(img, s):
    """Scale an image about its centre; revealed area is zero."""
    h, w = img.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    M = np.array([[s, 0, cx * (1 - s)], [0, s, cy * (1 - s)]], np.float32)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def edge_fill(img):
    """Blurred, enlarged copy of the image. Sits underneath revealed gaps."""
    h, w = img.shape[:2]
    small = cv2.resize(img, (max(w // 8, 1), max(h // 8, 1)), interpolation=cv2.INTER_AREA)
    big = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur(big, (0, 0), 16).astype(np.float32)


def crop_zoom(img, c):
    """Slight simultaneous crop: keep the centre 1/c and resize back.
    NOTE: this is digital zoom and enlarges the subject by c. See design note."""
    if c <= 1.0:
        return img
    h, w = img.shape[:2]
    ch, cw = int(round(h / c)), int(round(w / c))
    y0, x0 = (h - ch) // 2, (w - cw) // 2
    return cv2.resize(img[y0:y0 + ch, x0:x0 + cw], (w, h), interpolation=cv2.INTER_LINEAR)


def soft_alpha(mask):
    """MediaPipe mask (0..1) to a feathered alpha (float32, 0..1)."""
    a = np.clip((mask - 0.3) / 0.4, 0.0, 1.0)
    return cv2.GaussianBlur(a, (0, 0), 1.5)


def segment(seg, frame_bgr):
    res = seg.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    return np.clip(res.segmentation_mask.astype(np.float32), 0, 1)


def clean_plate(frames, alphas, h, w):
    """Temporal median of background-only pixels at quarter resolution.
    Works for a locked-off camera. Holes (subject never moved away) are inpainted."""
    qh, qw = h // 4, w // 4
    n = len(frames)
    stack = np.empty((n, qh, qw, 3), np.float32)
    bgok = np.empty((n, qh, qw), bool)
    for i in range(n):
        small = cv2.resize(frames[i], (qw, qh), interpolation=cv2.INTER_AREA).astype(np.float32)
        am = cv2.resize(alphas[i].astype(np.float32) / 255.0, (qw, qh), interpolation=cv2.INTER_AREA)
        ok = am < 0.2
        bgok[i] = ok
        stack[i] = np.where(ok[..., None], small, np.nan)
    with np.errstate(all="ignore"):
        med = np.nanmedian(stack, axis=0)
    del stack
    have = bgok.sum(axis=0) > 0
    med = np.nan_to_num(med, nan=0.0).astype(np.uint8)
    hole = ((~have).astype(np.uint8)) * 255
    if hole.any():
        med = cv2.inpaint(med, hole, 5, cv2.INPAINT_TELEA)
    return cv2.resize(med, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)


def depth_proxy_bands(h, w, layers):
    """STAND-IN for a depth model. Returns (bands, band_depth_factor).

    Subject is its own near layer. The background is split into (layers-1)
    horizontal bands; the top band is treated as farthest (back wall or
    ceiling), the bottom band nearest. Replace this function with Depth
    Anything Small output (quantised into layers) when weights are available.
    """
    k = max(layers - 1, 1)
    ys = np.arange(h, dtype=np.float32) / max(h - 1, 1)
    bands = []
    centres = []
    for i in range(k):
        lo, hi = i / k, (i + 1) / k
        row = ((ys >= lo) & (ys < hi)).astype(np.float32)
        bands.append(np.repeat(row[:, None], w, axis=1))
        centres.append((lo + hi) / 2)
    sig = max(h / 40.0, 2.0)
    bands = [cv2.GaussianBlur(b, (0, 0), sig) for b in bands]
    total = np.sum(bands, axis=0) + 1e-6
    bands = [b / total for b in bands]
    # depth factor in [0,1]: 1 = farthest band, 0 = nearest band
    factors = [1.0 - c for c in centres]
    return bands, factors


def bg_source(frame, plate, alpha):
    """Background pixels from the real frame; subject area (dilated) from the clean plate."""
    A = cv2.dilate(alpha, np.ones((15, 15), np.uint8))[..., None].astype(np.float32)
    return frame.astype(np.float32) * (1 - A) + plate * A


def render_opt1(frame, alpha, plate, s, crop_c):
    src = bg_source(frame, plate, alpha)
    fill = edge_fill(src)
    cov = scale_about_center(np.ones(frame.shape[:2], np.float32), s)[..., None]
    bgw = scale_about_center(src, s)
    bg = bgw * cov + fill * (1 - cov)
    a = alpha[..., None]
    out = frame.astype(np.float32) * a + bg * (1 - a)
    return crop_zoom(out, crop_c)


def render_opt2(frame, alpha, plate, bands, factors, ds, d_far, m, crop_c):
    src = bg_source(frame, plate, alpha)
    canvas = edge_fill(src)
    bgw = (1 - alpha)
    layers = []
    for b, f in zip(bands, factors):
        d_k = ds + (d_far - ds) * f
        layers.append((d_k, b))
    layers.sort(key=lambda x: -x[0])  # far to near
    for d_k, b in layers:
        s = bg_scale(m, ds, d_k)
        lay = scale_about_center(src, s)
        a = scale_about_center((b * bgw).astype(np.float32), s)[..., None]
        canvas = lay * a + canvas * (1 - a)
    a = alpha[..., None]
    out = frame.astype(np.float32) * a + canvas * (1 - a)
    return crop_zoom(out, crop_c)


def label(img, text):
    out = img.copy()
    cv2.rectangle(out, (0, 0), (min(out.shape[1], 16 + 22 * len(text)), 44), (0, 0, 0), -1)
    cv2.putText(out, text, (12, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def cpu_name():
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


def pct(xs, q):
    return float(np.percentile(xs, q)) if xs else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--trigger", type=float, required=True, help="effect start, seconds")
    ap.add_argument("--ds", type=float, default=3.0, help="subject distance (arbitrary units)")
    ap.add_argument("--d", type=float, default=8.0, help="assumed background distance")
    ap.add_argument("--m-end", type=float, default=0.9, help="zoom term at end of ramp (< ds)")
    ap.add_argument("--crop", type=float, default=0.03, help="crop fraction at end of ramp (0 disables)")
    ap.add_argument("--layers", type=int, default=6, help="Option 2 layer count (4 to 8)")
    args = ap.parse_args()
    assert 4 <= args.layers <= 8, "--layers must be 4 to 8"
    assert 0 < args.m_end < args.ds < args.d, "need 0 < m_end < ds < d"

    os.makedirs(args.out_dir, exist_ok=True)
    frames_dir = os.path.join(args.out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(args.input)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames, alphas, t_mask = [], [], []
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    while True:
        ok, f = cap.read()
        if not ok:
            break
        t0 = time.perf_counter()
        a = soft_alpha(segment(seg, f))
        t_mask.append(time.perf_counter() - t0)
        frames.append(f)
        alphas.append((a * 255).astype(np.uint8))
    cap.release()
    seg.close()
    if not frames:
        raise SystemExit("no frames read")
    h, w = frames[0].shape[:2]

    t0 = time.perf_counter()
    plate = clean_plate(frames, alphas, h, w)
    t_plate = time.perf_counter() - t0

    t0 = time.perf_counter()
    bands, factors = depth_proxy_bands(h, w, args.layers)
    t_depth = time.perf_counter() - t0

    tmp = os.path.join(args.out_dir, "_silent.mp4")
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (3 * w, h))
    t1_times, t2_times = [], []
    snap_frames = {}
    snap_times = {round(args.trigger + EFFECT_SECONDS * 0.5, 3), round(args.trigger + EFFECT_SECONDS, 3)}
    for i, frame in enumerate(frames):
        t = i / fps
        alpha = alphas[i].astype(np.float32) / 255.0
        if t < args.trigger:
            o1 = o2 = frame
        else:
            u = (t - args.trigger) / EFFECT_SECONDS
            ue = smoothstep(u)
            m = ue * args.m_end
            s_bg = bg_scale(m, args.ds, args.d)
            crop_c = 1.0 + args.crop * ue
            ta = time.perf_counter()
            o1 = render_opt1(frame, alpha, plate, s_bg, crop_c).clip(0, 255).astype(np.uint8)
            tb = time.perf_counter()
            o2 = render_opt2(frame, alpha, plate, bands, factors, args.ds, args.d, m, crop_c).clip(0, 255).astype(np.uint8)
            tc = time.perf_counter()
            t1_times.append(tb - ta)
            t2_times.append(tc - tb)
        panel = np.hstack([label(frame, "ORIGINAL"), label(o1, "OPTION 1"), label(o2, "OPTION 2")])
        writer.write(panel)
        for st in snap_times:
            if abs(t - st) < 0.5 / fps:
                key = f"{st:.2f}"
                snap_frames[key] = (frame, o1, o2)
    writer.release()

    for key, (fo, f1, f2) in snap_frames.items():
        cv2.imwrite(os.path.join(frames_dir, f"t{key}_original.png"), fo)
        cv2.imwrite(os.path.join(frames_dir, f"t{key}_option1.png"), f1)
        cv2.imwrite(os.path.join(frames_dir, f"t{key}_option2.png"), f2)

    out_mp4 = os.path.join(args.out_dir, "side_by_side.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-i", args.input,
        "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        "-movflags", "+faststart", out_mp4,
    ], check=True)
    os.remove(tmp)

    stats = {
        "input": os.path.basename(args.input),
        "resolution": [w, h], "fps": fps, "frames": len(frames),
        "params": {"ds": args.ds, "d": args.d, "m_end": args.m_end,
                   "crop": args.crop, "layers": args.layers, "trigger_s": args.trigger,
                   "effect_s": EFFECT_SECONDS,
                   "bg_scale_at_end_nominal": round(bg_scale(args.m_end, args.ds, args.d), 4)},
        "one_off_seconds": {"clean_plate": round(t_plate, 3), "depth_proxy": round(t_depth, 4)},
        "per_frame_ms_all_frames_segmentation_and_alpha": {
            "mean": round(1000 * float(np.mean(t_mask)), 2), "p95": round(1000 * pct(t_mask, 95), 2)},
        "per_frame_ms_effect_window": {
            "opt1_mean": round(1000 * float(np.mean(t1_times)), 2) if t1_times else None,
            "opt1_p95": round(1000 * pct(t1_times, 95), 2) if t1_times else None,
            "opt2_mean": round(1000 * float(np.mean(t2_times)), 2) if t2_times else None,
            "opt2_p95": round(1000 * pct(t2_times, 95), 2) if t2_times else None,
            "frames": len(t1_times)},
        "hardware": {"cpu": cpu_name(), "cpu_count": os.cpu_count(), "gpu": "none available in sandbox, not measured"},
    }
    with open(os.path.join(args.out_dir, "stats.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    print(json.dumps(stats, indent=2))
    print("wrote", out_mp4)


if __name__ == "__main__":
    main()
