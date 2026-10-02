'use client';
// components/viewer/CookieBanner.jsx — PRD row 106 (UK PECR). Shown until a
// choice is made; the YouTube embed and journey analytics are off until
// then. Necessary cookies (sign-in, the show state) are always on.
import { useEffect, useState } from 'react';
import { loadConsent, acceptAll, necessaryOnly, onConsentChange } from '../../lib/consent';

export default function CookieBanner() {
  const [consent, setConsent] = useState(null);
  useEffect(() => {
    setConsent(loadConsent());
    return onConsentChange(setConsent);
  }, []);
  if (!consent || consent.decided) return null;
  return (
    <div className="v-cookie v-root" role="dialog" aria-labelledby="cookie-title" data-testid="cookie-banner">
      <span id="cookie-title" style={{ fontSize: 19, fontWeight: 700 }}>Cookies, plainly</span>
      <span style={{ fontSize: 15, lineHeight: 1.35, color: 'var(--muted-on-light)' }}>
        Watching uses a YouTube player, which sets YouTube's cookies. We also keep pseudonymous notes on how the app is used, never your name or messages.
        Signing in needs a cookie either way. <a href="/privacy" className="v-link" style={{ padding: 0 }}>Privacy</a>
      </span>
      <span className="v-row" style={{ flexWrap: 'wrap' }}>
        <button className="v-btn v-btn-ink" onClick={() => setConsent(acceptAll())}>Allow the player and analytics</button>
        <button className="v-btn v-btn-ghost-light" onClick={() => setConsent(necessaryOnly())}>Necessary only</button>
      </span>
    </div>
  );
}
