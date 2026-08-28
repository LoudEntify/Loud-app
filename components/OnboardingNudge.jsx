'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSession, getProfile } from '../lib/supabaseAuth';
import { hasUnfinishedOnboarding, loadOnboarding } from '../lib/onboarding';

const TEAL = '#2ec4b6';

// The resume prompt, and the entire reason onboarding can afford to be
// skippable.
//
// A slim bar. Not a modal, not a card that pushes the page down, not a
// pulsing badge. It sits above the page content, states what is left in
// one sentence, offers one action and a dismiss, and then gets out of the
// way — because the person is on this page to do something else, and that
// something else is more important than our setup checklist.
//
// Dismiss lasts the browser session. Not forever (they may genuinely
// have meant "not now"), and not one page load (that would make it a
// nag). Someone who never wants to see it again has a better option
// available to them: skip the remaining steps, which is an answer we
// record and stop asking about.
//
// NOT SHOWN on live surfaces — PageShell only mounts this when
// liveOverlay is false. A setup reminder over someone's performance is
// indefensible.

const DISMISS_KEY = 'loudentify.onboardingNudge.dismissed';

export default function OnboardingNudge() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage.getItem(DISMISS_KEY)) return;
        const s = await getSession();
        if (cancelled || !s?.user) return;
        const { profile } = await getProfile(s.user.id);
        if (cancelled) return;
        const state = await loadOnboarding(s.user.id, profile?.role);
        if (cancelled) return;
        setRole(profile?.role || 'viewer');
        setShow(hasUnfinishedOnboarding(state, profile?.role));
      } catch {
        // A nudge that fails to load is a nudge nobody sees. Correct.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Never on the walkthrough itself — telling someone to go and do the
  // thing they are currently doing.
  if (!show || pathname === '/welcome') return null;

  function dismiss() {
    try { window.sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* fine */ }
    setShow(false);
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '9px 16px', borderBottom: '1px solid rgba(46,196,182,0.25)',
        background: 'rgba(46,196,182,0.07)',
      }}
    >
      <span style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.7)', flex: 1, minWidth: 200 }}>
        {role === 'artist'
          ? 'Your artist account still has a couple of setup steps — a photo, and a date for your first show.'
          : 'Pick a few genres and follow some artists, and Discover starts working for you.'}
      </span>
      <Link
        href="/welcome"
        style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: TEAL, textDecoration: 'none', border: `1px solid ${TEAL}`, padding: '7px 12px' }}
      >
        FINISH SETUP
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="dismiss"
        style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '7px 6px' }}
      >
        NOT NOW
      </button>
    </div>
  );
}
