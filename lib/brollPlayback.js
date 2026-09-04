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

// How long to wait for the swapped-in clip to actually produce frames
// before giving up on it.
//
// ── WHY THIS GATE EXISTS ──────────────────────────────────────
// The blank stage in the first device run had TWO causes, and only one
// of them was the camera mute. The other survives the mute's removal:
// the cut to b-roll was fired as soon as replaceTrack() resolved, and
// replaceTrack resolving means the sender has ACCEPTED a track, not that
// the track has produced a single frame. Cutting to a sender that is not
// yet encoding shows viewers a dead layer for as long as it takes the
// first frame to arrive — a window that is short on a fast machine and
// unbounded on a slow one.
//
// So the cut waits for evidence: framesSent or framesEncoded advancing
// on the b-roll sender's own stats. Never a timer, never a fixed delay.
const FRAME_CONFIRM_TIMEOUT_MS = 4000;
const FRAME_CONFIRM_POLL_MS = 100;

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
 * Wait until this publication's sender is demonstrably producing frames.
 *
 * Returns { ok: true, waitedMs, frames } once framesSent (or
 * framesEncoded, where the build reports one and not the other) has
 * advanced past where it stood before the swap, or { ok: false } if it
 * never does inside the timeout.
 *
 * The baseline matters: the b-roll sender has a lifetime frame count
 * from the placeholder, so "frames > 0" would be satisfied by a frame
 * encoded before this clip existed. Only movement counts.
 */
async function waitForFrames(publication, { timeoutMs = FRAME_CONFIRM_TIMEOUT_MS } = {}) {
  const track = publication?.track;
  if (typeof track?.getSenderStats !== 'function') {
    // Nothing to measure. Reported rather than silently treated as a
    // pass, so a browser that cannot answer is visible in the capture
    // instead of looking like a confirmed frame.
    return { ok: false, reason: 'no_sender_stats', waitedMs: 0 };
  }
  const readFrames = async () => {
    try {
      const stats = await track.getSenderStats();
      const list = Array.isArray(stats) ? stats : [stats];
      return list.reduce((n, s) => n + (s?.framesSent ?? s?.framesEncoded ?? 0), 0);
    } catch {
      return null;
    }
  };
  const baseline = (await readFrames()) ?? 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, FRAME_CONFIRM_POLL_MS));
    const frames = await readFrames();
    if (frames != null && frames > baseline) {
      return { ok: true, waitedMs: Date.now() - startedAt, frames, baseline };
    }
  }
  return { ok: false, reason: 'no_frames', waitedMs: Date.now() - startedAt, baseline };
}

/**
 * The session's b-roll publisher. ONE per show, created when the
 * broadcast starts and torn down when it ends.
 *
 * ── THE LIFECYCLE, WHICH IS THE WHOLE DESIGN ──────────────────
 *   ensurePublication()  resolve or establish. Idempotent, single-flight.
 *   play(clip)           swap the clip in. No publish, no negotiation.
 *   stop()               swap the black frame back. The publication STAYS.
 *   teardown()           unpublish. Show over.
 *
 * stop() deliberately does not unpublish. Unpublishing is what made
 * every clip cost a renegotiation, and re-publishing for the next clip
 * would pay it again.
 */
// ─────────────────────────────────────────────────────────────
// THE RULE THIS FILE WAS REBUILT AROUND
//
//   "DOES THE REFERENCE EXIST" AND "DOES THE REFERENCE WORK" ARE
//   DIFFERENT QUESTIONS. NEVER ANSWER THE SECOND BY ASKING THE FIRST.
//
// Stated as a rule rather than as a fix because this codebase has now
// been bitten by the difference. The previous version held the
// publication in a closure and guarded every use with `if
// (!publication)`. After a LiveKit reconnect that object still existed
// and no longer worked, so the guard passed, the swap ran against a dead
// handle, and the failure arrived as either silence or a TypeError
// depending on how far the teardown had got.
//
// isUsablePublication() below is the shape every such check should take:
// walk to the thing that actually does the work — here the RTP sender
// and its transport — and ask about that.
// ─────────────────────────────────────────────────────────────

/** The b-roll publication as it exists RIGHT NOW, or null. Never cached. */
function findBrollPublication(room) {
  const pubs = room?.localParticipant?.videoTrackPublications;
  for (const pub of pubs?.values?.() ?? []) {
    if (pub?.trackName === BROLL_TRACK_NAME) return pub;
  }
  return null;
}

/**
 * Is this publication capable of carrying a swap?
 *
 * Three questions, not one. The publication object can outlive its
 * track, the track can outlive its sender, and the sender can outlive
 * its transport — and each of those survivals is exactly what a
 * reconnect produces.
 */
