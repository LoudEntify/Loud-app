// lib/useSourceDimensions.js
// ─────────────────────────────────────────────────────────────
// Portrait capture -- tracks the ACTUAL delivered frame dimensions of a
// camera track. Never assumes portrait or landscape from device type or
// role; only from what getUserMedia genuinely delivers right now.
// That's the whole point: the same detection handles a phone held
// upright, a phone rotated mid-show, a laptop webcam, and a capture
// card identically, by reacting to whatever shape actually shows up
// rather than a hardcoded assumption.
//
// Two exports share one core (watchTrackDimensions, below):
//   - useSourceDimensions(publication, refreshKey) -- Stage 1. Local-
//     only (a LiveKit LocalTrackPublication), used for the self-preview
//     DEBUG labels and to drive a rotation processor's re-check.
//   - useTrackAspect(trackRef) -- Stage 2. Works for ANY rendered
//     track, local or remote, since a slot's active shot (renderSlot in
//     LiveDemo.jsx) can be either the local participant's own camera or
//     a remote camfeed device's track -- shot-grammar crop selection
//     needs to work correctly either way, not just for the local case.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { TrackEvent } from 'livekit-client';

// Bounded retry window for the INITIAL read only. A capture card can
// lose the race to have getSettings() populated by the time this first
// runs -- a phone's tightly-integrated camera pipeline usually reports
// real dimensions near-instantly, but a generic UVC capture card can
// take a beat longer to settle. This is NOT the same problem a resize
// listener solves: the very first no-data -> real-data transition may
// not fire 'resize' at all, since there's no prior value for anything
// to visibly "change" from -- so without this, a slow-to-settle source
// hangs on "detecting" forever. 10 * 100ms = ~1s total, then give up
// and surface a clear failure rather than waiting silently forever --
// bounded means bounded, so a genuinely dead source doesn't retry
// forever and peg the CPU.
const INITIAL_READ_MAX_ATTEMPTS = 10;
const INITIAL_READ_RETRY_INTERVAL_MS = 100;

// `onUpdate` is called with one of:
//   { status: 'detecting', attempts }
//   { status: 'ready', width, height, attempts }
//   { status: 'failed', attempts }
// `attempts` on a 'ready'/'failed' update is how many tries the initial
// read took (1 = succeeded immediately, no retry needed) -- callers
// that want to show this (useSourceDimensions' DEBUG label) can; ones
// that don't (useTrackAspect) can ignore it.
// Prefer a processor's output (e.g. a manual rotation correction) over
// the raw capturing source where that concept exists (LocalTrack only --
// getProcessor is undefined on a RemoteTrack, so this naturally falls
// through to mediaStreamTrack for remote tracks with no special casing
// needed). getProcessor() is LocalTrack's own public accessor, never
// anything internal/protected. Shared by watchTrackDimensions' live path
// below and useTrackAspect's synchronous initial read (see its own
// comment) so there's exactly one definition of "how to read a track's
// current dimensions" for both the async and sync callers.
function readTrackDimensionsOnce(track) {
  const mst = track?.getProcessor?.()?.processedTrack ?? track?.mediaStreamTrack;
  const settings = mst?.getSettings?.();
  return settings?.width && settings?.height ? { width: settings.width, height: settings.height } : null;
}

