// Device-zoom spike test screen (docs/DIRECTOR_DATA_SPEC.md, Part A and C).
// Dev build only: needs native/modules/loud-camera. Three modes:
//   Camera      this phone publishes its camera and obeys zoom/pan commands
//   Controller  this phone sends commands and shows the round trip
//   Survey      read the B2 profile, write it to a file, exit (no LiveKit);
//               also reachable as loudentify://spike/zoom?mode=survey for
//               a device farm.
import { Component, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Share } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { styles } from '../../src/theme';
import { color } from '../../src/shared';
import { useSession } from '../../src/session';
import { File } from 'expo-file-system';
import * as LoudCamera from '../../modules/loud-camera';
import { SpikeSession, runSurvey, latestReportFile, listReportFiles, shareReportFile } from '../../src/spike/runtime';
import { FRAME_SOURCES } from '../../src/spike/zoomPlan';
import { proWarnings, residualLine, STAGES } from '../../src/spike/proMode';

const mono = { color: color.porcelain, fontSize: 13, fontFamily: 'monospace' };

/**
 * A render error anywhere below this must not take the app down (a
 * release build turns an uncaught render error into a process crash,
 * which is what happened on 14 Oct when the camera preview rendered
 * before its publication existed). The boundary shows the error in the
 * spike's own log style and leaves the rest of the screen working.
 */
class SpikeErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError?.(String(error?.message || error)); }
  render() {
    if (this.state.error) {
      return (
        <View style={[this.props.style, { padding: 12, justifyContent: 'center' }]}>
          <Text style={[mono, { color: '#ff9f1c' }]}>{this.props.label || 'This part of the screen hit an error'}: {String(this.state.error?.message || this.state.error)}</Text>
          <Pressable onPress={() => this.setState({ error: null })}><Text style={[mono, { marginTop: 8 }]}>Tap to retry</Text></Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
/** The controller's log line for an ack: the move cycle (includes the move) and the command latency (network leg out), then what the camera did. */
function ackLine(p) {
  const r = p.ack.result || {};
  const did = r.refused ? `REFUSED: ${r.reason}` : p.command.type === 'pan' ? `${r.mode} [${r.path}] moved ${fx(r.achieved, 3)} of ${fx(r.requested, 3)} frame` : `${r.mode} ${r.achieved}x${r.clamped ? ' (clamped)' : ''}`;
  return `ack ${p.command.type} cycle ${p.moveCycleMs} ms · command ${p.commandLatencyMs ?? '–'} ms → ${did}${r.lensSwitch ? ' LENS SWITCH' : ''} · ${r.frameSource} · dropped ${r.droppedFrames}`;
}
/** The pro-mode presets the controller offers; each row is gated by the camera's proSupport (docs/SPIKE_PRO_MODE_PLAN.md section 4). */
const PRO_ROWS = [
  { key: 'iso', label: 'ISO', presets: [[100, '100'], [400, '400'], [1600, '1600'], [3200, '3200']] },
  { key: 'shutter', label: 'Shutter', presets: [[4.17, '1/240'], [8.33, '1/120'], [16.67, '1/60'], [33.33, '1/30'], [66.67, '1/15']] },
  { key: 'wb', label: 'WB', presets: [[3200, '3200K'], [4500, '4500K'], [5600, '5600K'], [7500, '7500K']] },
  { key: 'focus', label: 'Focus', presets: [[0, '∞'], [0.5, '2 m'], [1, '1 m'], [3.33, '0.3 m']] },
  { key: 'ev', label: 'EV', presets: [[-1, '−1'], [-0.33, '−⅓'], [0, '0'], [0.33, '+⅓'], [1, '+1']] },
];
const LOCK_ROWS = [['ae', 'AE', 'lockAe'], ['awb', 'AWB', 'lockAwb'], ['af', 'AF', 'lockAf']];
/** The controller's log line for a pro or match ack. */
function proAckLine(p) {
  const r = p.ack.result || {};
  if (p.command.type === 'stage') return `stage ${r.achieved} on the camera`;
  if (p.command.type === 'survey') return `camera capability: ${r.profile?.hardwareLevel ?? '?'} level, pro controls ${Object.entries(r.profile?.proSupport || {}).filter(([k, v]) => k !== 'hardwareLevel' && v?.supported).map(([k]) => k).join(', ') || 'none'}`;
  if (p.command.type === 'match') return r.phase === 'read' ? `match read: ISO ${r.targets?.iso ?? '–'}, ${r.targets?.shutterMs ?? '–'} ms, ${r.targets?.wbKelvin ?? '–'} K` : `match apply: residual ${residualLine(r.residual)}${r.reasons?.length ? ` (${r.reasons.join('; ')})` : ''}`;
  const base = `pro ${r.control} ${p.command.value ?? ''} → ${r.supported === false ? 'UNSUPPORTED' : `achieved ${r.achieved ?? '–'}`}${r.clamped ? ' (clamped)' : ''}${r.reason ? ` · ${r.reason}` : ''}`;
  return `${base}${r.warnings?.length ? ` · WARN ${r.warnings.join(' | ')}` : ''}${r.fpsExpected ? ` · fps expected ${r.fpsExpected}` : ''} · ${p.moveCycleMs} ms`;
}

/** The camera's log line for a move it ran (or refused). */
function resultLine(p) {
  const r = p.result;
  if (r.refused) return `refused ${p.command.type} ${p.command.direction}: ${r.reason}`;
  const what = p.command.type === 'pan' ? `moved ${fx(r.achieved, 3)} of ${fx(r.requested, 3)} frame at ${r.zoomAtPan}x` : `${r.achieved}x${r.releasedCrop ? ' (crop released)' : ''}`;
  return `did ${p.command.type}: ${r.mode}${r.path ? ` [${r.path}]` : ''} ${what} in ${r.actualDurationMs} ms, ${r.frameSource}, dropped ${r.droppedFrames}${r.reason ? ` (${r.reason})` : ''}`;
}
function Btn({ label, onPress, tone = 'ghost', small }) {
  const bg = tone === 'teal' ? styles.btnTeal : tone === 'orange' ? styles.btnOrange : styles.btnGhostDark;
  const tx = tone === 'ghost' ? styles.btnTextDark : styles.btnText;
  return <Pressable style={[styles.btn, bg, small ? { minHeight: 40, paddingHorizontal: 12 } : null]} onPress={onPress}><Text style={[tx, small ? { fontSize: 14 } : null]}>{label}</Text></Pressable>;
}

/**
 * Pro mode controls (controller role). Only what the camera's proSupport
 * marks supported is live; the rest is greyed with its one-line reason.
 * A warning the planner expects (frame rate, grain, slow path) is logged
 * before the command goes, and comes back in the ack too.
 */
function ProPanel({ s, cameraProfile, push }) {
  const sup = cameraProfile?.proSupport;
  if (!cameraProfile) return <Text style={mono}>pro mode: waiting for the camera's capability (sent on connect; tap "Ask camera" to retry)</Text>;
  const send = (control, value) => {
    for (const w of proWarnings(control, value, { fps: 30, pro: cameraProfile.pro })) push(`WARN ${w}`);
    s?.pro(control, value).catch((e) => push(String(e)));
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.bodyDark, { fontWeight: '700' }]}>Pro mode · {cameraProfile.hardwareLevel ?? '?'} level · {cameraProfile.model ?? ''}</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Btn small label="Enable" tone="teal" onPress={() => send('enable', null)} />
        <Btn small label="Disable (all auto)" onPress={() => send('disable', null)} />
        <Btn small label="Match cameras" tone="orange" onPress={() => s?.matchCameras().catch((e) => push(String(e)))} />
        <Btn small label="Ask camera" onPress={() => s?.requestSurvey().catch((e) => push(String(e)))} />
      </View>
      {PRO_ROWS.map((row) => {
        const c = sup?.[row.key];
        if (!c?.supported) return <Text key={row.key} style={[mono, { color: color.mutedOnDark }]}>{row.label}: unavailable — {c?.reason ?? 'not surveyed'}</Text>;
        return (
          <View key={row.key} style={[styles.row, { flexWrap: 'wrap', alignItems: 'center' }]}>
            <Text style={mono}>{row.label} ({c.min}–{c.max}):</Text>
            {row.presets.filter(([v]) => v >= c.min - 1e-9 && v <= c.max + 1e-9).map(([v, label]) => <Btn key={label} small label={label} onPress={() => send(row.key, v)} />)}
          </View>
        );
      })}
      <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'center' }]}>
        {LOCK_ROWS.map(([value, label, key]) => (sup?.[key]?.supported
          ? <View key={value} style={[styles.row, { gap: 4 }]}><Btn small label={`Lock ${label}`} onPress={() => send('lock', value)} /><Btn small label={`Unlock ${label}`} onPress={() => send('unlock', value)} /></View>
          : <Text key={value} style={[mono, { color: color.mutedOnDark }]}>{label} lock: unavailable — {sup?.[key]?.reason ?? 'not surveyed'}</Text>))}
      </View>
    </View>
  );
}

