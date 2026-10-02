'use client';
// The share page's countdown and "Watch" button (design/WebShowPage).
// Server renders the slated time; this ticks every second and switches
// to the live state without a reload once the show starts.
import { useEffect, useState } from 'react';
import { track } from '../../lib/telemetry';

function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function Countdown({ showId, slatedAt, state }) {
  const [now, setNow] = useState(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const remaining = now == null ? null : Date.parse(slatedAt) - now;
  const live = state === 'live' || (remaining != null && remaining <= 0 && state !== 'ended' && state !== 'cancelled');
  const ended = state === 'ended' || state === 'cancelled';
  return (
    <div className="w-count" data-testid="countdown" data-state={ended ? state : live ? 'live' : 'upcoming'}>
      {ended ? (<><span className="w-eyebrow">{state === 'cancelled' ? 'CANCELLED' : 'THIS SHOW HAS ENDED'}</span><span style={{ fontSize: 18 }}>{state === 'cancelled' ? 'The artist called this one off.' : 'The recording appears here once the artist publishes it.'}</span></>)
        : live ? (<><span className="w-eyebrow">LIVE NOW</span><span className="w-timer" style={{ fontSize: 40 }}>On stage</span></>)
          : (<><span className="w-eyebrow">STARTS IN</span><span className="w-timer" suppressHydrationWarning>{remaining == null ? '--:--:--' : parts(remaining)}</span></>)}
      {!ended && <a href={`/show/${showId}`} className="w-pill w-pill-lg w-pill-ink" onClick={() => track('share_page.watch', { live }, { showId })} data-testid="watch-cta">{live ? 'Watch now, free' : 'Watch free in your browser'}</a>}
      {!ended && !live && <a href={`/s/${showId}/calendar.ics`} className="w-pill w-pill-lg w-pill-white" download>Add to calendar</a>}
      <span className="w-note">Watching is free. Sign up to comment, vote and support.</span>
    </div>
  );
}
