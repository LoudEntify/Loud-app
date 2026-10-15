#!/usr/bin/env python3
"""Make a 15 s test clip from a public-domain photo (scikit-image 'astronaut').
Pipeline smoke test only. It is a still photo with gentle sway, NOT performance footage."""
import sys
import cv2
import numpy as np
from skimage import data

out = sys.argv[1]
W, H, FPS, SECS = 720, 960, 30, 15
img = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
img = cv2.resize(img, (900, 900), interpolation=cv2.INTER_CUBIC)
writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
for i in range(FPS * SECS):
    t = i / FPS
    dx = 14 * np.sin(2 * np.pi * t / 4.0)
    dy = 6 * np.sin(2 * np.pi * t / 3.0)
    scale = 0.78
    M = np.array([[scale, 0, (W - 900 * scale) / 2 + dx], [0, scale, (H - 900 * scale) / 2 + 40 + dy]], np.float32)
    canvas = np.full((H, W, 3), (40, 30, 25), np.uint8)
    cv2.warpAffine(img, M, (W, H), dst=canvas, borderMode=cv2.BORDER_TRANSPARENT)
    writer.write(canvas)
writer.release()
print("wrote", out)
