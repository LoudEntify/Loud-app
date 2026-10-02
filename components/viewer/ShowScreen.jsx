'use client';
// components/viewer/ShowScreen.jsx — the show, viewer side, around the player.
//
// Boards: YT-Waiting, YT-Show, YT-Focus (Bigger), YT-Prompt (vote sheet),
// YT-GuestSignUp, YT-VersusTalk / YT-Versus / YT-VersusB, YT-FoldShow,
// WebYT-Show, EndCard, SupportSheet, ShowOffline. PRD rows 98–104, 107.
//
// Geometry comes from lib/player/layout.js; this file only places things
// in the rects it returns, so the two invariants it proves (player never
// under 200x200, nothing over the player) hold on screen. Everything the
// viewer does is stamped with the player's own position (apiRef).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PlayerFrame from './PlayerFrame';
import SignUpSheet, { LoginSheet } from './SignUpSheet';
import { computeShowLayout } from '../../lib/player/layout';
import { useViewport } from './useViewport';
import { useSession } from '../../lib/useSession';
import { api, newIdempotencyKey } from '../../lib/viewerApi';
import { track } from '../../lib/telemetry';
import { viewerIdOrSession } from '../../lib/viewerIdentity';
import { PreviewMeter, loadWatchedMs, saveWatchedMs, GATED_ACTIONS } from '../../lib/guestPreview';
import { ViewMeter } from '../../lib/metering';
import { SUPPORT_AMOUNTS, SUPPORT_MESSAGE_MAX } from '../../lib/support';
import { REACTION_EMOJI } from '../../lib/reactions';
import { followArtist, unfollowArtist } from '../../lib/follows';
import { getSupabase } from '../../lib/supabaseClient';
import { Skeleton, ErrorState, OfflineBar, useOnline } from './States';
import { Back, Person, Eye, Token, Share, Bigger, Smaller, Flag, Emoji, Heart, Send, Bell, Check, Close, Play } from './Icons';