function isUsablePublication(pub) {
  const sender = pub?.track?.sender;
  if (!sender) return false;
  // `transport` is absent on some builds; absence is not evidence of
  // closure, so only an explicitly closed transport disqualifies.
  if (sender.transport && sender.transport.state === 'closed') return false;
  return true;
}

/**
 * The session's b-roll publisher.
 *
 * ── WHY THERE IS NO STORED PUBLICATION ────────────────────────
 * Because on a full reconnect livekit-client runs republishAllTracks(),
 * which unpublishes every local track and publishes it again — a new
 * publication object with a NEW trackSid. Anything holding the old one
 * is holding a corpse, and the corpse answers `if (x)` correctly.
 *
 * So the publication is resolved from room.localParticipant at every
 * use. In the common case after a reconnect it is simply THERE, because
 * LiveKit republished it for us, and resolving fresh picks it up with no
 * work at all. Only when it is genuinely absent or unusable is a new one
 * established.
 *
 * ── AND WHY IT IS NEVER MUTED ─────────────────────────────────
 * Muting is how the previous version kept the publication quiet between
 * clips, and it caused three separate failures: it broke the return cut
 * (availableRoles skips muted publications), it produced a blank stage
 * (the camera went off before the clip came on), and it made every swap
 * depend on undocumented ordering — setMediaStreamTrack sets
 * `enabled = isUnmuting ? true : !this.isMuted`, so a clip swapped into
 * a muted publication arrives DISABLED and only the following unmute
 * saves it.
 *
 * The publication now idles on a single black frame instead. One frame
 * from a captureStream(0) canvas, encoded once, then nothing —
 * indistinguishable from muted on the wire, with none of the state.
 */
