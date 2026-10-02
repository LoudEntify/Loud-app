// Camera mode (CameraMode.dc.html): this phone becomes one camera for an
// artist's show by scanning the pairing code the main device shows. The
// pairing itself is the pilot's camfeed flow (/api/camfeed/pair: the phone
// gets a device credential scoped to one artist, one slot, one show window,
// publish only). Publishing the frames into the LiveKit room is wired when
// the LiveKit native SDK lands (NEEDS_KOREY: credentials); today the screen
// shows the viewfinder, role, connection and ON AIR state, and keeps the
// screen awake and the app in the foreground, as the rules require.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, AppState } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { api } from '../src/api';
import { styles } from '../src/theme';
import { color } from '../src/shared';

export default function CameraMode() {
  useKeepAwake();
  const [perm, requestPerm] = useCameraPermissions();
  const [pairing, setPairing] = useState(null); const [scanning, setScanning] = useState(true); const [facing, setFacing] = useState('back'); const [away, setAway] = useState(false); const [err, setErr] = useState(null);
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAway(s !== 'active')); return () => sub.remove(); }, []);
  async function onScan({ data }) {
    if (!scanning) return; setScanning(false);
    const code = (String(data).match(/code=([A-Za-z0-9-]+)/) || [])[1] || String(data).trim();
    const r = await api('/api/camfeed/pair', { method: 'POST', body: { code } });
    if (!r.ok) { setErr(r.data?.error || 'That code did not work. Ask the artist for a fresh one.'); setScanning(true); return; }
    setPairing(r.data);
  }
  if (!perm) return <View style={styles.screenDark} />;
  if (!perm.granted) return <View style={[styles.screenDark, { padding: 20, paddingTop: 80, gap: 12 }]}><Text style={styles.h1Dark}>Use this phone as a camera</Text><Text style={styles.bodyDark}>Loudentify needs the camera to be a camera.</Text><Pressable style={[styles.btn, styles.btnTeal, { height: 52 }]} onPress={requestPerm}><Text style={styles.btnText}>Allow the camera</Text></Pressable></View>;
  return (
    <View style={styles.screenDark}>
      <CameraView style={{ flex: 1 }} facing={facing} barcodeScannerSettings={pairing ? undefined : { barcodeTypes: ['qr'] }} onBarcodeScanned={pairing ? undefined : onScan} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 52, padding: 12, gap: 6 }}>
        {pairing ? <View style={styles.row}><Text style={[styles.badgeLive, { backgroundColor: pairing.context === 'show' ? color.red : color.orange, color: pairing.context === 'show' ? '#fff' : color.ink }]}>{pairing.context === 'show' ? 'ON AIR' : 'REHEARSAL'}</Text><Text style={{ color: color.porcelain, fontWeight: '700' }}>{pairing.role} camera · slot {pairing.slot}</Text></View> : <Text style={{ color: color.porcelain, fontSize: 17, fontWeight: '700' }}>Scan the code on the artist's main device</Text>}
        {err && <Text style={{ color: color.orange }}>{err}</Text>}
        {away && <Text style={{ color: color.orange, fontWeight: '700' }}>Keep Loudentify in front: the camera stops in the background.</Text>}
      </View>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 32, flexDirection: 'row', gap: 8 }}>
        <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}><Text style={styles.btnTextDark}>Flip</Text></Pressable>
        {pairing && <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => { setPairing(null); setScanning(true); }}><Text style={styles.btnTextDark}>Unpair</Text></Pressable>}
      </View>
    </View>
  );
}
