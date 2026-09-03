'use client';

// components/AwayReturnNotice.jsx
// ─────────────────────────────────────────────────────────────
// What the artist is told after being away from the screen: their camera
// paused, their microphone did not, and for how long.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Real-time media
//
// ── WHY IT IS A NOTICE AND NOT A CONTROL ──────────────────────
// Nothing here is actionable, and it deliberately does not pretend to
// be. The merged state resolves itself the moment the artist comes
// back — the camera unmutes on its own — so there is nothing to fix and
// no button to offer. It reports; ResumeAffordance acts. That is why
// this sits at the TOP of the console and the resume card sits in the
// centre: the centre of the stage is reserved for the one thing that
// stops the show, and an informational card living there would train
// the artist to dismiss the position rather than read it.
//
// ── THE THIRD LINE EARNED ITS PLACE ───────────────────────────
// The duration was argued against for being more to read, and argued
// back in for answering the only question an artist actually has on
// return: how bad was that. Four seconds and two minutes are different
// situations, and the difference decides whether they carry on or say
// something to the room.
//
// ── WHAT IS NOT HERE ──────────────────────────────────────────
// Anything about what the audience saw. The probe measured the phone,
// not delivery. The app knows what it does with a held frame; it does
// not know what arrived, and a line claiming otherwise would be a claim
// nobody can stand behind.
//
// Every string comes from describeAwayReturn in lib/interruptionState.js,
// which owns all artist-facing wording.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { describeAwayReturn, AWAY_NOTICE_MIN_MS } from '../lib/interruptionState';
import { logHealthEvent } from '../lib/healthLog';

const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Long enough to read three short lines twice, short enough that it is
// gone before it becomes furniture.
const AUTO_DISMISS_MS = 10000;

export default function AwayReturnNotice({ episode }) {
  // Keyed on the episode's return timestamp: a NEW absence must be able
  // to re-open a notice the artist has already dismissed, and two
  // absences of the same length are still two absences.
  const [dismissedFor, setDismissedFor] = useState(null);

  const returnedAt = episode?.returnedAt ?? null;
  const awayForMs = episode?.awayForMs ?? 0;
  // Below the threshold nothing is shown at all: a glance at a
  // notification is not an absence worth reporting, and a card that
  // appears every time the artist checks the time is a card they learn
  // to ignore before the one that matters arrives.
  const visible = !!returnedAt && awayForMs >= AWAY_NOTICE_MIN_MS && dismissedFor !== returnedAt;

  useEffect(() => {
    if (!visible) return undefined;
    logHealthEvent('away_return_notice_shown', { awayForMs });
    const timer = setTimeout(() => setDismissedFor(returnedAt), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, returnedAt, awayForMs]);

  if (!visible) return null;

  const lines = describeAwayReturn(awayForMs);

  return (
    <div
      // Top of the console, under the topbar. Tapping anywhere on it
      // clears it — no button, because a button label is one more thing
      // to read and the whole card is already a tap target.
      role="status"
      onClick={() => setDismissedFor(returnedAt)}
      style={{
        position: 'absolute',
        top: 56,
        left: 12,
        right: 12,
        zIndex: 55,
        margin: '0 auto',
        maxWidth: 360,
        background: 'rgba(1, 22, 39, 0.92)',
        border: `1px solid ${TEAL}`,
        borderRadius: 12,
        padding: '12px 14px',
        color: PORCELAIN,
        boxShadow: '0 14px 40px rgba(0,0,0,0.4)',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>{lines.camera}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.45, marginTop: 2 }}>{lines.microphone}</div>
      <div style={{ fontSize: 11.5, color: 'rgba(253,255,252,0.6)', marginTop: 6 }}>{lines.duration}</div>
    </div>
  );
}
