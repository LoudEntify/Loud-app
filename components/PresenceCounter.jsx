'use client';

import { useParticipants } from '@livekit/components-react';
import { ParticipantKind } from 'livekit-client';

// Post-Stage-5 fix (MULTI_PERFORMER_SPEC.md) -- live performer/viewer
// counts. useParticipants() already subscribes to LiveKit's own
// participant connect/disconnect/attribute events -- no polling, no DB
// read, purely derived from the same live room state everything else
// in this app already trusts.
//
// Performer count: distinct slots among contestant-{slot}- identities,
// same rule as LiveDemo.jsx's presentSlots.
// Excluded from BOTH counts: camfeed-* devices (extra cameras, not
// people -- same reasoning presentSlots already uses to keep them out
// of the performer count) and the egress participant. Egress exclusion
// checks LiveKit's own documented ParticipantKind.EGRESS (confirmed
// against the livekit-client source, not assumed from an identity
// prefix) -- Room Composite Egress joins as a real, if hidden,
// participant, and would otherwise inflate the viewer count by exactly
// one during every recording, which is the one time this number most
// needs to be right.
export default function PresenceCounter() {
  const participants = useParticipants();

  const performerSlots = new Set();
  let viewerCount = 0;

  participants.forEach((p) => {
    if (p.kind === ParticipantKind.EGRESS) return;
    if (p.identity.startsWith('contestant-')) {
      const slot = p.identity.split('-')[1];
      if (slot) performerSlots.add(slot);
      return;
    }
    if (p.identity.startsWith('camfeed-')) return;
    viewerCount += 1;
  });

  return (
    <div className="presence-counter">
      <span className="presence-performers">{performerSlots.size} performer{performerSlots.size === 1 ? '' : 's'}</span>
      {' · '}
      <span className="presence-viewers">{viewerCount} viewer{viewerCount === 1 ? '' : 's'}</span>
    </div>
  );
}
