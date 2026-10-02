'use client';
// components/artist/ConsoleScreen.jsx — Countdown (Countdown.dc.html) then
// the live console (Console.dc.html; YT-ArtistTalk / Request / Handover /
// Perform for Versus; FixSheet.dc.html).
//
// What the artist sees is exactly the composed frame that goes out (the
// compositor renders the same layout the egress records), a few seconds
// ahead of viewers. Conversation and Perform change the view; a Perform
// while the other artist is on stage asks them; the Fix sheet switches the
// mic in place, rechecks cameras and reconnects; End show is press-and-hold.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { composeLayout, renderFrame } from '../../lib/pipeline/compositor';
import { track } from '../../lib/telemetry';
import { SHOW_PROMPTS } from '../../lib/showPrompts';
import { Skeleton, ErrorState, OfflineBar, useOnline } from '../viewer/States';
import { Eye, Warn, Check, Close, Send } from '../viewer/Icons';

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function ConsoleScreen({ showId }) {
  const router = useRouter();
  const online = useOnline();
  const { session, loading, accessToken } = useSession();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [tickData, setTickData] = useState(null);
  const [comments, setComments] = useState([]);
  const [sheet, setSheet] = useState(null); // 'fix' | 'prompt' | 'vote' | null
  const [stream, setStream] = useState(null);
  const [mics, setMics] = useState([]);
  const [micId, setMicId] = useState(null);
  const [camHealthy, setCamHealthy] = useState(true);
  const [holdPct, setHoldPct] = useState(0);
  const [ending, setEnding] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const videoRef = useRef(null); const canvasRef = useRef(null); const lastComment = useRef(0); const holdRef = useRef(null);
  const show = data?.show; const slot = data?.slot; const isVersus = show?.performance_mode === 'versus';
  const live = Boolean(tickData?.live ?? (show?.actual_started_at && !show?.actual_ended_at));

  const load = useCallback(async () => {
    if (!accessToken) return;
    const r = await api(`/api/artist/shows/${showId}/console`, { accessToken });
    if (!r.ok) { setErr(r.data?.error || 'Could not open the console.'); return; }
    setData(r.data);
  }, [accessToken, showId]);
  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session, router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // own camera + mic (the self-view and the frame that is composed)
  useEffect(() => {
    let s;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: micId ? { deviceId: { exact: micId } } : true });
        setStream(s); if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
        const list = await navigator.mediaDevices.enumerateDevices(); setMics(list.filter((d) => d.kind === 'audioinput'));
        s.getVideoTracks()[0]?.addEventListener('ended', () => setCamHealthy(false));
      } catch { setCamHealthy(false); }
    })();
    return () => { s?.getTracks().forEach((t) => t.stop()); };
  }, [micId]);

  // the heartbeat: push a frame, check delivery, read state
  useEffect(() => {
    if (!accessToken || !show) return undefined;
    let stop = false;
    const beat = async () => {
      const r = await api(`/api/artist/shows/${showId}/tick`, { method: 'POST', accessToken, body: { healthy: { a: slot === 'a' ? camHealthy : true, b: slot === 'b' ? camHealthy : true } } });
      if (!stop && r.ok) { setTickData(r.data); if (r.data.versusView && r.data.versusView !== show.versus_view) setData((d) => ({ ...d, show: { ...d.show, versus_view: r.data.versusView } })); }
      const c = await api(`/api/viewer/comments?show=${showId}&after=${lastComment.current}`);
      if (!stop && c.ok && c.data.comments.length) { lastComment.current = Math.max(lastComment.current, ...c.data.comments.map((x) => x.id)); setComments((p) => [...p, ...c.data.comments].slice(-60)); }
    };
    beat();
    const t = setInterval(beat, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [accessToken, show, showId, slot, camHealthy]);

  // draw the composed frame: exactly what is broadcast
  useEffect(() => {
    let raf;
    const loop = () => {
      const c = canvasRef.current, v = videoRef.current;
      if (c && show) {
        const layout = composeLayout({ mode: show.performance_mode, view: show.versus_view, w: c.width, h: c.height, healthy: { a: slot === 'a' ? camHealthy : true, b: slot === 'b' ? camHealthy : true } });
        const sources = { [slot]: v && v.readyState >= 2 ? v : null };
        renderFrame(c.getContext('2d'), layout, { sources, names: { a: show.artist?.display_name || 'You', b: show.artist_b?.display_name || 'Artist B' } });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show, slot, camHealthy, stream]);

  // foreground rule: warn before leaving mid-show
  useEffect(() => {
    if (!live) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [live]);

  async function goLive() {
    if (goingLive) return; setGoingLive(true);
    const r = await api(`/api/artist/shows/${showId}/go-live`, { method: 'POST', accessToken });
    setGoingLive(false);
    if (r.ok) { track('show.go_live', { from: 'console' }, { showId }); await load(); } else setErr(r.data?.error || 'Could not go live.');
  }
  async function versus(action) {
    const r = await api(`/api/artist/shows/${showId}/versus`, { method: 'POST', accessToken, body: { action } });
    if (r.ok) { if (r.data.view) setData((d) => ({ ...d, show: { ...d.show, versus_view: r.data.view } })); if (r.data.request) setTickData((t) => ({ ...t, pendingRequest: r.data.request })); }
  }
  async function answerRequest(answer) {
    const req = tickData?.pendingRequest; if (!req) return;
    const r = await api(`/api/artist/shows/${showId}/stage-request`, { method: 'POST', accessToken, body: { requestId: req.id, answer } });
    if (r.ok) { setTickData((t) => ({ ...t, pendingRequest: null })); setData((d) => ({ ...d, show: { ...d.show, versus_view: r.data.view } })); }
  }
  async function pushPrompt(p) {
    const r = await api('/api/show-prompts', { method: 'POST', accessToken, body: { room: show.room_name, kind: p.kind, body: p.body, options: p.options, source: p.key ? 'saved' : 'composed', key: p.key } });
    setSheet(null);
    if (!r.ok) setErr(r.data?.error || 'Could not push the prompt.');
  }
  async function closePrompt() {
    if (!tickData?.prompt) return;
    await api('/api/show-prompts', { method: 'PATCH', accessToken, body: { room: show.room_name, promptId: tickData.prompt.id } });
  }
  function holdStart() { const t0 = Date.now(); holdRef.current = setInterval(() => { const p = Math.min(100, ((Date.now() - t0) / 1500) * 100); setHoldPct(p); if (p >= 100) { clearInterval(holdRef.current); endShow(); } }, 50); }
  function holdEnd() { clearInterval(holdRef.current); setHoldPct(0); }
  async function endShow() {
    if (ending) return; setEnding(true);
    const r = await api(`/api/artist/shows/${showId}/end`, { method: 'POST', accessToken });
    if (r.ok) { track('show.ended', {}, { showId }); router.replace(`/artist/post-show/${showId}`); } else { setEnding(false); setErr(r.data?.error || 'Could not end the show.'); }
  }

  if (err && !data) return <Shell><div style={{ padding: '52px 16px' }}><ErrorState title="We couldn't open the console" body={err} onRetry={() => { setErr(null); load(); }} backHref="/profile" backLabel="Your profile" /></div></Shell>;
  if (!data) return <Shell><div style={{ padding: '52px 16px', display: 'flex', flexDirection: 'column', gap: 12 }} role="status" aria-label="Loading console"><Skeleton h={28} w={180} /><Skeleton h={420} /><Skeleton h={48} /></div></Shell>;
  if (show.actual_ended_at) { router.replace(`/artist/post-show/${showId}`); return null; }

  const slated = Date.parse(show.slated_at);
  const untilSlot = slated - now;
  const elapsed = show.actual_started_at ? now - Date.parse(show.actual_started_at) : 0;
  const delivery = tickData?.delivery?.state || show.delivery_state;
  const myViewFor = slot === 'a' ? 'a_performing' : 'b_performing';
  const onStage = show.versus_view === myViewFor;
  const pending = tickData?.pendingRequest;
  const askedByMe = pending && pending.from_slot === slot;
  const askedOfMe = pending && pending.to_slot === slot;
  const viewers = tickData?.viewers ?? 0;

  // ── countdown (before go-live) ──
  if (!live) {
    const inWindow = untilSlot <= 30 * 60000;
    const autoAt = untilSlot <= 0;
    if (autoAt && !goingLive && data.slot === 'a' && !show.actual_started_at) goLive();
    return (
      <Shell>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 18 }} data-testid="countdown-screen">
          <canvas ref={canvasRef} width={540} height={960} style={{ width: 'min(60vw, 304px)', aspectRatio: '9/16', outline: '1px solid rgba(253,255,252,0.28)' }} aria-label="Your camera" />
          <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
          <span className="v-row" style={{ gap: 8 }}><span className="v-icon-btn" style={{ width: 28, height: 28, background: 'var(--silk-teal)', color: 'var(--ink)' }}><Check size={16} /></span>{data.lastKitCheck?.length ? 'Kit check saved' : <a className="v-link" href={`/artist/kit-check?show=${showId}`}>Run Kit Check</a>}</span>
          <div role="timer" aria-label={untilSlot > 0 ? `${fmt(untilSlot)} until you go live` : 'Going live'} className="v-col" style={{ alignItems: 'center', gap: 4, textAlign: 'center' }}>
            <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>{untilSlot > 0 ? fmt(untilSlot) : '0'}</span>
            <span style={{ fontSize: 18 }}>{untilSlot > 0 ? 'to live' : goingLive ? 'Going live' : 'Starting'}</span>
            <span className="v-muted" style={{ fontSize: 15 }}>Stay on this screen. Your show starts on its own at zero.</span>
          </div>
          {data.slot === 'a' && inWindow && untilSlot > 0 && <button className="v-btn v-btn-ghost-dark" onClick={goLive} disabled={goingLive} data-testid="go-live-now">Start a little early</button>}
          {!inWindow && <span className="v-muted" style={{ fontSize: 15 }}>Your window opens 30 minutes before the slot.</span>}
          {err && <ErrorState title="Not yet" body={err} retry={false} backHref={null} />}
          <div className="v-row" style={{ gap: 10 }}><button className="v-btn v-btn-ghost-dark" onClick={() => setSheet('fix')}>Fix</button><a className="v-btn v-btn-ghost-dark" href="/profile">Leave</a></div>
        </div>
        {sheet === 'fix' && <FixSheet mics={mics} micId={micId} onMic={setMicId} elapsed={0} live={false} camHealthy={camHealthy} onRecheck={() => { setCamHealthy(true); setMicId((m) => m); }} onClose={() => setSheet(null)} />}
      </Shell>
    );
  }

  // ── live console ──
  return (
    <Shell>
      <OfflineBar />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '52px 12px 20px', gap: 10, overflowY: 'auto' }} data-testid="console">
        <div className="v-row" style={{ gap: 8 }}>
          <span className="v-badge v-badge-live">LIVE</span><span style={{ fontSize: 17, fontWeight: 700 }}>{fmt(elapsed)}</span>
          <span className="v-row" style={{ gap: 5, fontSize: 14 }}><Eye size={15} />{viewers}{data.youtubeMode === 'google' ? ' on YouTube' : ''}</span>
          <span style={{ flex: 1 }} />
          <span className={`v-badge ${delivery === 'ok' ? 'v-badge-soon' : 'v-badge-live'}`} style={delivery === 'ok' ? { background: 'var(--teal)' } : undefined} data-testid="delivery-state">{delivery === 'ok' ? 'DELIVERING' : delivery === 'reconnecting' ? 'RECONNECTING' : delivery === 'failed' ? 'NOT DELIVERING' : String(delivery || '').toUpperCase()}</span>
          {!isVersus && <button className="v-chip v-chip-dark" style={{ height: 32, fontSize: 14 }}>Director: Auto</button>}
        </div>
        {/* the composed frame shrinks so the controls below it always fit the phone (a hidden End show button is not acceptable) */}
        <div style={{ position: 'relative', alignSelf: 'center', width: `min(100%, 304px, calc((100dvh - ${isVersus ? 470 : 410}px) * 9 / 16))`, minWidth: 140, aspectRatio: '9/16', flexShrink: 0 }}>
          <canvas ref={canvasRef} width={540} height={960} style={{ width: '100%', height: '100%', outline: '1px solid rgba(253,255,252,0.28)', display: 'block' }} role="img" aria-label="What is being broadcast" data-testid="composed-frame" />
          <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
          {delivery !== 'ok' && <span className="v-kicker" style={{ position: 'absolute', left: 8, bottom: 8, padding: '4px 8px', borderRadius: 999, background: 'rgba(231,29,54,0.85)', fontSize: 12 }}>{delivery === 'reconnecting' ? 'YouTube reconnecting · recording continues' : 'YouTube not delivering · recording continues'}</span>}
        </div>
        <div className="v-muted" style={{ fontSize: 14, textAlign: 'center' }}>Viewers see this about {tickData?.delaySeconds != null ? Math.round(tickData.delaySeconds) : '5'} seconds behind.</div>
        {isVersus && (
          <div className="v-row" style={{ gap: 8 }} data-testid="versus-controls">
            <button className="v-col" aria-pressed={show.versus_view === 'conversation'} onClick={() => versus('conversation')} style={{ flex: 1, padding: 10, borderRadius: 16, background: show.versus_view === 'conversation' ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.1)', border: `2px solid ${show.versus_view === 'conversation' ? 'var(--teal)' : 'transparent'}`, color: 'var(--porcelain)', alignItems: 'flex-start' }}><span style={{ fontSize: 17, fontWeight: 700 }}>Conversation</span><span className="v-muted" style={{ fontSize: 13 }}>Split screen</span></button>
            {askedByMe ? <span className="v-col" style={{ flex: 1, padding: 10, borderRadius: 16, background: 'rgba(255,159,28,0.2)', border: '2px solid var(--orange)' }} data-testid="asking"><span style={{ fontSize: 17, fontWeight: 700 }}>Asking {show[pending.to_slot === 'a' ? 'artist' : 'artist_b']?.display_name || 'them'}</span><span className="v-muted" style={{ fontSize: 13 }}>Waiting for a reply</span></span>
              : <button className="v-col" aria-pressed={onStage} onClick={() => versus('perform')} style={{ flex: 1, padding: 10, borderRadius: 16, background: onStage ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.1)', border: `2px solid ${onStage ? 'var(--teal)' : 'transparent'}`, color: 'var(--porcelain)', alignItems: 'flex-start' }} data-testid="perform"><span style={{ fontSize: 17, fontWeight: 700 }}>Perform</span><span className="v-muted" style={{ fontSize: 13 }}>{onStage ? 'You are on stage' : 'Your turn'}</span></button>}
          </div>
        )}
        <div className="v-row" style={{ gap: 8, justifyContent: 'center' }}>
          {[['prompt', 'Prompt'], ['vote', 'Vote'], ['fix', 'Fix']].map(([k, l]) => <button key={k} aria-label={l} className="v-col" style={{ alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, width: 60 }} onClick={() => setSheet(k)}><span className="v-icon-btn" style={{ background: k === 'fix' ? 'var(--orange)' : 'rgba(253,255,252,0.14)', color: k === 'fix' ? 'var(--ink)' : 'var(--porcelain)' }}>{k === 'fix' ? <Warn /> : k === 'vote' ? <Check /> : <Send />}</span><span>{l}</span></button>)}
        </div>
        {tickData?.prompt && <div className="v-card-dark v-row" style={{ padding: '8px 12px', gap: 8 }}><span className="v-col" style={{ flex: 1, gap: 1 }}><span className="v-kicker" style={{ color: 'var(--teal)' }}>Prompt open</span><span className="v-ellipsis" style={{ fontWeight: 700 }}>{tickData.prompt.body}</span></span><button className="v-btn v-btn-ghost-dark" style={{ height: 36 }} onClick={closePrompt}>Close voting</button></div>}
        <div role="log" aria-label="Comments" className="v-panel-dark" style={{ flex: 1, minHeight: 60, overflow: 'hidden', padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, fontSize: 15 }}>
          {comments.slice(-6).map((c) => <div key={c.id} className="v-ellipsis"><span style={{ fontWeight: 700, color: 'var(--orange)' }}>{c.author}</span> {c.body}</div>)}
          {!comments.length && <span className="v-muted">Comments appear here.</span>}
        </div>
        {slot === 'a' && (
          <button onMouseDown={holdStart} onMouseUp={holdEnd} onMouseLeave={holdEnd} onTouchStart={holdStart} onTouchEnd={holdEnd} className="v-btn v-btn-lg" style={{ position: 'relative', overflow: 'hidden', background: 'rgba(231,29,54,0.25)', color: 'var(--porcelain)', border: '2px solid var(--red)' }} aria-label="Press and hold to end show" data-testid="end-show" disabled={ending}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${holdPct}%`, background: 'var(--red)', transition: 'width 50ms linear' }} />
            <span style={{ position: 'relative' }}>{ending ? 'Ending…' : 'Press and hold to end show'}</span>
          </button>
        )}
        {err && <ErrorState title="Something didn't work" body={err} retry={false} backHref={null} onRetry={() => setErr(null)} />}
      </div>
      {askedOfMe && (
        <section aria-label="Stage request" className="v-sheet-dark" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 }} data-testid="stage-request">
          <div className="v-sheet-handle" style={{ background: 'rgba(253,255,252,0.3)' }} />
          <span className="v-kicker" style={{ color: 'var(--orange)' }}>Stage request</span>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{show[pending.from_slot === 'a' ? 'artist' : 'artist_b']?.display_name || 'The other artist'} wants to perform</span>
          <span className="v-muted" style={{ fontSize: 15 }}>If you hand over, the screen switches to them and you move to the small window.</span>
          <button className="v-btn v-btn-lg v-btn-teal" onClick={() => answerRequest('handover')} data-testid="handover">Hand over the stage</button>
          <button className="v-btn v-btn-lg v-btn-ghost-dark" onClick={() => answerRequest('not_yet')} data-testid="not-yet">Not yet</button>
        </section>
      )}
      {sheet === 'fix' && <FixSheet mics={mics} micId={micId} onMic={(id) => { setMicId(id); setSheet(null); }} elapsed={elapsed} live camHealthy={camHealthy} onRecheck={() => { setCamHealthy(true); setMicId((m) => m); setSheet(null); }} onClose={() => setSheet(null)} />}
      {(sheet === 'prompt' || sheet === 'vote') && <PromptSheet kind={sheet} isVersus={isVersus} names={{ a: show.artist?.display_name || 'A', b: show.artist_b?.display_name || 'B' }} onPush={pushPrompt} onClose={() => setSheet(null)} />}
    </Shell>
  );
}

function Shell({ children }) { return <div className="v-root v-dark" style={{ position: 'relative', height: '100dvh', overflow: 'hidden' }}>{children}</div>; }

function FixSheet({ mics, micId, onMic, elapsed, live, camHealthy, onRecheck, onClose }) {
  return (
    <div role="dialog" aria-label="Fix something" style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(1,22,39,0.5)' }} onClick={onClose}>
      <section className="v-sheet" onClick={(e) => e.stopPropagation()} data-testid="fix-sheet">
        <div className="v-sheet-handle" />
        <div className="v-row" style={{ gap: 8 }}>{live && <><span className="v-badge v-badge-live">LIVE</span><span style={{ fontWeight: 700 }}>{fmt(elapsed)}</span><span className="v-muted" style={{ fontSize: 14 }}>Your show is still running</span></>}</div>
        <h1 style={{ fontSize: 26 }}>Fix something</h1>
        <p className="v-muted" style={{ fontSize: 15 }}>Viewers keep watching while you sort it.</p>
        <div role="radiogroup" aria-label="Microphone" className="v-col" style={{ gap: 6 }}>
          <span className="v-kicker" style={{ color: 'var(--ink)' }}>Switch microphone</span>
          {mics.length ? mics.map((m, i) => <button key={m.deviceId || i} role="radio" aria-checked={(micId || mics[0]?.deviceId) === m.deviceId} className="v-btn v-btn-ghost-light" style={{ justifyContent: 'space-between', border: (micId || mics[0]?.deviceId) === m.deviceId ? '2px solid var(--ink)' : '2px solid transparent' }} onClick={() => onMic(m.deviceId)}><span>{m.label || `Microphone ${i + 1}`}</span>{(micId || mics[0]?.deviceId) === m.deviceId && <Check size={18} />}</button>) : <span className="v-muted">No microphones listed yet.</span>}
        </div>
        <button className="v-list-row v-card-light" style={{ width: '100%', textAlign: 'left' }} onClick={onRecheck}><span className="v-col" style={{ flex: 1 }}><span style={{ fontWeight: 700 }}>Recheck cameras</span><span className="v-muted" style={{ fontSize: 14 }}>{camHealthy ? 'Main is live.' : 'Main stalled. Tap to reconnect it.'}</span></span></button>
        <button className="v-list-row v-card-light" style={{ width: '100%', textAlign: 'left' }} onClick={() => window.location.reload()}><span className="v-col" style={{ flex: 1 }}><span style={{ fontWeight: 700 }}>Reconnect</span><span className="v-muted" style={{ fontSize: 14 }}>Rejoin without ending the show</span></span></button>
        <button className="v-btn v-btn-lg v-btn-ink" onClick={onClose}>Back to the show</button>
      </section>
    </div>
  );
}

function PromptSheet({ kind, isVersus, names, onPush, onClose }) {
  const [body, setBody] = useState(kind === 'vote' && isVersus ? 'Who moved you this round?' : '');
  const [options, setOptions] = useState(kind === 'vote' && isVersus ? [names.a, names.b] : ['', '']);
  const saved = Object.values(SHOW_PROMPTS || {}).slice(0, 4);
  return (
    <div role="dialog" aria-label={kind === 'vote' ? 'Vote' : 'Prompt'} style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(1,22,39,0.5)' }} onClick={onClose}>
      <section className="v-sheet" onClick={(e) => e.stopPropagation()} data-testid="prompt-sheet">
        <div className="v-sheet-handle" />
        <div className="v-row" style={{ justifyContent: 'space-between' }}><h1 style={{ fontSize: 26 }}>{kind === 'vote' ? 'Open a vote' : 'Ask your viewers'}</h1><button aria-label="Close" className="v-icon-btn v-btn-ghost-light" onClick={onClose}><Close /></button></div>
        {kind === 'prompt' && saved.length > 0 && <div className="v-row" style={{ gap: 6, flexWrap: 'wrap' }}>{saved.map((p) => <button key={p.key} className="v-chip v-chip-light" onClick={() => { setBody(p.body); setOptions(p.options?.length ? p.options : ['', '']); }}>{p.body.slice(0, 28)}</button>)}</div>}
        <label className="v-field">Question<input value={body} maxLength={280} onChange={(e) => setBody(e.target.value)} placeholder="What should I play next?" /></label>
        {options.map((o, i) => <label key={i} className="v-field">Option {i + 1}<input value={o} maxLength={60} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))} /></label>)}
        {options.length < 4 && <button className="v-link" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions((l) => [...l, ''])}>Add an option</button>}
        <button className="v-btn v-btn-lg v-btn-teal" disabled={!body.trim() || options.filter((o) => o.trim()).length < 2} onClick={() => onPush({ kind: 'choice', body: body.trim(), options: options.map((o) => o.trim()).filter(Boolean) })} data-testid="push-prompt">Push to viewers</button>
      </section>
    </div>
  );
}
