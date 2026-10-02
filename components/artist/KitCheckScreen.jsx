'use client';
// components/artist/KitCheckScreen.jsx — Kit Check (KitCheck.dc.html,
// YT-KitCheck.dc.html). The artist's OWN camera, cropped to the three
// broadcast windows (conversation half, full performing frame, corner
// window) with framing guides; never the YouTube picture. A checklist of
// outcomes, each ready / checking / fix with one fix: mic sending real
// signal on the raw input; camera holding frames for two minutes;
// connection; charging; Do Not Disturb; headphones. Nothing streams.
// Stay here at slot time and you go live on your own.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { composeLayout, renderFrame } from '../../lib/pipeline/compositor';
import { windowOpensAt } from '../../lib/showWindow';
import { track } from '../../lib/telemetry';
import { Skeleton, ErrorState } from '../viewer/States';
import { Back, Check, Warn, Clock } from '../viewer/Icons';

const HOLD_MS = Number(process.env.NEXT_PUBLIC_KITCHECK_HOLD_MS || 120000); // two minutes; tests shorten it
const CROPS = [['conversation', 'Conversation'], ['performing', 'Performing'], ['corner', 'Corner']];

export default function KitCheckScreen({ showId = null }) {
  const router = useRouter();
  const { session, profile, loading, accessToken } = useSession();
  const [show, setShow] = useState(null);
  const [crop, setCrop] = useState('performing');
  const [stream, setStream] = useState(null);
  const [camErr, setCamErr] = useState(null);
  const [checks, setChecks] = useState({ mic_signal: { status: 'checking', detail: 'Listening for your voice' }, camera_frames: { status: 'checking', detail: 'Holding frames, 0 of 2 minutes' }, connection: { status: 'checking', detail: 'Measuring' }, charging: { status: 'checking', detail: 'Checking the battery' }, dnd: { status: 'fix', detail: 'Calls could interrupt your show' }, headphones: { status: 'checking', detail: 'Looking for headphones' } });
  const [saved, setSaved] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [tick, setTick] = useState(0);
  const videoRef = useRef(null); const canvasRef = useRef(null); const framesRef = useRef({ count: 0, last: 0, startedAt: null, stalls: 0 });
  const setCheck = (k, v) => setChecks((c) => ({ ...c, [k]: v }));

  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session, router]);
  useEffect(() => { if (showId && accessToken) api(`/api/artist/shows/${showId}/console`, { accessToken }).then((r) => { if (r.ok) setShow(r.data.show); }); }, [showId, accessToken]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // camera + mic
  useEffect(() => {
    let s;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        setStream(s);
        if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
        // raw mic level (not the mixed output)
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && s.getAudioTracks().length) {
          const ctx = new AC(); const src = ctx.createMediaStreamSource(s); const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
          const buf = new Float32Array(an.fftSize); let peak = 0; let samples = 0;
          const iv = setInterval(() => {
            an.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length); peak = Math.max(peak, rms); samples += 1;
            if (peak > 0.02) setCheck('mic_signal', { status: 'ready', detail: 'Real signal from your voice', level: rms });
            else if (samples > 8) setCheck('mic_signal', { status: 'fix', detail: 'No signal yet. Say something, or switch mic in Fix.', level: rms });
            else setCheck('mic_signal', { status: 'checking', detail: 'Say a few words', level: rms });
          }, 500);
          s.__micInterval = iv;
        } else setCheck('mic_signal', { status: 'fix', detail: 'No microphone found' });
      } catch (e) { setCamErr(e.message || 'Camera access was refused'); setCheck('camera_frames', { status: 'fix', detail: 'Allow camera access to check it' }); setCheck('mic_signal', { status: 'fix', detail: 'Allow microphone access to check it' }); }
    })();
    return () => { if (s) { clearInterval(s.__micInterval); s.getTracks().forEach((t) => t.stop()); } };
  }, []);

  // frames keep arriving: the watchdog
  useEffect(() => {
    if (!stream) return undefined;
    const v = videoRef.current; const f = framesRef.current; f.startedAt = Date.now(); f.last = Date.now();
    let raf; let lastTime = -1;
    const loop = () => {
      if (v && v.currentTime !== lastTime && v.readyState >= 2) { lastTime = v.currentTime; f.count += 1; f.last = Date.now(); }
      if (Date.now() - f.last > 1500) { f.stalls += 1; f.last = Date.now(); }
      const held = Date.now() - f.startedAt;
      if (f.stalls >= 2) setCheck('camera_frames', { status: 'fix', detail: `Frames stalled ${f.stalls} times. Try another camera.` });
      else if (held >= HOLD_MS && f.count > 10) setCheck('camera_frames', { status: 'ready', detail: `Held frames for ${Math.round(HOLD_MS / 60000) || 1} minute${HOLD_MS >= 120000 ? 's' : ''}` });
      else setCheck('camera_frames', { status: 'checking', detail: `Holding frames, ${Math.min(Math.round(held / 1000), Math.round(HOLD_MS / 1000))} of ${Math.round(HOLD_MS / 1000)} s` });
      drawCrop();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, crop]);

  function drawCrop() {
    const c = canvasRef.current, v = videoRef.current; if (!c || !v || v.readyState < 2) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const layout = crop === 'conversation' ? composeLayout({ mode: 'versus', view: 'conversation', w, h }) : crop === 'corner' ? composeLayout({ mode: 'versus', view: 'b_performing', w, h }) : composeLayout({ mode: 'solo', w, h });
    const sources = crop === 'conversation' ? { a: v } : crop === 'corner' ? { a: v } : { a: v };
    renderFrame(ctx, layout, { sources, names: { a: 'You', b: crop === 'corner' ? 'Them' : 'Them' } });
    // framing guides: head room and a centre line
    ctx.strokeStyle = 'rgba(253,255,252,0.35)'; ctx.setLineDash([6, 6]);
    const r = layout.layers.find((l) => l.slot === 'a').rect;
    ctx.strokeRect(r.x + r.w * 0.15, r.y + r.h * 0.08, r.w * 0.7, r.h * 0.5);
    ctx.beginPath(); ctx.moveTo(r.x + r.w / 2, r.y); ctx.lineTo(r.x + r.w / 2, r.y + r.h); ctx.stroke(); ctx.setLineDash([]);
  }

  // connection, charging, headphones
  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        // Best of three round trips: a single cold request says more about the server than the link.
        let ms = Infinity;
        for (let i = 0; i < 3; i += 1) { const t = performance.now(); await fetch('/api/build-info', { cache: 'no-store' }); ms = Math.min(ms, Math.round(performance.now() - t)); }
        // Upload matters more than download for a stream, and the browser's
        // own downlink estimate is unreliable, so time a real 400 KB upload.
        const payload = new Uint8Array(400 * 1024);
        const t1 = performance.now();
        const probe = accessToken ? await fetch('/api/artist/net-probe', { method: 'POST', body: payload, headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${accessToken}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
        const upMs = Math.max(1, performance.now() - t1);
        const upMbps = probe?.bytes ? Math.round(((probe.bytes * 8) / upMs / 1000) * 10) / 10 : null;
        const ok = ms < 1000 && (upMbps == null || upMbps >= 2.5);
        setCheck('connection', ok ? { status: 'ready', detail: `Strong enough to stream (${ms} ms${upMbps ? `, ${upMbps} Mb/s up` : ''})` } : { status: 'fix', detail: `Slow right now (${ms} ms${upMbps != null ? `, ${upMbps} Mb/s up` : ''}). Move closer to the router or use mobile data.` });
      }
      catch { setCheck('connection', { status: 'fix', detail: 'No connection' }); }
      try { const b = await navigator.getBattery?.(); if (!b) setCheck('charging', { status: 'skipped', detail: 'Cannot read the battery in this browser; plug every device in' }); else { const upd = () => setCheck('charging', b.charging ? { status: 'ready', detail: 'Plugged in' } : { status: 'fix', detail: `On battery (${Math.round(b.level * 100)}%). Plug in before the show.` }); upd(); b.addEventListener('chargingchange', upd); } }
      catch { setCheck('charging', { status: 'skipped', detail: 'Cannot read the battery; plug every device in' }); }
      try { const list = await navigator.mediaDevices.enumerateDevices(); const outs = list.filter((d) => d.kind === 'audiooutput'); const wired = outs.find((d) => /head|wired|jack/i.test(d.label)); const bt = outs.find((d) => /bluetooth|airpods|buds/i.test(d.label)); setCheck('headphones', wired ? { status: 'ready', detail: 'Wired, no delay' } : bt ? { status: 'fix', detail: 'Bluetooth adds delay. Wired is better for singing.' } : { status: 'skipped', detail: 'No headphones found; wired is best for singing' }); }
      catch { setCheck('headphones', { status: 'skipped', detail: 'Could not list audio devices' }); }
    })();
  }, [accessToken]);

  const list = [['mic_signal', 'Mic signal'], ['camera_frames', 'Camera'], ['connection', 'Connection'], ['charging', 'Charging'], ['dnd', 'Do Not Disturb'], ['headphones', 'Headphones']];
  const ready = list.filter(([k]) => checks[k].status === 'ready').length;
  const toFix = list.filter(([k]) => checks[k].status === 'fix').length;
  const save = useCallback(async () => {
    if (!accessToken) return;
    await api(`/api/artist/shows/${showId || 'none'}/kit-check`, { method: 'POST', accessToken, body: { items: list.map(([k]) => ({ item: k, status: checks[k].status, detail: checks[k].detail })) } });
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, checks, showId]);

  // At slot time, stay here and you go live on your own (PRD 120)
  const slated = show ? Date.parse(show.slated_at) : null;
  const untilSlot = slated ? slated - Date.now() : null;
  useEffect(() => {
    if (!show || goingLive || show.actual_started_at || untilSlot == null || untilSlot > 0) return;
    setGoingLive(true);
    (async () => { await save(); const r = await api(`/api/artist/shows/${show.id}/go-live`, { method: 'POST', accessToken }); if (r.ok) { track('show.go_live', { from: 'kitcheck' }, { showId: show.id }); router.replace(`/artist/console/${show.id}`); } else setGoingLive(false); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, show]);

  if (loading) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={160} h={30} /><Skeleton h={300} /></div>;
  if (profile && profile.role !== 'artist') return <div className="v-screen"><ErrorState title="Kit Check is for artists" retry={false} backHref="/profile" backLabel="Your profile" /></div>;
  return (
    <div className="v-screen v-dark" style={{ background: 'var(--silk-dark)', color: 'var(--porcelain)' }} data-testid="kit-check">
      <div className="v-row" style={{ gap: 12 }}><a href={show ? '/profile' : '/artist/create'} aria-label="Back" className="v-icon-btn v-btn-ghost-dark"><Back /></a><div className="v-col" style={{ gap: 2 }}><h1 className="v-h1" style={{ fontSize: 28 }}>Kit check</h1><span className="v-muted" style={{ fontSize: 14 }}>Rehearsal. Nothing is streaming.{show ? ` · ${show.title}` : ''}</span></div></div>
      <div className="v-row" style={{ gap: 6 }} role="group" aria-label="Frame">{CROPS.map(([k, l]) => <button key={k} className="v-chip v-chip-dark" aria-pressed={crop === k} style={crop === k ? { border: '2px solid var(--teal)' } : undefined} onClick={() => setCrop(k)}>{l}</button>)}</div>
      <div style={{ position: 'relative', width: '100%', maxWidth: 304, aspectRatio: '9 / 16', margin: '0 auto', outline: '1px solid rgba(253,255,252,0.28)', background: 'var(--poster)' }} role="img" aria-label={`Your camera, cropped to the ${crop} window`}>
        <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
        <canvas ref={canvasRef} width={540} height={960} style={{ width: '100%', height: '100%', display: 'block' }} data-testid="kit-crop" />
        {camErr && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', fontSize: 15 }}>{camErr}</div>}
        <span className="v-kicker" style={{ position: 'absolute', left: 8, bottom: 8, padding: '2px 8px', borderRadius: 999, background: 'rgba(1,22,39,0.7)', fontSize: 12 }}>Your camera only</span>
      </div>
      <ul aria-label="Checks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(([k, label]) => { const c = checks[k]; return (
          <li key={k} className="v-row v-panel-dark" style={{ padding: '10px 12px', gap: 12 }} data-testid={`check-${k}`} data-status={c.status}>
            <span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span><span className="v-muted" style={{ fontSize: 14 }}>{c.detail}</span></span>
            {k === 'mic_signal' && c.level != null && <span aria-hidden="true" className="v-row" style={{ gap: 2 }}>{[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ width: 4, height: 8 + i * 4, borderRadius: 2, background: c.level * 40 > i ? 'var(--teal)' : 'rgba(253,255,252,0.2)' }} />)}</span>}
            {k === 'dnd' && c.status !== 'ready' ? <button className="v-btn v-btn-ghost-dark" style={{ height: 40 }} onClick={() => setCheck('dnd', { status: 'ready', detail: 'On (confirmed by you)' })}>Turn on</button>
              : <span role="img" aria-label={c.status === 'ready' ? 'Ready' : c.status === 'fix' ? 'Fix' : c.status === 'skipped' ? 'Skipped' : 'Checking'} className="v-icon-btn" style={{ width: 32, height: 32, background: c.status === 'ready' ? 'var(--silk-teal)' : c.status === 'fix' ? 'var(--red)' : 'rgba(253,255,252,0.14)', color: c.status === 'ready' ? 'var(--ink)' : 'var(--porcelain)' }}>{c.status === 'ready' ? <Check size={18} /> : c.status === 'fix' ? <Warn size={18} /> : <Clock size={18} />}</span>}
          </li>); })}
      </ul>
      <div className="v-panel-dark v-col" style={{ padding: 14, gap: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{ready} of {list.length} ready{toFix ? `, ${toFix} to fix` : ''}</span>
        <span className="v-muted" style={{ fontSize: 15 }}>{show ? (untilSlot > 0 ? `Stay here and you go live on your own at ${new Date(slated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (in ${Math.ceil(untilSlot / 60000)} min).` : goingLive ? 'Going live now…' : 'Your slot has started.') : 'No show booked for this check.'}</span>
      </div>
      <div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="v-btn v-btn-teal" onClick={save} data-testid="kit-save">{saved ? 'Saved' : 'Looks good'}</button>
        {show && <a className="v-btn v-btn-ghost-dark" href={`/artist/console/${show.id}`} data-testid="kit-to-console">Open the console</a>}
      </div>
    </div>
  );
}