export function createBrollPublisher({ room, onEnded, onError }) {
  let videoEl = null;
  let placeholderTrack = null;
  let currentClipId = null;
  let stopped = false;
  // Single-flight, same reasoning as ensureAudioGraph in lib/audioHost.js:
  // a reconnect handler and an artist's tap can arrive together, and two
  // concurrent establishes would publish two b-roll tracks.
  let ensuring = null;

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

  function freshPlaceholder() {
    // A new canvas track per establish. Reusing one across a republish
    // would hand LiveKit a track it may already have stopped.
    try { placeholderTrack?.stop?.(); } catch { /* already gone */ }
    placeholderTrack = createPlaceholderTrack();
    return placeholderTrack;
  }

  async function establish(reason) {
    const track = freshPlaceholder();
    if (!track) return { error: 'no_placeholder' };
    const pub = await room.localParticipant.publishTrack(track, {
      // THE discriminator, unchanged. Every parser downstream reads this
      // and nothing else to know a clip from a camera (lib/trackSources.js).
      name: BROLL_TRACK_NAME,
      // NOT Camera — see the long note in lib/trackSources.js about
      // setCameraEnabled re-asserting itself on every reconnect.
      source: BROLL_TRACK_SOURCE,
      // A clip is a produced picture: losing resolution to hold framerate
      // makes it look like a bad stream, where dropping a frame or two
      // does not.
      degradationPreference: 'maintain-resolution',
      simulcast: false,
      videoEncoding: { maxBitrate: BROLL_MAX_BITRATE, maxFramerate: 30 },
    });
    logHealthEvent('broll_prewarmed', {
      reason,
      trackSid: pub?.trackSid ?? null,
      maxBitrate: BROLL_MAX_BITRATE,
      width: PLACEHOLDER_WIDTH,
      height: PLACEHOLDER_HEIGHT,
    });
    return { ok: true, pub };
  }

  return {
    get clipId() { return currentClipId; },
    get playing() { return !!currentClipId; },
    get ready() { return isUsablePublication(findBrollPublication(room)); },

    /**
     * Make sure a USABLE b-roll publication exists, and return it.
     *
     * Idempotent and single-flight. Safe to call on mount, on every
     * reconnect, and immediately before a swap — which is exactly where
     * it is called, because those are the three moments the answer can
     * have changed.
     */
    async ensurePublication(reason = 'unspecified') {
      if (!isBrollPlaybackSupported()) return { error: 'unsupported_browser' };
      if (!room?.localParticipant) return { error: 'not_connected' };

      const existing = findBrollPublication(room);
      if (isUsablePublication(existing)) return { ok: true, pub: existing };

      // Present but unusable is its own finding, and the one the last
      // capture could not report: it is what a reconnect leaves behind.
      if (existing) {
        logHealthEvent('broll_publication_stale', {
          reason,
          trackSid: existing.trackSid ?? null,
          hasTrack: !!existing.track,
          hasSender: !!existing.track?.sender,
          transportState: existing.track?.sender?.transport?.state ?? null,
        });
        try { await room.localParticipant.unpublishTrack(existing.track, true); } catch { /* already gone */ }
      }

      if (ensuring) return ensuring;
      ensuring = (async () => {
        try {
          return await establish(reason);
        } catch (err) {
          logHealthEvent('broll_prewarm_failed', { reason, error: String(err?.message || err) });
          return { error: String(err?.message || err) };
        } finally {
          ensuring = null;
        }
      })();
      return ensuring;
    },

    /** Put a clip on air. */
    async play({ clip, accessToken }) {
      if (currentClipId) return { error: 'A clip is already playing.' };
      if (!isBrollPlaybackSupported()) {
        return { error: 'This browser cannot play a clip into a live show. Chrome or Edge on a computer can.' };
      }

      // Resolved HERE, immediately before use, never read from a field
      // written minutes ago. See the rule at the top of this section.
      const warm = await this.ensurePublication('play');
      if (warm.error) return { error: 'Could not put the clip on air.' };
      const pub = warm.pub;

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
        position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px',
        opacity: '0.01', pointerEvents: 'none', zIndex: '-1',
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
      } catch {
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

      // ── 4. SWAP, then CHECK IT LANDED ─────────────────────────
      // The check is the point. setMediaStreamTrack attaches to the
      // sender only `if (this.sender && sender.transport?.state !==
      // 'closed')` — when that is false it SKIPS the attach and resolves
      // successfully. A swap that did nothing is indistinguishable from
      // one that worked until frames fail to arrive, which is how the
      // last capture spent four seconds per attempt discovering silence.
      try {
        await pub.track.replaceTrack(clipTrack, { userProvidedTrack: true });
      } catch (err) {
        teardownElement();
        currentClipId = null;
        logHealthEvent('broll_swap_failed', { clipId: clip.id, error: String(err?.message || err) });
        return { error: 'Could not put the clip on air.' };
      }

      const attached = pub.track?.sender?.track;
      if (attached !== clipTrack) {
        // Structural no-op. Reported in the millisecond it happens
        // rather than four seconds later as "no frames", because they
        // are different faults and only one of them is about the clip.
        logHealthEvent('broll_swap_noop', {
          clipId: clip.id,
          hasSender: !!pub.track?.sender,
          transportState: pub.track?.sender?.transport?.state ?? null,
          attachedIsNull: attached == null,
        });
        await this.stop();
        return { error: 'The clip could not be attached to the broadcast. Try again.' };
      }

      // ── 5. WAIT FOR FRAMES, NOT FOR A PROMISE ─────────────────
      // replaceTrack resolving means the sender accepted a track. The
      // caller fires the cut on this function returning, so returning
      // before anything is encoded is the same as cutting to a dead
      // layer.
      const confirmed = await waitForFrames(pub);
      logHealthEvent('broll_frames_confirmed', {
        clipId: clip.id, ok: confirmed.ok, waitedMs: confirmed.waitedMs, reason: confirmed.reason ?? null,
      });
      if (!confirmed.ok) {
        await this.stop();
        return { error: 'The clip did not start sending. Nothing was put on air.' };
      }

      if (stopped) { await this.stop(); return { error: 'Cancelled.' }; }

      logHealthEvent('broll_published', {
        clipId: clip.id,
        title: clip.title || null,
        durationMs: clip.duration_ms ?? null,
        trackSid: pub?.trackSid ?? null,
        // A swap costs no renegotiation; a publish does. If this ever
        // reads anything else outside a reconnect, the fix has regressed.
        via: 'swap',
        frameConfirmMs: confirmed.waitedMs,
      });

      return { ok: true, publication: pub, durationMs: Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration * 1000) : null };
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

      // Resolved fresh here too: stop() runs on paths that include a
      // reconnect having happened mid-clip.
      const pub = findBrollPublication(room);
      if (isUsablePublication(pub) && placeholderTrack?.readyState === 'live') {
        try {
          // Back to the black frame. No mute: the frame is the idle
          // state, and one still frame costs what a muted track costs.
          await pub.track.replaceTrack(placeholderTrack, { userProvidedTrack: true });
          try { placeholderTrack.requestFrame?.(); } catch { /* not all builds expose it */ }
        } catch (err) {
          console.warn('[broll] swap back failed', err);
        }
      }
      teardownElement();
      if (clipId) logHealthEvent('broll_unpublished', { clipId, kept: true });
    },

    /** Show over. The only thing that actually unpublishes. */
    async teardown(reason = 'unspecified') {
      await this.stop();
      const pub = findBrollPublication(room);
      if (pub?.track && room?.localParticipant) {
        try { await room.localParticipant.unpublishTrack(pub.track, true); } catch (err) {
          console.warn('[broll] unpublish failed', err);
        }
      }
      try { placeholderTrack?.stop?.(); } catch { /* already gone */ }
      placeholderTrack = null;
      logHealthEvent('broll_publication_torn_down', { reason });
    },
  };
}