export default function ZoomSpike() {
  useKeepAwake();
  const params = useLocalSearchParams();
  const { accessToken, session, loading } = useSession();
  const [mode, setMode] = useState(params.mode === 'survey' ? 'survey' : null);
  const [log, setLog] = useState([]);
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState(null);
  const [lastAck, setLastAck] = useState(null);
  const [status, setStatus] = useState('idle');
  const [collect, setCollect] = useState(true);
  const [survey, setSurvey] = useState(null);
  const [remote, setRemote] = useState(null);
  const [VideoTrack, setVideoTrack] = useState(null);
  // Which frame path the Camera role asks for (auto picks hardware where the camera allows it; cpu is the old path, kept for comparison).
  const [frameSource, setFrameSource] = useState('auto');
  // Pro mode (controller role): the camera's capability as it reported it, the current test stage.
  const [cameraProfile, setCameraProfile] = useState(null);
  const [stage, setStage] = useState(null);
  const sess = useRef(null);

  const push = (line) => setLog((l) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...l].slice(0, 60));

  useEffect(() => { try { setVideoTrack(() => require('@livekit/react-native').VideoTrack); } catch { /* Expo Go */ } }, []);

  // Survey mode: no sign-in, no LiveKit. Read, write, show the path, exit.
  useEffect(() => {
    if (mode !== 'survey') return;
    (async () => {
      try {
        setStatus('surveying');
        const r = await runSurvey();
        setSurvey(r); setStatus('survey written');
        push(`survey written: ${r.path}`);
        if (params.exit === '1') setTimeout(() => router.back(), 1500);
      } catch (e) { setStatus('survey failed'); push(String(e?.message || e)); }
    })();
  }, [mode]);

  useEffect(() => () => { sess.current?.stop(); }, []);

  async function begin(role) {
    if (!accessToken) { push('sign in as an artist first (Profile tab)'); return; }
    setMode(role); setStatus('connecting');
    const s = new SpikeSession({
      role, accessToken, userId: session?.user?.id, frameSource,
      onEvent: (kind, p) => {
        if (kind === 'profile') setProfile(p);
        else if (kind === 'state') setState(p);
        else if (kind === 'ack') { setLastAck(p); push(['pro', 'match', 'stage', 'survey'].includes(p.command.type) ? proAckLine(p) : ackLine(p)); }
        else if (kind === 'result') push(['pro', 'match', 'stage', 'survey'].includes(p.command.type) ? `did ${p.command.type} ${p.command.control ?? p.command.phase ?? p.command.stage ?? ''}: ${p.result.supported === false ? 'unsupported' : `achieved ${p.result.achieved ?? p.result.targets?.iso ?? '–'}`}${p.result.reason ? ` (${p.result.reason})` : ''}` : resultLine(p));
        else if (kind === 'cameraProfile') { setCameraProfile(p); push(`camera pro capability received (${p.hardwareLevel ?? '?'} level)`); }
        else if (kind === 'stage') { setStage(p); push(`stage ${p ?? 'none'}`); }
        else if (kind === 'match') push(p.ok ? `match cameras: targets ISO ${p.targets.iso}, ${p.targets.shutterMs} ms, ${p.targets.wbKelvin} K; ${p.results.map((r) => `${r.from}: ${residualLine(r.residual)}`).join('; ')}` : `match cameras failed: ${p.reason}`);
        else if (kind === 'frameSource') push(p.used ? `frame path: ${p.used}${p.fellBack ? ' (FELL BACK' : ''}${p.reason ? ` — ${p.reason}` : ''}${p.fellBack ? ')' : ''}` : `frame path wanted: ${p.wanted}`);
        else if (kind === 'command') push(`command ${p.type} ${p.target ?? p.direction}`);
        else if (kind === 'connected') { setStatus(`in ${p.room} as ${p.identity}`); push(`connected as ${p.identity}`); if (role === 'controller') setTimeout(() => s.requestSurvey().catch(() => {}), 1500); }
        else if (kind === 'published') push(`publishing track ${p.trackSid}`);
        else if (kind === 'remote') setRemote(p);
        else if (kind === 'clock') push(`clock offset ${p.offsetMs} ms ±${p.errorBoundMs}`);
        else if (kind === 'upload') push(`batch ${p.ok ? 'ok' : 'FAILED'} ${p.records ?? ''} rec ${p.gzBytes ?? ''} B gz ${p.error || p.status || ''}`);
        else if (kind === 'reportUpload') { /* logged by finish() */ }
        else if (kind === 'collect') setCollect(p);
        else if (kind === 'soak') push(p.done ? `soak done after ${p.moves} moves` : `soak move ${p.moves} at ${p.minutes} min`);
        else if (kind === 'error') push(`error: ${p}`);
        else if (kind === 'disconnected') { setStatus(`disconnected (${p})`); }
      },
    });
    sess.current = s;
    try { await s.connect(); } catch (e) { setStatus('failed'); push(String(e?.message || e)); }
  }

  async function finish() {
    const s = sess.current; if (!s) return;
    let written = null;
    try {
      written = await s.writeReport();
      push(`report written: ${written.name}`);
      push(written.upload?.ok ? `report uploaded to the bucket: ${written.upload.path}` : `report upload FAILED: ${written.upload?.error || written.upload?.status}`);
    } catch (e) { push(String(e?.message || e)); }
    await s.stop(); sess.current = null; setMode(null); setStatus('stopped'); setState(null); setRemote(null);
    // The app's documents folder is private to the app on Android (not in
    // Files, not over USB), so the report is offered as a FILE through the
    // share sheet; "Share last report" below re-opens it any time.
    if (written) { try { await shareReportFile(new File(written.uri)); } catch (e) { push(`share: ${String(e?.message || e)}`); } }
  }

  async function shareLatest() {
    const f = latestReportFile();
    if (!f) { push('no report on this phone yet'); return; }
    await shareOne(f);
  }
  async function shareOne(f) {
    push(`sharing ${f.name}`);
    try { await shareReportFile(f); } catch (e) { push(`share: ${String(e?.message || e)}`); }
  }
  // Every report still on the phone, newest first; refreshed whenever the
  // idle screen shows (a report written by an older build is here too).
  const [reports, setReports] = useState([]);
  useEffect(() => { if (!mode) setReports(listReportFiles()); }, [mode, status]);
  const reportLabel = (f) => {
    const m = f.name.match(/^spike-report-([a-z]+)-(.+)-(\d{10,})\.json$/);
    const when = m ? new Date(Number(m[3])) : null;
    return `${m ? m[1] : 'report'} · ${when ? `${when.toISOString().slice(0, 10)} ${when.toTimeString().slice(0, 5)}` : f.name}`;
  };

  if (!LoudCamera.available) {
    return <View style={[styles.screenDark, { padding: 20, paddingTop: 80, gap: 12 }]}><Text style={styles.h1Dark}>Dev build needed</Text><Text style={styles.bodyDark}>This screen needs the LoudCamera native module, which Expo Go does not carry. Build with `eas build --profile development --platform android` (docs/NEEDS_KOREY.md).</Text><Btn label="Back" onPress={() => router.back()} /></View>;
  }

  if (mode === 'survey') {
    return (
      <ScrollView style={styles.screenDark} contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 10 }}>
        <Text style={styles.h1Dark}>Capability survey</Text>
        <Text style={styles.bodyDark}>{status}</Text>
        {survey && <Text style={mono}>{survey.name}{'\n'}{survey.path}</Text>}
        {survey && <Text style={mono}>{JSON.stringify({ make: survey.profile.make, model: survey.profile.model, os: `${survey.profile.os} ${survey.profile.osVersion}`, deviceZoom: survey.profile.deviceZoom, activeMode: survey.profile.activeMode, lenses: survey.profile.lenses.length, maxResolution: survey.profile.maxResolution, maxFrameRate: survey.profile.maxFrameRate, stabilisation: survey.profile.stabilisation }, null, 1)}</Text>}
        <View style={styles.row}>
          {survey && <Btn label="Share file" onPress={() => Share.share({ message: JSON.stringify(survey.profile), title: survey.name })} tone="teal" />}
          <Btn label="Exit" onPress={() => router.back()} />
        </View>
      </ScrollView>
    );
  }

  if (!mode) {
    return (
      <View style={[styles.screenDark, { padding: 16, paddingTop: 56, gap: 12 }]}>
        <Text style={styles.h1Dark}>Device zoom spike</Text>
        <Text style={styles.bodyDark}>{loading ? 'Checking sign-in…' : accessToken ? 'Signed in. Pick this phone’s role.' : 'Sign in as an artist (Profile tab) for Camera or Controller. Survey needs no sign-in.'}</Text>
        <Btn label="Camera (publishes, obeys commands)" tone="teal" onPress={() => begin('camera')} />
        <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'center' }]}>
          <Text style={mono}>frame path:</Text>
          {FRAME_SOURCES.map((f) => <Btn key={f} small label={f === frameSource ? `[${f}]` : f} onPress={() => setFrameSource(f)} />)}
        </View>
        <Btn label="Controller (sends commands)" tone="orange" onPress={() => begin('controller')} />
        <Btn label="Capability survey (no LiveKit)" onPress={() => setMode('survey')} />
        <Btn label="Back" onPress={() => router.back()} />
        <Text style={[styles.bodyDark, { fontWeight: '700', marginTop: 8 }]}>Share a report</Text>
        {reports.length === 0 && <Text style={mono}>No report on this phone yet.</Text>}
        <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: 6 }}>
          {reports.map((f) => <Btn key={f.name} small label={reportLabel(f)} onPress={() => shareOne(f)} />)}
        </ScrollView>
      </View>
    );
  }

  const s = sess.current;
  const st = state;
  return (
    <View style={styles.screenDark}>
      <SpikeErrorBoundary label="Preview" style={{ height: 300, backgroundColor: '#000' }} onError={(e) => push(`preview error: ${e}`)}>
        <View style={{ height: 300, backgroundColor: '#000' }}>
          {(() => {
            // LiveKit's VideoTrack reads trackRef.publication.track without a guard: render it only once the publication and its track exist.
            const localPub = mode === 'camera' && s?.track && s?.room ? s.room.localParticipant.getTrackPublication('camera') : null;
            if (VideoTrack && mode === 'camera' && localPub?.track) return <VideoTrack trackRef={{ participant: s.room.localParticipant, publication: localPub, source: 'camera' }} style={{ flex: 1 }} objectFit="cover" />;
            if (VideoTrack && mode === 'controller' && remote?.publication?.track) return <VideoTrack trackRef={{ participant: remote.participant, publication: remote.publication, source: remote.publication?.source }} style={{ flex: 1 }} objectFit="cover" />;
            if (mode === 'controller') return <Text style={[styles.bodyDark, { padding: 12 }]}>Waiting for the camera phone…</Text>;
            return <Text style={[styles.bodyDark, { padding: 12 }]}>{s?.track ? 'Preview starting…' : 'Starting the camera…'}</Text>;
          })()}
        </View>
      </SpikeErrorBoundary>
      <SpikeErrorBoundary label="Controls" style={{ flex: 1 }} onError={(e) => push(`screen error: ${e}`)}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        <Text style={[styles.bodyDark, { fontWeight: '700' }]}>{mode.toUpperCase()} · {status}</Text>
        {profile && <Text style={mono}>B2 {profile.make} {profile.model} · {profile.os} {profile.osVersion} · zoom {profile.deviceZoom.available ? `${profile.deviceZoom.min}–${profile.deviceZoom.max}x device` : 'DIGITAL FALLBACK ≤1.2x'}{profile.qualityCeiling?.zoom != null ? ` · 1080p ceiling ${profile.qualityCeiling.zoom}x` : ''}{profile.deviceZoom.switchOverFactors?.length ? ` · lens switch at ${profile.deviceZoom.switchOverFactors.join(', ')}x` : ' · no lens switch'} · frame path {profile.frameSource?.eligible ?? '?'}</Text>}
        {st && <Text style={mono}>B4 {st.frameSource} · zoom {st.deviceZoom}x device × {st.digitalFactor} crop = {st.effectiveZoom}x · lens {st.activePhysicalId || st.cameraId} · {st.width}×{st.height}@{st.fps} · dropped {st.droppedFrames} · conv {st.convertMsPerFrame ?? '–'} ms{st.moving ? ` · MOVING ${st.moveKind}` : ''}</Text>}
        {st && <Text style={mono}>light EV {fx(st.sceneEv, 1)} · ISO {st.iso ?? '–'} · {fx(st.exposureMs, 1)} ms · f/{st.aperture ?? '–'}{st.frameSource === 'hardware' ? ` · region ${st.appliedCrop ? `${fx(st.appliedCrop.w, 3)}@${fx(st.appliedCrop.x, 3)},${fx(st.appliedCrop.y, 3)}` : '–'} pushes ${st.regionPushes}` : ''}</Text>}
        {st?.pro?.enabled && <Text style={mono}>PRO on · AE {st.pro.aeMode ?? '?'}{st.pro.aeLock ? ' locked' : ''} · AWB {st.pro.awbMode ?? '?'}{st.pro.awbLock ? ' locked' : ''} · AF {st.pro.afMode ?? '?'} · ISO {st.pro.iso ?? '–'} · {st.pro.shutterMs ?? '–'} ms · WB {st.pro.wbKelvin ?? '–'} K · focus {st.pro.focusDiopters ?? '–'} dpt · EV {st.pro.evStops ?? 0} · frame {st.pro.frameDurationMs ?? '–'} ms</Text>}
        <Text style={mono}>stage {stage ?? 'none'}{mode === 'controller' ? '' : ' (set by the controller)'}</Text>
        {lastAck && <Text style={mono}>last move cycle {lastAck.moveCycleMs} ms (includes the move) · command latency {lastAck.commandLatencyMs ?? '–'} ms · ack leg {lastAck.ackLegMs ?? '–'} ms (server clock)</Text>}
        {mode === 'controller' && (
          <>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {[1, 1.5, 2, 3, 5].map((z) => <Btn key={z} small label={`${z}x`} tone="teal" onPress={() => s?.zoom(z, 2000).catch((e) => push(String(e)))} />)}
              <Btn small label="1x fast" onPress={() => s?.zoom(1, 400, 'ease-out').catch((e) => push(String(e)))} />
            </View>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {['left', 'right', 'up', 'down'].map((d) => <Btn key={d} small label={`pan ${d}`} tone="orange" onPress={() => s?.pan(d).catch((e) => push(String(e)))} />)}
            </View>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Btn small label="Start 20-min soak" onPress={() => s?.startSoak(20)} />
              <Btn small label="Stop soak" onPress={() => s?.stopSoak()} />
              {STAGES.map((x) => <Btn key={x} small label={stage === x ? `[Stage ${x}]` : `Stage ${x}`} onPress={() => s?.setStage(x).catch((e) => push(String(e)))} />)}
            </View>
            <ProPanel s={s} cameraProfile={cameraProfile} push={push} />
          </>
        )}
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Btn small label={collect ? 'Collection ON' : 'Collection OFF'} onPress={() => s?.setCollect(!collect)} />
          <Btn small label="Upload now" onPress={() => s?.maybeUpload(true).catch((e) => push(String(e)))} />
          <Btn small label="Report + stop" tone="teal" onPress={finish} />
          <Btn small label="Share last report" onPress={shareLatest} />
        </View>
        {s && <Text style={mono}>{JSON.stringify({ latency: s.latencySummary(), shots: s.shots, cost: s.costSummary(), storage: s.storageSummary() })}</Text>}
        {log.map((l, i) => <Text key={i} style={[mono, { color: color.mutedOnDark }]}>{l}</Text>)}
      </ScrollView>
      </SpikeErrorBoundary>
    </View>
  );
}