function watchTrackDimensions(track, onUpdate) {
  if (!track) return undefined;

  function currentTrack() {
    return track.getProcessor?.()?.processedTrack ?? track.mediaStreamTrack;
  }

  let detachResize = null;
  let retryTimer = null;

  // Live updates once we've already settled at least once (a real
  // resize event, a rotation-processor swap) -- no retry loop needed
  // here, the event firing means real data is available right now.
  function handleLiveUpdate() {
    const dims = readTrackDimensionsOnce(track);
    if (dims) onUpdate({ status: 'ready', width: dims.width, height: dims.height });
  }

  function attachResize() {
    const mst = currentTrack();
    if (!mst?.addEventListener) return null;
    mst.addEventListener('resize', handleLiveUpdate);
    return () => mst.removeEventListener('resize', handleLiveUpdate);
  }

  function attemptInitialRead(attempt) {
    const dims = readTrackDimensionsOnce(track);
    if (dims) {
      onUpdate({ status: 'ready', width: dims.width, height: dims.height, attempts: attempt });
      return;
    }
    if (attempt >= INITIAL_READ_MAX_ATTEMPTS) {
      onUpdate({ status: 'failed', attempts: attempt });
      return;
    }
    retryTimer = setTimeout(() => attemptInitialRead(attempt + 1), INITIAL_READ_RETRY_INTERVAL_MS);
  }

  function restartDetection() {
    if (retryTimer) clearTimeout(retryTimer);
    onUpdate({ status: 'detecting', attempts: 0 });
    attemptInitialRead(1);
  }

  function handleRestarted() {
    detachResize?.();
    detachResize = attachResize();
    // The underlying MediaStreamTrack was just swapped (e.g. a
    // facingMode toggle) -- the same acquisition race can happen again
    // on the fresh track, so it gets its own bounded retry window too.
    restartDetection();
  }

  onUpdate({ status: 'detecting', attempts: 0 });
  attemptInitialRead(1);
  detachResize = attachResize();
  track.on?.(TrackEvent.Restarted, handleRestarted);

  return () => {
    if (retryTimer) clearTimeout(retryTimer);
    detachResize?.();
    track.off?.(TrackEvent.Restarted, handleRestarted);
  };
}

