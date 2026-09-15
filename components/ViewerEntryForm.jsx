'use client';

import { useState } from 'react';

// components/ViewerEntryForm.jsx
// ─────────────────────────────────────────────────────────────
// Item 11f. THE one definition, used by BOTH doors.
//
// PRD: Live Show / Audience · S&I: Auth, Database
//
// ── WHY IT IS ITS OWN FILE ────────────────────────────────────
// It lived inside LiveDemo.jsx, on the holding screen. The homepage
// needs the same form, and the /live copy stays as a working fallback
// for anyone arriving on a direct show link -- so there are two callers
// and exactly one definition.
//
// A copy would have been faster and wrong. These two forms must collect
// the same fields, write the same localStorage keys, and show the same
// data notice, because they produce rows in the same table that the
// 21st reads as one dataset. Two copies drift the first time one is
// edited, and the drift is invisible until the analysis.
//
// On the holding screen, above the countdown, so it is filled in while
// the viewer is already waiting rather than as a gate in front of a show
// that has started.
//
// ── WHY THE EMAIL LABEL IS PART OF THE DESIGN ─────────────────
// A bare email field on a join screen suppresses entry and reads as
// harvesting. The sentence next to it is the difference between asking
// and taking, and it is why the field is allowed to exist at all.
//
// ── WHY THE FORM DOES NOT BLOCK THE SHOW ──────────────────────
// 18+ is required and blocks the button; name is required and blocks the
// button. But the WRITE that follows is fire-and-forget: if the network
// eats it, the viewer still watches. pilot2_02 makes display_name and
// age_confirmed_at nullable for exactly this reason -- a rejected insert
// would cost the whole session rather than one field, and "a missing
// name should cost a name".
export default function ViewerEntryForm({ onSubmit, submitLabel = 'Enter the show' }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [over18, setOver18] = useState(false);
  const canEnter = displayName.trim().length > 0 && over18;
  const field = {
    width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 15,
    border: '1px solid rgba(253,255,252,0.25)', background: 'rgba(253,255,252,0.06)',
    color: '#fdfffc', boxSizing: 'border-box',
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canEnter) return;
        onSubmit({
          displayName: displayName.trim(),
          email: email.trim() || null,
          ageConfirmedAt: new Date().toISOString(),
        });
      }}
      style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}
    >
      <label style={{ fontSize: 13, opacity: 0.8 }}>
        Your name
        <input
          style={{ ...field, marginTop: 4 }}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={120}
          autoComplete="nickname"
          placeholder="What should we call you?"
        />
      </label>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: -6 }}>This is what appears next to your messages.</div>

      <label style={{ fontSize: 13, opacity: 0.8 }}>
        Email
        <input
          style={{ ...field, marginTop: 4 }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          autoComplete="email"
        />
      </label>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: -6 }}>
        Optional — if you&rsquo;d like to hear about future shows.
      </div>

      <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start', opacity: 0.9 }}>
        <input
          type="checkbox"
          checked={over18}
          onChange={(e) => setOver18(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>I am 18 or over</span>
      </label>

      {/* Above the button and not behind a link, deliberately: a notice
          someone has to go looking for is a notice nobody read. */}
      <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.45 }}>
        We keep your messages and answers so we can improve the platform. Your name and email are
        only used for this show and, if you opt in, to tell you about future ones. Ask us any time
        and we&rsquo;ll delete them.
      </div>

      <button
        type="submit"
        disabled={!canEnter}
        style={{
          padding: '11px 14px', borderRadius: 8, fontSize: 15, fontWeight: 700, border: 'none',
          background: canEnter ? '#fdfffc' : 'rgba(253,255,252,0.18)',
          color: canEnter ? '#011627' : 'rgba(253,255,252,0.5)',
          cursor: canEnter ? 'pointer' : 'not-allowed',
        }}
      >
        {submitLabel}
      </button>
    </form>
  );
}
