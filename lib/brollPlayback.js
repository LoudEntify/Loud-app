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
// ── STEP 5 IS THE ORDER THAT MATTERS ──
// If the track disappeared before the cut-away command reached viewers,
// every client would spend a few hundred milliseconds looking at a shot
// whose target has vanished — a frozen last frame under a CAMERA LOST
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
 * One clip, playing. Create with start(), end with stop(). Not reusable —
 * a second clip is a second controller, so there is never a question
 * about which element or which publication a call refers to.
 */
export function createBrollPlayer({ room, onEnded, onError }) {
  let videoEl = null;
  let publication = null;
  let stopped = false;
  let currentClipId = null;

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
      return !!publication;
    },

    async start({ clip, accessToken }) {
      if (publication) return { error: 'A clip is already playing.' };
      if (!isBrollPlaybackSupported()) {
        return { error: 'This browser cannot play a clip into a live show. Chrome or Edge on a computer can.' };
      }
      if (!room?.localParticipant) return { error: 'Not connected to the show.' };

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
          return { error: body.error || 'Could not open that clip.' };
        }
        url = body.url;
      } catch {
        return { error: 'Could not reach the clip.' };
      }
      if (stopped) return { error: 'Cancelled.' };

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
      // publish handshake still reports its ending.
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
        return { error: 'The clip would not start playing.' };
      }
      if (stopped) { teardownElement(); return { error: 'Cancelled.' }; }

      // ── 3. capture ────────────────────────────────────────────
      const stream = captureFrom(videoEl);
      const [videoTrack] = stream?.getVideoTracks() ?? [];
      if (!videoTrack) {
        teardownElement();
        return { error: 'This browser would not hand over the clip’s video.' };
      }

      // ── 4. publish ────────────────────────────────────────────
      try {
        publication = await room.localParticipant.publishTrack(videoTrack, {
          // THE discriminator. Every parser downstream reads this and
          // nothing else to know a clip from a camera
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
        });
      } catch (err) {
        teardownElement();
        logHealthEvent('broll_publish_failed', { clipId: clip.id, error: String(err?.message || err) });
        return { error: 'Could not put the clip on air.' };
      }

      // A clip that ends between publish() resolving and this line would
      // otherwise leave a stopped track published forever.
      if (stopped) {
        await this.stop();
        return { error: 'Cancelled.' };
      }

      logHealthEvent('broll_published', {
        clipId: clip.id,
        title: clip.title || null,
        durationMs: clip.duration_ms ?? null,
        trackSid: publication?.trackSid ?? null,
      });

      return { ok: true, publication, durationMs: Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration * 1000) : null };
    },

    /**
     * Take the clip off air.
     *
     * The CALLER is responsible for having already cut away — see the
     * ordering note at the top of this file. stop() only removes the
     * track; it has no opinion about what is on screen.
     */
    async stop() {
      stopped = true;
      const pub = publication;
      publication = null;
      const clipId = currentClipId;
      currentClipId = null;

      if (pub?.track && room?.localParticipant) {
        try {
          // stopOnUnpublish: true — the captured MediaStreamTrack is
          // ours and nothing else holds it. Leaving it live would keep
          // the element's decoder pinned.
          await room.localParticipant.unpublishTrack(pub.track, true);
        } catch (err) {
          console.warn('[broll] unpublish failed', err);
        }
      }
      teardownElement();
      if (clipId) logHealthEvent('broll_unpublished', { clipId });
    },
  };
}