const EMOJI_STRIP = ['🔥', '❤️', '🎶', '👏', '😍', '🙌', '😂', '🥹'];

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSlot(iso) {
  try { return new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function ShowScreen({ showId, initialShow = null }) {
  const router = useRouter();
  const vp = useViewport();
  const online = useOnline();
  const { session, profile, accessToken, loading: sessionLoading } = useSession();
  const [payload, setPayload] = useState(initialShow ? { show: initialShow, viewers: 0, prompt: null } : null);
  const [loadError, setLoadError] = useState(null);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState(null); // 'support' | 'signup' | 'login' | 'report' | 'reactions' | null
  const [bigger, setBigger] = useState(false);
  const [voteOpen, setVoteOpen] = useState(false);
  const [myVote, setMyVote] = useState(null);
  const [toast, setToast] = useState(null);
  const [chip, setChip] = useState(false);
  const [guestGate, setGuestGate] = useState(false);
  const [playerState, setPlayerState] = useState('loading');
  const [tick, setTick] = useState(0);
  const apiRef = useRef(null);
  const previewRef = useRef(null);
  const meterRef = useRef(new ViewMeter());
  const lastCommentId = useRef(0);
  const supportKey = useRef(null);
  const show = payload?.show || null;
  const prompt = payload?.prompt || null;
  const signedIn = Boolean(session);
  const isVersus = show?.performance_mode === 'versus';
  const state = show?.derived_state;
  const live = state === 'live';

  // ── load + poll the show payload ──────────────────────────────
  const load = useCallback(async () => {
    const res = await api(`/api/viewer/show/${showId}`, { accessToken });
    if (!res.ok) { setLoadError(res.status === 404 ? 'notfound' : 'error'); return; }
    setLoadError(null);
    setPayload((prev) => {
      if (prev?.show?.versus_view && res.data.show.versus_view !== prev.show.versus_view) track('versus.view_changed', { view: res.data.show.versus_view }, { showId });
      return res.data;
    });
    if (res.data.myVote) setMyVote(res.data.myVote.choice_index ?? res.data.myVote.text_body ?? null);
  }, [showId, accessToken]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // ── chat: poll (realtime broadcast arrives in Phase 3 with the artist console) ──
  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await api(`/api/viewer/comments?show=${showId}&after=${lastCommentId.current}`);
      if (stop || !res.ok) return;
      const incoming = res.data.comments || [];
      if (incoming.length) {
        lastCommentId.current = Math.max(lastCommentId.current, ...incoming.map((c) => c.id));
        setComments((prev) => [...prev, ...incoming.filter((c) => !prev.some((p) => p.id === c.id))].slice(-200));
      }
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [showId]);

  // ── journey: joined / left ──
  useEffect(() => {
    track('show.joined', { live: Boolean(live) }, { showId });
    return () => track('show.left', {}, { showId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  // ── guest preview + metering, driven by player state ──
  useEffect(() => {
    if (!previewRef.current) previewRef.current = new PreviewMeter({ watchedMs: loadWatchedMs() });
    const pm = previewRef.current; const vm = meterRef.current;
    pm.onPlayerState(playerState);
    const events = vm.onPlayerState(playerState);
    if (events.length) sendMetering(events);
    const t = setInterval(() => {
      saveWatchedMs(pm.totalMs());
      if (!signedIn && !sessionLoading) {
        if (pm.expired()) { setGuestGate(true); setChip(false); } else if (pm.chipDue()) setChip(true);
      }
      const due = vm.tick();
      if (due.length) sendMetering(due);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState, signedIn, sessionLoading]);
  useEffect(() => { if (signedIn) { setGuestGate(false); setChip(false); if (sheet === 'signup' || sheet === 'login') setSheet(null); } }, [signedIn, sheet]);

  function positionMs() { try { return apiRef.current?.positionMs?.() ?? null; } catch { return null; } }
  function sendMetering(events) {
    const body = { showId, viewerId: viewerIdOrSession(), userId: session?.user?.id || null, events: events.map((event) => ({ event, playbackPositionMs: positionMs(), clientTs: new Date().toISOString(), source: apiRef.current?.kind || show?.delivery })) };
    fetch('/api/viewer/metering', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }

  // ── gated actions ──
  function gate(action, fn) {
    if (!GATED_ACTIONS.includes(action)) return fn();
    if (!signedIn) { setSheet('signup'); track('signup.started', { trigger: action }, { showId }); return undefined; }
    return fn();
  }

  async function sendComment(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    gate('comment', async () => {
      setDraft('');
      const res = await api('/api/viewer/comments', { method: 'POST', accessToken, body: { showId, body: text, playbackPositionMs: positionMs(), viewerId: viewerIdOrSession() } });
      if (res.ok) { lastCommentId.current = Math.max(lastCommentId.current, res.data.comment.id); setComments((p) => [...p, res.data.comment].slice(-200)); }
      else showToast(res.data?.error || 'Could not send that.');
    });
  }
  async function vote(choiceIndex) {
    gate('vote', async () => {
      if (!prompt) return;
      const res = await api('/api/viewer/vote', { method: 'POST', accessToken, body: { promptId: prompt.id, choiceIndex, playbackPositionMs: positionMs(), viewerId: viewerIdOrSession() } });
      if (res.ok) { setMyVote(choiceIndex); track('vote.cast', { reason: res.data.reason, changed: res.data.changed }, { showId }); if (!isVersus) setVoteOpen(false); }
      else showToast(res.data?.error || 'Could not record your vote.');
    });
  }
  async function react(emoji) {
    gate('react', async () => {
      const slot = isVersus ? (show.versus_view === 'b_performing' ? 'b' : 'a') : null;
      await api('/api/viewer/reactions', { method: 'POST', accessToken, body: { showId, emoji, playbackPositionMs: positionMs(), artistSlot: slot, viewerId: viewerIdOrSession() } });
      showToast(`${emoji} sent`);
    });
  }
  async function toggleFollow() {
    gate('follow', async () => {
      const artistId = show.artist_id;
      if (payload.following) { await unfollowArtist(session.user.id, artistId); setPayload((p) => ({ ...p, following: false })); }
      else { await followArtist(session.user.id, artistId); setPayload((p) => ({ ...p, following: true })); track('follow', {}, { showId }); }
    });
  }
  async function toggleRemind() {
    gate('remind', async () => {
      const sb = getSupabase();
      if (payload.reminded) { await sb.from('show_reminders').delete().eq('user_id', session.user.id).eq('show_id', showId); setPayload((p) => ({ ...p, reminded: false })); }
      else { await sb.from('show_reminders').insert({ user_id: session.user.id, show_id: showId }); setPayload((p) => ({ ...p, reminded: true })); track('reminder.set', {}, { showId }); showToast("We'll remind you"); }
    });
  }
  async function share() {
    const url = `${window.location.origin}/show/${showId}`;
    const title = show?.title || 'A show on Loudentify';
    try { if (navigator.share) await navigator.share({ title, url }); else { await navigator.clipboard.writeText(url); showToast('Link copied'); } } catch { /* cancelled */ }
    track('show.shared', {}, { showId });
  }
  function showToast(text) { setToast(text); setTimeout(() => setToast(null), 2600); }
  function openSupport() { gate('support', () => { supportKey.current = newIdempotencyKey(); setSheet('support'); }); }
  function toggleBigger() { setBigger((b) => { if (!b) track('bigger.used', {}, { showId }); return !b; }); }

  // ── layout ──
  const mode = !show ? 'default' : (sheet === 'signup' || sheet === 'login' || guestGate) ? 'guest' : (voteOpen && prompt) ? 'vote' : bigger ? 'bigger' : state === 'waiting' || state === 'scheduled' ? 'waiting' : 'default';
  const layout = useMemo(() => computeShowLayout({ width: vp.width, height: vp.height, mode }), [vp.width, vp.height, mode]);
  const wide = layout.tier !== 'phone';

  // ── states ──
  if (loadError === 'notfound') return <Shell dark><div style={{ padding: '52px 16px' }}><ErrorState title="We couldn't find this show" body="The link may be wrong, or the show was removed." retry={false} /></div></Shell>;
  if (loadError && !show) return <Shell dark><div style={{ padding: '52px 16px' }}><ErrorState title="We couldn't load this show" body="It may have ended. Try again, or go back to Discover." onRetry={load} /></div></Shell>;
  if (!show) return <Shell dark><LoadingShow layout={layout} /></Shell>;
  if (state === 'ended' || state === 'cancelled') return <Shell dark><EndCard show={show} payload={payload} onFollow={toggleFollow} onRemind={toggleRemind} /></Shell>;

  const abs = (r, extra = {}) => ({ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, ...extra });
  const artistName = show.artist?.display_name || show.artist_name || 'Artist';
  const nameB = show.artist_b?.display_name || 'Artist B';
  const slated = Date.parse(show.slated_at);
  const countdown = slated - Date.now();
  const promptClosesIn = prompt?.closed_at ? Date.parse(prompt.closed_at) - Date.now() : null;
  const versusVote = isVersus && prompt && prompt.kind === 'choice' && Array.isArray(prompt.options) && prompt.options.length === 2;

  const header = (
    <div className="v-row" style={{ gap: 10, padding: wide ? '0 12px' : '52px 12px 0', height: wide ? 56 : undefined, ...(wide ? abs(layout.regions.header) : { position: 'absolute', left: 0, right: 0, top: 0 }) }} data-testid="show-header">
      <a href="/live" aria-label="Leave show" className="v-icon-btn v-btn-dim" style={{ background: 'rgba(1,22,39,0.5)' }}><Back /></a>
      {isVersus ? (
        <div className="v-col" style={{ flex: 1, gap: 3 }}>
          <span className="v-row" style={{ gap: 6, fontSize: 18, fontWeight: 700, lineHeight: 1 }}><span className="v-ellipsis">{artistName}</span><span className="v-badge v-badge-vs">VS</span><span className="v-ellipsis">{nameB}</span></span>
          <span className="v-row" style={{ gap: 8 }}><span className={`v-badge ${live ? 'v-badge-live' : 'v-badge-soon'}`}>{live ? 'LIVE' : 'SOON'}</span><span className="v-row" style={{ gap: 5, fontSize: 14 }}><Eye size={15} />{payload.viewers} watching</span></span>
        </div>
      ) : (
        <a href={show.artist?.username ? `/@${show.artist.username}` : `/artist/${show.artist_id}`} className="v-row" style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <span className="v-avatar" style={{ width: 36, height: 36 }}>{show.artist?.avatar_url ? <img src={show.artist.avatar_url} alt="" /> : <Person size={20} />}</span>
          <span className="v-col" style={{ gap: 3 }}>
            <span className="v-ellipsis" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>{artistName}</span>
            <span className="v-row" style={{ gap: 8 }}><span className={`v-badge ${live ? 'v-badge-live' : 'v-badge-soon'}`}>{live ? 'LIVE' : 'SOON'}</span><span className="v-row" style={{ gap: 5, fontSize: 14 }}><Eye size={15} />{payload.viewers} watching</span></span>
          </span>
        </a>
      )}
      {!isVersus && <button className="v-btn v-btn-teal" onClick={toggleFollow} aria-pressed={Boolean(payload.following)} data-testid="follow">{payload.following ? 'Following' : 'Follow'}</button>}
    </div>
  );

  const sideButton = (label, Icon, onClick, { orange = false, href = null, testid = null } = {}) => {
    const inner = <><span className="v-icon-btn" style={{ background: orange ? 'var(--orange)' : 'rgba(1,22,39,0.55)', color: orange ? 'var(--ink)' : 'var(--porcelain)' }}><Icon /></span><span>{label}</span></>;
    const style = { width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, lineHeight: 1, color: 'var(--porcelain)' };
    return href ? <a key={label} href={href} aria-label={label} style={style}>{inner}</a> : <button key={label} aria-label={label} onClick={onClick} style={style} data-testid={testid}>{inner}</button>;
  };
  const sideColumn = layout.regions.side && (
    <div style={{ ...abs(layout.regions.side), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} data-testid="side-buttons">
      {live ? sideButton('Support', Token, openSupport, { orange: true, testid: 'support' }) : sideButton(payload.reminded ? 'Reminded' : 'Remind me', Bell, toggleRemind, { orange: true, testid: 'remind' })}
      {sideButton('Share', Share, share)}
      {live && sideButton('Bigger', Bigger, toggleBigger, { testid: 'bigger' })}
      {sideButton('Report', Flag, () => setSheet('report'))}
    </div>
  );

  const voteCard = prompt && !voteOpen ? (
    versusVote ? (
      <section aria-label="Pick a side" className="v-card-dark v-row" style={{ padding: '0 8px 0 12px', gap: 8 }}>
        <span className="v-col" style={{ flex: 1, gap: 1 }}><span className="v-kicker" style={{ color: 'var(--teal)', fontSize: 11 }}>Voting is open{promptClosesIn != null ? `, ${fmtCountdown(promptClosesIn)}` : ''}</span><span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.05 }}>{prompt.body}</span></span>
        {prompt.options.map((o, i) => <button key={i} aria-pressed={myVote === i} onClick={() => vote(i)} className="v-btn" style={{ width: 80, padding: '0 4px', fontSize: 14, border: `2px solid ${myVote === i ? 'var(--teal)' : 'transparent'}`, background: myVote === i ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.14)', color: 'var(--porcelain)' }}><span className="v-ellipsis">{typeof o === 'string' ? o : o.label}</span></button>)}
      </section>
    ) : (
      <section aria-label="Vote open" className="v-card-dark v-row" style={{ padding: '0 6px 0 14px', gap: 10 }}>
        <span className="v-col" style={{ flex: 1, gap: 1 }}><span className="v-kicker" style={{ color: 'var(--teal)' }}>Vote open{promptClosesIn != null ? `, ${fmtCountdown(promptClosesIn)} left` : ''}</span><span className="v-ellipsis" style={{ fontSize: 16, fontWeight: 700 }}>{prompt.body}</span></span>
        <button className="v-btn v-btn-teal" onClick={() => gate('vote', () => setVoteOpen(true))} data-testid="vote-open">{myVote != null ? 'Change vote' : 'Vote'}</button>
      </section>
    )
  ) : null;

  const waitingCard = !live ? (
    <section aria-label="Countdown" className="v-card-dark v-row" style={{ padding: '0 16px', justifyContent: 'space-between', gap: 12 }} data-testid="countdown">
      <span className="v-col" style={{ gap: 2 }}><span className="v-kicker" style={{ color: 'var(--teal)' }}>Starts in</span><span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1 }}>{countdown > 0 ? fmtCountdown(countdown) : 'Any moment'}</span></span>
      <span className="v-col" style={{ alignItems: 'flex-end', gap: 2, fontSize: 16 }}><span style={{ fontWeight: 700 }}>{fmtSlot(show.slated_at)}</span><span className="v-muted">Chat is open early</span></span>
    </section>
  ) : null;

  const commentList = (compact = false, lines = null) => (
    <div role="log" aria-label="Comments" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, fontSize: 16, lineHeight: 1.25, minHeight: 0 }} data-testid="comments">
      {(lines ? comments.slice(-lines) : comments.slice(-40)).map((c) => <div key={c.id} className={compact ? 'v-ellipsis' : ''}><span style={{ fontWeight: 700, color: 'var(--orange)' }}>{c.author}</span> {c.body}</div>)}
      {!comments.length && <div className="v-muted" style={{ fontSize: 15 }}>{live ? 'Say something to get the chat going.' : 'Chat is open early. Say hello.'}</div>}
    </div>
  );
  const composer = (
    <form onSubmit={sendComment} className="v-row" style={{ gap: 8 }} data-testid="composer">
      <button type="button" aria-label="Emoji" className="v-icon-btn" style={{ background: 'rgba(253,255,252,0.16)' }} onClick={() => setSheet(sheet === 'emoji' ? null : 'emoji')}><Emoji /></button>
      <button type="button" aria-label="Reactions" className="v-icon-btn" style={{ background: 'rgba(253,255,252,0.16)' }} onClick={() => setSheet(sheet === 'reactions' ? null : 'reactions')}><Heart /></button>
      <input aria-label="Write a comment" placeholder={live ? 'Say something' : 'Say hello'} value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => gate('comment', () => {})} maxLength={500} style={{ flex: 1, minWidth: 0, height: 48, padding: '0 16px', border: 'none', borderRadius: 24, background: 'rgba(253,255,252,0.16)', color: 'var(--porcelain)', fontSize: 17 }} />
      <button type="submit" aria-label="Send" className="v-icon-btn v-btn-teal" style={{ width: 48, height: 48, borderRadius: 24 }}><Send /></button>
    </form>
  );
  const emojiStrip = sheet === 'emoji' && (
    <div className="v-row" style={{ gap: 6, flexWrap: 'wrap', padding: '6px 0' }} role="group" aria-label="Emoji">
      {EMOJI_STRIP.map((e) => <button key={e} onClick={() => { setDraft((d) => d + e); setSheet(null); }} className="v-icon-btn" style={{ fontSize: 22, background: 'rgba(253,255,252,0.12)' }}>{e}</button>)}
    </div>
  );
  const reactionsTab = sheet === 'reactions' && (
    <div className="v-col" style={{ gap: 8, padding: '8px 0' }} role="group" aria-label="Reactions" data-testid="reactions-tab">
      <span className="v-muted" style={{ fontSize: 14 }}>Reactions are free and land where you are in the show. The full design is coming.</span>
      <div className="v-row" style={{ gap: 6, flexWrap: 'wrap' }}>{REACTION_EMOJI.map((e) => <button key={e} onClick={() => react(e)} className="v-icon-btn" style={{ fontSize: 22, background: 'rgba(253,255,252,0.12)' }} aria-label={`React ${e}`}>{e}</button>)}</div>
    </div>
  );

  const voteSheetBody = prompt && (
    <section aria-label="Artist prompt" className="v-sheet-dark" style={{ height: '100%' }} data-testid="vote-sheet">
      <div className="v-row" style={{ justifyContent: 'space-between', height: 24 }}>
        <span className="v-kicker" style={{ color: 'var(--teal)', fontSize: 13 }}>The artist asks</span>
        <span className="v-row" style={{ gap: 12 }}>{promptClosesIn != null && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--orange)' }}>Closes in {fmtCountdown(promptClosesIn)}</span>}<button aria-label="Close" className="v-icon-btn" onClick={() => setVoteOpen(false)}><Close /></button></span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>{prompt.body}</div>
      {prompt.kind === 'choice' ? (prompt.options || []).map((o, i) => (
        <button key={i} aria-pressed={myVote === i} onClick={() => vote(i)} className="v-row" style={{ height: 48, padding: '0 16px', borderRadius: 24, border: `2px solid ${myVote === i ? 'var(--teal)' : 'transparent'}`, background: myVote === i ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.14)', color: 'var(--porcelain)', fontSize: 18, fontWeight: 700, justifyContent: 'space-between' }}>
          <span>{typeof o === 'string' ? o : o.label}</span>{myVote === i && <span style={{ color: 'var(--teal)', display: 'flex' }}><Check /></span>}
        </button>
      )) : <TextAnswer onSend={(text) => api('/api/viewer/vote', { method: 'POST', accessToken, body: { promptId: prompt.id, textBody: text, playbackPositionMs: positionMs() } }).then((r) => { if (r.ok) { setMyVote(text); setVoteOpen(false); } else showToast(r.data?.error || 'Could not send that.'); })} />}
      <div className="v-muted" style={{ fontSize: 14 }}>One vote each. You can change it until voting closes.</div>
    </section>
  );

  const guestSheet = (sheet === 'login') ? <LoginSheet onDone={() => setSheet(null)} onSignUp={() => setSheet('signup')} embedded={wide} />
    : <SignUpSheet trigger={guestGate ? 'timer' : 'tap'} compact onDone={() => { setSheet(null); setGuestGate(false); }} onLogin={() => setSheet('login')} embedded={wide} />;

  // ── phone ──
  if (!wide) {
    return (
      <Shell dark>
        {mode === 'guest' ? (
          <>
            <PlayerFrame show={show} rect={layout.player} apiRef={apiRef} onState={setPlayerState} showLive={live} />
            <div style={{ ...abs(layout.regions.intro), display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}><span className={`v-badge ${live ? 'v-badge-live' : 'v-badge-soon'}`}>{live ? 'LIVE' : 'SOON'}</span><span className="v-row" style={{ gap: 5, fontSize: 14 }}><Eye size={15} />{payload.viewers} watching</span></span>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.05 }}>{isVersus ? `${artistName} vs ${nameB}` : artistName}</span>
              <span style={{ fontSize: 17, lineHeight: 1.25 }}>{guestGate ? 'Your free minute is up.' : 'Sign up to join in.'}</span>
              <span className="v-muted" style={{ fontSize: 15, lineHeight: 1.25 }}>The show keeps playing while you sign up.</span>
            </div>
            <div style={{ ...abs(layout.regions.sheet), overflowY: 'auto' }}>{guestSheet}</div>
          </>
        ) : (
          <>
            {header}
            <PlayerFrame show={show} rect={layout.player} apiRef={apiRef} onState={setPlayerState} showLive={live} />
            {sideColumn}
            {mode === 'vote' && <div style={{ ...abs(layout.regions.sheet) }}>{voteSheetBody}</div>}
            {mode === 'bigger' && (
              <>
                <div className="v-row" style={{ ...abs(layout.regions.chatLine), gap: 10, fontSize: 16 }}>
                  <span className="v-ellipsis" style={{ flex: 1 }}>{comments.length ? <><span style={{ fontWeight: 700, color: 'var(--orange)' }}>{comments[comments.length - 1].author}</span> {comments[comments.length - 1].body}</> : <span className="v-muted">Chat is quiet</span>}</span>
                  <button className="v-link" style={{ color: 'var(--teal)', textDecoration: 'none' }} onClick={toggleBigger}>Open chat</button>
                </div>
                <div className="v-row" style={{ ...abs(layout.regions.actions), justifyContent: 'space-between', gap: 8 }}>
                  <button className="v-btn v-btn-orange" onClick={openSupport}><Token />Support</button>
                  {prompt && <button className="v-btn v-btn-teal" onClick={() => gate('vote', () => { setBigger(false); setVoteOpen(true); })}>Vote{promptClosesIn != null ? `, ${fmtCountdown(promptClosesIn)}` : ''}</button>}
                  <button aria-label="Smaller picture" className="v-icon-btn v-btn-dim" onClick={toggleBigger}><Smaller /></button>
                  <button aria-label="Share" className="v-icon-btn v-btn-dim" onClick={share}><Share /></button>
                </div>
              </>
            )}
            {(mode === 'default' || mode === 'waiting') && (
              <>
                <div style={{ ...abs(layout.regions.card) }}>{live ? voteCard : waitingCard}</div>
                <div style={{ ...abs(layout.regions.comments), display: 'flex', flexDirection: 'column' }}>{emojiStrip}{reactionsTab}{commentList(false, 4)}</div>
                <div style={{ ...abs(layout.regions.composer) }}>{composer}</div>
              </>
            )}
          </>
        )}
        {chip && !signedIn && !guestGate && (
          <div role="status" className="v-row" style={{ position: 'absolute', left: 16, right: 16, top: 56, zIndex: 5, justifyContent: 'space-between', gap: 12, padding: '8px 8px 8px 18px', borderRadius: 999, background: 'var(--porcelain)', color: 'var(--ink)' }} data-testid="preview-chip">
            <span className="v-col" style={{ gap: 0 }}><span style={{ fontSize: 17, fontWeight: 700 }}>Sign up free to keep watching</span><span className="v-muted" style={{ fontSize: 14 }}>Preview ends in {Math.ceil((previewRef.current?.remainingMs() || 0) / 1000)} seconds</span></span>
            <button className="v-btn v-btn-ink" onClick={() => setSheet('signup')}>Sign up</button>
          </div>
        )}
        {sheet === 'support' && <SupportSheet show={show} artistName={isVersus ? (show.versus_view === 'b_performing' ? nameB : artistName) : artistName} accessToken={accessToken} showId={showId} keyRef={supportKey} positionMs={positionMs} onClose={() => setSheet(null)} onSent={(a, n) => { setSheet(null); showToast(`Thanks! ${a} tokens to ${n}`); track('support.sent', { amount: a }, { showId }); }} />}
        {sheet === 'report' && <ReportSheet showId={showId} positionMs={positionMs} onClose={() => setSheet(null)} onDone={() => { setSheet(null); showToast("Thanks. We'll look at it."); }} />}
        {toast && <div role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 90, zIndex: 6, padding: '12px 16px', borderRadius: 16, background: 'var(--porcelain)', color: 'var(--ink)', fontSize: 16, fontWeight: 700, textAlign: 'center' }} data-testid="toast">{toast}</div>}
        <OfflineBar />
      </Shell>
    );
  }

  // ── fold / tablet / computer ──
  const r = layout.regions;
  return (
    <Shell dark>
      {layout.tier === 'computer' ? (
        <header className="v-row" style={{ ...abs(r.header), padding: '0 28px', gap: 16, borderBottom: '1px solid rgba(253,255,252,0.12)' }}>
          <a href="/discover" aria-label="Leave show" className="v-icon-btn" style={{ background: 'rgba(253,255,252,0.12)' }}><Back /></a>
          <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: 24 }} />
          <span style={{ flex: 1 }} />
          {signedIn ? <a href="/wallet" className="v-btn v-btn-ghost-dark"><Token />Wallet</a> : <button className="v-btn v-btn-ghost-dark" onClick={() => setSheet('login')}>Log in</button>}
        </header>
      ) : header}
      {layout.tier === 'computer' && (
        <section style={{ ...abs(r.info), display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
          {mode === 'guest' ? guestSheet : mode === 'vote' ? voteSheetBody : (
            <>
              <div className="v-row" style={{ gap: 14 }}><span className="v-avatar" style={{ width: 56, height: 56 }}><Person size={26} /></span><span className="v-col" style={{ gap: 4 }}><span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{isVersus ? `${artistName} vs ${nameB}` : artistName}</span><span className="v-row" style={{ gap: 10 }}><span className={`v-badge ${live ? 'v-badge-live' : 'v-badge-soon'}`}>{live ? 'LIVE' : 'SOON'}</span><span className="v-row" style={{ gap: 5, fontSize: 14 }}><Eye size={15} />{payload.viewers} watching</span></span><span style={{ fontSize: 17, color: 'rgba(253,255,252,0.85)' }}>{show.title}{show.genre ? ` · ${show.genre}` : ''}</span></span></div>
              <div className="v-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <button className="v-btn v-btn-teal" style={{ height: 48 }} onClick={toggleFollow}>{payload.following ? 'Following' : 'Follow'}</button>
                {live ? <button className="v-btn v-btn-orange" style={{ height: 48 }} onClick={openSupport} data-testid="support"><Token />Support</button> : <button className="v-btn v-btn-ghost-dark" style={{ height: 48 }} onClick={toggleRemind} data-testid="remind"><Bell />{payload.reminded ? 'Reminded' : 'Remind me'}</button>}
                <button aria-label="Share show" className="v-icon-btn" style={{ width: 48, height: 48, background: 'rgba(253,255,252,0.14)' }} onClick={share}><Share /></button>
                <button aria-label="Report" className="v-icon-btn" style={{ width: 48, height: 48, background: 'rgba(253,255,252,0.14)' }} onClick={() => setSheet('report')}><Flag /></button>
              </div>
              {live ? (prompt && <div className="v-card-dark v-col" style={{ padding: 16, gap: 10, background: 'rgba(1,22,39,0.6)' }}><span className="v-kicker" style={{ color: 'var(--teal)', fontSize: 13 }}>Vote open{promptClosesIn != null ? `, ${fmtCountdown(promptClosesIn)} left` : ''}</span><span style={{ fontSize: 20, fontWeight: 700 }}>{prompt.body}</span>{(prompt.options || []).map((o, i) => <button key={i} aria-pressed={myVote === i} onClick={() => vote(i)} className="v-row" style={{ height: 48, padding: '0 16px', borderRadius: 24, border: `2px solid ${myVote === i ? 'var(--teal)' : 'transparent'}`, background: myVote === i ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.14)', color: 'var(--porcelain)', fontSize: 18, fontWeight: 700, justifyContent: 'space-between' }}><span>{typeof o === 'string' ? o : o.label}</span>{myVote === i && <Check />}</button>)}</div>) : waitingCard}
              {show.description && <p style={{ fontSize: 17, lineHeight: 1.35, color: 'rgba(253,255,252,0.85)' }}>{show.description}</p>}
            </>
          )}
        </section>
      )}
      <PlayerFrame show={show} rect={layout.player} apiRef={apiRef} onState={setPlayerState} showLive={live} />
      {layout.tier !== 'computer' && r.actions && (
        <div className="v-row" style={{ ...abs(r.actions), justifyContent: 'space-between', gap: 8 }}>
          {live ? <button className="v-btn v-btn-orange" style={{ height: 48 }} onClick={openSupport} data-testid="support"><Token />Support</button> : <button className="v-btn v-btn-ghost-dark" style={{ height: 48 }} onClick={toggleRemind} data-testid="remind"><Bell />{payload.reminded ? 'Reminded' : 'Remind me'}</button>}
          <button className="v-btn v-btn-ghost-dark" style={{ height: 48 }} onClick={share}><Share />Share</button>
          <button className="v-btn v-btn-ghost-dark" style={{ height: 48 }} onClick={() => setSheet('report')}><Flag />Report</button>
        </div>
      )}
      <aside className="v-panel-dark" style={{ ...abs(r.panel), padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        {layout.tier !== 'computer' && (mode === 'guest' ? <div style={{ overflowY: 'auto' }}>{guestSheet}</div> : mode === 'vote' ? voteSheetBody : null)}
        {!(layout.tier !== 'computer' && (mode === 'guest' || mode === 'vote')) && (
          <>
            {layout.tier !== 'computer' && (live ? voteCard : waitingCard)}
            {emojiStrip}{reactionsTab}
            {commentList()}
            {composer}
          </>
        )}
      </aside>
      {chip && !signedIn && !guestGate && <div role="status" className="v-row" style={{ position: 'absolute', left: r.panel.x, width: r.panel.w, top: r.panel.y - 56, justifyContent: 'space-between', gap: 12, padding: '6px 8px 6px 18px', borderRadius: 999, background: 'var(--porcelain)', color: 'var(--ink)' }} data-testid="preview-chip"><span style={{ fontSize: 16, fontWeight: 700 }}>Sign up free to keep watching</span><button className="v-btn v-btn-ink" onClick={() => setSheet('signup')}>Sign up</button></div>}
      {sheet === 'support' && <SupportSheet show={show} artistName={artistName} accessToken={accessToken} showId={showId} keyRef={supportKey} positionMs={positionMs} onClose={() => setSheet(null)} onSent={(a, n) => { setSheet(null); showToast(`Thanks! ${a} tokens to ${n}`); track('support.sent', { amount: a }, { showId }); }} wide />}
      {sheet === 'report' && <ReportSheet showId={showId} positionMs={positionMs} onClose={() => setSheet(null)} onDone={() => { setSheet(null); showToast("Thanks. We'll look at it."); }} wide />}
      {toast && <div role="status" style={{ position: 'absolute', left: r.panel.x, width: r.panel.w, bottom: 40, zIndex: 6, padding: '12px 16px', borderRadius: 16, background: 'var(--porcelain)', color: 'var(--ink)', fontSize: 16, fontWeight: 700, textAlign: 'center' }} data-testid="toast">{toast}</div>}
      <OfflineBar />
    </Shell>
  );
}

function Shell({ children, dark }) {
  return <div className={`v-root ${dark ? 'v-dark' : 'v-light'}`} style={{ position: 'relative', height: '100dvh', overflow: 'hidden' }} data-testid="show-screen">{children}</div>;
}

function LoadingShow({ layout }) {
  const r = layout.regions;
  return (
    <div role="status" aria-label="Loading show">
      <div style={{ position: 'absolute', left: 12, right: 12, top: 52 }} className="v-row"><Skeleton w={44} h={44} r={22} /><Skeleton w={160} h={36} /></div>
      <Skeleton w={layout.player.w} h={layout.player.h} r={0} style={{ position: 'absolute', left: layout.player.x, top: layout.player.y }} />
      {r.card && <Skeleton w={r.card.w} h={r.card.h} r={16} style={{ position: 'absolute', left: r.card.x, top: r.card.y }} />}
      {r.panel && <Skeleton w={r.panel.w} h={r.panel.h} r={20} style={{ position: 'absolute', left: r.panel.x, top: r.panel.y }} />}
    </div>
  );
}

function TextAnswer({ onSend }) {
  const [t, setT] = useState('');
  return <form onSubmit={(e) => { e.preventDefault(); if (t.trim()) onSend(t.trim()); }} className="v-row" style={{ gap: 8 }}><input aria-label="Your answer" value={t} onChange={(e) => setT(e.target.value)} maxLength={300} style={{ flex: 1, height: 48, padding: '0 16px', borderRadius: 24, border: 'none', background: 'rgba(253,255,252,0.16)', color: 'var(--porcelain)', fontSize: 17 }} /><button className="v-icon-btn v-btn-teal" style={{ width: 48, height: 48 }} aria-label="Send answer"><Send /></button></form>;
}

function SheetWrap({ children, onClose, wide, label }) {
  return (
    <div role="dialog" aria-label={label} style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: wide ? 'center' : 'flex-end', justifyContent: 'center', background: 'rgba(1,22,39,0.45)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: wide ? 480 : undefined, maxHeight: '85%', overflowY: 'auto', borderRadius: wide ? 24 : undefined }}>{children}</div>
    </div>
  );
}

function SupportSheet({ show, artistName, accessToken, showId, keyRef, positionMs, onClose, onSent, wide }) {
  const [amount, setAmount] = useState(25);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [balance, setBalance] = useState(null);
  useEffect(() => { api('/api/viewer/wallet', { accessToken }).then((r) => { if (r.ok) setBalance(r.data.balance); }); }, [accessToken]);
  async function send() {
    if (busy) return;
    setBusy(true); setErr(null);
    const res = await api('/api/viewer/support', { method: 'POST', accessToken, body: { showId, amountTokens: amount, message, idempotencyKey: keyRef.current, playbackPositionMs: positionMs() } });
    setBusy(false);
    if (res.ok) onSent(amount, artistName);
    else setErr(res.status === 402 ? `Not enough tokens. You have ${res.data?.balance ?? 0}. Get more on the web.` : res.data?.error || 'Could not send that. Try again.');
  }
  return (
    <SheetWrap onClose={onClose} wide={wide} label="Support">
      <section aria-labelledby="support-title" className="v-sheet" style={{ borderRadius: wide ? 24 : undefined, gap: 16 }} data-testid="support-sheet">
        {!wide && <div className="v-sheet-handle" />}
        <div className="v-row" style={{ justifyContent: 'space-between', gap: 12 }}><h1 id="support-title" style={{ fontSize: 28 }}>Support {artistName}</h1><button aria-label="Close" className="v-icon-btn v-btn-ghost-light" onClick={onClose}><Close /></button></div>
        <span className="v-row" style={{ gap: 8, fontSize: 17 }}><Token />You have <strong>{balance == null ? '…' : balance} tokens</strong></span>
        <div role="radiogroup" aria-label="Amount" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {SUPPORT_AMOUNTS.map((a) => <button key={a} role="radio" aria-checked={amount === a} onClick={() => setAmount(a)} className="v-col" style={{ height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 0, background: amount === a ? '#fff' : 'rgba(255,255,255,0.72)', border: amount === a ? '2px solid var(--ink)' : '2px solid transparent', color: 'var(--ink)' }}><span style={{ fontSize: 22, fontWeight: 700 }}>{a}</span><span style={{ fontSize: 13 }}>tokens</span></button>)}
        </div>
        <label className="v-field" style={{ fontSize: 15 }}>Add a message (optional)<input placeholder="The artist sees this on screen" value={message} maxLength={SUPPORT_MESSAGE_MAX} onChange={(e) => setMessage(e.target.value)} style={{ background: 'rgba(255,255,255,0.72)' }} /></label>
        <p style={{ fontSize: 15, lineHeight: 1.35, color: 'rgba(1,22,39,0.78)' }}>Most of it goes straight to the artist. No odds, no prizes, just support.</p>
        {err && <div className="v-error" role="alert"><span>{err}</span></div>}
        <button className="v-btn v-btn-lg v-btn-teal" onClick={send} disabled={busy} data-testid="support-send"><Token />{busy ? 'Sending' : `Send ${amount} tokens`}</button>
        {balance != null && balance < amount && <a className="v-link" style={{ alignSelf: 'center' }} href="/wallet">Get tokens on the web</a>}
      </section>
    </SheetWrap>
  );
}

function ReportSheet({ showId, positionMs, onClose, onDone, wide }) {
  const [reason, setReason] = useState('');
  const reasons = ['Harassment or hate', 'Sexual content', 'Violence or danger', 'Spam or a scam', 'Something else'];
  return (
    <SheetWrap onClose={onClose} wide={wide} label="Report">
      <section className="v-sheet" style={{ borderRadius: wide ? 24 : undefined }} data-testid="report-sheet">
        {!wide && <div className="v-sheet-handle" />}
        <div className="v-row" style={{ justifyContent: 'space-between' }}><h1 style={{ fontSize: 26 }}>Report this show</h1><button aria-label="Close" className="v-icon-btn v-btn-ghost-light" onClick={onClose}><Close /></button></div>
        <p className="v-muted" style={{ fontSize: 15 }}>One tap sends the show, the moment and your reason to the safety queue.</p>
        <div className="v-col" style={{ gap: 8 }}>{reasons.map((r) => <button key={r} aria-pressed={reason === r} onClick={() => setReason(r)} className="v-btn v-btn-ghost-light" style={{ justifyContent: 'flex-start', height: 48, border: reason === r ? '2px solid var(--ink)' : '2px solid transparent' }}>{r}</button>)}</div>
        <button className="v-btn v-btn-lg v-btn-ink" disabled={!reason} onClick={() => { track('report.sent', { reason, position_ms: positionMs() }, { showId }); onDone(); }}>Send report</button>
      </section>
    </SheetWrap>
  );
}

function EndCard({ show, payload, onFollow, onRemind }) {
  const [liveNow, setLiveNow] = useState(null);
  useEffect(() => { api('/api/viewer/live').then((r) => setLiveNow(r.ok ? r.data.liveNow.filter((s) => s.id !== show.id).slice(0, 2) : [])); }, [show.id]);
  const name = show.artist?.display_name || show.artist_name || 'the artist';
  return (
    <div style={{ height: '100%', padding: '52px 16px 36px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }} data-testid="end-card">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><a href="/discover" aria-label="Close" className="v-icon-btn" style={{ background: 'rgba(253,255,252,0.12)' }}><Close /></a></div>
      <div className="v-col" style={{ alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <span className="v-avatar" style={{ width: 88, height: 88, border: '2px solid rgba(253,255,252,0.6)', background: 'var(--silk-card)' }}><Person size={36} /></span>
        <h1 style={{ fontSize: 34, lineHeight: 1.05 }}>{show.cancelled_at ? 'This show was cancelled' : "That's the show"}</h1>
        <p style={{ fontSize: 18, color: 'rgba(253,255,252,0.85)' }}>{show.cancelled_at ? `${name} will be back.` : `Thanks for watching ${name}`}</p>
        <div className="v-row" style={{ gap: 8, marginTop: 4 }}><button className="v-btn v-btn-teal" onClick={onFollow}>{payload.following ? 'Following' : 'Follow'}</button>{show.artist_id && <a className="v-btn v-btn-ghost-dark" href={`/artist/${show.artist_id}`}><Play />Recordings</a>}</div>
      </div>
      {payload.nextShow && (
        <div className="v-row" style={{ padding: 14, borderRadius: 18, background: 'rgba(253,255,252,0.1)', gap: 12 }}>
          <div className="v-col" style={{ flex: 1, gap: 2 }}><span className="v-kicker" style={{ color: 'var(--teal)', fontSize: 13 }}>Next from {name}</span><span style={{ fontSize: 18, fontWeight: 700 }}>{payload.nextShow.title || 'A show'}</span><span style={{ fontSize: 15, color: 'rgba(253,255,252,0.8)' }}>{fmtSlot(payload.nextShow.slated_at)}</span></div>
          <a className="v-btn v-btn-ghost-dark" style={{ height: 40 }} href={`/show/${payload.nextShow.id}`}><Bell />Remind me</a>
        </div>
      )}
      <section className="v-col" style={{ gap: 10 }}>
        <h2 className="v-h2" style={{ fontSize: 20 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--red)' }} />Live now on Loudentify</h2>
        {liveNow === null ? <Skeleton h={150} /> : liveNow.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>{liveNow.map((s) => <a key={s.id} href={`/show/${s.id}`} className="v-col" style={{ gap: 6 }}><span className="v-poster" style={{ height: 150, borderRadius: 14 }}><span className="v-badge v-badge-live" style={{ position: 'absolute', top: 8, left: 8 }}>LIVE</span></span><span style={{ fontSize: 17, fontWeight: 700 }}>{s.performance_mode === 'versus' ? `${s.artist?.display_name} vs ${s.artist_b?.display_name}` : s.artist?.display_name}</span></a>)}</div>
        ) : <span className="v-muted">Nothing live right now. Three shows start later today.</span>}
      </section>
      <div style={{ flex: 1 }} />
      <a className="v-btn v-btn-lg v-btn-ghost-dark" href="/discover" style={{ fontSize: 18 }}>Back to Discover</a>
    </div>
  );
}
