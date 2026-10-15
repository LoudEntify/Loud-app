#!/usr/bin/env python3
"""Offline dolly-zoom experiment. Not app code.

Three versions are rendered side by side with the original:
  V1  Option 1: performer/background split, MediaPipe Selfie Segmentation mask.
  V2  Option 2: layered parallax, MediaPipe mask, STAND-IN depth bands
      (Depth Anything weights are not reachable from the sandbox).
  V3  Option 1 with a Robust Video Matting mask (ONNX), temporally smoothed.

Two variants of the effect:
  grow    (default) Dolly out / zoom in. The background grows behind a
          constant-size performer. Never needs picture beyond the frame.
  shrink  Starts zoomed in at --zoom-start (e.g. 1.5x). The device zooms out
          during the effect; the background shrinks, revealing real picture
          from the full clip, while the performer stays the same size.

Background law:  scale(d) = ((ds - m) * d) / (ds * (d - m)), scale(d) == 1 at m == 0.
  grow:   background output scale = 1 / scale(d)       (subject scale 1)
  shrink: background output scale = Z * scale(d)       (subject scale Z)
No blurred fill and no digital crop in either variant.
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
import onnxruntime as ort

EFFECT_SECONDS = 1.5
RVM_STATE_CH = (16, 20, 40, 64)


def bg_scale(m, ds, d):
    return ((ds - m) * d) / (ds * (d - m))


def smoothstep(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3.0 - 2.0 * u)


def solve_m(target, ds, d):
    """m such that bg_scale(m, ds, d) == target (bg_scale is decreasing in m)."""
    lo, hi = 0.0, ds * (1 - 1e-6)
    for _ in range(200):
        mid = (lo + hi) / 2
        if bg_scale(mid, ds, d) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def scales(variant, ds, d, m, Z):
    """(subject_scale, background_scale) for a layer at distance d."""
    s = bg_scale(m, ds, d)
    if variant == "grow":
        return 1.0, 1.0 / s
    return Z, Z * s


def scale_about_center(img, s):
    if s == 1.0:
        return img
    h, w = img.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    M = np.array([[s, 0, cx * (1 - s)], [0, s, cy * (1 - s)]], np.float32)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def soft_alpha(mask):
    a = np.clip((mask - 0.3) / 0.4, 0.0, 1.0)
    return cv2.GaussianBlur(a, (0, 0), 1.5)


class MediaPipeMatte:
    def __init__(self):
        self.seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)

    def __call__(self, frame_bgr):
        res = self.seg.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        return soft_alpha(np.clip(res.segmentation_mask.astype(np.float32), 0, 1))

    def close(self):
        self.seg.close()


class RvmMatte:
    """Robust Video Matting, MobileNetV3 ONNX. Recurrent state carries across frames."""

    def __init__(self, path):
        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.state = None

    def __call__(self, frame_bgr):
        h, w = frame_bgr.shape[:2]
        ratio = np.array([min(1.0, 512.0 / max(h, w))], np.float32)
        x = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) * (1.0 / 255.0)
        x = np.transpose(x, (2, 0, 1))[None]
        if self.state is None:
            self.state = [np.zeros((1, c, 1, 1), np.float32) for c in RVM_STATE_CH]
        feed = {"src": x, "r1i": self.state[0], "r2i": self.state[1],
                "r3i": self.state[2], "r4i": self.state[3], "downsample_ratio": ratio}
        outs = self.sess.run(None, feed)
        self.state = list(outs[2:6])
        return outs[1][0, 0]


def clean_plate(frames, alphas, h, w):
    """Temporal median of subject-free pixels at quarter resolution; holes inpainted."""
    qh, qw = h // 4, w // 4
    n = len(frames)
    stack = np.empty((n, qh, qw, 3), np.float32)
    ok_all = np.empty((n, qh, qw), bool)
    for i in range(n):
        small = cv2.resize(frames[i], (qw, qh), interpolation=cv2.INTER_AREA).astype(np.float32)
        am = cv2.resize(alphas[i], (qw, qh), interpolation=cv2.INTER_AREA)
        ok = am < 0.2
        ok_all[i] = ok
        stack[i] = np.where(ok[..., None], small, np.nan)
    with np.errstate(all="ignore"):
        med = np.nanmedian(stack, axis=0)
    del stack
    have = ok_all.sum(axis=0) > 0
    med = np.nan_to_num(med, nan=0.0).astype(np.uint8)
    hole = ((~have).astype(np.uint8)) * 255
    if hole.any():
        med = cv2.inpaint(med, hole, 5, cv2.INPAINT_TELEA)
    return cv2.resize(med, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)


def depth_proxy_bands(h, w, layers):
    """STAND-IN for a depth model: horizontal background bands, top = farthest."""
    k = max(layers - 1, 1)
    ys = np.arange(h, dtype=np.float32) / max(h - 1, 1)
    bands, factors = [], []
    for i in range(k):
        lo, hi = i / k, (i + 1) / k
        row = ((ys >= lo) & (ys < hi)).astype(np.float32)
        bands.append(np.repeat(row[:, None], w, axis=1))
        factors.append(1.0 - (lo + hi) / 2)
    sig = max(h / 40.0, 2.0)
    bands = [cv2.GaussianBlur(b, (0, 0), sig) for b in bands]
    total = np.sum(bands, axis=0) + 1e-6
    return [b / total for b in bands], factors


def bg_source(frame_f, plate, alpha):
    A = cv2.dilate(alpha, np.ones((15, 15), np.uint8))[..., None]
    return frame_f * (1 - A) + plate * A


def composite_subject(frame_f, alpha, bg, subj_s):
    fr = scale_about_center(frame_f, subj_s)
    a = scale_about_center(alpha, subj_s)[..., None]
    return fr * a + bg * (1 - a)


def render_split(frame_f, alpha, plate, variant, ds, d, m, Z):
    subj_s, bg_s = scales(variant, ds, d, m, Z)
    src = bg_source(frame_f, plate, alpha)
    return composite_subject(frame_f, alpha, scale_about_center(src, bg_s), subj_s)


def render_layered(frame_f, alpha, plate, bands, factors, variant, ds, d, m, Z):
    subj_s, _ = scales(variant, ds, d, m, Z)
    src = bg_source(frame_f, plate, alpha)
    canvas = src
    bgw = (1.0 - alpha)
    layers = sorted(((ds + (d - ds) * f, b) for b, f in zip(bands, factors)), key=lambda x: -x[0])
    for d_k, b in layers:
        _, s_bg = scales(variant, ds, d_k, m, Z)
        lay = scale_about_center(src, s_bg)
        a = scale_about_center((b * bgw).astype(np.float32), s_bg)[..., None]
        canvas = lay * a + canvas * (1 - a)
    return composite_subject(frame_f, alpha, canvas, subj_s)


def label(img, text):
    out = img.copy()
    cv2.rectangle(out, (0, 0), (min(out.shape[1], 24 + 26 * len(text)), 56), (0, 0, 0), -1)
    cv2.putText(out, text, (14, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def edge_flicker(alphas):
    """Mean |d alpha| per frame on edge pixels (0.05 < alpha < 0.95). Lower is steadier."""
    vals = []
    for prev, cur in zip(alphas[:-1], alphas[1:]):
        edge = (cur > 0.05) & (cur < 0.95)
        if edge.any():
            vals.append(float(np.abs(cur[edge] - prev[edge]).mean()))
    return float(np.mean(vals)) if vals else None


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
    return float(np.percentile(xs, q)) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="upright working clip")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cache-dir", required=True, help="stores mask caches so variants reuse them")
    ap.add_argument("--rvm-onnx", required=True)
    ap.add_argument("--variant", choices=["grow", "shrink"], default="grow")
    ap.add_argument("--trigger", type=float, required=True, help="effect start, seconds")
    ap.add_argument("--zoom-start", type=float, default=1.5, help="shrink only: device zoom at start")
    ap.add_argument("--ds", type=float, default=3.0)
    ap.add_argument("--d", type=float, default=8.0)
    ap.add_argument("--m-end", type=float, default=0.9, help="grow only; shrink solves m_end from zoom-start")
    ap.add_argument("--layers", type=int, default=6)
    ap.add_argument("--ema", type=float, default=0.6, help="V3 temporal smoothing weight on previous alpha")
    args = ap.parse_args()
    assert 4 <= args.layers <= 8

    os.makedirs(args.out_dir, exist_ok=True)
    os.makedirs(args.cache_dir, exist_ok=True)
    frames_dir = os.path.join(args.out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(args.input)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    n = len(frames)
    h, w = frames[0].shape[:2]

    mp_path = os.path.join(args.cache_dir, "mp_alpha.npy")
    rvm_path = os.path.join(args.cache_dir, "rvm_alpha_raw.npy")
    mask_stats_path = os.path.join(args.cache_dir, "mask_stats.json")
    if os.path.exists(mp_path) and os.path.exists(rvm_path):
        mp_alpha = np.load(mp_path)
        rvm_raw = np.load(rvm_path)
        mask_stats = json.load(open(mask_stats_path))
    else:
        seg = MediaPipeMatte()
        t_mp = []
        mp_alpha = np.empty((n, h, w), np.float32)
        for i, f in enumerate(frames):
            t0 = time.perf_counter()
            mp_alpha[i] = seg(f)
            t_mp.append(time.perf_counter() - t0)
        seg.close()
        rvm = RvmMatte(args.rvm_onnx)
        t_rvm = []
        rvm_raw = np.empty((n, h, w), np.float32)
        for i, f in enumerate(frames):
            t0 = time.perf_counter()
            rvm_raw[i] = rvm(f)
            t_rvm.append(time.perf_counter() - t0)
        mask_stats = {
            "mediapipe_ms_per_frame": {"mean": round(1000 * float(np.mean(t_mp)), 2), "p95": round(1000 * pct(t_mp, 95), 2)},
            "rvm_ms_per_frame": {"mean": round(1000 * float(np.mean(t_rvm)), 2), "p95": round(1000 * pct(t_rvm, 95), 2)},
        }
        np.save(mp_path, mp_alpha)
        np.save(rvm_path, rvm_raw)
        json.dump(mask_stats, open(mask_stats_path, "w"), indent=2)

    # V3 temporal smoothing: exponential moving average over the RVM alpha
    rvm_smooth = np.empty_like(rvm_raw)
    rvm_smooth[0] = rvm_raw[0]
    for i in range(1, n):
        rvm_smooth[i] = args.ema * rvm_smooth[i - 1] + (1 - args.ema) * rvm_raw[i]

    # clean plate: subject-free pixels in either matte
    union = [np.maximum(mp_alpha[i], rvm_raw[i]) for i in range(n)]
    t0 = time.perf_counter()
    plate = clean_plate(frames, [(u * 255).astype(np.uint8) for u in union], h, w)
    t_plate = time.perf_counter() - t0
    del union

    bands, factors = depth_proxy_bands(h, w, args.layers)

    Z = args.zoom_start if args.variant == "shrink" else 1.0
    m_end = solve_m(1.0 / Z, args.ds, args.d) if args.variant == "shrink" else args.m_end

    versions = {
        "v1_mediapipe_split": {"alpha": lambda i: mp_alpha[i], "fn": "split"},
        "v2_layered_stand_in_depth": {"alpha": lambda i: mp_alpha[i], "fn": "layered"},
        "v3_rvm_smoothed_split": {"alpha": lambda i: rvm_smooth[i], "fn": "split"},
    }
    timings = {k: [] for k in versions}
    flick_src = {"v1_mediapipe_split": mp_alpha, "v2_layered_stand_in_depth": mp_alpha,
                 "v3_rvm_smoothed_split": rvm_smooth}
    flick = {k: edge_flicker([flick_src[k][i] for i in range(n)]) for k in versions}
    flick["v3_rvm_raw_unsmoothed"] = edge_flicker([rvm_raw[i] for i in range(n)])

    panel_names = ["ORIGINAL", "V1 MEDIAPIPE", "V2 LAYERED", "V3 RVM SMOOTHED"]
    tmp = os.path.join(args.out_dir, "_silent.mp4")
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (4 * w, h))
    snap_times = [args.trigger + EFFECT_SECONDS * 0.5, args.trigger + EFFECT_SECONDS, 9.0]
    snaps = {}
    for i, frame in enumerate(frames):
        t = i / fps
        if t < args.trigger:
            pre = scale_about_center(frame.astype(np.float32), Z).clip(0, 255).astype(np.uint8)
            outs = {k: pre for k in versions}
            orig = pre
        else:
            ue = smoothstep((t - args.trigger) / EFFECT_SECONDS)
            m = ue * m_end
            orig = scale_about_center(frame.astype(np.float32), Z).clip(0, 255).astype(np.uint8) if Z != 1.0 else frame
            frame_f = frame.astype(np.float32)
            outs = {}
            for k, spec in versions.items():
                a = spec["alpha"](i).astype(np.float32)
                t0 = time.perf_counter()
                if spec["fn"] == "split":
                    res = render_split(frame_f, a, plate, args.variant, args.ds, args.d, m, Z)
                else:
                    res = render_layered(frame_f, a, plate, bands, factors, args.variant, args.ds, args.d, m, Z)
                timings[k].append(time.perf_counter() - t0)
                outs[k] = res.clip(0, 255).astype(np.uint8)
        panels = [label(orig, panel_names[0])] + [label(outs[k], panel_names[j + 1]) for j, k in enumerate(versions)]
        writer.write(np.hstack(panels))
        for st in snap_times:
            if abs(t - st) < 0.5 / fps:
                snaps[f"{st:.2f}"] = panels
    writer.release()

    for key, panels in snaps.items():
        names = ["original", "v1_mediapipe_split", "v2_layered", "v3_rvm_smoothed"]
        for nm, p in zip(names, panels):
            cv2.imwrite(os.path.join(frames_dir, f"{args.variant}_t{key}_{nm}.png"), p)

    out_mp4 = os.path.join(args.out_dir, f"side_by_side_{args.variant}.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-i", args.input,
        "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        "-movflags", "+faststart", out_mp4,
    ], check=True)
    os.remove(tmp)

    per_version = {}
    for k in versions:
        ts = timings[k]
        per_version[k] = {"ms_mean": round(1000 * float(np.mean(ts)), 2),
                          "ms_p95": round(1000 * pct(ts, 95), 2),
                          "edge_flicker_mean_abs_alpha_delta": flick[k]}
    per_version["v3_rvm_raw_unsmoothed"] = {"edge_flicker_mean_abs_alpha_delta": flick["v3_rvm_raw_unsmoothed"]}

    stats = {
        "input": os.path.basename(args.input),
        "resolution": [w, h], "fps": fps, "frames": n,
        "variant": args.variant,
        "params": {"ds": args.ds, "d": args.d, "m_end": round(m_end, 4), "zoom_start": Z,
                   "bg_output_scale_at_end": {"grow_background": round(1.0 / bg_scale(m_end, args.ds, args.d), 4) if args.variant == "grow" else None,
                                              "shrink_background": round(Z * bg_scale(m_end, args.ds, args.d), 4) if args.variant == "shrink" else None},
                   "trigger_s": args.trigger, "effect_s": EFFECT_SECONDS, "layers": args.layers, "ema": args.ema},
        "one_off_seconds": {"clean_plate": round(t_plate, 2)},
        "mask_ms_per_frame_all_frames": mask_stats,
        "versions_effect_window_ms_per_frame": per_version,
        "hardware": {"cpu": cpu_name(), "cpu_count": os.cpu_count(), "gpu": "none available in sandbox, not measured"},
    }
    with open(os.path.join(args.out_dir, f"stats_{args.variant}.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    print(json.dumps(stats, indent=2))
    print("wrote", out_mp4)


if __name__ == "__main__":
    main()
