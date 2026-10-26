// Camera mode (CameraMode.dc.html): this phone becomes one camera for an
// artist's show by scanning the pairing code the main device shows.
//
// Until 26 Oct this screen showed a viewfinder and nothing left the phone:
// publishing was waiting on the native camera work. That work is done and
// device-tested (orientation, device zoom, lens switching, pans, the bop,
// pro mode, frame rate, and the front camera's mirror), so the phone now
// publishes for real through native/src/cameraSession.js: scan the code,
// join the room the pairing names, send the picture.
//
// Two cameras live on this screen, and only one at a time: Expo's
// CameraView while scanning (it reads the QR code), then the capturer once
// paired (it owns the camera and publishes). They never run together,
// because two owners of one camera is how a phone ends up with a black
// preview and no error.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, AppState, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { api } from '../src/api';
import { styles } from '../src/theme';
import { color } from '../src/shared';
import { CameraSession } from '../src/cameraSession';
import { FACINGS } from '../src/spike/facing';
import { FRAME_RATE_CHOICES, FRAME_RATE_DEFAULT } from '../src/spike/frameRate';

let VideoTrack = null;
try { VideoTrack = require('@livekit/react-native').VideoTrack; } catch { /* Expo Go: no native LiveKit */ }

export default function CameraMode() {
  useKeepAwake();
  const [perm, requestPerm] = useCameraPermissions();
  const [pairing, setPairing] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [facing, setFacing] = useState('back');
  const [frameRate, setFrameRate] = useState(FRAME_RATE_DEFAULT);
  const [away, setAway] = useState(false);
  const [err, setErr] = useState(null);
  const [notes, setNotes] = useState([]);      // warnings worth showing: mount, frame rate, capability
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState(null);  // the live numbers under the picture
  const [track, setTrack] = useState(null);
  const session = useRef(null);

  const note = useCallback((line) => setNotes((n) => [line, ...n].slice(0, 3)), []);

  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAway(s !== 'active')); return () => sub.remove(); }, []);
  useEffect(() => () => { session.current?.stop?.(); }, []);

  async function onScan({ data }) {
    if (!scanning) return; setScanning(false);
    const code = (String(data).match(/code=([A-Za-z0-9-]+)/) || [])[1] || String(data).trim();
    const r = await api('/api/camfeed/pair', { method: 'POST', body: { code } });
    if (!r.ok) { setErr(r.data?.error || 'That code did not work. Ask the artist for a fresh one.'); setScanning(true); return; }
    setPairing(r.data);
    setErr(null);
    publish(r.data).catch((e) => setErr(String(e?.message || e)));
  }

  /** Join the room this pairing names and send the picture. */
  async function publish(p) {
    if (session.current) await session.current.stop().catch(() => {});
    setNotes([]);
    const cam = new CameraSession({
      token: p.token, url: p.url, room: p.room,
      facing, frameRate, orientation: 'portrait',
      onEvent: (kind, payload) => {
        if (kind === 'state') setStatus((s) => ({ ...(s || {}), ...session.current?.status?.() }));
        else if (kind === 'warning') note(payload);
        else if (kind === 'error') setErr(String(payload));
        else if (kind === 'capability') note(payload.line);
        else if (kind === 'frameRate' && payload.changed) note(payload.reason);
        else if (kind === 'published') setPublishing(true);
        else if (kind === 'link' && payload.state === 'disconnected') setPublishing(false);
      },
    });
    session.current = cam;
    await cam.start();
    setTrack(cam.track);
    setStatus(cam.status());
  }

  async function unpair() {
    await session.current?.stop().catch(() => {});
    session.current = null;
    setTrack(null); setPublishing(false); setStatus(null); setNotes([]);
    setPairing(null); setScanning(true);
  }

  /** Changing camera or frame rate restarts the capture: both are set when the camera starts. */
  async function restartWith(changes) {
    if (changes.facing !== undefined) setFacing(changes.facing);
    if (changes.frameRate !== undefined) setFrameRate(changes.frameRate);
    if (!pairing) return;
    setPublishing(false);
    const next = { ...{ facing, frameRate }, ...changes };
    try {
      await session.current?.stop().catch(() => {});
      const cam = new CameraSession({
        token: pairing.token, url: pairing.url, room: pairing.room,
        facing: next.facing, frameRate: next.frameRate, orientation: 'portrait',
        onEvent: (kind, payload) => {
          if (kind === 'state') setStatus(() => session.current?.status?.() || null);
          else if (kind === 'warning' || kind === 'capability') note(kind === 'capability' ? payload.line : payload);
          else if (kind === 'published') setPublishing(true);
        },
      });
      session.current = cam;
      await cam.start();
      setTrack(cam.track);
    } catch (e) { setErr(String(e?.message || e)); }
  }

  if (!perm) return <View style={styles.screenDark} />;
  if (!perm.granted) {
    return (
      <View style={[styles.screenDark, { padding: 20, paddingTop: 80, gap: 12 }]}>
        <Text style={styles.h1Dark}>Use this phone as a camera</Text>
        <Text style={styles.bodyDark}>Loudentify needs the camera to be a camera.</Text>
        <Pressable style={[styles.btn, styles.btnTeal, { height: 52 }]} onPress={requestPerm}><Text style={styles.btnText}>Allow the camera</Text></Pressable>
      </View>
    );
  }

  const live = pairing?.context === 'show';
  return (
    <View style={styles.screenDark}>
      {/* Scanning: Expo's camera reads the code. Paired: the published picture itself,
          so what the phone shows is what the show is getting. */}
      {pairing
        ? (() => {
          // LiveKit's VideoTrack reads trackRef.publication.track without a guard, which
          // crashed the spike on 14 Oct: render only once the publication AND its track exist.
          const cam = session.current;
          const pub = track && cam?.room ? (cam.publication || cam.room.localParticipant.getTrackPublication('camera')) : null;
          if (VideoTrack && pub?.track) return <VideoTrack trackRef={{ participant: cam.room.localParticipant, publication: pub, source: 'camera' }} style={{ flex: 1 }} objectFit="cover" />;
          return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={styles.bodyDark}>{publishing ? 'Sending your picture…' : 'Starting the camera…'}</Text></View>;
        })()
        : <CameraView style={{ flex: 1 }} facing={facing} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />}

      <View style={{ position: 'absolute', left: 0, right: 0, top: 52, padding: 12, gap: 6 }}>
        {pairing ? (
          <View style={styles.row}>
            <Text style={[styles.badgeLive, { backgroundColor: live ? color.red : color.orange, color: live ? '#fff' : color.ink }]}>{live ? 'ON AIR' : 'REHEARSAL'}</Text>
            <Text style={{ color: color.porcelain, fontWeight: '700' }}>{pairing.role} camera · slot {pairing.slot}</Text>
            {!publishing && <Text style={{ color: color.orange, fontWeight: '700' }}>not sending</Text>}
          </View>
        ) : <Text style={{ color: color.porcelain, fontSize: 17, fontWeight: '700' }}>Scan the code on the artist&apos;s main device</Text>}
        {status && <Text style={{ color: 'rgba(253,255,252,0.75)', fontSize: 13 }}>{status.facing} camera{status.mirrored ? ' (flipped)' : ''} · {Math.round(status.fps || 0)} fps of {status.fpsTarget} · dropped {status.dropped} · {status.width}×{status.height}</Text>}
        {err && <Text style={{ color: color.orange }}>{err}</Text>}
        {away && <Text style={{ color: color.orange, fontWeight: '700' }}>Keep Loudentify in front: the camera stops in the background.</Text>}
        {notes.length > 0 && (
          <ScrollView style={{ maxHeight: 92 }}>
            {notes.map((n, i) => <Text key={i} style={{ color: 'rgba(253,255,252,0.75)', fontSize: 13, marginTop: 2 }}>{n}</Text>)}
          </ScrollView>
        )}
      </View>

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 32, gap: 8 }}>
        {pairing && (
          <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
            {FACINGS.map((f) => (
              <Pressable key={f} style={[styles.btn, styles.btnGhostDark, { paddingHorizontal: 14, height: 40, borderWidth: f === facing ? 2 : 0, borderColor: color.teal }]} onPress={() => restartWith({ facing: f })}>
                <Text style={styles.btnTextDark}>{f === 'back' ? 'Back' : 'Front'}</Text>
              </Pressable>
            ))}
            {FRAME_RATE_CHOICES.map((r) => (
              <Pressable key={r} style={[styles.btn, styles.btnGhostDark, { paddingHorizontal: 12, height: 40, borderWidth: r === frameRate ? 2 : 0, borderColor: color.teal }]} onPress={() => restartWith({ frameRate: r })}>
                <Text style={styles.btnTextDark}>{r}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={[styles.row, { gap: 8 }]}>
          {!pairing && <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}><Text style={styles.btnTextDark}>Flip</Text></Pressable>}
          {pairing && <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={unpair}><Text style={styles.btnTextDark}>Unpair</Text></Pressable>}
        </View>
      </View>
    </View>
  );
}
