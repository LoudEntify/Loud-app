'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../lib/supabaseClient';
import { getSession, getProfile } from '../lib/supabaseAuth';
import EmptyState from './EmptyState';
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_OPTIONS_MINUTES,
  isExpired,
  showWindowClosesAt,
  sweepClosedShows,
  isWindowOpen,
  msUntilWindow,
  humanCountdown,
  nextUpcomingShow,
  syncShowReminders,
  WINDOW_OPENS_BEFORE_MS,
} from '../lib/scheduling';

const INK = '#011627';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';

const inputStyle = {
  border: '1px solid rgba(1,22,39,0.15)',
  background: 'transparent',
  padding: '11px 12px',
  fontSize: 13,
  color: INK,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
};
const labelStyle = { fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', fontWeight: 700, marginBottom: 4 };

// Scheduling + the two doors out of the dashboard: GO LIVE (only once
// the broadcast window is open) and KIT CHECK (always).
//
// The whole point of the split: KIT CHECK never touches LiveKit, so an
// artist can set up, tune audio, rehearse cues and check framing for as
// long as they like at zero streaming cost. GO LIVE is the only thing
// that opens a connection, and it cannot be pressed before the window.
export default function ScheduleShow() {
  const [session, setSession] = useState(null);
  // Needed to populate shows.artist_name -- a pre-accounts denormalised
  // column that is still read by the recordings-sync title builder and
  // the viewer holding screen. Identity comes from artist_id now, but
  // leaving that column empty would quietly break both of them.
  const [artistName, setArtistName] = useState('');
  const [shows, setShows] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', date: '', time: '', mode: 'solo', duration: DEFAULT_DURATION_MINUTES });
  // Versus invites, keyed by show id. Minted on demand rather than at
  // schedule time -- an artist may schedule a versus show days before
  // they know who they are facing.
  const [invites, setInvites] = useState({});
  const [inviteBusy, setInviteBusy] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // One-second clock so the countdown and the GO LIVE button flip on
  // their own, without the artist reloading at the critical moment.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (userId) => {
    const { data, error: err } = await getSupabase()
      .from('shows')
      .select('*')
      .eq('artist_id', userId)
      .order('slated_at', { ascending: true });
    if (err) { setShows([]); return; }
    setShows(data || []);
    // Lazy reminder generation -- see lib/scheduling.js for why this
    // runs here rather than in a job.
    syncShowReminders(userId, data || []).catch(() => {});
    // Product Ruling 1 -- the DURABLE half of the sweep. Every client
    // already derives "window closed => ended" instantly from the clock;
    // this is what eventually writes it down, on the artist's own
    // console, with no cron. Fire-and-forget: a failed sweep changes
    // nothing anyone can see.
    sweepClosedShows(data || []).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (s?.user) {
        const { profile } = await getProfile(s.user.id);
        if (!cancelled) setArtistName(profile?.display_name || profile?.username || s.user.email || 'Artist');
        await load(s.user.id);
      } else {
        setShows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  async function createShow() {
    setError('');
    if (!form.date || !form.time) { setError('Pick a date and time.'); return; }
    const slated = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(slated.getTime())) { setError('That date and time is not valid.'); return; }
    if (slated.getTime() < Date.now()) { setError('Pick a time in the future.'); return; }

    setCreating(true);
    try {
      // room_name is required by the existing shows schema and by the
      // live path. One room per show, derived from the id so it is
      // unique and readable in LiveKit's dashboard.
      const roomName = `show-${Math.random().toString(36).slice(2, 10)}`;
      const { error: err } = await getSupabase().from('shows').insert({
        artist_id: session.user.id,
        room_name: roomName,
        slated_at: slated.toISOString(),
        state: 'scheduled',
        title: form.title.trim() || null,
        performance_mode: form.mode,
        // Product Ruling 1. Everything downstream -- the broadcast
        // window, Live Now membership, the sweep to ended, Upcoming vs
        // expired -- is computed from this one number.
        duration_minutes: form.duration,
        // Legacy column, populated rather than left null -- see the
        // artistName note above.
        artist_name: artistName || 'Artist',
      });
      if (err) {
        // Show the real database message. A generic string here is what
        // turned a one-line constraint failure into a test sitting.
        setError(
          /column .* does not exist|schema cache/i.test(err.message || '')
            ? 'Scheduling needs docs/scheduling_migration.sql to be run first.'
            : `Could not schedule that show — ${err.message || 'unknown error'}`
        );
        return;
      }
      setForm({ title: '', date: '', time: '', mode: 'solo', duration: DEFAULT_DURATION_MINUTES });
      await load(session.user.id);
    } finally {
      setCreating(false);
    }
  }

  async function createInvite(show) {
    setInviteBusy(show.id);
    try {
      const res = await fetch('/api/performer/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ show_id: show.id }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not create an invite.'); return; }
      setInvites((prev) => ({ ...prev, [show.id]: `${window.location.origin}/join/${body.inviteToken}` }));
    } finally {
      setInviteBusy(null);
    }
  }

  const upcoming = nextUpcomingShow(shows, now);
  const windowOpen = upcoming ? isWindowOpen(upcoming, now) : false;

  if (!session) {
    return <EmptyState title="Sign in to schedule shows" body="Scheduling is tied to your artist account." action="LOG IN" actionHref="/auth" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── The two doors ───────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link
          href={windowOpen ? `/live?show=${upcoming.id}` : '#'}
          onClick={(e) => { if (!windowOpen) e.preventDefault(); }}
          style={{
            flex: '1 1 200px',
            textAlign: 'center',
            padding: '16px 0',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textDecoration: 'none',
            color: windowOpen ? '#fdfffc' : 'rgba(1,22,39,0.35)',
            background: windowOpen ? 'linear-gradient(90deg,#2ec4b6,#ff9f1c)' : 'rgba(1,22,39,0.05)',
            cursor: windowOpen ? 'pointer' : 'not-allowed',
            clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
          }}
        >
          GO LIVE
        </Link>
        <Link
          href="/kit-check"
          style={{
            flex: '1 1 200px',
            textAlign: 'center',
            padding: '16px 0',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textDecoration: 'none',
            color: TEAL,
            border: `1px solid ${TEAL}`,
            clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
          }}
        >
          KIT CHECK
        </Link>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)', lineHeight: 1.5 }}>
        {upcoming
          ? windowOpen
            ? 'Your broadcast window is open — GO LIVE connects you and starts billing time.'
            : `GO LIVE unlocks ${humanCountdown(msUntilWindow(upcoming, now))} (${Math.round(WINDOW_OPENS_BEFORE_MS / 60000)} minutes before your show).`
          : 'Schedule a show to unlock GO LIVE.'}
        {' '}Kit Check is always open and never connects to the internet stream — camera, audio and cues only.
      </div>

      {/* ── Schedule form ───────────────────────────────────── */}
      <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 12 }}>Schedule a show</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={labelStyle}>TITLE <span style={{ fontWeight: 400, letterSpacing: 0 }}>(optional)</span></div>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What are you calling this one?"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}>
              <div style={labelStyle}>DATE</div>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <div style={labelStyle}>TIME</div>
              <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          <div>
            <div style={labelStyle}>HOW LONG</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DURATION_OPTIONS_MINUTES.map((mins) => {
                const active = form.duration === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, duration: mins }))}
                    style={{
                      padding: '9px 14px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                      color: active ? TEAL : 'rgba(1,22,39,0.55)',
                      background: active ? 'rgba(46,196,182,0.12)' : 'transparent',
                      border: `1px solid ${active ? TEAL : 'rgba(1,22,39,0.15)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    {mins >= 60 ? `${mins / 60}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.45)', marginTop: 5 }}>
              Your show window runs from the start time to {form.duration >= 60 ? `${form.duration / 60}h${form.duration % 60 ? ` ${form.duration % 60}m` : ''}` : `${form.duration}m`} later, plus 15 minutes&rsquo; grace.
              After that it closes on its own.
            </div>
          </div>

          <div>
            <div style={labelStyle}>FORMAT</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['solo', 'versus'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode: m }))}
                  style={{
                    flex: 1,
                    padding: '11px 0',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    background: form.mode === m ? 'rgba(46,196,182,0.12)' : 'transparent',
                    color: form.mode === m ? TEAL : 'rgba(1,22,39,0.55)',
                    border: form.mode === m ? `1px solid ${TEAL}` : '1px solid rgba(1,22,39,0.15)',
                    cursor: 'pointer',
                  }}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: '#e71d36' }}>{error}</div>}

          <button
            type="button"
            onClick={createShow}
            disabled={creating}
            style={{
              marginTop: 4,
              padding: '13px 0',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: '#fdfffc',
              background: INK,
              border: 'none',
              cursor: creating ? 'default' : 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? 'SCHEDULING…' : 'SCHEDULE SHOW'}
          </button>
        </div>
      </div>

      {/* ── Upcoming list ───────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)', marginBottom: 10 }}>UPCOMING</div>

        {shows === null && <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>}

        {shows !== null && shows.filter((s) => s.state !== 'ended').length === 0 && (
          <EmptyState compact title="No shows scheduled" body="Pick a date above and it appears here with a countdown." />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(shows || [])
            .filter((s) => s.state !== 'ended')
            .map((s) => {
              const open = isWindowOpen(s, now);
              // Product Ruling 1 — a scheduled show whose window has
              // closed without ever being run is EXPIRED, not pending.
              // It used to sit here forever with a countdown reading
              // "now", which is the least useful thing a diary can say.
              const expired = isExpired(s, now);
              return (
                <div key={s.id} style={{ padding: '11px 13px', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{s.title || 'Untitled show'}</div>
                    <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 3 }}>
                      {new Date(s.slated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {' · '}{(s.duration_minutes || DEFAULT_DURATION_MINUTES)}MIN
                      {' · '}{(s.performance_mode || 'solo').toUpperCase()}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    padding: '4px 8px',
                    borderRadius: 999,
                    color: expired ? 'rgba(1,22,39,0.35)' : open ? ORANGE : 'rgba(1,22,39,0.45)',
                    border: `1px solid ${expired ? 'rgba(1,22,39,0.12)' : open ? 'rgba(255,159,28,0.5)' : 'rgba(1,22,39,0.15)'}`,
                  }}>
                    {expired ? 'MISSED' : open ? 'WINDOW OPEN' : humanCountdown(msUntilWindow(s, now)).toUpperCase()}
                  </span>
                </div>

                  {/* Versus needs a second performer, and that is now an
                      invite bound to an account rather than a code
                      anyone holding the string could use. */}
                  {(s.performance_mode === 'versus') && !open && !expired && (
                    <div style={{ marginTop: 8 }}>
                      {invites[s.id] ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(46,196,182,0.4)', padding: '8px 10px', clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)' }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'rgba(1,22,39,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {invites[s.id]}
                          </span>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard?.writeText(invites[s.id]); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 2000); }}
                            style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            {copiedId === s.id ? 'COPIED' : 'COPY'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => createInvite(s)}
                          disabled={inviteBusy === s.id}
                          style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, background: 'transparent', border: `1px solid ${TEAL}`, padding: '7px 11px', cursor: 'pointer' }}
                        >
                          {inviteBusy === s.id ? 'CREATING…' : 'INVITE OPPONENT'}
                        </button>
                      )}
                      <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 5 }}>
                        Single use. Whoever accepts it while logged in takes slot B, and it stops working.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
