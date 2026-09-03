'use client';

// components/DndPrompt.jsx
// ─────────────────────────────────────────────────────────────
// The pre-show Do Not Disturb reminder, in Kit Check.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: (none)
//
// ── WHAT IT IS CAREFUL ABOUT ──────────────────────────────────
// It asks, and it records that it asked. It never says DND is on,
// because no web API can tell it that (see lib/dndPrompt.js). Once
// acknowledged it shrinks to one line rather than disappearing: the
// artist who has done this ten times does not need the explanation
// again, but a checklist item that vanishes is one nobody can check.
//
// ── COPY CONSTRAINT ───────────────────────────────────────────
// Nothing here may state what happens when the phone is interrupted
// mid-show, because that is measured on Android and unmeasured on iOS
// (docs/INTERRUPTION_FEASIBILITY.md). "A call interrupts your show" is
// safe — a call taking the audio session is what a call does on every
// platform. "Minimising is fine" is not, and does not appear.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { readDndAck, saveDndAck } from '../lib/dndPrompt';

const INK = '#011627';
const TEAL = '#2ec4b6';

export default function DndPrompt({ artistId }) {
  // undefined = not read yet, so the full card never flashes on screen
  // for an artist who acknowledged it months ago.
  const [ack, setAck] = useState(undefined);

  useEffect(() => {
    setAck(readDndAck(artistId));
  }, [artistId]);

  const acknowledge = useCallback(() => {
    saveDndAck(artistId);
    setAck(readDndAck(artistId) || { acknowledgedAt: Date.now() });
  }, [artistId]);

  if (ack === undefined) return null;

  if (ack) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 11.5, color: 'rgba(1,22,39,0.55)' }}>
        <span aria-hidden="true" style={{ color: TEAL, fontWeight: 700 }}>✓</span>
        <span>Do Not Disturb — your reminder to switch it on before you go live.</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Turn on Do Not Disturb</div>
      <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
        A phone call takes the microphone from whatever is using it, including your show.
        Switching on Do Not Disturb (or a Focus) before you go live is the one thing that
        stops that happening. <strong>We cannot see whether it is on</strong> — no app can —
        so this is a reminder, not a check.
      </div>
      <button
        type="button"
        onClick={acknowledge}
        style={{
          marginTop: 12,
          padding: '10px 16px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          background: TEAL,
          color: INK,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        DONE — DON'T SHOW THIS AGAIN
      </button>
    </div>
  );
}
