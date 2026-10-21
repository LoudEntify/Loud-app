#!/usr/bin/env python3
"""Offline dolly-zoom experiment, v3: the crisp-edge pass. Not app code.

Renders ORIGINAL | OLD | NEW side by side, where OLD is the 15 Oct method
(V3: RVM matte at 512 px, Gaussian-softened alpha, linear background scale,
quarter-resolution clean plate) and NEW is the same effect with:

  1. the matte at a higher working resolution (RVM downsample ratio 0.4 on
     1080p instead of 512 px), refined with a guided filter against the
     picture itself (edge-aware: the edge follows hair and shoulders, not a
     blur band), tightened so no background colour bleeds into the subject,
     and smoothed in time only where the matte is NOT moving (a moving hand
     keeps the fresh matte; the old plain EMA ghosted it);
  2. the background scaled with cubic interpolation and a light unsharp
     mask when it is enlarged (grow), area interpolation when shrunk;
  3. a full-resolution clean plate (median of subject-free pixels), built
     strip by strip so it fits in memory.

Measurements, at the effect peak and over the effect window:
  edge_flicker   mean |d alpha| per frame on edge pixels (lower is steadier)
  bg_sharpness   variance of the Laplacian over background pixels, as a ratio
                 to the same measure on the ORIGINAL frame (1.0 = as sharp as
                 the source; the unsharp mask can push it above 1)
  halo           mean colour distance, in a 3..12 px ring just outside the
                 matte, between the output and what should be there (the
                 scaled background alone); subject colour smeared into the
                 ring raises it (lower is better)

Background law as before: scale(d) = ((ds - m) d) / (ds (d - m)).
"""
import argparse
import json
import os
import subprocess
import time

import cv2
import numpy as np
import onnxruntime as ort

EFFECT_SECONDS = 1.5
RVM_STATE_CH = (16, 20, 40, 64)


# ── geometry (unchanged) ─────────────────────────────────────────
def bg_scale(m, ds, d):
    return ((ds - m) * d) / (ds * (d - m))


def smoothstep(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3.0 - 2.0 * u)


def solve_m(target, ds, d):
    lo, hi = 0.0, ds * (1 - 1e-6)
    for _ in range(200):
        mid = (lo + hi) / 2
        if bg_scale(mid, ds, d) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def scales(variant, ds, d, m, Z):
    s = bg_scale(m, ds, d)
    if variant == "grow":
        return 1.0, 1.0 / s
    return Z, Z * s


