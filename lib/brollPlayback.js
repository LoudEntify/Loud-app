'use client';

// lib/brollPlayback.js
// ─────────────────────────────────────────────────────────────
// Plays an uploaded clip INTO the broadcast as a real LiveKit track.
//
// The whole path, in order:
//   1. ask the server for a signed URL for a clip the artist owns
//   2. play the file in a hidden, MUTED <video> element
//   3. captureStream() that element and take its video track
//   4. publish it, named `broll`, as a ScreenShare source
//   5. when it ends, tell the caller — the caller cuts away FIRST, and
//      only then does stop() unpublish
//
// ── ⚠️ ROUND 3: THE PUBLICATION IS NOW PERMANENT ──────────────
// Steps 1-3 are unchanged. STEP 4 IS NOT: nothing is published when a
// clip starts any more, because publishing a second 1080x1920 video
// track into a live show is what knocked the congestion controller over.
//
// Measured, from the artist's own capture (freeze-run-2.csv, five
// episodes): broll_published -> availableOutgoingBitrate collapses
// 6.9Mbps -> 1.0Mbps in ~4s -> qualityLimitationReason flips to
// 'bandwidth' -> uplinkBps hits 0 for ~4s, fps 30 -> 26 -> 20 -> none ->
// 3 -> simulcast drops the top layer -> recovers ~11s later. Not the
// connection: steady state used 3.0 of 6.9Mbps and framesNotSent was
// zero across all 309 samples.
//
// So the publication is now established ONCE, at session start, from a
// black canvas, and immediately muted. Playing a clip is replaceTrack()
// plus unmute() on a sender the SFU has known about since before the
// show — no new transceiver, no renegotiation, nothing for the
// congestion controller to re-probe from zero.
//
// ── WHY NOT SUBSTITUTE ON THE CAMERA PUBLICATION ──────────────
// It was the obvious approach and it is the wrong one. The clip's pixels
// would flow through a publication named and sourced as the camera, so
// every parser in lib/trackSources.js would classify a clip as the
// performer's face — the exact failure that file was written to kill,
// and one that would be baked into recordings and into the training
// data those recordings become. A bitrate fix does not get to weaken
// that rule.
//
// ── STEP 5 IS THE ORDER THAT MATTERS ──
// If the track disappeared before the cut-away command reached viewers,
// every client would spend a few hundred milliseconds looking at a shot
// whose target has vanished — a frozen last frame under the holding
// pill, for a clip that ended exactly as intended. So this controller
// never unpublishes on its own. It reports `ended`, the caller
// broadcasts the return cut, and the caller then calls stop(). The clip
// holds its final frame on air for that handful of milliseconds, which
// is the correct picture to be showing.
//
// ── AUDIO ──
// The element is muted and only `getVideoTracks()[0]` is ever published.
// Clip audio staying out of the broadcast is the standing upload policy,
// and it is also the only safe answer here: the broadcast carries ONE
// processed audio track out of the Web Audio graph, and a second audio
// track published alongside it would double the room's audio rather than
// mix into it. Mixing clip audio into the graph is a real feature and a
// separate one.
//
// ── SAFARI ──
// HTMLMediaElement.captureStream() is not implemented in Safari. There
// is no polyfill and no workaround that does not involve re-encoding
// frames through a canvas at a quality nobody would broadcast. So this
// feature-detects and the UI disables itself with a plain sentence. That
// is the honest version: an artist on an iPhone is told b-roll needs a
// desktop Chrome, rather than tapping a button that silently does
// nothing.
// ─────────────────────────────────────────────────────────────

import { BROLL_TRACK_NAME, BROLL_TRACK_SOURCE } from './trackSources';
import { logHealthEvent } from './healthLog';

// The placeholder's dimensions, and therefore the publication's.
//
// LiveKit sizes a video sender's encodings from the track it is created
// with. A 2x2 placeholder would publish a sender that can never carry a
// real clip no matter what is swapped into it, so the placeholder is
// full size and black. It costs one canvas frame, once.
const PLACEHOLDER_WIDTH = 1080;
const PLACEHOLDER_HEIGHT = 1920;

