// lib/rotationProcessor.js
// ─────────────────────────────────────────────────────────────
// Portrait output for every source, in one pass: crop landscape sources
// to a portrait frame, and (opt-in, by-eye) correct a source whose pixel
// content is sideways relative to what it claims -- confirmed on real
// hardware (a physically-rotated Sony A6300 through a capture card):
// getSettings() reports portrait dimensions, but the pixel content stays
// sideways. There's no reliable way to auto-detect THAT specific case:
// no rotation metadata survives a plain HDMI capture into a UVC device,
// and content-based heuristics (face detection etc.) are unreliable and
// risk wrongly rotating an already-correct frame, which is worse than
// doing nothing -- rotation stays deliberately opt-in and by-eye, the
// operator picks whichever of 0/90/180/270 looks upright on their own
// corrected preview. The portrait CROP, by contrast, is auto-attached
// (see useNativeIsLandscape, lib/useSourceDimensions.js) whenever a
// source's raw dimensions are landscape -- no by-eye judgment needed
// there, just "is it wider than it is tall".
//
// Rotation and crop are ONE processor, not two chained ones: LiveKit's
// LocalTrack.setProcessor holds exactly one active processor at a time
// (replaces, doesn't stack), and even if you manually piped one
// processor's output into a second, that's a whole extra decode/canvas/
// encode stage for no benefit. A single canvas pass does both: rotate
// the frame (or don't, at 0deg), then read only the source rectangle
// that -- once rotated -- exactly fills a fixed portrait target AR,
// instead of the full frame.
//
// A LiveKit TrackProcessor (LocalTrack.setProcessor -- @experimental in
// the SDK, but the shipped, documented mechanism for this:
// https://github.com/livekit/track-processors-js). Its processedTrack
// becomes what actually gets published, confirmed against the compiled
// SDK source (sender.replaceTrack(processor.processedTrack) only runs
// once processor.init() has already resolved) -- NOT a local-only CSS
// effect, so viewers, the shot-grammar, and room-composite egress all
// see the real cropped/rotated pixels, not just the local preview.
// ─────────────────────────────────────────────────────────────

export const ROTATION_OPTIONS_DEG = [0, 90, 180, 270];

// Portrait target aspect ratio the crop normalizes every landscape
// source to -- matches the portrait ideal requested at capture
// (HIGH_RES_VIDEO_CAPTURE in LiveDemo.jsx/CamPage.jsx) and what
// SHOT_TYPES' portrait crop-scale values (lib/shotTypes.js) were tuned
// against. A landscape source cropped to this is necessarily lower-
// resolution than a native-portrait phone capture (it's a crop, not an
// upscale) -- expected, not a bug; see this file's callers for why that
// tradeoff is accepted.
const TARGET_PORTRAIT_ASPECT = 9 / 16;

// Assumed true aspect ratio of a source whose raw dimensions failed
// useNativeIsLandscape's plausibility check (lib/useSourceDimensions.js)
// -- confirmed on real hardware (Sony via capture card): that class of
// driver doesn't just fail to deliver a clean crop, it anamorphically
// SQUEEZES the frame (resizes width and height independently to chase
// whatever it was asked for), so the buffer it delivers no longer has
// its sensor's real proportions at all. 16:9 is the safe default true
// shape for this class of hardware. Cropping that squeezed buffer as-is
// (the pre-existing behavior) crops the distortion right along with the
// frame -- it never undoes it, which is why faces still looked narrow
// even once the crop was correctly auto-attaching.
const ASSUMED_SQUEEZED_SOURCE_ASPECT = 16 / 9;

// Given a frame's rotated-space dimensions (rw x rh -- i.e. after the
// chosen rotation swaps axes or doesn't), returns the largest portrait-
// AR (TARGET_PORTRAIT_ASPECT) output size that fits inside it without
// upscaling. Whichever axis has excess relative to the target ratio gets
// trimmed; a rotation that already lands at (or narrower than) the
// target -- a clean 16:9 sensor rotated 90deg -- crops to ~nothing.
function fitPortraitTarget(rw, rh) {
  if (rw / rh > TARGET_PORTRAIT_ASPECT) {
    const outH = rh;
    return { outW: Math.round(rh * TARGET_PORTRAIT_ASPECT), outH };
  }
  const outW = rw;
  return { outW, outH: Math.round(rw / TARGET_PORTRAIT_ASPECT) };
}

// Un-squeeze math shared by init()'s initial-size estimate and drawFrame's
// per-frame draw: given the RAW buffer's width/height, treats height as
// trustworthy and works out the width the buffer would have if it
// genuinely held an ASSUMED_SQUEEZED_SOURCE_ASPECT frame at that height
// -- i.e. how much the raw buffer's X axis needs to be stretched back
// out. Returns stretchX = 1 (a no-op) when unsqueeze is off, so every
// caller downstream (fitPortraitTarget, the raw-space crop-rect mapping)
// runs unmodified for the non-squeezed path -- recognized ratios and
// portrait sources are never touched by this correction.
function computeUnsqueeze(vw, vh, unsqueeze) {
  const correctedW = unsqueeze ? vh * ASSUMED_SQUEEZED_SOURCE_ASPECT : vw;
  const correctedH = vh;
  return { correctedW, correctedH, stretchX: correctedW / vw };
}