def scale_about_center(img, s, interp=cv2.INTER_LINEAR):
    if s == 1.0:
        return img
    h, w = img.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    M = np.array([[s, 0, cx * (1 - s)], [0, s, cy * (1 - s)]], np.float32)
    return cv2.warpAffine(img, M, (w, h), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


# ── matting ──────────────────────────────────────────────────────

def guided_filter(guide_bgr, p, radius=6, eps=1e-3, sub=4):
    """Fast guided filter (He, Sun, Tang) with a grey guide: box filters on a
    sub-sampled grid, the linear coefficients upsampled. p in [0, 1]."""
    I = cv2.cvtColor(guide_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) * (1.0 / 255.0)
    h, w = I.shape
    hs, ws = max(1, h // sub), max(1, w // sub)
    r = max(1, radius // sub)
    Is = cv2.resize(I, (ws, hs), interpolation=cv2.INTER_AREA); ps = cv2.resize(p, (ws, hs), interpolation=cv2.INTER_AREA)
    k = (2 * r + 1, 2 * r + 1)
    mI = cv2.boxFilter(Is, -1, k); mp_ = cv2.boxFilter(ps, -1, k)
    cII = cv2.boxFilter(Is * Is, -1, k); cIp = cv2.boxFilter(Is * ps, -1, k)
    vI = cII - mI * mI; cov = cIp - mI * mp_
    a = cov / (vI + eps); b = mp_ - a * mI
    ma = cv2.resize(cv2.boxFilter(a, -1, k), (w, h), interpolation=cv2.INTER_LINEAR)
    mb = cv2.resize(cv2.boxFilter(b, -1, k), (w, h), interpolation=cv2.INTER_LINEAR)
    return (ma * I + mb).astype(np.float32)

class RvmMatte:
    def __init__(self, path, ratio):
        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.state = None
        self.ratio = np.array([ratio], np.float32)

    def __call__(self, frame_bgr):
        x = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) * (1.0 / 255.0)
        x = np.transpose(x, (2, 0, 1))[None]
        if self.state is None:
            self.state = [np.zeros((1, c, 1, 1), np.float32) for c in RVM_STATE_CH]
        feed = {"src": x, "r1i": self.state[0], "r2i": self.state[1], "r3i": self.state[2], "r4i": self.state[3], "downsample_ratio": self.ratio}
        outs = self.sess.run(None, feed)
        self.state = list(outs[2:6])
        return outs[1][0, 0].astype(np.float32)


def old_alpha_series(raw, ema=0.6):
    """OLD: Gaussian-softened, plain EMA (the 15 Oct V3)."""
    out = np.empty_like(raw)
    prev = None
    for i in range(len(raw)):
        a = cv2.GaussianBlur(np.clip(raw[i], 0, 1), (0, 0), 1.5)
        if prev is not None:
            a = ema * prev + (1 - ema) * a
        out[i] = a
        prev = a
    return out


def new_alpha_series(raw, frames, radius=6, eps=1e-3, erode_px=1, ema=0.5, motion_gate=0.25):
    """NEW: guided-filter refinement against the frame, tightened, motion-gated EMA."""
    out = np.empty_like(raw)
    prev = None
    k = np.ones((2 * erode_px + 1, 2 * erode_px + 1), np.uint8)
    for i in range(len(raw)):
        a = np.clip(raw[i], 0, 1)
        guide = frames[i]  # uint8 BGR
        a = guided_filter(guide, a, radius=radius, eps=eps)
        a = np.clip((a - 0.08) / (0.92 - 0.08), 0, 1)       # tighten the soft tails
        if erode_px > 0:
            a = cv2.erode(a, k)                                # a pixel off the subject side: no bleed
        a = cv2.GaussianBlur(a, (0, 0), 0.6)                   # just enough to kill aliasing
        if prev is not None:
            moving = np.abs(a - prev) > motion_gate
            sm = ema * prev + (1 - ema) * a
            a = np.where(moving, a, sm).astype(np.float32)
        out[i] = a
        prev = a
    return out


# ── clean plate ──────────────────────────────────────────────────
def pull_push_fill(img, valid):
    """Fill invalid pixels from the surrounding valid ones, smoothly, at every
    scale (a pyramid of averages): for a wall or a ceiling this is the right
    fill, since the never-seen area behind a performer is usually plain."""
    img = img.astype(np.float32); v = valid.astype(np.float32)
    pyr_i = [img * v[..., None]]; pyr_v = [v]
    while min(pyr_v[-1].shape[:2]) > 2:
        pyr_i.append(cv2.pyrDown(pyr_i[-1])); pyr_v.append(cv2.pyrDown(pyr_v[-1]))
    # coarsest: normalise
    acc = pyr_i[-1] / np.maximum(pyr_v[-1], 1e-6)[..., None]
    for k in range(len(pyr_i) - 2, -1, -1):
        up = cv2.resize(acc, (pyr_i[k].shape[1], pyr_i[k].shape[0]), interpolation=cv2.INTER_LINEAR)
        vk = np.clip(pyr_v[k], 0, 1)[..., None]
        acc = pyr_i[k] / np.maximum(pyr_v[k], 1e-6)[..., None] * vk + up * (1 - vk)
    return np.clip(acc, 0, 255)


def clean_plate_fullres(frames, alphas, h, w, stride=2, strip=120, thresh=0.02, margin_px=9):
    idx = list(range(0, len(frames), stride))
    med = np.zeros((h, w, 3), np.float32)
    have_all = np.zeros((h, w), np.int32)
    k = np.ones((2 * margin_px + 1,) * 2, np.uint8)
    oks = [cv2.dilate((alphas[i] > thresh).astype(np.uint8), k) == 0 for i in idx]   # subject plus a margin kept out
    for y0 in range(0, h, strip):
        y1 = min(h, y0 + strip)
        stack = np.empty((len(idx), y1 - y0, w, 3), np.float32)
        have = np.zeros((y1 - y0, w), np.int32)
        for j, i in enumerate(idx):
            ok = oks[j][y0:y1]
            have += ok
            stack[j] = np.where(ok[..., None], frames[i][y0:y1].astype(np.float32), np.nan)
        with np.errstate(all="ignore"):
            m = np.nanmedian(stack, axis=0)
        med[y0:y1] = np.nan_to_num(m, nan=0.0)
        have_all[y0:y1] = have
        del stack
    valid = have_all > 0
    hole_frac = float((~valid).mean())
    if (~valid).any():
        med = pull_push_fill(med, valid)
    return med.astype(np.float32), hole_frac


def clean_plate_quarter(frames, alphas, h, w):
    """OLD: quarter resolution, all frames (the 15 Oct method)."""
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


# ── rendering ────────────────────────────────────────────────────
def bg_source(frame_f, plate, alpha, dilate=15, soft=0.0):
    A = cv2.dilate(alpha, np.ones((dilate, dilate), np.uint8))
    if soft > 0:
        A = cv2.GaussianBlur(np.clip(A, 0, 1), (0, 0), soft)
    A = A[..., None]
    return frame_f * (1 - A) + plate * A


def unsharp(img, sigma=1.0, amount=0.5):
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    return np.clip(img + amount * (img - blur), 0, 255)


def render(frame_f, alpha, plate, variant, ds, d, m, Z, new):
    subj_s, bg_s = scales(variant, ds, d, m, Z)
    src = bg_source(frame_f, plate, alpha, dilate=9, soft=5.0) if new else bg_source(frame_f, plate, alpha)
    if new:
        interp = cv2.INTER_AREA if bg_s < 1.0 else cv2.INTER_CUBIC
        bg = scale_about_center(src, bg_s, interp)
        if bg_s > 1.0:
            bg = unsharp(bg, sigma=1.0, amount=0.35 * min(1.0, (bg_s - 1.0) / 0.25))
        fr = scale_about_center(frame_f, subj_s, cv2.INTER_CUBIC if subj_s != 1.0 else cv2.INTER_LINEAR)
        a = scale_about_center(alpha, subj_s, cv2.INTER_LINEAR)[..., None]
    else:
        bg = scale_about_center(src, bg_s)
        fr = scale_about_center(frame_f, subj_s)
        a = scale_about_center(alpha, subj_s)[..., None]
    return fr * a + bg * (1 - a), bg


# ── metrics ──────────────────────────────────────────────────────
def edge_flicker(alphas):
    vals = []
    for prev, cur in zip(alphas[:-1], alphas[1:]):
        edge = (cur > 0.05) & (cur < 0.95)
        if edge.any():
            vals.append(float(np.abs(cur - prev)[edge].mean()))
    return float(np.mean(vals)) if vals else 0.0


def lap_var(img_u8, mask):
    g = cv2.cvtColor(img_u8, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(g, cv2.CV_32F, ksize=3)
    return float(lap[mask].var()) if mask.any() else 0.0


def halo_score(out_u8, bg_u8, alpha, inner=3, outer=12):
    hard = (alpha > 0.5).astype(np.uint8)
    ring = cv2.dilate(hard, np.ones((2 * outer + 1,) * 2, np.uint8)) - cv2.dilate(hard, np.ones((2 * inner + 1,) * 2, np.uint8))
    ring = ring.astype(bool)
    if not ring.any():
        return 0.0
    d = np.abs(out_u8.astype(np.float32) - bg_u8.astype(np.float32)).sum(axis=2) / 3.0
    return float(d[ring].mean())


def label(img, text):
    out = img.copy()
    cv2.putText(out, text, (16, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 0, 0), 6, cv2.LINE_AA)
    cv2.putText(out, text, (16, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def edge_crop(alpha, img, size=360):
    """A crop centred on the subject's right-hand boundary at mid-height (the shoulder/arm edge)."""
    h, w = alpha.shape
    hard = alpha > 0.5
    ys = np.where(hard.any(axis=1))[0]
    if len(ys) == 0:
        return img[:size, :size]
    y = int(ys.min() + 0.55 * (ys.max() - ys.min()))
    xs = np.where(hard[y])[0]
    x = int(xs.max()) if len(xs) else w // 2
    x0 = int(np.clip(x - size // 2, 0, w - size)); y0 = int(np.clip(y - size // 2, 0, h - size))
    return img[y0:y0 + size, x0:x0 + size]


def pct(xs, q):
    return float(np.percentile(xs, q)) if xs else 0.0



def read_frames(path):
    cap = cv2.VideoCapture(path)
    while True:
        ok, f = cap.read()
        if not ok:
            break
        yield f
    cap.release()


def video_meta(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return fps, n, w, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--rvm-onnx", required=True)
    ap.add_argument("--variant", choices=["grow", "shrink"], default="grow")
    ap.add_argument("--trigger", type=float, required=True)
    ap.add_argument("--zoom-start", type=float, default=1.5)
    ap.add_argument("--ds", type=float, default=3.0)
    ap.add_argument("--d", type=float, default=8.0)
    ap.add_argument("--m-end", type=float, default=0.9)
    ap.add_argument("--ratio-old", type=float, default=None)
    ap.add_argument("--ratio-new", type=float, default=0.4)
    ap.add_argument("--plate-stride", type=int, default=4)
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True); os.makedirs(args.cache_dir, exist_ok=True)
    frames_dir = os.path.join(args.out_dir, "frames"); os.makedirs(frames_dir, exist_ok=True)

    fps, n, w, h = video_meta(args.input)
    ratio_old = args.ratio_old or min(1.0, 512.0 / max(h, w))
    a_old_path = os.path.join(args.cache_dir, f"alpha_old_{ratio_old:.3f}.u8")
    a_new_path = os.path.join(args.cache_dir, f"alpha_new_{args.ratio_new:.3f}.u8")
    meta_path = os.path.join(args.cache_dir, "pass1.json")

    # ── pass 1: mattes (streamed, 8-bit on disk), raw flicker, plate frames ──
    if os.path.exists(a_old_path) and os.path.exists(a_new_path) and os.path.exists(meta_path):
        meta = json.load(open(meta_path))
        alpha_old = np.memmap(a_old_path, np.uint8, "r", shape=(n, h, w)); alpha_new = np.memmap(a_new_path, np.uint8, "r", shape=(n, h, w))
    else:
        alpha_old = np.memmap(a_old_path, np.uint8, "w+", shape=(n, h, w)); alpha_new = np.memmap(a_new_path, np.uint8, "w+", shape=(n, h, w))
        rvm_old = RvmMatte(args.rvm_onnx, ratio_old); rvm_new = RvmMatte(args.rvm_onnx, args.ratio_new)
        t_old_m, t_new_m, t_new_r, t_old_r = [], [], [], []
        prev_old = prev_new = prev_raw_new = None
        flick_raw = []; flick_old = []; flick_new = []
        k = np.ones((3, 3), np.uint8)
        for i, f in enumerate(read_frames(args.input)):
            t0 = time.perf_counter(); ro = rvm_old(f); t_old_m.append(time.perf_counter() - t0)
            t0 = time.perf_counter(); rn = rvm_new(f); t_new_m.append(time.perf_counter() - t0)
            # OLD refinement
            t0 = time.perf_counter()
            ao = cv2.GaussianBlur(np.clip(ro, 0, 1), (0, 0), 1.5)
            if prev_old is not None:
                ao = 0.6 * prev_old + 0.4 * ao
            t_old_r.append(time.perf_counter() - t0)
            # NEW refinement
            t0 = time.perf_counter()
            an = np.clip(rn, 0, 1)
            an = guided_filter(f, an, radius=8, eps=2e-3)
            an = np.clip((an - 0.08) / (0.92 - 0.08), 0, 1)
            an = cv2.erode(an, k)
            an = cv2.GaussianBlur(an, (0, 0), 0.6)
            if prev_new is not None:
                moving = np.abs(an - prev_new) > 0.25
                an = np.where(moving, an, 0.5 * prev_new + 0.5 * an).astype(np.float32)
            t_new_r.append(time.perf_counter() - t0)
            # flicker, incrementally
            for prev, cur, acc in ((prev_raw_new, rn, flick_raw), (prev_old, ao, flick_old), (prev_new, an, flick_new)):
                if prev is not None:
                    edge = (cur > 0.05) & (cur < 0.95)
                    if edge.any():
                        acc.append(float(np.abs(cur - prev)[edge].mean()))
            prev_old, prev_new, prev_raw_new = ao, an, np.clip(rn, 0, 1)
            alpha_old[i] = (ao * 255 + 0.5).astype(np.uint8); alpha_new[i] = (an * 255 + 0.5).astype(np.uint8)
            if i % 50 == 0:
                print(f"pass1 {i}/{n}", flush=True)
        alpha_old.flush(); alpha_new.flush()
        meta = {
            "matte": {"old": {"ratio": ratio_old, "internal_px": [int(w * ratio_old), int(h * ratio_old)], "ms_mean": round(1000 * float(np.mean(t_old_m)), 1), "ms_p95": round(1000 * pct(t_old_m, 95), 1)},
                      "new": {"ratio": args.ratio_new, "internal_px": [int(w * args.ratio_new), int(h * args.ratio_new)], "ms_mean": round(1000 * float(np.mean(t_new_m)), 1), "ms_p95": round(1000 * pct(t_new_m, 95), 1)}},
            "matte_refine": {"old_gauss_ema_ms_per_frame": round(1000 * float(np.mean(t_old_r)), 2), "new_guided_ms_per_frame": round(1000 * float(np.mean(t_new_r)), 2)},
            "edge_flicker": {"old": round(float(np.mean(flick_old)), 4), "new": round(float(np.mean(flick_new)), 4), "raw_new": round(float(np.mean(flick_raw)), 4)},
        }
        json.dump(meta, open(meta_path, "w"), indent=2)
        alpha_old = np.memmap(a_old_path, np.uint8, "r", shape=(n, h, w)); alpha_new = np.memmap(a_new_path, np.uint8, "r", shape=(n, h, w))

    # ── clean plates from every k-th frame ──
    plate_old_p = os.path.join(args.cache_dir, "plate_old.png"); plate_new_p = os.path.join(args.cache_dir, "plate_new.png"); plate_meta_p = os.path.join(args.cache_dir, "plate.json")
    if os.path.exists(plate_old_p) and os.path.exists(plate_new_p):
        plate_old = cv2.imread(plate_old_p).astype(np.float32); plate_new = cv2.imread(plate_new_p).astype(np.float32); plate_meta = json.load(open(plate_meta_p))
    else:
        sub = []; idx = []
        for i, f in enumerate(read_frames(args.input)):
            if i % args.plate_stride == 0:
                sub.append(f); idx.append(i)
        t0 = time.perf_counter(); plate_old = clean_plate_quarter(sub, [alpha_old[i] for i in idx], h, w); tp_old = time.perf_counter() - t0
        t0 = time.perf_counter(); plate_new, hole_frac = clean_plate_fullres(sub, [alpha_new[i].astype(np.float32) / 255.0 for i in idx], h, w, stride=1); tp_new = time.perf_counter() - t0
        del sub
        cv2.imwrite(plate_old_p, plate_old.astype(np.uint8)); cv2.imwrite(plate_new_p, plate_new.astype(np.uint8))
        plate_meta = {"frames_used": len(idx), "old_quarter_res_s": round(tp_old, 1), "new_full_res_s": round(tp_new, 1), "new_hole_fraction": round(hole_frac, 4)}
        json.dump(plate_meta, open(plate_meta_p, "w"))
    cv2.imwrite(os.path.join(args.out_dir, "plate_old.png"), plate_old.astype(np.uint8)); cv2.imwrite(os.path.join(args.out_dir, "plate_new.png"), plate_new.astype(np.uint8))

    Z = args.zoom_start if args.variant == "shrink" else 1.0
    m_end = solve_m(1.0 / Z, args.ds, args.d) if args.variant == "shrink" else args.m_end

    # ── pass 2: render ──
    tmp = os.path.join(args.out_dir, "_silent.mp4")
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (3 * w, h))
    snap_times = [args.trigger + EFFECT_SECONDS * 0.5, args.trigger + EFFECT_SECONDS]
    timings = {"old": [], "new": []}
    metrics = {"old": {"bg_sharp_ratio": [], "halo": []}, "new": {"bg_sharp_ratio": [], "halo": []}}
    for i, frame in enumerate(read_frames(args.input)):
        t = i / fps
        if t < args.trigger:
            pre = scale_about_center(frame.astype(np.float32), Z, cv2.INTER_CUBIC).clip(0, 255).astype(np.uint8) if Z != 1.0 else frame
            orig = pre; outs = {"old": pre, "new": pre}
        else:
            ue = smoothstep((t - args.trigger) / EFFECT_SECONDS); m = ue * m_end
            frame_f = frame.astype(np.float32)
            orig = scale_about_center(frame_f, Z, cv2.INTER_CUBIC).clip(0, 255).astype(np.uint8) if Z != 1.0 else frame
            outs = {}
            a_o = alpha_old[i].astype(np.float32) / 255.0; a_n = alpha_new[i].astype(np.float32) / 255.0
            for name, alpha, plate, new in (("old", a_o, plate_old, False), ("new", a_n, plate_new, True)):
                t0 = time.perf_counter()
                res, bg = render(frame_f, alpha, plate, args.variant, args.ds, args.d, m, Z, new)
                timings[name].append(time.perf_counter() - t0)
                out_u8 = res.clip(0, 255).astype(np.uint8); outs[name] = out_u8
                if t <= args.trigger + EFFECT_SECONDS + 1e-6:
                    subj_s = scales(args.variant, args.ds, args.d, m, Z)[0]
                    a_out = scale_about_center(alpha, subj_s)
                    bgmask = cv2.dilate((a_out > 0.05).astype(np.uint8), np.ones((25, 25), np.uint8)) == 0
                    bgmask &= (np.abs(bg).sum(axis=2) > 0)
                    ref = lap_var(orig, bgmask)
                    metrics[name]["bg_sharp_ratio"].append(lap_var(out_u8, bgmask) / ref if ref > 0 else 0.0)
                    metrics[name]["halo"].append(halo_score(out_u8, bg.clip(0, 255).astype(np.uint8), a_out))
        panels = [label(orig, "ORIGINAL"), label(outs["old"], "OLD (15 Oct)"), label(outs["new"], "NEW")]
        writer.write(np.hstack(panels))
        for st in snap_times:
            if abs(t - st) < 0.5 / fps:
                for nm, p in zip(("original", "old", "new"), panels):
                    cv2.imwrite(os.path.join(frames_dir, f"{args.variant}_t{st:.2f}_{nm}.png"), p)
                subj_s = scales(args.variant, args.ds, args.d, smoothstep((t - args.trigger) / EFFECT_SECONDS) * m_end, Z)[0]
                a_n = alpha_new[i].astype(np.float32) / 255.0; a_o = alpha_old[i].astype(np.float32) / 255.0
                crops = [label(edge_crop(scale_about_center(a_n, subj_s), orig), "orig"), label(edge_crop(scale_about_center(a_o, subj_s), outs["old"]), "old"), label(edge_crop(scale_about_center(a_n, subj_s), outs["new"]), "new")]
                cv2.imwrite(os.path.join(args.out_dir, f"edge_{args.variant}_t{st:.2f}.png"), np.hstack(crops))
        if i % 50 == 0:
            print(f"pass2 {i}/{n}", flush=True)
    writer.release()
    out_mp4 = os.path.join(args.out_dir, f"side_by_side_{args.variant}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_mp4], check=True)
    os.remove(tmp)

    stats = {
        "input": os.path.basename(args.input), "resolution": [w, h], "fps": fps, "frames": n, "variant": args.variant,
        "params": {"ds": args.ds, "d": args.d, "m_end": round(m_end, 4), "zoom_start": Z, "trigger_s": args.trigger, "effect_s": EFFECT_SECONDS,
                   "bg_output_scale_at_end": round((1.0 / bg_scale(m_end, args.ds, args.d)) if args.variant == "grow" else Z * bg_scale(m_end, args.ds, args.d), 4)},
        **meta, "clean_plate": plate_meta,
        "effect_window": {k: {"render_ms_mean": round(1000 * float(np.mean(timings[k])), 1), "bg_sharpness_ratio_mean": round(float(np.mean(v["bg_sharp_ratio"])), 3),
                              "bg_sharpness_ratio_min": round(float(np.min(v["bg_sharp_ratio"])), 3), "halo_mean": round(float(np.mean(v["halo"])), 2), "halo_max": round(float(np.max(v["halo"])), 2)}
                          for k, v in metrics.items()},
        "hardware": {"cpu_count": os.cpu_count(), "gpu": "none in sandbox"},
    }
    json.dump(stats, open(os.path.join(args.out_dir, f"stats_{args.variant}.json"), "w"), indent=2)
    print(json.dumps(stats, indent=2)); print("wrote", out_mp4)


if __name__ == "__main__":
    main()