// What a clip is allowed to spend, whatever the link could theoretically
// give it.
//
// The artist's steady state used 3.0 of 6.9Mbps, so 2Mbps fits inside
// the headroom that already existed rather than competing for it. Single
// layer, deliberately: simulcast on a track that is only ever full-frame
// produced footage buys nothing and gives the allocator three things to
// argue about instead of one.
const BROLL_MAX_BITRATE = 2_000_000;

/**
 * Can this browser hand a video file to a live stream at all?
 *
 * Feature-detected on the prototype rather than sniffing the user agent:
 * the question is genuinely "does this API exist", and a UA test would
 * be wrong the day Safari ships it.
 */
export function isBrollPlaybackSupported() {
  if (typeof document === 'undefined') return false;
  const proto = window.HTMLMediaElement?.prototype;
  return !!(proto && (proto.captureStream || proto.mozCaptureStream));
}

function captureFrom(video) {
  if (typeof video.captureStream === 'function') return video.captureStream();
  if (typeof video.mozCaptureStream === 'function') return video.mozCaptureStream();
  return null;
}

/**
 * Make the black frame the publication is established from.
 *
 * captureStream(0) is the point: a frame rate of zero means the canvas
 * produces a frame only when requestFrame() is called. One frame, then
 * silence — no timer, no compositor work, no per-frame cost for the rest
 * of the show. That matters more than usual right now, because the
 * round-2 CPU investigation is still open and a placeholder quietly
 * running at 1fps for every show would contaminate the very measurement
 * meant to settle it.
 */
function createPlaceholderTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = PLACEHOLDER_WIDTH;
  canvas.height = PLACEHOLDER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream?.(0);
  const [track] = stream?.getVideoTracks?.() ?? [];
  if (!track) return null;
  // Without this the track exists but has never produced a frame, and
  // some encoders will not complete a publish handshake on one.
  try { track.requestFrame?.(); } catch { /* not all builds expose it */ }
  return track;
}

/**
 * The session's b-roll publisher. ONE per show, created when the
 * broadcast starts and torn down when it ends.
 *
 * ── THE LIFECYCLE, WHICH IS THE WHOLE DESIGN ──────────────────
 *   prewarm()  publish the black frame, muted. Once, before any clip.
 *   play(clip) swap the clip in, unmute. No publish, no negotiation.
 *   stop()     mute, swap the black frame back. The publication STAYS.
 *   teardown() unpublish. Show over.
 *
 * stop() deliberately does not unpublish. Unpublishing is what made
 * every clip cost a renegotiation, and re-publishing for the next clip
 * would pay it again.
 */
