'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../lib/supabaseClient';
import { nextUpcomingShow } from '../lib/scheduling';
import { countdownParts } from '../lib/showWindow';
import { getSavedEntry, saveEntry } from '../lib/viewerIdentity';
import ViewerEntryForm from './ViewerEntryForm';
import PreshowAudio from './PreshowAudio';
import Logo from './Logo';

// components/HomeDoors.jsx
// ─────────────────────────────────────────────────────────────
// The front door. Two ways in, and they are not the same kind of thing.
//
// PRD: Live Show / Audience, Accounts & Identity
//
// ── WHY THE VIEWER DOOR IS NOT A LOGIN ────────────────────────
// The audience has no account and will not make one. They give a name,
// an email if they feel like it, and confirm they are 18 — and that is
// the whole of their identity on this platform. Putting a password in
// front of a live show loses most of the room, which is the one thing
// the pilot cannot afford to do, since the audience IS the measurement.
//
// The artist door is a real login because an artist is operating
// equipment, and because their accounts are created by hand for both
// pilots (see SELF_SIGNUP_ENABLED in components/Auth.jsx).
//
// ── /live's ENTRY FORM STAYS ──────────────────────────────────
// This page is an ADDITION, not a replacement. Anyone arriving on a
// direct show link — a shared URL, a QR code, a bookmark — still meets
// the same form on the holding screen and still registers. Both render
// the SAME component and write the SAME localStorage keys, so a viewer
// who registers here is not asked again there.
//
// That was deliberate sequencing: item 4's entry gate is the one flow
// the pilot's evidence base depends on, it was device-tested green, and
// four days from the show is not when to put it back into untested
// territory.
//
// ── THE LOGO ──────────────────────────────────────────────────
// Static, and the block below is sized so the animated version drops in
// without the layout moving. That work is a separate branch and must
// never be what holds this page up.
// ─────────────────────────────────────────────────────────────

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

function CountdownDisplay({ ms }) {
  const p = countdownParts(ms);
  const cell = (value, label) => (
    <div key={label} style={{ textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {String(value).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', opacity: 0.55 }}>{label}</div>
    </div>
  );
  // Which units are shown changes as it approaches, so the countdown
  // reads as a different thing a week out than it does in the last
  // minute. A fixed MM:SS would render "4320:00" three days before.
  const cells =
    p.scale === 'days'
      ? [cell(p.days, 'DAYS'), cell(p.hours, 'HOURS'), cell(p.minutes, 'MINS')]
      : p.scale === 'hours'
        ? [cell(p.hours, 'HOURS'), cell(p.minutes, 'MINS'), cell(p.seconds, 'SECS')]
        : p.scale === 'minutes'
          ? [cell(p.minutes, 'MINS'), cell(p.seconds, 'SECS')]
          : [cell(p.seconds, 'SECS')];
  return <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>{cells}</div>;
}

export default function HomeDoors() {
  const router = useRouter();
  const [door, setDoor] = useState(null); // null | 'viewer'
  const [show, setShow] = useState(undefined); // undefined = loading
  const [entry, setEntry] = useState(() => (typeof window === 'undefined' ? null : getSavedEntry()));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The next show, read with the anon client under the existing
  // read_shows policy -- the same way /live reads a show for a viewer
  // who has no account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabase().from('shows').select('*');
        if (cancelled) return;
        setShow(error ? null : nextUpcomingShow(data || []));
      } catch {
        if (!cancelled) setShow(null);
      }
    })();
  }, []);

  const slated = show?.slated_at ? new Date(show.slated_at).getTime() : null;
  const msToShowtime = slated === null ? null : slated - now;

  // At showtime, in they go. /live runs its own window logic from here,
  // so this hands over rather than deciding anything about the room.
  useEffect(() => {
    if (!show?.id || msToShowtime === null) return;
    if (msToShowtime > 0) return;
    if (!entry) return; // never carry someone in who has not registered
    router.push(`/live?show=${encodeURIComponent(show.id)}`);
  }, [show?.id, msToShowtime, entry, router]);

  const onRegister = useCallback((values) => {
    saveEntry(values);   // the same keys /live reads, so it will not ask again
    setEntry(values);
  }, []);

  const wrap = {
    minHeight: '100dvh', background: INK, color: PORCELAIN,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 20, textAlign: 'center', boxSizing: 'border-box',
  };

  // Reserved, fixed height. The animated logo replaces the contents of
  // this block and the page does not reflow when it lands.
  const logo = (
    <div style={{ height: 72, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
      <Logo surface="dark" height={60} />
      <div style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.5 }}>LIVE MUSIC PLATFORM</div>
    </div>
  );

  const doorButton = (label, sub, onClick, primary) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', maxWidth: 340, padding: '16px 18px', borderRadius: 12, cursor: 'pointer',
        background: primary ? PORCELAIN : 'transparent',
        color: primary ? INK : PORCELAIN,
        border: primary ? 'none' : '1px solid rgba(253,255,252,0.3)',
        font: 'inherit', textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: 11, opacity: primary ? 0.6 : 0.55, marginTop: 3 }}>{sub}</div>
    </button>
  );

  // ── REGISTERED: the countdown ───────────────────────────────
  if (entry && show) {
    return (
      <main style={wrap}>
        {logo}
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          You&rsquo;re in, {entry.displayName}. {show.artist_name || 'The show'} starts
        </div>
        {msToShowtime > 0 ? (
          <>
            <CountdownDisplay ms={msToShowtime} />
            <div style={{ fontSize: 11, opacity: 0.5 }}>
              {new Date(slated).toLocaleString([], {
                weekday: 'short', hour: 'numeric', minute: '2-digit',
              })}
              {' · this page will take you in automatically'}
            </div>
            <PreshowAudio msToShowtime={msToShowtime} />
          </>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: TEAL }}>Taking you in…</div>
        )}
      </main>
    );
  }

  // ── THE TWO DOORS ───────────────────────────────────────────
  return (
    <main style={wrap}>
      {logo}

      {door !== 'viewer' && (
        <>
          <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 320 }}>
            {show === undefined
              ? 'Finding the next show…'
              : show
                ? `${show.artist_name || 'A show'} — ${new Date(show.slated_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
                : 'No show is scheduled right now.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', alignItems: 'center' }}>
            {doorButton('Join as viewer', 'Watch the show. No account needed.', () => setDoor('viewer'), true)}
            {doorButton('Join as artist', 'Log in to your dashboard and Kit Check.', () => router.push('/auth'), false)}
          </div>
        </>
      )}

      {door === 'viewer' && (
        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <ViewerEntryForm onSubmit={onRegister} submitLabel="Save my place" />
          <button
            type="button"
            onClick={() => setDoor(null)}
            style={{ background: 'none', border: 'none', color: PORCELAIN, opacity: 0.5, cursor: 'pointer', font: 'inherit', fontSize: 11 }}
          >
            Back
          </button>
        </div>
      )}
    </main>
  );
}
