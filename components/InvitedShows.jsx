'use client';

// components/InvitedShows.jsx
// ─────────────────────────────────────────────────────────────
// The shows an artist is in but did not create — pending invitations
// and accepted bookings.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Database, Auth
//
// ── THE HOLE THIS CLOSES ──────────────────────────────────────
// Every "my shows" query in this app is `shows.artist_id = me`, the
// OWNER column. That was right while a show had one artist, and Versus
// broke it without anything appearing to break: an artist who accepts an
// invite has a slot, will publish a camera and will perform — and the
// show is invisible to them everywhere. Not in their diary, not on their
// profile.
//
// It existed for them in exactly one place: a notification. Which is
// dismissible, easily missed, and gone once read. An artist could accept
// a booking and then have no way to find it again.
//
// ── OWNER-ONLY, AND WHY ───────────────────────────────────────
// Rendered only when the profile's owner is looking at it. A pending
// invitation is a conversation between two artists, not a public fact
// about either — a visitor has no business seeing who has been asked and
// has not answered. Accepted shows are public information and the
// existing UPCOMING list already shows those; this section is the
// owner's private view of both states.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import Link from 'next/link';

const INK = '#011627';
const TEAL = '#2ec4b6';

function when(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function InvitedShows({ accessToken }) {
  const [slots, setSlots] = useState(null);

  useEffect(() => {
    if (!accessToken) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/performer/my-slots', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled) return;
        if (!res.ok) { setSlots([]); return; }
        const body = await res.json();
        setSlots(body.slots || []);
      } catch {
        if (!cancelled) setSlots([]);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  // Nothing at all is the common case and deserves no space. Distinct
  // from `null` (still loading), which also renders nothing but for a
  // different reason — a heading that appears and then empties is worse
  // than one that arrives late.
  if (!slots?.length) return null;

  const pending = slots.filter((s) => s.status === 'pending');
  const claimed = slots.filter((s) => s.status === 'claimed');

  return (
    <div style={{ marginTop: 28 }}>
      {pending.length > 0 && (
        <>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: TEAL }}>INVITATIONS</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {pending.map((s) => (
              <div
                key={`${s.show.id}:${s.slot}`}
                style={{
                  padding: '11px 13px', border: `1px solid ${TEAL}`,
                  clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, lineHeight: 1.45 }}>
                  {(s.host?.displayName || s.host?.username || 'An artist')} has invited you to perform
                  in a Versus show{s.show.slatedAt ? ` on ${when(s.show.slatedAt)}` : ''}
                </div>
                {s.show.title && (
                  <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.55)', marginTop: 3 }}>{s.show.title}</div>
                )}
                {/* The accept flow is the page the invite token already
                    resolves — the same screen a link would have opened.
                    One accept path, whether the invitation arrived as a
                    notification, a banner, or a link. */}
                <Link
                  href={`/join/${s.inviteToken}`}
                  style={{
                    display: 'inline-block', marginTop: 9, padding: '8px 14px',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    background: TEAL, color: INK, textDecoration: 'none',
                  }}
                >
                  ACCEPT
                </Link>
              </div>
            ))}
          </div>
        </>
      )}

      {claimed.length > 0 && (
        <div style={{ marginTop: pending.length ? 20 : 0 }}>
          {/* The second half, and the one that would have been missed:
              a show accepted last week has to be findable this week
              without going back through notifications. */}
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>
            YOU ARE PERFORMING IN
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {claimed.map((s) => (
              <div
                key={`${s.show.id}:${s.slot}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  border: '1px solid rgba(1,22,39,0.1)',
                  clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.show.title || 'Untitled show'}</div>
                  <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 2 }}>
                    {when(s.show.slatedAt)}
                    {' · '}VERSUS
                    {s.host && ` · with ${s.host.displayName || s.host.username}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