export function createBrollPublisher({ room, onEnded, onError }) {
  let videoEl = null;
  let publication = null;      // the permanent publication
  let placeholderTrack = null;
  let currentClipId = null;
  let stopped = false;
  let prewarmed = false;

  function teardownElement() {
    if (!videoEl) return;
    try {
      videoEl.pause();
      // Clearing src and calling load() is what actually releases the
      // decoder and the network connection. Removing the element alone
      // leaves a paused video holding both, and a show with a dozen
      // cued clips would accumulate every one of them.
      videoEl.removeAttribute('src');
      videoEl.load();
      videoEl.remove();
    } catch {
      // teardown is best-effort and must never throw into a live show
    }
    videoEl = null;
  }

  return {
    get clipId() {
      return currentClipId;
    },
    get playing() {
      return !!currentClipId;
    },
    get ready() {
      return prewarmed && !!publication;
    },

    /**
     * Establish the publication, before anything needs it.
     *
     * Idempotent, and safe to call on every reconnect: if the
     * publication is already there this is a no-op rather than a second
     * track. Returns { ok } or { error } — a failure here is not fatal
     * to the show, it just means b-roll is unavailable, and the caller
     * reports that rather than letting a clip fail later at the worst
     * moment.
     */
    async prewarm() {
      if (publication) return { ok: true, alreadyReady: true };
      if (!isBrollPlaybackSupported()) return { error: 'unsupported_browser' };
      if (!room?.localParticipant) return { error: 'not_connected' };

      placeholderTrack = createPlaceholderTrack();
      if (!placeholderTrack) return { error: 'no_placeholder' };

      try {
        publication = await room.localParticipant.publishTrack(placeholderTrack, {
          // THE discriminator, unchanged. Every parser downstream reads
          // this and nothing else to know a clip from a camera
          // (lib/trackSources.js).
          name: BROLL_TRACK_NAME,
          // NOT Camera — see the long note in lib/trackSources.js about
          // setCameraEnabled re-asserting itself on every reconnect.
          source: BROLL_TRACK_SOURCE,
          // A clip is a produced picture: losing resolution to hold
          // framerate makes it look like a bad stream, where dropping a
          // frame or two does not. The opposite of the right default for
          // a live camera pointed at a moving performer.
          degradationPreference: 'maintain-resolution',
          simulcast: false,
          videoEncoding: { maxBitrate: BROLL_MAX_BITRATE, maxFramerate: 30 },
        });
        // Muted from the moment it exists. A published-but-muted track
        // sends nothing, so the cost of holding it open between clips is
        // the SFU knowing it is there — which is exactly what we are
        // buying.
        await publication.mute();
        prewarmed = true;
        logHealthEvent('broll_prewarmed', {
          trackSid: publication?.trackSid ?? null,
          maxBitrate: BROLL_MAX_BITRATE,
          width: PLACEHOLDER_WIDTH,
          height: PLACEHOLDER_HEIGHT,
        });
        return { ok: true };
      } catch (err) {
        publication = null;
        logHealthEvent('broll_prewarm_failed', { error: String(err?.message || err) });
        return { error: String(err?.message || err) };
      }
    },

    /**
     * Put a clip on air. No publish: the sender already exists.
     */
    async play({ clip, accessToken }) {
      if (currentClipId) return { error: 'A clip is already playing.' };
      if (!isBrollPlaybackSupported()) {
        return { error: 'This browser cannot play a clip into a live show. Chrome or Edge on a computer can.' };
      }
      if (!room?.localParticipant) return { error: 'Not connected to the show.' };
      if (!publication) {
        // Late prewarm rather than a failure: a reconnect can drop the
        // publication, and the artist tapping a clip is a reasonable
        // moment to notice. It costs the negotiation this design exists
        // to avoid, which is worth saying out loud in telemetry rather
        // than hiding.
        logHealthEvent('broll_late_prewarm', { clipId: clip.id });
        const warm = await this.prewarm();
        if (warm.error) return { error: 'Could not put the clip on air.' };
      }

      stopped = false;
      currentClipId = clip.id;

      // ── 1. signed URL, owner-checked server-side ──────────────
      let url;
      try {
        const res = await fetch(`/api/broll/url?id=${encodeURIComponent(clip.id)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) {
          currentClipId = null;
          return { error: body.error || 'Could not open that clip.' };
        }
        url = body.url;
      } catch {
        currentClipId = null;
        return { error: 'Could not reach the clip.' };
      }
      if (stopped) { currentClipId = null; return { error: 'Cancelled.' }; }

      // ── 2. a hidden, muted element ────────────────────────────
      // IN the DOM, not detached: several browsers will not decode or
      // paint a video element that has never been attached, and an
      // element that never paints captures a black stream.
      videoEl = document.createElement('video');
      videoEl.src = url;
      videoEl.muted = true;          // see the AUDIO note at the top
      videoEl.playsInline = true;
      videoEl.crossOrigin = 'anonymous';
      videoEl.preload = 'auto';
      Object.assign(videoEl.style, {
        position: 'fixed',
        left: '0',
        bottom: '0',
        width: '2px',
        height: '2px',
        opacity: '0.01',
        pointerEvents: 'none',
        zIndex: '-1',
      });
      document.body.appendChild(videoEl);

      // Wired BEFORE play(), so a clip short enough to finish during the
      // swap still reports its ending.
      videoEl.addEventListener('ended', () => {
        if (stopped) return;
        logHealthEvent('broll_clip_ended', { clipId: clip.id, reason: 'playback_complete' });
        onEnded?.({ clipId: clip.id, reason: 'ended' });
      });
      videoEl.addEventListener('error', () => {
        if (stopped) return;
        logHealthEvent('broll_clip_error', { clipId: clip.id, code: videoEl?.error?.code ?? null });
        onError?.({ clipId: clip.id, error: 'The clip stopped unexpectedly.' });
      });

      try {
        // The caller's tap IS the user gesture, and the element is muted
        // anyway, so autoplay policy is satisfied on both counts.
        await videoEl.play();
      } catch (err) {
        teardownElement();
        currentClipId = null;
        return { error: 'The clip would not start playing.' };
      }
      if (stopped) { teardownElement(); currentClipId = null; return { error: 'Cancelled.' }; }

      // ── 3. capture ────────────────────────────────────────────
      const stream = captureFrom(videoEl);
      const [clipTrack] = stream?.getVideoTracks() ?? [];
      if (!clipTrack) {
        teardownElement();
        currentClipId = null;
        return { error: 'This browser would not hand over the clip\u2019s video.' };
      }

      // ── 4. SWAP, not publish ──────────────────────────────────
      // The whole point of the round. Same sender, same trackSid, same
      // subscription on every viewer — the clip simply becomes what that
      // sender is carrying.
      try {
        await publication.track.replaceTrack(clipTrack, { userProvidedTrack: true });
        await publication.unmute();
      } catch (err) {
        teardownElement();
        currentClipId = null;
        logHealthEvent('broll_swap_failed', { clipId: clip.id, error: String(err?.message || err) });
        return { error: 'Could not put the clip on air.' };
      }

      if (stopped) {
        await this.stop();
        return { error: 'Cancelled.' };
      }

      logHealthEvent('broll_published', {
        clipId: clip.id,
        title: clip.title || null,
        durationMs: clip.duration_ms ?? null,
        trackSid: publication?.trackSid ?? null,
        // The distinction this round exists to make. A swap costs no
        // renegotiation; a publish does. If this ever reads 'publish'
        // outside a late prewarm, the fix has regressed.
        via: 'swap',
      });

      return { ok: true, publication, durationMs: Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration * 1000) : null };
    },

    /**
     * Take the clip off air, KEEPING the publication.
     *
     * The CALLER is responsible for having already cut away — see the
     * ordering note at the top of this file.
     */
    async stop() {
      stopped = true;
      const clipId = currentClipId;
      currentClipId = null;

      if (publication?.track) {
        try {
          await publication.mute();
          // Back to the black frame. Not strictly required while muted,
          // but it means the sender is never left holding a
          // MediaStreamTrack from an element that is about to be torn
          // down, which is how a swap ends up sending a dead track.
          if (placeholderTrack && placeholderTrack.readyState === 'live') {
            await publication.track.replaceTrack(placeholderTrack, { userProvidedTrack: true });
            try { placeholderTrack.requestFrame?.(); } catch { /* fine */ }
          }
        } catch (err) {
          console.warn('[broll] swap back failed', err);
        }
      }
      teardownElement();
      if (clipId) logHealthEvent('broll_unpublished', { clipId, kept: true });
    },

    /**
     * Show over. The only thing that actually unpublishes.
     */
    async teardown(reason = 'unspecified') {
      await this.stop();
      const pub = publication;
      publication = null;
      prewarmed = false;
      if (pub?.track && room?.localParticipant) {
        try {
          await room.localParticipant.unpublishTrack(pub.track, true);
        } catch (err) {
          console.warn('[broll] unpublish failed', err);
        }
      }
      try { placeholderTrack?.stop?.(); } catch { /* already gone */ }
      placeholderTrack = null;
      logHealthEvent('broll_publication_torn_down', { reason });
    },
  };
}
