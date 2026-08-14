'use client';

import { useParticipants } from '@livekit/components-react';
import { ParticipantKind } from 'livekit-client';

// Post-Stage-5 fix (MULTI_PERFORMER_SPEC.md) -- live performer/viewer
// counts. useParticipants() already subscribes to LiveKit's own
// participant connect/disconnect/attribute events -- no polling, no DB
// read, purely derived from the same live room state everything else
// in this app already trusts.
//
// Performer count is `presentSlots.length`, passed down from the
// caller (LiveDemo.jsx's own presentSlots) rather than re-derived here
// from raw participant identities -- deliberately, so this can never
// drift from the same definition the spotlight layout/switcher use.
// presentSlots requires an actual PUBLISHED CAMERA TRACK (useTracks),
// a stricter bar than merely being connected (useParticipants) -- a
// performer who's claimed a slot but hasn't started publishing yet is
// correctly excluded from BOTH counts here, not miscounted as a
// viewer, until their camera actually comes up.
//
// Viewer count: every remaining participant, excluding camfeed-*
// devices (equipment, not people), any contestant-* identity (already
// counted via presentSlots -- or deliberately uncounted while they're
// still connecting, per the above), and the egress participant.
// Egress exclusion checks LiveKit's own documented
// ParticipantKind.EGRESS (confirmed against the livekit-client source,
// not assumed from an identity prefix) -- Room Composite Egress joins
// as a real, if hidden, participant, and would otherwise inflate the
// viewer count by exactly one during every recording, which is the one
// time this number most needs to be right.
export default function PresenceCounter({ presentSlots }) {
  const participants = useParticipants();
  const performerCount = presentSlots?.length ?? 0;

  let viewerCount = 0;
  participants.forEach((p) => {
    if (p.kind === ParticipantKind.EGRESS) return;
    if (p.identity.startsWith('contestant-')) return;
    if (p.identity.startsWith('camfeed-')) return;
    viewerCount += 1;
  });

  return (
    <div className="presence-counter">
      <span className="presence-performers">{performerCount} performer{performerCount === 1 ? '' : 's'}</span>
      {' · '}
      <span className="presence-viewers">{viewerCount} viewer{viewerCount === 1 ? '' : 's'}</span>
    </div>
  );
}
