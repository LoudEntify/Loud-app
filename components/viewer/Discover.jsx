'use client';
// components/viewer/Discover.jsx — Discover (Main.dc.html, Discover-Preview,
// DiscoverEmpty). A full-screen vertical feed that snaps one card per
// swipe, live first. Never empty: with nothing live it opens on Starting
// soon, then recordings. Only the card on screen holds a player; the
// others show a poster (ARCHITECTURE.md: "Only one live player instance
// exists at a time").
import { useCallback, useEffect, useRef, useState } from 'react';
import PlayerFrame from './PlayerFrame';
import { api } from '../../lib/viewerApi';
import { useSession } from '../../lib/useSession';
import { track } from '../../lib/telemetry';
import { PreviewMeter, loadWatchedMs, saveWatchedMs } from '../../lib/guestPreview';
import { Skeleton, ErrorState, Empty } from './States';
import { Search, Inbox, Eye, Person, Share, Dots, Play, Clock } from './Icons';

export default function Discover() {
  const { session, loading: sessionLoading } = useSession();
  const [cards, setCards] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(0);
  const [chip, setChip] = useState(false);
  const [expired, setExpired] = useState(false);
  const [playerState, setPlayerState] = useState('loading');
  const feedRef = useRef(null);
  const previewRef = useRef(null);
  const seen = useRef(new Set());

  const load = useCallback(async () => {
    setError(null);
    const res = await api('/api/viewer/feed', { accessToken: session?.access_token });
    if (!res.ok) { setError(res.data?.error || "We couldn't load Discover"); setCards((c) => c || []); return; }
    setCards(res.data.cards);
  }, [session?.access_token]);
  useEffect(() => { if (!sessionLoading) load(); }, [load, sessionLoading]);
  useEffect(() => { const t = setTimeout(() => { if (cards === null) setError('Taking too long'); }, 10000); return () => clearTimeout(t); }, [cards]);

  // snap tracking
  useEffect(() => {
    const el = feedRef.current; if (!el) return undefined;
    const onScroll = () => setActive(Math.round(el.scrollTop / el.clientHeight));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [cards]);
  useEffect(() => {
    const c = cards?.[active]; if (!c) return;
    const key = c.show?.id || c.recording?.id;
    if (!seen.current.has(key)) { seen.current.add(key); track('feed.card_seen', { kind: c.kind, index: active }, { showId: c.show?.id || null }); }
  }, [active, cards]);

  // guest preview across cards
  useEffect(() => {
    if (!previewRef.current) previewRef.current = new PreviewMeter({ watchedMs: loadWatchedMs() });
    const pm = previewRef.current;
    pm.onPlayerState(playerState);
    const t = setInterval(() => {
      saveWatchedMs(pm.totalMs());
      if (!session && !sessionLoading) { if (pm.expired()) setExpired(true); else if (pm.chipDue()) setChip(true); }
    }, 1000);
    return () => clearInterval(t);
  }, [playerState, session, sessionLoading]);

  if (cards === null && !error) return <div className="v-feed-card" role="status" aria-label="Loading Discover"><div style={{ position: 'absolute', left: 16, right: 84, bottom: 104, display: 'flex', flexDirection: 'column', gap: 10 }}><Skeleton w={60} h={24} r={999} /><Skeleton w="70%" h={30} /><Skeleton w="50%" h={20} /><Skeleton h={52} r={26} /></div></div>;
  if (error && !cards?.length) return <div className="v-feed-card" style={{ padding: '120px 16px 0' }}><ErrorState title="We couldn't load Discover" body="Check your connection and try again." onRetry={load} backHref={null} /></div>;
  if (!cards.length) return <div className="v-feed-card" style={{ padding: '120px 16px 0' }}><Empty title="Nothing live right now" body="New shows are booked at least 30 minutes ahead. See what's coming." action="See what's coming" actionHref="/live" /></div>;

  return (
    <div className="v-feed" ref={feedRef} data-testid="discover-feed">
      {cards.map((c, i) => <FeedCard key={(c.show?.id || c.recording?.id) + i} card={c} active={i === active} onPlayerState={i === active ? setPlayerState : undefined} first={i === 0} />)}
      {chip && !session && !expired && (
        <div role="status" className="v-row" style={{ position: 'fixed', left: 16, right: 16, top: 110, zIndex: 30, justifyContent: 'space-between', gap: 12, padding: '8px 8px 8px 18px', borderRadius: 999, background: 'var(--porcelain)', color: 'var(--ink)' }} data-testid="preview-chip">
          <span className="v-col" style={{ gap: 0 }}><span style={{ fontSize: 17, fontWeight: 700 }}>Sign up free to keep watching</span><span className="v-muted" style={{ fontSize: 14 }}>Preview ends in {Math.ceil((previewRef.current?.remainingMs() || 0) / 1000)} seconds</span></span>
          <a href="/signup?trigger=timer" className="v-btn v-btn-ink">Sign up</a>
        </div>
      )}
      {expired && !session && (
        <div role="dialog" aria-label="Sign up to keep watching" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, top: '40%', zIndex: 31 }}>
          <div className="v-sheet" style={{ height: '100%', overflowY: 'auto' }}>
            <div className="v-sheet-handle" />
            <h1 style={{ fontSize: 30 }}>Keep watching, free</h1>
            <p className="v-muted" style={{ fontSize: 17 }}>Your free minute is up. Sign up in under a minute and the music carries on.</p>
            <a href="/signup?trigger=timer" className="v-btn v-btn-lg v-btn-ink">Sign up free</a>
            <a href="/login" className="v-link" style={{ alignSelf: 'center' }}>Log in</a>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedCard({ card, active, onPlayerState, first }) {
  const apiRef = useRef(null);
  const show = card.show;
  const rec = card.recording;
  const artist = show?.artist || rec?.artist;
  const name = artist?.display_name || show?.artist_name || 'Artist';
  const isVersus = show?.performance_mode === 'versus';
  const live = card.kind === 'live';
  const title = show?.title || rec?.title || '';
  const slated = show?.slated_at ? Date.parse(show.slated_at) : null;
  const mins = slated ? Math.max(0, Math.round((slated - Date.now()) / 60000)) : null;
  return (
    <section className="v-feed-card" aria-label={`${name}: ${title}`} data-testid="feed-card" data-kind={card.kind}>
      {live && active ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 'min(100%, calc(100dvh * 9 / 16))', height: '100%' }}>
            <PlayerFrame show={show} rect={null} apiRef={apiRef} onState={onPlayerState} muted showLive />
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--silk-dark)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(253,255,252,0.6)' }}>
          {live ? <Play size={44} /> : card.kind === 'soon' ? <Clock size={44} /> : <Play size={44} />}
          <span className="v-kicker" style={{ fontSize: 15 }}>{live ? 'Live performance' : card.kind === 'soon' ? 'Starting soon' : 'Recording'}</span>
        </div>
      )}
      <div className="v-feed-fade-top" /><div className="v-feed-fade-bottom" />
      {first && (
        <div className="v-row" style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: '52px 16px 0', justifyContent: 'space-between' }}>
          <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: 30, width: 'auto' }} />
          <div className="v-row" style={{ gap: 8 }}><a href="/search" aria-label="Search" className="v-icon-btn" style={{ background: 'rgba(1,22,39,0.5)' }}><Search /></a><a href="/notifications" aria-label="Inbox" className="v-icon-btn" style={{ background: 'rgba(1,22,39,0.5)' }}><Inbox /></a></div>
        </div>
      )}
      <div style={{ position: 'absolute', right: 12, bottom: 132, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <a href={artist?.username ? `/@${artist.username}` : artist?.id ? `/artist/${artist.id}` : '#'} aria-label={`${name}'s profile`} style={{ position: 'relative', width: 56, height: 64, display: 'flex', justifyContent: 'center' }}>
          <span className="v-avatar" style={{ width: 52, height: 52, border: '2px solid var(--porcelain)' }}>{artist?.avatar_url ? <img src={artist.avatar_url} alt="" /> : <Person size={24} />}</span>
        </a>
        <button aria-label="Share" style={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--porcelain)' }} onClick={() => { const url = `${location.origin}${show ? `/show/${show.id}` : `/watch/${rec.id}`}`; if (navigator.share) navigator.share({ url }).catch(() => {}); else navigator.clipboard?.writeText(url); }}><span className="v-icon-btn" style={{ width: 48, height: 48, background: 'rgba(1,22,39,0.5)' }}><Share /></span><span style={{ fontSize: 13 }}>Share</span></button>
        <a href={show ? `/show/${show.id}` : `/watch/${rec.id}`} aria-label="More options" style={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--porcelain)' }}><span className="v-icon-btn" style={{ width: 48, height: 48, background: 'rgba(1,22,39,0.5)' }}><Dots /></span><span style={{ fontSize: 13 }}>More</span></a>
      </div>
      <div style={{ position: 'absolute', left: 16, right: 84, bottom: 104, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="v-row" style={{ gap: 8 }}>
          {live && <span className="v-badge v-badge-live" style={{ padding: '4px 10px', fontSize: 13 }}>LIVE</span>}
          {card.kind === 'soon' && <span className="v-badge v-badge-soon" style={{ padding: '4px 10px', fontSize: 13 }}>STARTS IN {mins} MIN</span>}
          {isVersus && <span className="v-badge v-badge-versus" style={{ padding: '4px 10px', fontSize: 13 }}>VERSUS</span>}
          {live && <span className="v-row" style={{ gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(1,22,39,0.6)', fontSize: 14 }}><Eye size={16} />{show.viewers ?? ''} watching</span>}
        </div>
        <a href={artist?.username ? `/@${artist.username}` : '#'} style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.05 }}>{isVersus ? `${name} vs ${show.artist_b?.display_name || 'Artist B'}` : name}</a>
        <div style={{ fontSize: 18, lineHeight: 1.25 }}>{title}{rec ? ` · from the show on ${new Date(rec.recorded_at).toLocaleDateString('en-GB')}` : ''}</div>
        <div className="v-row" style={{ gap: 8 }}>{(show?.genre || artist?.genres?.[0]) && <span className="v-chip v-chip-dark" style={{ height: 30, fontSize: 14 }}>{show?.genre || artist?.genres?.[0]}</span>}{show && <span className="v-chip v-chip-dark" style={{ height: 30, fontSize: 14 }}>{isVersus ? 'Versus' : 'Solo show'}</span>}</div>
        {live && <a href={`/show/${show.id}`} className="v-btn v-btn-lg v-btn-teal" style={{ marginTop: 6 }} data-testid="join-show">Join the show</a>}
        {card.kind === 'soon' && <a href={`/show/${show.id}`} className="v-btn v-btn-lg v-btn-ghost-dark" style={{ marginTop: 6 }}><Clock />Remind me</a>}
        {rec && <a href={`/watch/${rec.id}`} className="v-btn v-btn-lg v-btn-ghost-dark" style={{ marginTop: 6 }}><Play />Watch the full show</a>}
      </div>
    </section>
  );
}
