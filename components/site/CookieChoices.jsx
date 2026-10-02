'use client';
import { useEffect, useState } from 'react';
import { loadConsent, acceptAll, necessaryOnly, onConsentChange } from '../../lib/consent';

export default function CookieChoices() {
  const [c, setC] = useState(null);
  useEffect(() => { setC(loadConsent()); return onConsentChange(setC); }, []);
  if (!c) return null;
  return (
    <div className="w-card" data-testid="cookie-choices" style={{ maxWidth: 760 }}>
      <strong>Your choice right now: {c.decided ? (c.embed ? 'the player and analytics are allowed' : 'necessary only') : 'not yet made'}</strong>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="w-pill w-pill-ink" onClick={() => setC(acceptAll())}>Allow the player and analytics</button>
        <button className="w-pill w-pill-ghost" onClick={() => setC(necessaryOnly())}>Necessary only</button>
      </div>
    </div>
  );
}
