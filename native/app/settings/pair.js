// Settings → Devices → Add a camera: the pairing code, as a picture.
//
// DevicesSettings.dc.html draws a QR code inside the "Add a camera"
// section, with the instruction "On the other phone, open Loudentify, tap
// 'Use this phone as a camera' and scan this code." The native rebuild
// kept the instruction and lost the code: the row pointed at /camera,
// which is the scanner — the screen the SECOND phone sits on. So both
// phones offered to scan and neither offered anything to scan, and there
// was no way to add a camera from the app at all.
//
// This is that code, on a screen of its own rather than inline on
// Devices, because a code is minted and expires: minting one every time
// anybody opens Devices would burn through codes nobody scanned, and the
// countdown would be wrong the moment the screen was left open. A tap
// mints one, and the screen says how long it has.
//
// The QR encodes <site>/cam/pair?code=XXXXXX, the same string the web
// panel encodes. A phone's own camera app opens that as a web page; the
// Loudentify scanner reads the code straight out of it. One credential,
// one code path, two ways in.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import {
  Screen, Card, Button, Chip, ErrorPanel, Skeleton, ScreenHeader, Icon,
  color, space, radius, text, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { API_BASE } from '../../src/config';

// lib/camfeedPairing.js CAMERA_ROLES, labelled as the console labels its
// cuts (lib/liveCuts.js), so an artist pairing a phone and an artist
// pressing a button are using one vocabulary. The stored value stays
// 'wide'; lib/rigCameras.js is where the two names meet.
const ROLES = [
  { role: 'wide', label: 'Main', note: 'The one you perform to: the whole stage, from the back.' },
  { role: 'close', label: 'Close', note: 'Tight on your hands or your face.' },
  { role: 'side', label: 'Side', note: 'Off to one side of you.' },
];

/** Minutes left on a code, floored, never below zero. */
export function minutesLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt || '') - now;
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 60000));
}

export default function PairCamera() {
  const { accessToken, loading } = useSession();
  const { show_id: showId } = useLocalSearchParams();
  const [role, setRole] = useState('wide');
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [left, setLeft] = useState(null);
  const phase = useLoadingPhase(busy);

  const mint = useCallback(async (forRole) => {
    if (!accessToken) return;
    setBusy(true); setError(''); setPairing(null);
    const body = { action: 'invite', role: forRole, context: showId ? 'show' : 'rehearsal' };
    if (showId) body.show_id = showId;
    const r = await api('/api/camfeed/pair', { method: 'POST', accessToken, body });
    setBusy(false);
    if (!r.ok) { setError(r.data?.error || 'We could not make a pairing code. Try again.'); return; }
    setDegraded(Boolean(r.data?.degraded));
    setPairing(r.data?.pairing || r.data || null);
  }, [accessToken, showId]);

  useEffect(() => { if (!loading) mint(role); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // A code expires, and a countdown that stops at the minute it was drawn
  // is worse than none: it tells an artist a dead code is good for nine
  // more minutes.
  useEffect(() => {
    if (!pairing?.expiresAt) { setLeft(null); return undefined; }
    const tick = () => setLeft(minutesLeft(pairing.expiresAt));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [pairing]);

  function pick(next) {
    setRole(next);
    mint(next);
  }

  const url = pairing?.code ? `${API_BASE}/cam/pair?code=${encodeURIComponent(pairing.code)}` : '';
  const dead = left === 0;

  return (
    <Screen>
      <ScreenHeader title="Add a camera" onBack={() => router.push('/settings/devices')} style={{ paddingTop: 56 }} />
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, gap: space.l }}>
        <Card style={{ gap: space.sm }}>
          <Text style={text.rowTitle}>Where is this camera?</Text>
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            {ROLES.map((r) => (
              <Chip key={r.role} selected={role === r.role} onPress={() => pick(r.role)} testID={`pair-role-${r.role}`}>
                {r.label}
              </Chip>
            ))}
          </View>
          <Text style={text.supporting}>{ROLES.find((r) => r.role === role)?.note}</Text>
        </Card>

        {busy && phase !== 'slow' ? (
          <Card style={{ alignItems: 'center', gap: space.sm }}>
            <Skeleton width={200} height={200} />
            <Skeleton width="50%" height={18} />
          </Card>
        ) : error ? (
          <ErrorPanel title="We could not make a code" body={error} onRetry={() => mint(role)} />
        ) : pairing?.code ? (
          <Card style={{ alignItems: 'center', gap: space.m }}>
            <View style={{ padding: space.m, borderRadius: radius.card, backgroundColor: color.white, opacity: dead ? 0.35 : 1 }}>
              <QRCode value={url} size={200} color={color.ink} backgroundColor={color.white} />
            </View>
            <Text style={[text.supporting, { textAlign: 'center' }]}>
              On the other phone, open Loudentify, tap &quot;Use this phone as a camera&quot; and scan this code.
            </Text>
            <View style={{ alignItems: 'center', gap: space.xs }}>
              <Text style={[text.supporting, { letterSpacing: 1.3 }]}>OR ENTER THIS CODE</Text>
              <Text style={{ fontSize: 34, fontWeight: '700', letterSpacing: 4, color: color.ink }} selectable testID="pair-code">
                {pairing.code}
              </Text>
            </View>
            {dead ? (
              <>
                <Text style={{ fontSize: 15, color: color.red, textAlign: 'center' }}>This code has run out. Make a new one.</Text>
                <Button kind="main" onPress={() => mint(role)} testID="pair-new">New code</Button>
              </>
            ) : (
              <Text style={text.supporting}>
                {left === null ? 'Good for a few minutes.' : left <= 1 ? 'Less than a minute left.' : `Good for ${left} more minutes.`}
              </Text>
            )}
          </Card>
        ) : null}

        {degraded ? (
          <Card style={{ gap: space.xs }}>
            <Text style={text.rowTitle}>One camera at a time, for now</Text>
            <Text style={text.supporting}>
              This code pairs a camera, but choosing where each one sits is not
              switched on yet on this server. Everything else works.
            </Text>
          </Card>
        ) : null}

        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon.Camera size={22} color={color.ink} />
            <Text style={[text.rowTitle, { flex: 1 }]}>This phone as a camera</Text>
          </View>
          <Text style={text.supporting}>
            If you are holding the phone that should become the camera, scan
            from there instead.
          </Text>
          <Button kind="quiet" size="medium" onPress={() => router.push('/camera')} testID="pair-scan-here">
            Use this phone as a camera
          </Button>
        </Card>

        <Text style={text.supporting}>
          One camera per phone, using that phone&apos;s own camera. Keep every
          device plugged in during a show.
        </Text>
      </ScrollView>
    </Screen>
  );
}
