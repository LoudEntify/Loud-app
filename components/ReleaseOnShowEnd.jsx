'use client';

import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from '../lib/healthLog';

// WHEN THE SHOW ENDS, THIS DEVICE'S CAMERA LIGHT GOES OUT.
//
// ── THE BUG THIS EXISTS FOR ─────────────────────────────────────
// End Show released the devices on the client that PRESSED it. Every
// other participating device kept its camera light on: a paired phone
// propped on a stand, a QR-joined camera across the room, the second
// laptop. They were no longer being watched, but they were still
// filming — and the light is the only thing anyone actually trusts to
// tell them that.
//
// The reason was structural rather than an oversight. `/cam` and
// `/cam/pair` are their own pages with their own <LiveKitRoom>; they do
// not run the live show's component at all, so none of the show's
// end-of-show handling could ever have reached them. Nothing was
// listening. This is the piece that listens.
//
// ── STOPPING TRANSMISSION IS NOT STOPPING THE CAMERA ────────────
// The distinction the codebase already draws elsewhere, and the one that
// caused this: `unpublishTrack(track, false)` takes a track off air and
// leaves the MediaStreamTrack running — light still on. Only
// `track.stop()` releases the device. Both happen here, in that order,
// and then every local track is swept again in case something was
// acquired outside a publication.
//
// ── TWO TRIGGERS, BECAUSE ONE IS NOT ENOUGH ─────────────────────
//   SHOW_ENDED   the artist pressed End Show. The normal path.
//   Disconnected the room went away underneath us — token expiry, the
//                room being closed, the network giving up. A device that
//                is no longer in a room is definitively not filming for
//                one, so it releases then too.
//
// Deliberately NOT triggered by Reconnecting: a blip is not an ending,
// and releasing the camera on one would turn a two-second wobble into a
// dead camera for the rest of the show.

export default function ReleaseOnShowEnd({ onEnded, label = 'device' }) {
  const room = useRoomContext();
  // Idempotent by construction: SHOW_ENDED may be broadcast more than
  // once, and a disconnect can follow it. Releasing twice is harmless
  // but reporting it twice is noise in the one timeline someone reads
  // to check this worked.
  const releasedRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!room) return undefined;

    function release(reason) {
      if (releasedRef.current) return;
      releasedRef.current = true;

      let stopped = 0;
      try {
        room.localParticipant?.trackPublications?.forEach((pub) => {
          try {
            // Order matters: off air first, then the device. Unpublishing
            // with stop=true does both, but a failure partway through
            // should still leave the track stopped, so the explicit
            // stop() below is not redundant.
            if (pub.track) {
              room.localParticipant.unpublishTrack(pub.track, true);
              stopped += 1;
            }
          } catch {
            // one bad publication must not prevent the others being released
          }
        });
      } catch {
        // never let cleanup throw out of an end-of-show path
      }

      // Belt and braces: anything acquired outside a publication (a
      // preview stream, a track mid-publish) is still a live camera as
      // far as the light is concerned.
      try {
        room.localParticipant?.trackPublications?.forEach((pub) => {
          try { pub.track?.mediaStreamTrack?.stop?.(); } catch { /* already gone */ }
        });
      } catch {
        // same
      }

      logHealthEvent('local_devices_released', { reason, role: label, stopped });
      onEndedRef.current?.(reason);
    }

    function onData(payload) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (parsed?.type === 'SHOW_ENDED') release('show_ended');
      } catch {
        // Not our message, or not JSON. Every other data message on this
        // channel is somebody else's business.
      }
    }

    function onDisconnected() { release('room_disconnected'); }

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, label]);

  return null;
}
