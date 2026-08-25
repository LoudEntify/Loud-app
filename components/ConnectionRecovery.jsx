'use client';

import { useEffect, useState } from 'react';

const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';
const PORCELAIN = '#fdfffc';

// The resume ladder's top rung — the bit a person actually sees.
//
// Three states, and the difference between them is who is doing the work:
//
//   RECONNECTING  LiveKit is retrying on its own. Say so, offer nothing,
//                 and get out of the way. A button here would be an
//                 invitation to interrupt a recovery that is already
//                 happening — and a manual reconnect during an automatic
//                 one is how you turn a two-second blip into a
//                 twenty-second one.
//
//   STILL TRYING  The automatic retry has been going long enough that it
//                 probably is not going to work. NOW offer the manual
//                 path, beside the automatic one rather than instead of
//                 it.
//
//   DISCONNECTED  It gave up. The offer is the only thing on screen that
//                 matters.
//
// ── WHAT RESUME DOES NOT DO ──
// It does not ask for a password, and it cannot. The Supabase session is
// already in this tab and `join-show` rebinds the slot by account, so
// resuming is one API call with a credential the browser already holds.
// A performer who drops mid-song and is met with a login form has lost
// the show; that is the failure this whole ladder exists to make
// impossible.

// How long the automatic retry gets before the manual offer appears
// alongside it. Long enough that an ordinary network blip resolves
// without anyone being offered a button; short enough that a genuinely
// stuck connection is not left sitting there.
const OFFER_AFTER_MS = 6000;

export default function ConnectionRecovery({ state, onResume, busy = false, isPerformer = false }) {
  const [offerManual, setOfferManual] = useState(false);

  useEffect(() => {
    if (state !== 'reconnecting') { setOfferManual(false); return undefined; }
    const t = setTimeout(() => setOfferManual(true), OFFER_AFTER_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state !== 'reconnecting' && state !== 'disconnected') return null;

  const disconnected = state === 'disconnected';
  const colour = disconnected ? RED : ORANGE;
  const showButton = disconnected || offerManual;

  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 8,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 'calc(100% - 24px)',
          background: 'rgba(1,22,39,0.62)',
          border: `1px solid ${colour}`,
          borderRadius: 999,
          padding: '7px 14px',
          // Re-enabled on the pill only, so the surrounding strip stays
          // click-through to the video underneath.
          pointerEvents: 'auto',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: PORCELAIN, textShadow: 'var(--text-halo)' }}>
          {disconnected
            ? isPerformer
              ? 'You are off air. Your slot is still yours.'
              : 'Connection lost.'
            : offerManual
              ? 'Still trying to reconnect…'
              : 'Reconnecting…'}
        </span>

        {showButton && (
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#011627',
              background: TEAL,
              border: 'none',
              borderRadius: 999,
              padding: '6px 12px',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {busy ? 'RESUMING…' : disconnected && isPerformer ? 'GET BACK ON' : 'RESUME'}
          </button>
        )}
      </div>
    </div>
  );
}