export function createPortraitProcessor(degrees = 0, { unsqueeze = false } = {}) {
  let videoEl = null;
  let canvas = null;
  let ctx = null;
  let rvfcHandle = null;
  let rafId = null;
  let stopped = false;

  const swapped = degrees === 90 || degrees === 270;
  const radians = (degrees * Math.PI) / 180;

  function scheduleNext() {
    if (stopped) return;
    if (videoEl?.requestVideoFrameCallback) {
      rvfcHandle = videoEl.requestVideoFrameCallback(drawFrame);
    } else {
      rafId = requestAnimationFrame(drawFrame);
    }
  }

  function drawFrame() {
    if (stopped || !videoEl || !ctx || !canvas) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (vw && vh) {
      try {
        // Un-stretch first (source-rect-only, dest size is untouched --
        // see computeUnsqueeze's own comment). No-op (stretchX === 1)
        // unless this processor was told to assume a squeezed source.
        const { correctedW, correctedH, stretchX } = computeUnsqueeze(vw, vh, unsqueeze);

        // Rotated-space dimensions -- what the (corrected) frame's own
        // width/height become after the chosen rotation, before any crop.
        const rw = swapped ? correctedH : correctedW;
        const rh = swapped ? correctedW : correctedH;
        const { outW, outH } = fitPortraitTarget(rw, rh);

        // Crop rectangle in rotated CORRECTED space -- same math as
        // before the un-squeeze existed, just computed against
        // correctedW/correctedH instead of vw/vh directly.
        const cw = swapped ? outH : outW;
        const ch = swapped ? outW : outH;
        const cx = (correctedW - cw) / 2;
        const cy = (correctedH - ch) / 2;

        // Map back to the RAW (still-squeezed) buffer -- only the X axis
        // and width were ever touched by stretchX; Y/height are 1:1 with
        // the raw buffer throughout (the squeeze this corrects for is
        // horizontal -- see ASSUMED_SQUEEZED_SOURCE_ASPECT's comment).
        // The dest rect stays (cw, ch) -- unchanged from the pre-unsqueeze
        // sw/sh -- so this one drawImage call both crops AND stretches
        // the narrower raw strip back out to correct proportions.
        const sx = cx / stretchX;
        const sy = cy;
        const sw = cw / stretchX;
        const sh = ch;

        // The source's native resolution can change live (a facingMode/
        // device restart producing a different size or aspect) --
        // recomputed every frame above from videoEl's own current
        // dimensions, so the canvas needs to be able to follow that too,
        // not stay pinned to whatever size init() first saw.
        if (canvas.width !== outW || canvas.height !== outH) {
          canvas.width = outW;
          canvas.height = outH;
        }

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(videoEl, sx, sy, sw, sh, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
      } catch (e) {
        // A single bad frame must never kill the loop -- this runs
        // inside a self-scheduling callback nothing else wraps in
        // try/catch, so skip and keep going rather than let it throw
        // silently into the void and stop scheduling.
        console.warn('[portraitProcessor] draw failed, skipping frame', e);
      }
    }
    scheduleNext();
  }

  return {
    name: `portrait-${degrees}`,
    processedTrack: undefined,

    async init({ track }) {
      videoEl = document.createElement('video');
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = new MediaStream([track]);
      await videoEl.play();

      const settings = track.getSettings();
      const vw = videoEl.videoWidth || settings.width || 1280;
      const vh = videoEl.videoHeight || settings.height || 720;
      const { correctedW, correctedH } = computeUnsqueeze(vw, vh, unsqueeze);
      const rw = swapped ? correctedH : correctedW;
      const rh = swapped ? correctedW : correctedH;
      const { outW, outH } = fitPortraitTarget(rw, rh);

      canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      ctx = canvas.getContext('2d');

      const outStream = canvas.captureStream(30);
      this.processedTrack = outStream.getVideoTracks()[0];

      stopped = false;
      scheduleNext();
    },

    // The underlying raw track was swapped (e.g. device reacquired) --
    // rebind the hidden video element to it, keep the same canvas/
    // output track and rotation+crop running.
    async restart({ track }) {
      if (!videoEl) return;
      videoEl.srcObject = new MediaStream([track]);
      await videoEl.play();
    },

    async destroy() {
      stopped = true;
      if (rvfcHandle != null && videoEl?.cancelVideoFrameCallback) {
        videoEl.cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafId) cancelAnimationFrame(rafId);
      this.processedTrack?.stop();
      videoEl?.pause();
      videoEl = null;
      canvas = null;
      ctx = null;
    },
  };
}
