'use client';
// components/artist/OwnerProfileScreen.jsx — the artist's own console
// (Profile-Owner.dc.html, ProfileEmpty): identity, status strip, Schedule /
// Kit check / New clip, tabs Shows, Clips, Upcoming, Insights, the Menu.
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { formatDuration } from '../../lib/insights';
import { Skeleton, Empty } from '../viewer/States';
import { Person, Share, Dots, Play, Clock, Chevron } from '../viewer/Icons';

export default function OwnerProfileScreen() {
  const { session, profile, loading } = useSession();
  const [shows, setShows] = useState(null); const [recs, setRecs] = useState(null); const [clips, setClips] = useState(null); const [followers, setFollowers] = useState(null); const [tab, setTab] = useState('shows'); const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!session) return;
    const sb = getSupabase();
    Promise.all([
      sb.from('shows').select('id, title, slated_at, performance_mode, actual_started_at, actual_ended_at, cancelled_at').or(`artist_id.eq.${session.user.id},artist_b_id.eq.${session.user.id}`).is('cancelled_at', null).order('slated_at'),
      sb.from('recordings').select('id, title, recorded_at, duration_ms, visibility').eq('artist_id', session.user.id).order('recorded_at', { ascending: false }),
      sb.from('clips').select('id, title, start_ms, end_ms, created_at').eq('artist_id', session.user.id).order('created_at', { ascending: false }),
      sb.from('follows').select('follower_id', { count: 'exact', head: true }).eq('artist_id', session.user.id),
    ]).then(([s, r, c, f]) => { setShows(s.data || []); setRecs(r.data || []); setClips(c.data || []); setFollowers(f.count || 0); });
  }, [session]);
  if (loading || !profile || shows === null) return <div className="v-screen" role="status" aria-label="Loading profile"><Skeleton w={88} h={88} r={44} /><Skeleton w="60%" h={28} /><Skeleton h={64} /></div>;
  const now = Date.now();
  const live = shows.find((s) => s.actual_started_at && !s.actual_ended_at);
  const upcoming = shows.filter((s) => !s.actual_ended_at && !s.actual_started_at && Date.parse(s.slated_at) > now - 30 * 60000);
  const next = upcoming[0];
  const setupLeft = !(profile.bio && profile.genres?.length) || !profile.onboarding?.agreement_at;
  return (
    <div className="v-screen" data-testid="owner-profile">
      <div className="v-row" style={{ justifyContent: 'space-between' }}><span className="v-muted" style={{ fontWeight: 700 }}>@{profile.username || profile.display_name}</span><button aria-label="Menu" className="v-icon-btn v-btn-ghost-light" onClick={() => setMenu(!menu)}><Dots /></button></div>
      {menu && <div className="v-card-light" role="menu">{[['/wallet', 'Wallet'], ['/artist/earnings', 'Wallet and payouts'], ['/settings', 'Settings'], ['/help', 'Help and legal']].map(([h, l]) => <a key={h} href={h} className="v-list-row" role="menuitem"><span style={{ flex: 1, fontWeight: 700 }}>{l}</span><Chevron /></a>)}<button className="v-list-row" style={{ width: '100%', textAlign: 'left' }} onClick={async () => { await getSupabase().auth.signOut(); window.location.href = '/discover'; }}><span style={{ flex: 1, fontWeight: 700, color: 'var(--red)' }}>Log out</span></button></div>}
      <div className="v-col" style={{ alignItems: 'center', gap: 6, textAlign: 'center' }}>
        <span className="v-avatar" style={{ width: 88, height: 88 }}>{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <Person size={40} />}</span>
        <h1 style={{ fontSize: 30, lineHeight: 1 }}>{profile.display_name}</h1>
        <span className="v-muted">{(profile.genres || []).slice(0, 3).join(' · ') || 'Add your genres'}</span>
        <div className="v-row" style={{ gap: 16 }}><span><strong>{followers ?? 0}</strong> followers</span><span><strong>{recs?.length || 0}</strong> shows</span></div>
        <div className="v-row" style={{ gap: 8 }}><a className="v-btn v-btn-ghost-light" href="/settings">Edit profile</a><button className="v-btn v-btn-ghost-light" onClick={() => { const url = `${location.origin}/@${profile.username}`; if (navigator.share) navigator.share({ url }).catch(() => {}); else navigator.clipboard?.writeText(url); }}><Share />Share profile</button></div>
      </div>
      {live ? <a href={`/artist/console/${live.id}`} className="v-card-light v-col" style={{ padding: 14, gap: 2, background: 'var(--silk-dark)', color: 'var(--porcelain)' }} data-testid="status-strip"><span className="v-row" style={{ gap: 8 }}><span className="v-badge v-badge-live">LIVE</span><span style={{ fontWeight: 700 }}>{live.title}</span></span><span style={{ fontSize: 14, color: 'rgba(253,255,252,0.85)' }}>Open the console.</span></a>
        : next ? <a href={`/artist/kit-check?show=${next.id}`} className="v-card-light v-col" style={{ padding: 14, gap: 2 }} data-testid="status-strip"><span style={{ fontWeight: 700 }}>Next show {new Date(next.slated_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className="v-muted" style={{ fontSize: 14 }}>{setupLeft ? '1 thing to fix: finish setting up your stage.' : 'Stage ready. Tap to run Kit Check.'}</span></a>
        : setupLeft ? <a href="/artist/onboarding" className="v-card-light v-col" style={{ padding: 14, gap: 2 }} data-testid="status-strip"><span style={{ fontWeight: 700 }}>Finish setting up your stage</span><span className="v-muted" style={{ fontSize: 14 }}>Photo, agreement, YouTube, mic, camera, then book.</span></a>
        : <a href="/artist/schedule" className="v-card-light v-col" style={{ padding: 14, gap: 2 }} data-testid="status-strip"><span style={{ fontWeight: 700 }}>No show booked</span><span className="v-muted" style={{ fontSize: 14 }}>Book one at least 30 minutes ahead.</span></a>}
      <div className="v-row" style={{ gap: 8 }}><a className="v-btn v-btn-teal" style={{ flex: 1 }} href="/artist/schedule"><Clock size={18} />Schedule</a><a className="v-btn v-btn-ghost-light" style={{ flex: 1 }} href="/artist/kit-check">Kit check</a><a className="v-btn v-btn-ghost-light" style={{ flex: 1 }} href="/artist/clips/new">New clip</a></div>
      <div role="tablist" aria-label="Your sections" className="v-row" style={{ gap: 8, overflowX: 'auto' }}>{[['shows', 'Shows'], ['clips', 'Clips'], ['upcoming', 'Upcoming'], ['insights', 'Insights']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="v-chip v-chip-light" onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'shows' && (recs.length ? <div className="v-card-light">{recs.map((r) => <a key={r.id} href={`/share/${r.id}`} className="v-list-row"><Play /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>{r.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{new Date(r.recorded_at).toLocaleDateString('en-GB')} · {formatDuration(r.duration_ms)}</span></span><span className="v-badge v-badge-soon" style={{ background: r.visibility === 'public' ? 'var(--teal)' : r.visibility === 'unlisted' ? 'var(--orange)' : 'rgba(1,22,39,0.12)' }}>{r.visibility}</span></a>)}</div> : <Empty title="No shows yet" body="Your recordings land here after each show." action="Schedule a show" actionHref="/artist/schedule" />)}
      {tab === 'clips' && (clips.length ? <div className="v-card-light">{clips.map((c) => <div key={c.id} className="v-list-row"><Play /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>{c.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{formatDuration(c.end_ms - c.start_ms)}</span></span></div>)}</div> : <Empty title="No clips yet" body="Trim up to 90 seconds from a show to share it." action="New clip" actionHref="/artist/clips/new" />)}
      {tab === 'upcoming' && (upcoming.length ? <div className="v-card-light">{upcoming.map((s) => <a key={s.id} href={`/artist/console/${s.id}`} className="v-list-row"><Clock /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>{s.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{new Date(s.slated_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{s.performance_mode === 'versus' ? ' · Versus' : ''}</span></span><Chevron /></a>)}</div> : <Empty title="Nothing booked" action="Schedule a show" actionHref="/artist/schedule" />)}
      {tab === 'insights' && <a className="v-btn v-btn-lg v-btn-ghost-light" href="/artist/insights">Open insights</a>}
    </div>
  );
}
