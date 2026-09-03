'use client';

// components/ResumeAffordance.jsx
// ─────────────────────────────────────────────────────────────
// What the artist sees when their own capture was interrupted, and the
// one control that puts it back.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Real-time media
//
// ── THE RULE THIS COMPONENT IS ─────────────────────────────────
// Resume automatically if the capability comes back by itself; offer a
// tap if it does not. That is a CAPABILITY test, not a platform test —
// on a platform that restores an interrupted audio session on its own,
// this never renders at all, and no code here has to know which
// platforms those are.
//
// It matters because an interrupted AudioContext generally cannot be
// resumed without a user gesture, and a page that quietly tries and
// fails leaves an artist looking at a live show that is publishing
// silence. Whether iOS needs the gesture is unmeasured
// (docs/INTERRUPTION_FEASIBILITY.md); designing for both costs one
// button and removes the dependency on the answer.
//
// ── WHAT THE COPY MAY AND MAY NOT SAY ─────────────────────────
// May: what happened, in the past tense, as a capability. "Your audio
// was interrupted."
//
// May not: a cause the platform never reported ("you took a call"), or
// any promise about what minimising does next time. The second is the
// one that would be tempting to add here — a reassuring line about
// staying live in the background — and it is unmeasured on the device
// this product is now designed for. Nothing on this card refers to
// minimising at all.
// ─────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import { describeInterruption } from '../lib/interruptionState';
import { logHealthEvent } from '../lib/healthLog';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

export default function ResumeAffordance({ state, needsGesture, onResume }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const resume = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    logHealthEvent('interruption_resume_tapped', { state });
    try {
      const ok = await onResume?.();
      // A refusal is reported rather than retried in a loop. The browser
      // saying no to a resume is a decision, not a transient, and the
      // artist tapping again is the only thing that changes it.
      if (ok === false) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [onResume, state]);

  if (!needsGesture) return null;

  return (
    <div
      // Centre of the stage, above everything. This is the one moment
      // where the artist's own console should stop being a monitor and
      // start being a control: they are publishing nothing, and every
      // second spent looking for the fix is a second of dead air.
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 60,
        background: 'rgba(1, 22, 39, 0.92)',
        border: `1px solid ${TEAL}`,
        borderRadius: 14,
        padding: 20,
        maxWidth: 320,
        textAlign: 'center',
        color: PORCELAIN,
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
        {describeInterruption(state) || 'Your capture was interrupted.'}
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.7)', marginTop: 8, lineHeight: 1.5 }}>
        Your audience is seeing a held frame. Tap to go back on.
      </div>
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        style={{
          marginTop: 14,
          width: '100%',
          padding: '14px 18px',
          borderRadius: 10,
          border: 'none',
          background: TEAL,
          color: INK,
          fontWeight: 700,
          fontSize: 15,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'RESUMING…' : 'RESUME'}
      </button>
      {failed && (
        <div style={{ fontSize: 12, color: '#ffb3bd', marginTop: 10, lineHeight: 1.5 }}>
          That did not take. Tap again — if it keeps refusing, leave and rejoin the show.
        </div>
      )}
    </div>
  );
}
