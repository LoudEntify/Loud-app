// Device-zoom spike test screen (docs/DIRECTOR_DATA_SPEC.md, Part A and C).
// Dev build only: needs native/modules/loud-camera. Three modes:
//   Camera      this phone publishes its camera and obeys zoom/pan commands
//   Controller  this phone sends commands and shows the round trip
//   Survey      read the B2 profile, write it to a file, exit (no LiveKit);
//               also reachable as loudentify://spike/zoom?mode=survey for
//               a device farm.
import { useEffect, useRef, useState } from 'react';
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

const mono = { color: color.porcelain, fontSize: 13, fontFamily: 'monospace' };
const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
/** The controller's log line for an ack: the move cycle (includes the move) and the command latency (network leg out), then what the camera did. */
function ackLine(p) {
  const r = p.ack.result || {};
  const did = r.refused ? `REFUSED: ${r.reason}` : p.command.type === 'pan' ? `${r.mode} [${r.path}] moved ${fx(r.achieved, 3)} of ${fx(r.requested, 3)} frame` : `${r.mode} ${r.achieved}x${r.clamped ? ' (clamped)' : ''}`;
  return `ack ${p.command.type} cycle ${p.moveCycleMs} ms · command ${p.commandLatencyMs ?? '–'} ms → ${did}${r.lensSwitch ? ' LENS SWITCH' : ''} · ${r.frameSource} · dropped ${r.droppedFrames}`;
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
        else if (kind === 'ack') { setLastAck(p); push(ackLine(p)); }
        else if (kind === 'result') push(resultLine(p));
        else if (kind === 'frameSource') push(`frame source wanted: ${p.wanted}`);
        else if (kind === 'command') push(`command ${p.type} ${p.target ?? p.direction}`);
        else if (kind === 'connected') { setStatus(`in ${p.room} as ${p.identity}`); push(`connected as ${p.identity}`); }
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
      <View style={{ height: 300, backgroundColor: '#000' }}>
        {VideoTrack && mode === 'camera' && s?.track && s?.room && <VideoTrack trackRef={{ participant: s.room.localParticipant, publication: s.room.localParticipant.getTrackPublication('camera'), source: 'camera' }} style={{ flex: 1 }} objectFit="cover" />}
        {VideoTrack && mode === 'controller' && remote && <VideoTrack trackRef={{ participant: remote.participant, publication: remote.publication, source: remote.publication?.source }} style={{ flex: 1 }} objectFit="cover" />}
        {mode === 'controller' && !remote && <Text style={[styles.bodyDark, { padding: 12 }]}>Waiting for the camera phone…</Text>}
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        <Text style={[styles.bodyDark, { fontWeight: '700' }]}>{mode.toUpperCase()} · {status}</Text>
        {profile && <Text style={mono}>B2 {profile.make} {profile.model} · {profile.os} {profile.osVersion} · zoom {profile.deviceZoom.available ? `${profile.deviceZoom.min}–${profile.deviceZoom.max}x device` : 'DIGITAL FALLBACK ≤1.2x'}{profile.qualityCeiling?.zoom != null ? ` · 1080p ceiling ${profile.qualityCeiling.zoom}x` : ''}{profile.deviceZoom.switchOverFactors?.length ? ` · lens switch at ${profile.deviceZoom.switchOverFactors.join(', ')}x` : ' · no lens switch'} · frame path {profile.frameSource?.eligible ?? '?'}</Text>}
        {st && <Text style={mono}>B4 {st.frameSource} · zoom {st.deviceZoom}x device × {st.digitalFactor} crop = {st.effectiveZoom}x · lens {st.activePhysicalId || st.cameraId} · {st.width}×{st.height}@{st.fps} · dropped {st.droppedFrames} · conv {st.convertMsPerFrame ?? '–'} ms{st.moving ? ` · MOVING ${st.moveKind}` : ''}</Text>}
        {st && <Text style={mono}>light EV {fx(st.sceneEv, 1)} · ISO {st.iso ?? '–'} · {fx(st.exposureMs, 1)} ms · f/{st.aperture ?? '–'}{st.frameSource === 'hardware' ? ` · region ${st.appliedCrop ? `${fx(st.appliedCrop.w, 3)}@${fx(st.appliedCrop.x, 3)},${fx(st.appliedCrop.y, 3)}` : '–'} pushes ${st.regionPushes}` : ''}</Text>}
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
            </View>
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
    </View>
  );
}
