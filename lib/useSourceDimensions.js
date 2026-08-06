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

// Two independent triggers, both wired up unconditionally regardless of
// source/track type -- a listener that never fires (a webcam, a
// capture card, a RemoteTrack that never restarts) costs nothing:
//   - the native 'resize' event on the MediaStreamTrack itself, which
//     fires when a phone is physically rotated mid-session with no
//     re-acquisition involved -- same underlying track, new delivered
//     shape. Works for local AND remote tracks (a subscribed remote
//     track's decoded dimensions genuinely change too).
//   - TrackEvent.Restarted, which only ever fires on LocalTracks (our
//     own facingMode-swap restartTrack calls) -- subscribing on a
//     RemoteTrack is harmless, it just never fires.
function watchTrackDimensions(track, onChange) {
  if (!track) return undefined;

  // Prefer a processor's output (e.g. a manual rotation correction) over
  // the raw capturing source where that concept exists (LocalTrack only
  // -- getProcessor is undefined on a RemoteTrack, so this naturally
  // falls through to mediaStreamTrack for remote tracks with no special
  // casing needed). getProcessor() is LocalTrack's own public accessor,
  // never anything internal/protected.
  function currentTrack() {
    return track.getProcessor?.()?.processedTrack ?? track.mediaStreamTrack;
  }

  let detachResize = null;

  function readDims() {
    const settings = currentTrack()?.getSettings?.();
    if (settings?.width && settings?.height) {
      onChange({ width: settings.width, height: settings.height });
    }
  }

  function attachResize() {
    const mst = currentTrack();
    if (!mst?.addEventListener) return null;
    mst.addEventListener('resize', readDims);
    return () => mst.removeEventListener('resize', readDims);
  }

  function handleRestarted() {
    detachResize?.();
    detachResize = attachResize();
    readDims();
  }

  readDims();
  detachResize = attachResize();
  track.on?.(TrackEvent.Restarted, handleRestarted);

  return () => {
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
export function useSourceDimensions(publication, refreshKey) {
  const [dims, setDims] = useState(null);
  const trackSid = publication?.trackSid;

  useEffect(() => {
    const videoTrack = publication?.videoTrack;
    if (!videoTrack) {
      setDims(null);
      return undefined;
    }
    return watchTrackDimensions(videoTrack, setDims);
    // Keyed on trackSid + refreshKey, not the publication object itself
    // -- the same publication's underlying MediaStreamTrack can be
    // swapped many times (facingMode toggles) without trackSid ever
    // changing, and watchTrackDimensions' own Restarted/resize handling
    // already covers that live; re-running this whole effect on every
    // such swap would be redundant. refreshKey is the deliberate
    // exception -- see its own comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSid, refreshKey]);

  if (!dims) return null;
  return { ...dims, isPortraitSource: dims.height > dims.width };
}

// `trackRef` is a @livekit/components-react TrackReference
// ({ participant, publication, source }), the same shape already
// flowing through renderSlot/ShotVideo/ShotTransformFrame in
// LiveDemo.jsx -- works whether the referenced track is the local
// participant's own camera or a remote camfeed device's, since a slot's
// active shot can be either.
export function useTrackAspect(trackRef) {
  const [dims, setDims] = useState(null);
  const trackSid = trackRef?.publication?.trackSid;

  useEffect(() => {
    const track = trackRef?.publication?.track;
    if (!track) {
      setDims(null);
      return undefined;
    }
    return watchTrackDimensions(track, setDims);
  }, [trackSid]);

  if (!dims) return null;
  return { ...dims, isPortraitSource: dims.height > dims.width };
}
