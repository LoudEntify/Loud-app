'use client';
// components/viewer/PublicProfile.jsx — an artist as others see them
// (Profile-Public.dc.html, ProfileEmpty). Reads only public_profiles and
// public shows/recordings: the server decides the mode, this screen never
// receives owner fields to hide.
import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabaseClient';
import { useSession } from '../../lib/useSession';
import { followArtist, unfollowArtist, fetchFollowedArtistIds } from '../../lib/follows';
import { track } from '../../lib/telemetry';
import { Skeleton, ErrorState, Empty } from './States';
import { Back, Person, Share, Bell, Play } from './Icons';

export default function PublicProfile({ username, artistId }) {
  const { session, profile: me } = useSession();
  const [p, setP] = useState(null);
  const [shows, setShows] = useState(null);
  const [recordings, setRecordings] = useState(null);
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(false);
  const [tab, setTab] = useState('upcoming');
  const sb = getSupabase();
  async function load() {
    setError(null);
    let q = sb.from('public_profiles').select('*');
    q = username ? q.eq('username', username) : q.eq('id', artistId);
    const { data, error: e } = await q.maybeSingle();
    if (e) { setError('load'); return; }
    if (!data) { setError('notfound'); return; }
    setP(data);
    const [{ data: s }, { data: r }] = await Promise.all([
      sb.from('shows').select('id, title, slated_at, performance_mode, state, actual_started_at, actual_ended_at, cancelled_at, genre').or(`artist_id.eq.${data.id},artist_b_id.eq.${data.id}`).eq('visibility', 'public').is('cancelled_at', null).gte('slated_at', new Date(Date.now() - 4 * 3600000).toISOString()).order('slated_at').limit(20),
      sb.from('recordings').select('id, title, recorded_at, duration_ms').eq('artist_id', data.id).eq('visibility', 'public').order('recorded_at', { ascending: false }).limit(20),
    ]);
    setShows(s || []); setRecordings(r || []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [username, artistId]);
  useEffect(() => { if (session && p) fetchFollowedArtistIds(session.user.id).then((ids) => setFollowing((ids || []).includes(p.id))); }, [session, p]);
  async function toggleFollow() {
    if (!session) { window.location.href = `/signup?trigger=follow&next=${encodeURIComponent(window.location.pathname)}`; return; }
    if (following) { await unfollowArtist(session.user.id, p.id); setFollowing(false); } else { await followArtist(session.user.id, p.id); setFollowing(true); track('follow', {}, null); }
  }
  if (error === 'notfound') return <div className="v-screen"><ErrorState title="We couldn't find that profile" body="The link may be wrong, or the account was closed." retry={false} /></div>;
  if (error) return <div className="v-screen"><ErrorState title="We couldn't load this profile" onRetry={load} /></div>;
  if (!p) return <div className="v-screen" role="status" aria-label="Loading profile"><div className="v-row" style={{ gap: 14 }}><Skeleton w={88} h={88} r={44} /><div className="v-col" style={{ flex: 1 }}><Skeleton w="60%" h={28} /><Skeleton w="40%" h={16} /></div></div><Skeleton h={48} r={24} /><Skeleton h={120} /></div>;
  const live = (shows || []).find((s) => s.actual_started_at && !s.actual_ended_at);
  const isOwner = me?.id === p.id;
  const isArtist = p.role === 'artist';
  return (
    <div className="v-screen" data-testid="public-profile">
      <div className="v-row" style={{ justifyContent: 'space-between' }}><a href="/discover" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a>{isOwner && <a href="/profile" className="v-link">Your console</a>}</div>
      <div className="v-row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <span className="v-avatar" style={{ width: 88, height: 88, position: 'relative' }}>{p.avatar_url ? <img src={p.avatar_url} alt="" /> : <Person size={40} />}</span>
        <div className="v-col" style={{ flex: 1, gap: 4 }}>
          <span className="v-row" style={{ gap: 8 }}><span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{p.display_name}</span>{live && <a href={`/show/${live.id}`} className="v-badge v-badge-live">LIVE</a>}</span>
          <span className="v-muted" style={{ fontSize: 15 }}>{p.username ? `@${p.username}` : ''}{p.genres?.length ? ` · ${p.genres.slice(0, 3).join(', ')}` : ''}{p.city ? ` · ${p.city}` : ''}</span>
          {p.bio && <p style={{ fontSize: 16, lineHeight: 1.35 }}>{p.bio}</p>}
        </div>
      </div>
      {isArtist && !isOwner && (
        <div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="v-btn v-btn-teal" onClick={toggleFollow} aria-pressed={following} data-testid="profile-follow">{following ? 'Following' : 'Follow'}</button>
          {shows?.[0] && !live && <a className="v-btn v-btn-ghost-light" href={`/show/${shows[0].id}`}><Bell />Remind me</a>}
          <button className="v-btn v-btn-ghost-light" onClick={() => { const url = location.href; if (navigator.share) navigator.share({ url }).catch(() => {}); else navigator.clipboard?.writeText(url); }}><Share />Share</button>
        </div>
      )}
      {isArtist ? (
        <>
          <div className="v-row" style={{ gap: 8 }} role="tablist">{[['upcoming', 'Upcoming'], ['shows', 'Shows'], ['about', 'About']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="v-chip v-chip-light" onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'upcoming' && (shows === null ? <Skeleton h={64} /> : shows.length ? shows.map((s) => <a key={s.id} href={`/show/${s.id}`} className="v-card-light v-list-row"><span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{s.title || 'A show'}</span><span className="v-muted" style={{ fontSize: 14 }}>{new Date(s.slated_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{s.performance_mode === 'versus' ? ' · Versus' : ''}</span></span>{s.actual_started_at && !s.actual_ended_at ? <span className="v-badge v-badge-live">LIVE</span> : <Bell />}</a>) : <Empty title="No shows booked yet" body={`${p.display_name} hasn't scheduled anything. Follow to hear when they do.`} />)}
          {tab === 'shows' && (recordings === null ? <Skeleton h={64} /> : recordings.length ? recordings.map((r) => <a key={r.id} href={`/watch/${r.id}`} className="v-card-light v-list-row"><Play /><span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{r.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{new Date(r.recorded_at).toLocaleDateString('en-GB')}</span></span></a>) : <Empty title="No recordings yet" body="Shows appear here after they have been performed." />)}
          {tab === 'about' && <div className="v-card-light" style={{ padding: 16 }}><p style={{ fontSize: 16, lineHeight: 1.4 }}>{p.bio || `${p.display_name} hasn't written a bio yet.`}</p>{p.country && <p className="v-muted" style={{ marginTop: 8 }}>{[p.city, p.country].filter(Boolean).join(', ')}</p>}</div>}
        </>
      ) : <Empty title={`${p.display_name} is a fan`} body="Fans don't have public pages beyond this." />}
    </div>
  );
}
