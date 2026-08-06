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
export function useSourceDimensions(publication) {
  const [dims, setDims] = useState(null);
  const trackSid = publication?.trackSid;

  useEffect(() => {
    const videoTrack = publication?.videoTrack;
    if (!videoTrack) {
      setDims(null);
      return undefined;
    }

    let detachResize = null;

    function readDims() {
      const settings = videoTrack.mediaStreamTrack?.getSettings?.();
      if (settings?.width && settings?.height) {
        setDims({ width: settings.width, height: settings.height });
      }
    }

    function attachResize() {
      const mst = videoTrack.mediaStreamTrack;
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
    // Keyed on trackSid, not the publication object itself -- the same
    // publication's underlying MediaStreamTrack can be swapped many
    // times (facingMode toggles) without trackSid ever changing, and
    // handleRestarted/the resize listener already handle that case
    // live; re-running this whole effect on every such swap would be
    // redundant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSid]);

  if (!dims) return null;
  return { ...dims, isPortraitSource: dims.height > dims.width };
}
