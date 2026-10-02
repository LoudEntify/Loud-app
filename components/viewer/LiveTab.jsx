'use client';
// components/viewer/LiveTab.jsx — Live (Live.dc.html, LiveLoading.dc.html):
// Live now grid (followed first), Starting soon, Upcoming by day, filters.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/viewerApi';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { track } from '../../lib/telemetry';
import { Skeleton, ErrorState, Empty } from './States';
import { Search, Inbox, Eye, Bell, Chevron } from './Icons';

export default function LiveTab() {
  const { session, loading: sessionLoading } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [genre, setGenre] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams({ filter, ...(genre ? { genre } : {}) });
    const res = await api(`/api/viewer/live?${q}`, { accessToken: session?.access_token });
    if (!res.ok) { setError(true); return; }
    setData(res.data);
  }, [filter, genre, session?.access_token]);
  useEffect(() => { if (!sessionLoading) load(); }, [load, sessionLoading]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function remind(show) {
    if (!session) { window.location.href = `/signup?trigger=remind&next=/live`; return; }
    const sb = getSupabase();
    if (show.reminded) await sb.from('show_reminders').delete().eq('user_id', session.user.id).eq('show_id', show.id);
    else { await sb.from('show_reminders').insert({ user_id: session.user.id, show_id: show.id }); track('reminder.set', {}, { showId: show.id }); }
    load();
  }
  const name = (s) => s.performance_mode === 'versus' ? `${s.artist?.display_name || 'Artist A'} vs ${s.artist_b?.display_name || 'Artist B'}` : s.artist?.display_name || s.artist_name || 'Artist';
  const chips = [['all', 'All'], ['following', 'Following'], ['solo', 'Solo'], ['versus', 'Versus']];
  const byDay = (list) => { const m = new Map(); for (const s of list) { const d = new Date(s.slated_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); if (!m.has(d)) m.set(d, []); m.get(d).push(s); } return [...m.entries()]; };

  return (
    <div className="v-screen" data-testid="live-tab">
      <div className="v-row" style={{ justifyContent: 'space-between' }}>
        <h1 className="v-h1">Live</h1>
        <div className="v-row" style={{ gap: 8 }}><a href="/search" aria-label="Search" className="v-icon-btn v-btn-ghost-light"><Search /></a><a href="/notifications" aria-label="Inbox" className="v-icon-btn v-btn-ghost-light"><Inbox /></a></div>
      </div>
      <div className="v-row" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }} role="group" aria-label="Filters">
        {chips.map(([k, label]) => <button key={k} className="v-chip v-chip-light" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
        {(data?.genres || []).map((g) => <button key={g} className="v-chip v-chip-light" aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>)}
      </div>
      {error && !data && <ErrorState title="We couldn't load Live" body="Check your connection and try again." onRetry={load} backHref={null} />}
      {!data && !error && (
        <div role="status" aria-label="Loading Live" className="v-col" style={{ gap: 18 }}>
          <Skeleton w={120} h={26} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}><Skeleton h={200} r={16} /><Skeleton h={200} r={16} /></div>
          <Skeleton w={140} h={26} /><Skeleton h={64} /><Skeleton h={64} />
        </div>
      )}
      {data && (
        <>
          <section className="v-col" style={{ gap: 12 }}>
            <div className="v-row" style={{ justifyContent: 'space-between' }}><h2 className="v-h2"><span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--red)' }} />Live now</h2></div>
            {data.liveNow.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }} data-testid="live-grid">
                {data.liveNow.map((s) => (
                  <a key={s.id} href={`/show/${s.id}`} className="v-col" style={{ gap: 8 }}>
                    <span className="v-poster" style={{ height: 200 }}>
                      <span className="v-badge v-badge-live" style={{ position: 'absolute', top: 10, left: 10 }}>LIVE</span>
                      {s.performance_mode === 'versus' && <span className="v-badge v-badge-versus" style={{ position: 'absolute', top: 10, right: 10 }}>VERSUS</span>}
                      <span className="v-row" style={{ position: 'absolute', bottom: 10, left: 10, gap: 5, padding: '3px 9px', borderRadius: 999, background: 'rgba(1,22,39,0.7)', color: 'var(--porcelain)', fontSize: 13 }}><Eye size={14} />{s.viewers ?? 0}</span>
                    </span>
                    <span className="v-col" style={{ gap: 2 }}><span style={{ fontSize: 18, fontWeight: 700 }}>{name(s)}</span><span className="v-muted" style={{ fontSize: 15 }}>{s.title}</span></span>
                  </a>
                ))}
              </div>
            ) : <Empty title="Nothing live right now" body={data.soon.length ? `${data.soon.length} show${data.soon.length === 1 ? '' : 's'} start${data.soon.length === 1 ? 's' : ''} in the next few hours.` : 'Shows are booked at least 30 minutes ahead, so check back soon.'} action={data.soon.length ? null : 'Browse upcoming'} actionHref="/live#upcoming" />}
          </section>
          <section className="v-col" style={{ gap: 12 }}>
            <h2 className="v-h2">Starting soon</h2>
            {data.soon.length ? data.soon.map((s) => <SoonRow key={s.id} s={s} name={name(s)} onRemind={() => remind(s)} />) : <span className="v-muted">Nothing in the next few hours.</span>}
          </section>
          <section className="v-col" id="upcoming" style={{ gap: 12 }}>
            <h2 className="v-h2">Upcoming</h2>
            {data.upcoming.length ? byDay(data.upcoming).map(([day, list]) => (
              <div key={day} className="v-col" style={{ gap: 8 }}>
                <span className="v-kicker v-muted">{day}</span>
                {list.map((s) => <SoonRow key={s.id} s={s} name={name(s)} onRemind={() => remind(s)} showTime />)}
              </div>
            )) : <span className="v-muted">No shows booked yet beyond today.</span>}
          </section>
          <a href="/competitions" className="v-row" style={{ padding: 16, borderRadius: 16, background: 'var(--silk-dark)', color: 'var(--porcelain)', gap: 12 }}>
            <span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 19, fontWeight: 700 }}>Monthly genre competitions</span><span style={{ fontSize: 15, color: 'rgba(253,255,252,0.75)' }}>Coming soon</span></span><Chevron />
          </a>
        </>
      )}
    </div>
  );
}

function SoonRow({ s, name, onRemind, showTime }) {
  const mins = Math.max(0, Math.round((Date.parse(s.slated_at) - Date.now()) / 60000));
  const when = showTime ? new Date(s.slated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : mins < 60 ? `Starts in ${mins} min` : `Starts in ${Math.round(mins / 60)} h`;
  return (
    <div className="v-row" style={{ gap: 12 }} data-testid="soon-row">
      <a href={`/show/${s.id}`} className="v-poster" style={{ width: 64, height: 64, borderRadius: 12, flexShrink: 0 }} aria-label={name} />
      <a href={`/show/${s.id}`} className="v-col" style={{ flex: 1, gap: 2 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{name}</span><span className="v-muted" style={{ fontSize: 15 }}>{s.title}</span>
        <span className="v-row" style={{ gap: 6, fontSize: 15, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--orange)' }} />{when}</span>
      </a>
      <button className="v-btn v-btn-ghost-light" style={{ height: 40, fontSize: 15, padding: '0 14px' }} onClick={onRemind} aria-pressed={Boolean(s.reminded)}><Bell size={18} />{s.reminded ? 'Reminded' : 'Remind me'}</button>
    </div>
  );
}
