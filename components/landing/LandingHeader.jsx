'use client';
// components/landing/LandingHeader.jsx — the landing's own header: logo,
// four links, Sign in and the Go Live pill. Below 1024px the links fold
// into a Menu button. The menu closes on Escape, on a click outside and on
// a link, and moves focus to its first link when opened from the keyboard.
import { useEffect, useRef, useState } from 'react';
import Logo from '../Logo';

export const NAV = [
  ['/about', 'About'],
  ['/artists', 'Artists'],
  ['/whats-on', 'Shows'],
];
export const SIGN_IN = '/login';
export const GO_LIVE = '/signup?trigger=perform&next=/artist/onboarding';

export default function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [byKeyboard, setByKeyboard] = useState(false);
  const wrap = useRef(null);
  const first = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    if (byKeyboard) first.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open, byKeyboard]);

  return (
    <header className="lm-header" data-testid="landing-header">
      <a href="/" className="lm-logo" aria-label="Loudentify home"><Logo surface="dark" height={36} /></a>
      <nav className="lm-nav" aria-label="Main">
        {NAV.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="lm-header-right" ref={wrap}>
        <a href={SIGN_IN} className="lm-signin">Sign in</a>
        <a href={GO_LIVE} className="lm-pill lm-pill-sm lm-pill-teal" data-testid="header-go-live">Go Live</a>
        <button
          ref={button}
          type="button"
          className="lm-menu-btn"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="lm-menu"
          onClick={(e) => { setByKeyboard(e.detail === 0); setOpen((o) => !o); }}
        >
          {open ? 'Close' : 'Menu'}
        </button>
        {open && (
          <nav id="lm-menu" className="lm-menu" aria-label="Menu" data-testid="landing-menu" onClick={(e) => { if (e.target.closest('a')) setOpen(false); }}>
            {NAV.map(([href, label], i) => <a key={href} href={href} ref={i === 0 ? first : undefined}>{label}</a>)}
            <a href={SIGN_IN}>Sign in</a>
            <a href={GO_LIVE} className="lm-pill lm-pill-teal">Go Live</a>
          </nav>
        )}
      </div>
    </header>
  );
}
