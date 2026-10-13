'use client';
// components/spike/ControllerScreen.jsx — the laptop half of the device-
// zoom spike (docs/DIRECTOR_DATA_SPEC.md). The phone is the Camera; this
// page is the Controller the phone test script asks for when there is
// only one phone. Everything that matters (room, commands, acks, clock,
// report) is lib/spike/controllerSession.js; this file is the buttons,
// the picture and the log, laid out like native/app/spike/zoom.js.
//
// States: loading (sign-in check), signed out, idle, connecting, waiting
// for the camera phone (empty), connected, error; offline comes from
// ViewerShell's OfflineBar. SPIKE ONLY: delete with app/spike/controller.
import { useEffect, useRef, useState } from 'react';
import { Room } from 'livekit-client';
import { useSession } from '../../lib/useSession';
import { WebControllerSession } from '../../lib/spike/controllerSession';

const mono = { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' };
const small = { height: 40, padding: '0 14px', fontSize: 15 };

function Btn({ label, onPress, tone = 'ghost', disabled }) {
  const cls = tone === 'teal' ? 'v-btn v-btn-teal' : tone === 'orange' ? 'v-btn v-btn-orange' : 'v-btn v-btn-ghost-dark';
  return <button type="button" className={cls} style={small} onClick={onPress} disabled={disabled}>{label}</button>;
}

const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
/** Same line as the phone Controller's: the move cycle (includes the move), the command latency (network leg out), then what the camera did. */
function ackLine(p) {
  const r = p.ack.result || {};
  const did = r.refused ? `REFUSED: ${r.reason}` : p.command.type === 'pan' ? `${r.mode} [${r.path}] moved ${fx(r.achieved, 3)} of ${fx(r.requested, 3)} frame` : `${r.mode} ${r.achieved}x${r.clamped ? ' (clamped)' : ''}`;
  return `ack ${p.command.type} cycle ${p.moveCycleMs} ms · command ${p.commandLatencyMs ?? '–'} ms → ${did}${r.lensSwitch ? ' LENS SWITCH' : ''} · ${r.frameSource} · dropped ${r.droppedFrames}`;
}

function downloadJson(name, object) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ControllerScreen() {
  const { accessToken, session, profile, loading } = useSession();
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);
  const [remote, setRemote] = useState(null);
  const [lastAck, setLastAck] = useState(null);
  const [clock, setClock] = useState(null);
  const [soak, setSoak] = useState(null);
  const [tick, setTick] = useState(0);
  const sess = useRef(null);
  const video = useRef(null);

  const push = (line) => setLog((l) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...l].slice(0, 80));

  // The phone's picture: attach the subscribed track to the <video>.
  useEffect(() => {
    const el = video.current; const track = remote?.track;
    if (!el || !track) return undefined;
    track.attach(el);
    return () => { try { track.detach(el); } catch { /* gone */ } };
  }, [remote]);

  // Refresh the summary line every few seconds while connected.
  useEffect(() => {
    if (status !== 'connected') return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => () => { sess.current?.stop(); }, []);

  async function join() {
    if (!accessToken) { push('sign in as an artist first'); return; }
    setStatus('connecting'); setLastAck(null); setRemote(null);
    const s = new WebControllerSession({
      accessToken, userId: session?.user?.id,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      appVersion: `web-${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local'}`,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      createRoom: () => new Room({ adaptiveStream: false, dynacast: false }),
      onEvent: (kind, p) => {
        if (kind === 'ack') { setLastAck(p); push(ackLine(p)); }
        else if (kind === 'sent') push(`sent ${p.type} ${p.target ?? p.direction}`);
        else if (kind === 'connected') { setStatus('connected'); push(`connected to ${p.room} as ${p.identity}`); }
        else if (kind === 'remote') { setRemote(p); push(p ? `camera track from ${p.participant?.identity}` : 'camera track gone'); }
        else if (kind === 'clock') { setClock(p); push(`clock offset ${p.offsetMs} ms ±${p.errorBoundMs}`); }
        else if (kind === 'upload') push(`batch ${p.ok ? 'ok' : 'FAILED'} ${p.records ?? ''} rec ${p.gzBytes ?? ''} B gz ${p.error || p.status || ''}`);
        else if (kind === 'soak') { setSoak(p.done ? null : p); push(p.done ? `soak done after ${p.moves} moves` : `soak move ${p.moves} at ${p.minutes} min`); }
        else if (kind === 'reportUpload') { /* logged by finish() */ }
        else if (kind === 'error') push(`error: ${p}`);
        else if (kind === 'disconnected') { setStatus('disconnected'); push(`disconnected (${p})`); }
      },
    });
    sess.current = s;
    try { await s.connect(); } catch (e) { setStatus('error'); push(String(e?.message || e)); await s.stop(); sess.current = null; }
  }

  async function finish() {
    const s = sess.current; if (!s) return;
    s.stopSoak(); setSoak(null);
    push('stopping: uploading the last batch…');
    await s.stop();
    const name = s.reportFileName();
    downloadJson(name, s.report());
    push(`report downloaded: ${name}`);
    const up = await s.uploadReport(name);
    push(up.ok ? `report uploaded to the bucket: ${up.path}` : `report upload FAILED: ${up.error || up.status}`);
    sess.current = null; setStatus('stopped'); setRemote(null);
  }

  const s = sess.current;
  const run = (p) => p.catch((e) => push(String(e?.message || e)));
  const live = status === 'connected';
  const isArtist = profile?.role === 'artist';

  return (
    <main className="v-screen v-dark" style={{ maxWidth: 720, margin: '0 auto', gap: 14 }}>
      <div className="v-col">
        <span className="v-kicker" style={{ color: '#2ec4b6' }}>Device-zoom spike · staging only</span>
        <h1 className="v-h1">Controller (laptop)</h1>
        <p className="v-muted" style={{ margin: 0 }}>Sends the zoom and pan commands to the phone running the Camera role, and records every ack with server-clock timestamps.</p>
      </div>

      {loading && <p className="v-muted">Checking sign-in…</p>}
      {!loading && !accessToken && (
        <div className="v-panel-dark v-col" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>Sign in as the same artist account the phone uses.</p>
          <a className="v-btn v-btn-teal" href="/login?next=/spike/controller" style={{ alignSelf: 'flex-start' }}>Log in</a>
        </div>
      )}
      {!loading && accessToken && !isArtist && <p className="v-muted">This account is not an artist account. The spike token is only minted for artists, so joining will be refused.</p>}

      {!loading && accessToken && status !== 'connected' && status !== 'connecting' && (
        <div className="v-row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="v-btn v-btn-orange" onClick={join}>{status === 'idle' ? 'Join as Controller' : 'Join again'}</button>
          {status === 'error' && <span className="v-muted">Could not join. The log below says why.</span>}
        </div>
      )}
      {status === 'connecting' && <p className="v-muted">Connecting to the rehearsal room…</p>}

      <div style={{ background: '#000', borderRadius: 16, aspectRatio: '9 / 16', maxHeight: 420, width: '100%', overflow: 'hidden', display: 'grid', placeItems: 'center', position: 'relative' }}>
        <video ref={video} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: remote ? 'block' : 'none' }} />
        {!remote && <span className="v-muted" style={{ padding: 12, textAlign: 'center' }}>{live ? 'Waiting for the camera phone to publish…' : 'The phone’s picture appears here once you join and the phone is in Camera mode.'}</span>}
      </div>

      <div className="v-col" style={mono}>
        <span><b>{status.toUpperCase()}</b>{s?.connected ? ` · ${s.connected.room} as ${s.connected.identity}` : ''}</span>
        <span>clock source: {process.env.NEXT_PUBLIC_SPIKE_CLOCK_BASE ? `${process.env.NEXT_PUBLIC_SPIKE_CLOCK_BASE} (staging, relayed by this server)` : 'this server'}</span>
        {clock && <span>clock offset {clock.offsetMs} ms ±{clock.errorBoundMs} (server clock)</span>}
        {lastAck && <span>last move cycle {lastAck.moveCycleMs} ms (includes the move) · command latency {lastAck.commandLatencyMs ?? '–'} ms · ack leg {lastAck.ackLegMs ?? '–'} ms (server clock)</span>}
        {lastAck?.ack.result?.shot && <span>camera shot: {lastAck.ack.result.shot.zoom}x at ({lastAck.ack.result.shot.cx}, {lastAck.ack.result.shot.cy}) · {lastAck.ack.result.frameSource}</span>}
        {soak && <span>soak running: move {soak.moves} at {soak.minutes} min</span>}
      </div>

      <div className="v-row" style={{ flexWrap: 'wrap' }}>
        {[1, 2, 5].map((z) => <Btn key={z} label={`${z}x`} tone="teal" disabled={!live} onPress={() => run(s.zoom(z, 2000))} />)}
        <Btn label="1x fast" disabled={!live} onPress={() => run(s.zoom(1, 400, 'ease-out'))} />
      </div>
      <div className="v-row" style={{ flexWrap: 'wrap' }}>
        {['left', 'right', 'up', 'down'].map((d) => <Btn key={d} label={`pan ${d}`} tone="orange" disabled={!live} onPress={() => run(s.pan(d))} />)}
      </div>
      <div className="v-row" style={{ flexWrap: 'wrap' }}>
        <Btn label="Start 20-min soak" disabled={!live || !!soak} onPress={() => s.startSoak(20)} />
        <Btn label="Stop soak" disabled={!soak} onPress={() => { s?.stopSoak(); setSoak(null); push('soak stopped'); }} />
        <Btn label="Report + stop" tone="teal" disabled={!s || status === 'stopped'} onPress={finish} />
      </div>

      {s && <div style={mono} data-tick={tick}>{JSON.stringify({ latency: s.latencySummary(), shots: s.shots, storage: s.storageSummary() })}</div>}
      <div className="v-col" style={{ ...mono, color: '#c9cfd1', gap: 2 }}>
        {log.map((l, i) => <span key={`${i}-${l}`}>{l}</span>)}
      </div>
    </main>
  );
}
