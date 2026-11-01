// CameraMode.dc.html — this phone becomes one camera for a show.
//
// The screen a second phone sits on, on a stand, for the length of a
// performance. Everything about it follows from that: it keeps the screen
// awake, it says plainly when it is on air and when it is not, and the
// board's one instruction — "Keep this phone plugged in and on this
// screen" — is the only copy on it that is not a status.
//
// The publishing underneath is unchanged and device-tested (orientation,
// device zoom, lens switching, pans, the bop, pro mode, frame rate, the
// front camera's mirror). This rewrite is the board, not the behaviour.
//
// Two cameras live here, and only one at a time: Expo's CameraView while
// scanning, then the capturer once paired. They never run together,
// because two owners of one camera is how a phone ends up with a black
// preview and no error.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, AppState, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import {
  Screen, MediaTile, Button, Badge, Chip, ErrorPanel, Icon,
  color, space, radius, surface, textOnDark, face,
} from '../src/ui';
import { api } from '../src/api';
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
  const [orientation, setOrientation] = useState('portrait');
  const [away, setAway] = useState(false);
  const [err, setErr] = useState(null);
  const [notes, setNotes] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState(null);
  const [track, setTrack] = useState(null);
  const [settings, setSettings] = useState(false);
  const session = useRef(null);

  const note = useCallback((line) => setNotes((n) => [line, ...n].slice(0, 3)), []);

  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAway(s !== 'active')); return () => sub.remove(); }, []);
  useEffect(() => () => { session.current?.stop?.(); }, []);

  async function onScan({ data }) {
    if (!scanning) return;
    setScanning(false);
    const code = (String(data).match(/code=([A-Za-z0-9-]+)/) || [])[1] || String(data).trim();
    const r = await api('/api/camfeed/pair', { method: 'POST', body: { code } });
    if (!r.ok) { setErr(r.data?.error || 'That code did not work. Ask the artist for a fresh one.'); setScanning(true); return; }
    setPairing(r.data);
    setErr(null);
    publish(r.data).catch((e) => setErr(String(e?.message || e)));
  }

  const handler = useCallback((kind, payload) => {
    if (kind === 'state') setStatus(() => session.current?.status?.() || null);
    else if (kind === 'warning') note(payload);
    else if (kind === 'error') setErr(String(payload));
    else if (kind === 'capability') note(payload.line);
    else if (kind === 'frameRate' && payload.changed) note(payload.reason);
    else if (kind === 'published') setPublishing(true);
    else if (kind === 'link' && payload.state === 'disconnected') setPublishing(false);
  }, [note]);

  /** Join the room this pairing names and send the picture. */
  async function publish(p, overrides = {}) {
    if (session.current) await session.current.stop().catch(() => {});
    setNotes([]);
    const next = { facing, frameRate, orientation, ...overrides };
    const cam = new CameraSession({
      token: p.token, url: p.url, room: p.room,
      facing: next.facing, frameRate: next.frameRate, orientation: next.orientation,
      onEvent: handler,
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
    setPairing(null); setScanning(true); setSettings(false);
  }

  /** Camera, frame rate and which way up all restart the capture. */
  async function restartWith(changes) {
    if (changes.facing !== undefined) setFacing(changes.facing);
    if (changes.frameRate !== undefined) setFrameRate(changes.frameRate);
    if (changes.orientation !== undefined) setOrientation(changes.orientation);
    if (!pairing) return;
    setPublishing(false);
    try { await publish(pairing, changes); } catch (e) { setErr(String(e?.message || e)); }
  }

  if (!perm) return <Screen dark />;

  if (!perm.granted) {
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.m }}>
          <Text style={textOnDark.screenTitle}>Use this phone as a camera</Text>
          <Text style={textOnDark.body}>Loudentify needs the camera to be a camera. Nothing is recorded until an artist pairs this phone to a show.</Text>
          <Button kind="main" onPress={requestPerm} testID="allow-camera">Allow the camera</Button>
          <Button kind="quietDark" size="medium" onPress={() => router.back()}>Not now</Button>
        </View>
      </Screen>
    );
  }

  const onAir = pairing?.context === 'show' && publishing;
  const slotLabel = pairing ? `${String(pairing.role || 'Side').replace(/^\w/, (c) => c.toUpperCase())} camera` : null;

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      {/* What this phone is sending, or the scanner before it is paired. */}
      {pairing ? (() => {
        // LiveKit's VideoTrack reads trackRef.publication.track without a
        // guard, which crashed the spike on 14 Oct: render only once the
        // publication and its track both exist.
        const cam = session.current;
        const pub = track && cam?.room ? (cam.publication || cam.room.localParticipant.getTrackPublication('camera')) : null;
        if (VideoTrack && pub?.track) {
          return <VideoTrack trackRef={{ participant: cam.room.localParticipant, publication: pub, source: 'camera' }} style={{ flex: 1 }} objectFit="cover" />;
        }
        return (
          <MediaTile label={publishing ? 'Sending your picture' : 'Starting the camera'} style={{ flex: 1 }} />
        );
      })() : (
        <CameraView style={{ flex: 1 }} facing={facing} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      )}

      {/* The rule-of-thirds grid the board draws over the viewfinder. */}
      {pairing ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
          {[1 / 3, 2 / 3].map((f) => <View key={`h${f}`} style={{ position: 'absolute', left: 0, right: 0, top: `${f * 100}%`, height: 1, backgroundColor: 'rgba(253,255,252,0.18)' }} />)}
          {[1 / 3, 2 / 3].map((f) => <View key={`v${f}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${f * 100}%`, width: 1, backgroundColor: 'rgba(253,255,252,0.18)' }} />)}
        </View>
      ) : null}

      {/* Top strip: what this phone is, and whether it is actually sending. */}
      <View style={{ position: 'absolute', left: space.m, right: space.m, top: 52, gap: 6 }}>
        {pairing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            {onAir ? <Badge kind="live">ON AIR</Badge> : <Badge kind="versus">REHEARSAL</Badge>}
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.7)' }}>
              <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: color.porcelain }}>{slotLabel}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.7)' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: publishing ? color.teal : color.orange }} />
              <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{publishing ? 'Connected' : 'Not sending'}</Text>
            </View>
          </View>
        ) : (
          <Text style={[textOnDark.rowTitle, { fontSize: 17 }]}>Scan the code on the artist&apos;s main device</Text>
        )}

        {status ? (
          <Text style={{ fontFamily: face.regular, fontSize: 13, color: 'rgba(253,255,252,0.75)' }}>
            {status.facing} camera{status.mirrored ? ' (flipped)' : ''} · {Math.round(status.fps || 0)} of {status.fpsTarget} fps · dropped {status.dropped} · {status.width}×{status.height}
          </Text>
        ) : null}

        {away ? (
          <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: color.orange }}>
            Keep Loudentify in front: the camera stops in the background.
          </Text>
        ) : null}

        {notes.length ? (
          <ScrollView style={{ maxHeight: 92 }}>
            {notes.map((n, i) => <Text key={i} style={{ fontFamily: face.regular, fontSize: 13, color: 'rgba(253,255,252,0.75)', marginTop: 2 }}>{n}</Text>)}
          </ScrollView>
        ) : null}
      </View>

      {err ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, top: 160 }}>
          <ErrorPanel title="That did not work" body={err} onRetry={() => { setErr(null); setScanning(true); }} retryLabel="Try again" />
        </View>
      ) : null}

      {/* The panel the board puts at the foot. */}
      <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 36, borderRadius: radius.cardLg, backgroundColor: 'rgba(1,22,39,0.78)', padding: space.l, gap: space.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.quietDark }}>
            <Icon.Camera size={22} color={color.porcelain} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[textOnDark.rowTitle, { fontSize: 18 }]} numberOfLines={1}>
              {pairing ? `Camera for ${pairing.artistName || 'this show'}` : 'Not paired yet'}
            </Text>
            <Text style={textOnDark.supporting}>
              {pairing ? 'Keep this phone plugged in and on this screen' : 'Point this phone at the code on the main device'}
            </Text>
          </View>
        </View>

        {settings && pairing ? (
          <View style={{ gap: space.sm }}>
            <Text style={textOnDark.label}>Camera</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {FACINGS.map((f) => (
                <Chip key={f} dark selected={f === facing} onPress={() => restartWith({ facing: f })}>{f === 'back' ? 'Back' : 'Front'}</Chip>
              ))}
            </View>
            <Text style={textOnDark.label}>Frames per second</Text>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {FRAME_RATE_CHOICES.map((r) => (
                <Chip key={r} dark selected={r === frameRate} onPress={() => restartWith({ frameRate: r })}>{String(r)}</Chip>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.s }}>
          {pairing ? (
            <>
              <Button
                kind="quietDark"
                size="medium"
                style={{ flex: 1 }}
                icon={<Icon.Rotate size={18} color={color.porcelain} />}
                onPress={() => restartWith({ orientation: orientation === 'portrait' ? 'landscape' : 'portrait' })}
              >
                Rotate
              </Button>
              <Button kind="quietDark" size="medium" style={{ flex: 1 }} onPress={() => setSettings((s) => !s)}>
                {settings ? 'Done' : 'Adjust'}
              </Button>
              <Button kind="quietDark" size="medium" style={{ flex: 1 }} icon={<Icon.Close size={18} color={color.porcelain} />} onPress={unpair} testID="unpair">
                Unpair
              </Button>
            </>
          ) : (
            <>
              <Button kind="quietDark" size="medium" style={{ flex: 1 }} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>Flip</Button>
              <Button kind="quietDark" size="medium" style={{ flex: 1 }} onPress={() => router.back()}>Leave</Button>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
