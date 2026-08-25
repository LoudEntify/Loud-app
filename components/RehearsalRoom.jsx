'use client';

import { useEffect, useMemo, useState } from 'react';
import { LiveKitRoom, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const ORANGE = '#ff9f1c';
const TEAL = '#2ec4b6';

// The composed multi-camera view, for rehearsal only.
//
// ⚠️ This is the ONE place Kit Check connects to LiveKit, and it is
// deliberately loud about it. Everywhere else in Kit Check is genuinely
// local; this is a scoped, documented exception (DECISIONS.md), so the
// UI states plainly that the artist is now connected and how long the
// session has left. The failure mode this guards against is an artist
// believing they are in the free local mode while a room quietly bills.
//
// Now sized for a RIG rather than a pair: the grid grows with the number
// of live cameras instead of assuming one paired phone, and every tile is
// labelled with the camera role parsed out of the participant identity —
// which is the same string the live show's director console parses, so
// what the artist sees here is exactly what the console will offer them
// on stage.

// `camfeed-{slot}-{role}-{id}` — the format is set in lib/camfeedPairing.js
// and read by components/LiveDemo.jsx. Parsed in one place here so the
// label and the reported role can never disagree.
function roleOf(identity) {
  if (typeof identity !== 'string' || !identity.startsWith('camfeed-')) return null;
  return identity.split('-')[2] || null;
}

function Tiles({ onConnectedRoles }) {
  const tracks = useTracks([Track.Source.Camera]);

  const roles = useMemo(
    () => tracks.map((t) => roleOf(t.participant.identity)).filter(Boolean),
    [tracks]
  );

  // Reported upward so the pairing panel can flip a card from WAITING to
  // LIVE. Keyed on the joined string so a re-render with the same set of
  // cameras doesn't churn the parent's state.
  const rolesKey = roles.join(',');
  useEffect(() => {
    onConnectedRoles?.(rolesKey ? rolesKey.split(',') : []);
  }, [rolesKey, onConnectedRoles]);

  if (tracks.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: 'rgba(253,255,252,0.5)', fontSize: 12 }}>
        Waiting for cameras…
      </div>
    );
  }

  // One camera reads as a preview, two as a comparison, three or more as
  // a rig. Columns follow that rather than being fixed at two.
  const columns = tracks.length === 1 ? 1 : tracks.length <= 4 ? 2 : 3;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 6 }}>
      {tracks.map((t) => {
        const role = roleOf(t.participant.identity);
        return (
          <div key={`${t.participant.identity}:${t.publication?.trackSid}`} style={{ position: 'relative', aspectRatio: '9 / 16', background: INK, overflow: 'hidden' }}>
            <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 8.5, letterSpacing: '0.06em', color: PORCELAIN, background: 'rgba(1,22,39,0.6)', padding: '2px 6px', borderRadius: 3 }}>
              {role ? role.toUpperCase() : t.participant.identity.startsWith('camfeed-') ? 'PAIRED CAMERA' : 'YOUR CAMERA'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function RehearsalRoom({ session, onEnd, onConnectedRoles }) {
  const [secondsLeft, setSecondsLeft] = useState(session.sessionSeconds ?? 20 * 60);

  // Hard stop. The token's own TTL is the real backstop -- this is the
  // visible one, so the artist is never surprised by a disconnect.
  useEffect(() => {
    if (secondsLeft <= 0) { onEnd(); return undefined; }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, onEnd]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, letterSpacing: '0.06em', color: ORANGE, border: `1px solid ${ORANGE}`, borderRadius: 999, padding: '5px 12px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE }} />
          REHEARSAL ROOM — CONNECTED · {mins}:{secs} LEFT
        </span>
        <button
          type="button"
          onClick={onEnd}
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)', padding: '7px 12px', cursor: 'pointer' }}
        >
          END REHEARSAL
        </button>
      </div>

      <LiveKitRoom
        token={session.token}
        serverUrl={session.url}
        connect
        audio={false}
        // The artist's camera IS published here, on purpose: a composed
        // view with only the paired phones in it is not a composition.
        // Kit Check releases its own local camera before this mounts --
        // two owners of one device is how you get a black tile.
        video
        style={{ background: INK, padding: 6 }}
      >
        <Tiles onConnectedRoles={onConnectedRoles} />
      </LiveKitRoom>

      <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.5)', marginTop: 8, lineHeight: 1.5 }}>
        Every camera you pair here <strong style={{ color: TEAL }}>comes with you</strong> when the show starts —
        the phones move to the show room on their own, still propped exactly where you left them.
      </div>
    </div>
  );
}