// `publication` is a LiveKit LocalTrackPublication (e.g.
// room.localParticipant.getTrackPublication(Track.Source.Camera)), not
// a @livekit/components-react TrackReference -- callers derive it
// themselves, this hook only tracks dimensions once it has one.
//
// `refreshKey` (optional) -- bump it whenever the caller does something
// this hook can't discover on its own, namely attaching/switching a
// rotation TrackProcessor (see lib/rotationProcessor.js). There's no
// public LiveKit event that fires specifically for that, so the caller
// -- the one actually calling setProcessor -- tells us to re-check
// instead of us guessing.
//
// Returns { status: 'detecting' | 'failed', attempts } while not ready,
// or { status: 'ready', width, height, isPortraitSource, attempts }.
export function useSourceDimensions(publication, refreshKey) {
  const [state, setState] = useState({ status: 'detecting', attempts: 0 });
  const trackSid = publication?.trackSid;

  useEffect(() => {
    const videoTrack = publication?.videoTrack;
    if (!videoTrack) {
      setState({ status: 'detecting', attempts: 0 });
      return undefined;
    }
    return watchTrackDimensions(videoTrack, setState);
    // Keyed on trackSid + refreshKey, not the publication object itself
    // -- the same publication's underlying MediaStreamTrack can be
    // swapped many times (facingMode toggles) without trackSid ever
    // changing, and watchTrackDimensions' own Restarted/resize handling
    // already covers that live; re-running this whole effect on every
    // such swap would be redundant. refreshKey is the deliberate
    // exception -- see its own comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSid, refreshKey]);

  if (state.status === 'ready') {
    return { ...state, isPortraitSource: state.height > state.width };
  }
  return state;
}

// `trackRef` is a @livekit/components-react TrackReference
// ({ participant, publication, source }), the same shape already
// flowing through renderSlot/ShotVideo/ShotTransformFrame in
// LiveDemo.jsx -- works whether the referenced track is the local
// participant's own camera or a remote camfeed device's, since a slot's
// active shot can be either.
//
// Always returns an object (never null) with `status: 'detecting' |
// 'ready' | 'failed'` and `isPortraitSource` (defaults false/landscape
// while detecting or if detection ultimately failed -- a reasonable
// fallback either way, matching this file's existing bounded-retry
// philosophy of never blocking forever). Exposing `status` explicitly
// -- rather than collapsing detecting/failed into a single null, like
// this used to -- is what lets a caller (ShotFadeLayer) tell "still
// resolving, wait" apart from "settled, safe to proceed", which a bare
// boolean can't express.
//
// Initial state is read SYNCHRONOUSLY (the useState lazy-initializer
// runs during render, before paint or any effect) rather than always
// starting at 'detecting' and correcting a render later. This closes the
// actual gap the punch-in flash traced back to: ShotFadeLayer's caller,
// ShotVideo, mounts a brand-new keyed instance per camera cut (see its
// own comment), so this initializer runs fresh on every cut -- for an
// already-flowing track (the camera-cut case; a source that's been
// publishing for a while has real getSettings() data available
// immediately), isPortrait is correct on the very first render, so
// ShotTransformFrame's transform effect never applies the wrong
// (landscape-default) scale even invisibly -- there's nothing left to
// correct. A genuinely brand-new track (first-ever appearance, no prior
// getSettings() data yet) still starts 'detecting' here and resolves via
// the effect below same as before; ShotFadeLayer's reveal-gate (see its
// own comment) remains the backstop for that narrower case, same as it
// already was before this change.
export function useTrackAspect(trackRef) {
  const [state, setState] = useState(() => {
    const track = trackRef?.publication?.track;
    const dims = track ? readTrackDimensionsOnce(track) : null;
    return dims ? { status: 'ready', width: dims.width, height: dims.height, attempts: 1 } : { status: 'detecting', attempts: 0 };
  });
  const trackSid = trackRef?.publication?.trackSid;

  useEffect(() => {
    const track = trackRef?.publication?.track;
    if (!track) {
      setState({ status: 'detecting', attempts: 0 });
      return undefined;
    }
    return watchTrackDimensions(track, setState);
  }, [trackSid]);

  if (state.status === 'ready') {
    return { status: 'ready', width: state.width, height: state.height, isPortraitSource: state.height > state.width };
  }
  return { status: state.status, isPortraitSource: false };
}

// One-shot, bounded-retry read of a track's RAW native dimensions --
// deliberately bypassing readTrackDimensionsOnce's processor-output
// preference. This exists specifically to answer "does this source need
// the portrait-crop processor attached at all" (lib/rotationProcessor.js)
// -- a question that has to be answered from the UNPROCESSED source,
// before any processor exists, or it's circular: a crop processor's own
// output is always portrait by design, so asking it "are you landscape"
// answers nothing. No live subscription (unlike watchTrackDimensions) --
// reads once, bounded-retried, then done; a processor attaching later
// must never retroactively change this answer.
function readRawDimensionsOnce(track, onDone) {
  if (!track) {
    onDone(null);
    return undefined;
  }
  let attempt = 0;
  let timer = null;
  let cancelled = false;
  function tryRead() {
    if (cancelled) return;
    attempt += 1;
    const settings = track.mediaStreamTrack?.getSettings?.();
    if (settings?.width && settings?.height) {
      onDone({ width: settings.width, height: settings.height });
      return;
    }
    if (attempt >= INITIAL_READ_MAX_ATTEMPTS) {
      onDone(null);
      return;
    }
    timer = setTimeout(tryRead, INITIAL_READ_RETRY_INTERVAL_MS);
  }
  tryRead();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

// Known camera sensor aspect ratios (checked in both orientations) --
// the shapes a genuine, unscaled capture actually produces. Real
// hardware (Sony via capture card) has been observed reporting
// getSettings() dimensions that are portrait-SHAPED (width <= height)
// but match none of these ratios -- e.g. 1080x1200 (ratio 0.9), which
// isn't 16:9, 4:3, 3:2, 1:1, or any of their portrait inverses. That's
// the signature of a driver's non-uniform (squeeze) scaling, not
// anything a real sensor mode produces. Belt-and-suspenders check for
// useNativeIsLandscape below, on top of the aspectRatio-based capture
// constraint (HIGH_RES_VIDEO_CAPTURE in CamPage.jsx/LiveDemo.jsx) that's
// the primary fix for this failure mode.
const KNOWN_ASPECT_RATIOS = [16 / 9, 4 / 3, 3 / 2, 1, 9 / 16, 3 / 4, 2 / 3];
const ASPECT_RATIO_TOLERANCE = 0.08;

function isPlausibleCameraAspectRatio(width, height) {
  const ratio = width / height;
  return KNOWN_ASPECT_RATIOS.some((known) => Math.abs(ratio - known) / known <= ASPECT_RATIO_TOLERANCE);
}

// Answers "is this camera publication's RAW source landscape" -- `true`/
// `false` once resolved, `null` while still detecting or with no track
// yet. Used by the portrait-crop auto-attach logic in CamPage.jsx and
// LiveDemo.jsx to decide whether a source needs createPortraitProcessor
// at all; deliberately independent of useTrackAspect/useSourceDimensions
// (which correctly prefer a processor's output once one exists) since
// this specific question must always be answered from the unprocessed
// source. A source whose raw read never settles (bounded retry exhausts
// -- a genuinely dead/misbehaving device) resolves `false`: attaching a
// crop processor to a source we couldn't even read from would risk
// masking a real acquisition failure behind a black or frozen "cropped"
// frame instead of surfacing it, which is worse than just publishing
// whatever raw (uncropped) frames the source does deliver.
//
// A width > height reading is unambiguous landscape, trusted outright.
// A width <= height reading ("claims portrait") only gets trusted if
// its aspect ratio is one a real camera could produce
// (isPlausibleCameraAspectRatio) -- an unrecognized ratio defaults to
// landscape/cropped instead of trusting an implausible portrait
// reading. That default is deliberately asymmetric: attaching the crop
// to a source that's actually already-correct portrait is close to a
// no-op (fitPortraitTarget barely trims a source already near the 9:16
// target), while trusting a bogus "portrait" reading on a genuinely
// squeezed landscape source leaves the squeeze on screen uncorrected --
// the wrong default in one direction costs far more than the other.
// Returns { isLandscape, implausibleAspect }. `implausibleAspect` is true
// only on the safety-net branch above (a "claims portrait" reading whose
// ratio matches no real camera shape) -- it's the caller's signal that
// the delivered buffer isn't just landscape-cropped-as-portrait, it's
// actually anamorphically SQUEEZED (real hardware: Sony via capture
// card), so createPortraitProcessor needs to un-stretch the buffer, not
// just crop it -- see rotationProcessor.js's `unsqueeze` option. A plain
// width > height reading is unambiguous landscape with no squeeze
// implied (implausibleAspect stays false), same as a clean recognized
// portrait/landscape ratio.
export function useNativeIsLandscape(publication) {
  const [state, setState] = useState({ isLandscape: null, implausibleAspect: false });
  const trackSid = publication?.trackSid;

  useEffect(() => {
    const track = publication?.videoTrack;
    if (!track) {
      setState({ isLandscape: null, implausibleAspect: false });
      return undefined;
    }
    setState({ isLandscape: null, implausibleAspect: false });
    return readRawDimensionsOnce(track, (dims) => {
      if (!dims) {
        setState({ isLandscape: false, implausibleAspect: false });
        return;
      }
      if (dims.width > dims.height) {
        setState({ isLandscape: true, implausibleAspect: false });
        return;
      }
      if (!isPlausibleCameraAspectRatio(dims.width, dims.height)) {
        console.warn(
          `[useNativeIsLandscape] unrecognized aspect ratio ${dims.width}x${dims.height} (${(dims.width / dims.height).toFixed(3)}) -- treating as landscape/cropped rather than trusting an implausible portrait reading`
        );
        setState({ isLandscape: true, implausibleAspect: true });
        return;
      }
      setState({ isLandscape: false, implausibleAspect: false });
    });
  }, [trackSid]);

  return state;
}
