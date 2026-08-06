// lib/rotationProcessor.js
// ─────────────────────────────────────────────────────────────
// Manual rotation correction for landscape/capture-card sources whose
// delivered frame claims a shape that doesn't match its actual content
// orientation -- confirmed on real hardware (a physically-rotated Sony
// A6300 through a capture card): getSettings() reports portrait
// dimensions, but the pixel content stays sideways. There's no reliable
// way to auto-detect this: no rotation metadata survives a plain HDMI
// capture into a UVC device, and content-based heuristics (face
// detection etc.) are unreliable and risk wrongly rotating an
// already-correct frame, which is worse than doing nothing. This is
// deliberately opt-in and by-eye -- the operator picks whichever of
// 0/90/180/270 looks upright on their own corrected preview.
//
// A LiveKit TrackProcessor (LocalTrack.setProcessor -- @experimental in
// the SDK, but the shipped, documented mechanism for this:
// https://github.com/livekit/track-processors-js). Its processedTrack
// becomes what actually gets published, confirmed against the compiled
// SDK source (sender.replaceTrack(processor.processedTrack) only runs
// once processor.init() has already resolved) -- NOT a local-only CSS
// effect. Draws the raw source onto a canvas with the chosen rotation
// and republishes canvas.captureStream()'s track.
// ─────────────────────────────────────────────────────────────

export const ROTATION_OPTIONS_DEG = [0, 90, 180, 270];

export function createRotationProcessor(degrees) {
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
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(videoEl, -vw / 2, -vh / 2, vw, vh);
        ctx.restore();
      } catch (e) {
        // A single bad frame must never kill the loop -- this runs
        // inside a self-scheduling callback nothing else wraps in
        // try/catch, so skip and keep going rather than let it throw
        // silently into the void and stop scheduling.
        console.warn('[rotationProcessor] draw failed, skipping frame', e);
      }
    }
    scheduleNext();
  }

  return {
    name: `rotation-${degrees}`,
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

      canvas = document.createElement('canvas');
      canvas.width = swapped ? vh : vw;
      canvas.height = swapped ? vw : vh;
      ctx = canvas.getContext('2d');

      const outStream = canvas.captureStream(30);
      this.processedTrack = outStream.getVideoTracks()[0];

      stopped = false;
      scheduleNext();
    },

    // The underlying raw track was swapped (e.g. device reacquired) --
    // rebind the hidden video element to it, keep the same canvas/
    // output track and rotation running.
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
