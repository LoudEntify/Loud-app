// lib/useSourceDimensions.js
// ─────────────────────────────────────────────────────────────
// Portrait capture, Stage 1 -- tracks the ACTUAL delivered frame
// dimensions of a local camera publication. Never assumes portrait or
// landscape from device type or role; only from what getUserMedia
// genuinely delivers right now. That's the whole point: the same
// detection handles a phone held upright, a phone rotated mid-show, a
// laptop webcam, and a capture card identically, by reacting to
// whatever shape actually shows up rather than a hardcoded assumption.
//
// Two independent triggers, both wired up unconditionally regardless of
// source type -- a listener that never fires on a fixed-shape source
// (a webcam, a capture card) costs nothing:
//   - the native 'resize' event on the MediaStreamTrack itself, which
//     fires when a phone is physically rotated mid-session with no
//     re-acquisition involved -- same underlying track, new delivered
//     shape.
//   - TrackEvent.Restarted on the LiveKit LocalVideoTrack wrapper,
//     which fires when OUR OWN code calls restartTrack (e.g. the
//     front/rear facingMode swap) -- the underlying MediaStreamTrack
//     OBJECT gets replaced, so the resize listener has to be rebound
//     to the new one rather than staying attached to the old, now-dead
//     track.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { TrackEvent } from 'livekit-client';

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

    // Prefer a processor's output (e.g. a manual rotation correction)
    // over the raw capturing source -- getProcessor() is LocalTrack's
    // own public accessor, never anything internal/protected. This is
    // what makes detection classify a ROTATED frame by its corrected
    // shape, not its pre-rotation one.
    function currentTrack() {
      return videoTrack.getProcessor?.()?.processedTrack ?? videoTrack.mediaStreamTrack;
    }

    let detachResize = null;

    function readDims() {
      const settings = currentTrack()?.getSettings?.();
      if (settings?.width && settings?.height) {
        setDims({ width: settings.width, height: settings.height });
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
    videoTrack.on(TrackEvent.Restarted, handleRestarted);

    return () => {
      detachResize?.();
      videoTrack.off(TrackEvent.Restarted, handleRestarted);
    };
    // Keyed on trackSid + refreshKey, not the publication object itself
    // -- the same publication's underlying MediaStreamTrack can be
    // swapped many times (facingMode toggles) without trackSid ever
    // changing, and handleRestarted/the resize listener already handle
    // that case live; re-running this whole effect on every such swap
    // would be redundant. refreshKey is the deliberate exception --
    // see its own comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSid, refreshKey]);

  if (!dims) return null;
  return { ...dims, isPortraitSource: dims.height > dims.width };
}
