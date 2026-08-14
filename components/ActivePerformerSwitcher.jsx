'use client';

import { VideoTrack } from '@livekit/components-react';

// Stage 4 of MULTI_PERFORMER_SPEC.md. Visual pattern mirrors
// VideoDeckPanel.jsx's clickable-live-thumbnail row exactly -- same
// idea (tap a small live preview to make it active), extended across
// performer SLOTS instead of camera angles within one slot.
//
// Rendered only for role 'a' (BroadcastStage decides that, not this
// component) -- but that's a UI convenience, not the security
// boundary. The actual authorization lives entirely in
// app/api/show/active-performer, checked against a session token every
// call regardless of what this component shows or hides -- "hiding the
// button isn't the security model" (MULTI_PERFORMER_SPEC.md section 5).
export default function ActivePerformerSwitcher({ slots, tracksForSlot, activePerformerSlot, onSwitch, switching }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#888780' }}>Tap a performer to make them the active feed.</p>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {slots.map((slot) => {
          const track = tracksForSlot(slot)[0];
          const isActive = activePerformerSlot === slot;
          return (
            <button
              key={slot}
              onClick={() => onSwitch(slot)}
              disabled={switching || isActive}
              className={isActive ? 'btn-active' : ''}
              style={{
                width: 96,
                height: 72,
                borderRadius: 8,
                overflow: 'hidden',
                padding: 0,
                background: '#2C2C2A',
                position: 'relative',
                flexShrink: 0,
                opacity: switching ? 0.6 : 1,
              }}
            >
              {track ? (
                <VideoTrack trackRef={track} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888780', fontSize: 11 }}>
                  Performer {slot.toUpperCase()}
                </div>
              )}
              <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 10, color: '#fdfffc', textShadow: '0 0 4px #000' }}>
                {slot.toUpperCase()}{isActive ? ' • LIVE' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
