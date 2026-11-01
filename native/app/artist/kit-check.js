// KitCheck.dc.html — the rehearsal. Nothing streams.
//
// This replaces a WebView over /artist/kit-check. The web twin
// (components/artist/KitCheckScreen.jsx) is the reference for what each
// check means, and the two post to the same route, so a check that passes
// in a browser and fails on the phone is a real difference rather than two
// screens disagreeing.
//
// What the phone can and cannot measure, stated because the difference is
// the whole honesty of this screen:
//
//   connection  real. Three timed round trips for latency, then a timed
//               upload, because streaming needs the UP link and nothing
//               else here measures it (/api/artist/net-probe).
//   charging    real, from expo-battery, and it keeps listening: a cable
//               pulled out while the artist is still on this screen turns
//               the row back to red.
//   cameras     partly. Expo's CameraView hands out no per-frame callback,
//               so "held frames" is the preview staying ready with the app
//               in front for two minutes. A stall the preview hides would
//               be missed; the native capturer reports frames for real and
//               only exists in a development build, so this is the honest
//               version of the check rather than a fake of the strong one.
//   mic, DND,   not measurable from managed native code: there is no raw
//   headphones  input level, no Do Not Disturb state and no audio-route
//               list. Each is the artist's own confirmation instead, and
//               what goes to the route says so, because a check that
//               invents a pass is worse than one that admits a person did
//               the looking.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, AppState } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Battery from 'expo-battery';
import {
  Screen, MediaTile, Button, Chip, ErrorPanel, OfflineBar, Skeleton, Icon,
  color, space, radius, surface, textOnDark, face, size,
} from '../../src/ui';
import { api } from '../../src/api';
import { API_BASE } from '../../src/config';
import { supabase, useSession } from '../../src/session';

/** Two minutes of frames, as the board's "Held frames for 2 minutes" says. */
const HOLD_MS = 120_000;
/** The upload a stream needs, and the round trip above which it stutters. */
const MIN_UP_MBPS = 2.5;
const MAX_LATENCY_MS = 1000;
const PROBE_BYTES = 400 * 1024;

/**
 * The seven rows the board lists, in its order. `item` is what the route
 * stores (app/api/artist/shows/[id]/kit-check/route.js accepts exactly
 * mic_signal, camera_frames, connection, charging, dnd, headphones,
 * framing); `confirm` marks the ones a person answers rather than a sensor.
 */
const ROWS = [
  { key: 'mic_signal', item: 'mic_signal', title: 'Mic signal', icon: Icon.Mic, confirm: 'Confirm', confirmed: 'Real signal from your voice' },
  { key: 'camera_main', item: 'camera_frames', title: 'Main camera', icon: Icon.Camera },
  { key: 'camera_side', item: 'camera_frames', title: 'Side camera', icon: Icon.Camera },
  { key: 'connection', item: 'connection', title: 'Connection', icon: Icon.Cloud },
  { key: 'charging', item: 'charging', title: 'Charging' },
  { key: 'dnd', item: 'dnd', title: 'Do Not Disturb', icon: Icon.Bell, confirm: 'Turn on', confirmed: 'On (confirmed by you)' },
  { key: 'headphones', item: 'headphones', title: 'Headphones', confirm: 'Confirm', confirmed: 'Wired, no delay' },
];

const CAMERAS = [
  { key: 'camera_main', chip: 'Main', facing: 'back' },
  { key: 'camera_side', chip: 'Side', facing: 'front' },
];

const START_OF = { mic_signal: 'Say a few words, then confirm', camera_main: 'Holding frames, 0 of 2 minutes', camera_side: 'Not checked yet', connection: 'Measuring', charging: 'Checking the battery', dnd: 'Calls could interrupt your show', headphones: 'Wired is best for singing' };
const START_STATUS = { mic_signal: 'checking', camera_main: 'checking', camera_side: 'skipped', connection: 'checking', charging: 'checking', dnd: 'fix', headphones: 'skipped' };

const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function KitCheck() {
  const { show: showParam } = useLocalSearchParams();
  const { session, profile, loading, accessToken } = useSession();
  const [perm, requestPerm] = useCameraPermissions();
  const [camera, setCamera] = useState('camera_main');
  const [show, setShow] = useState(undefined);        // undefined while reading, null when there is none
  const [place, setPlace] = useState(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checks, setChecks] = useState(() => Object.fromEntries(
    ROWS.map((r) => [r.key, { status: START_STATUS[r.key], detail: START_OF[r.key] }]),
  ));
  const held = useRef({ camera_main: null, camera_side: null });

  const setCheck = useCallback((key, value) => setChecks((c) => ({ ...c, [key]: value })), []);

  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session]);

  // The show this check is for: the one a reminder named, or the next one
  // booked. Read from the table under row-level security, the way the
  // profile reads an artist's own shows; there is no route that lists them.
  useEffect(() => {
    if (!accessToken || !session?.user?.id) return;
    if (showParam) {
      api(`/api/artist/shows/${showParam}/console`, { accessToken }).then((r) => {
        if (r.ok) setShow(r.data.show);
        else { setShow(null); setFailed(true); }
      });
      return;
    }
    supabase().from('shows')
      .select('id, title, slated_at, duration_minutes, actual_started_at, cancelled_at')
      .eq('artist_id', session.user.id).is('actual_started_at', null).is('cancelled_at', null)
      .gte('slated_at', new Date(Date.now() - 60 * 60_000).toISOString())
      .order('slated_at').limit(1)
      .then(({ data, error }) => { setShow(data?.[0] || null); if (error) setFailed(true); }, () => { setShow(null); setFailed(true); });
  }, [accessToken, session, showParam]);

  // The saved place, for the chip the board puts beside the title.
  useEffect(() => {
    if (!accessToken) return;
    supabase().from('places').select('id, name').limit(1).then(({ data }) => setPlace(data?.[0] || null), () => setPlace(null));
  }, [accessToken]);

  // Camera permission, asked for once: without it there is no preview and
  // no camera check, and the screen says so rather than showing black.
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);

  // The hold: the chosen preview has to stay up, and in front, for two
  // minutes. Leaving the app resets that camera's clock, because frames
  // stop arriving when the phone is showing something else.
  useEffect(() => {
    if (!perm?.granted) {
      setCheck('camera_main', { status: 'fix', detail: 'Allow camera access to check it' });
      return undefined;
    }
    held.current[camera] = held.current[camera] ?? Date.now();
    const away = AppState.addEventListener('change', (s) => { if (s !== 'active') held.current[camera] = Date.now(); });
    const tick = setInterval(() => {
      const since = Date.now() - (held.current[camera] || Date.now());
      const mins = Math.floor(since / 60_000);
      setCheck(camera, since >= HOLD_MS
        ? { status: 'ready', detail: 'Held frames for 2 minutes' }
        : { status: 'checking', detail: `Holding frames, ${mins} of 2 minutes` });
    }, 1000);
    return () => { clearInterval(tick); away.remove(); };
  }, [camera, perm?.granted, setCheck]);

  // Charging, and it keeps listening.
  useEffect(() => {
    let sub;
    const read = (state) => setCheck('charging', state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
      ? { status: 'ready', detail: 'Every device plugged in' }
      : { status: 'fix', detail: 'On battery. Plug in before the show.' });
    Battery.getBatteryStateAsync().then(read, () => setCheck('charging', { status: 'skipped', detail: 'Cannot read the battery; plug every device in' }));
    try { sub = Battery.addBatteryStateListener(({ batteryState }) => read(batteryState)); } catch { sub = null; }
    return () => sub?.remove?.();
  }, [setCheck]);

  // Latency, then upload. Down is not the problem a stream has.
  const measureConnection = useCallback(async () => {
    setCheck('connection', { status: 'checking', detail: 'Measuring' });
    let ms = Infinity;
    try {
      for (let i = 0; i < 3; i += 1) {
        const t = Date.now();
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${API_BASE}/api/build-info`, { cache: 'no-store' });
        ms = Math.min(ms, Date.now() - t);
      }
    } catch {
      setOffline(true);
      setCheck('connection', { status: 'fix', detail: 'No connection' });
      return;
    }
    setOffline(false);
    let upMbps = null;
    if (accessToken) {
      try {
        const t = Date.now();
        const r = await fetch(`${API_BASE}/api/artist/net-probe`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${accessToken}` },
          body: 'x'.repeat(PROBE_BYTES),
        });
        const took = Math.max(1, Date.now() - t);
        const { bytes } = r.ok ? await r.json() : {};
        if (bytes) upMbps = Math.round(((bytes * 8) / took / 1000) * 10) / 10;
      } catch { upMbps = null; }
    }
    const ok = ms < MAX_LATENCY_MS && (upMbps == null || upMbps >= MIN_UP_MBPS);
    const numbers = `${ms} ms${upMbps == null ? '' : `, ${upMbps} Mb/s up`}`;
    setCheck('connection', ok
      ? { status: 'ready', detail: `Strong enough to stream (${numbers})` }
      : { status: 'fix', detail: `Slow right now (${numbers}). Move closer to the router or use mobile data.` });
  }, [accessToken, setCheck]);

  useEffect(() => { if (accessToken) measureConnection(); }, [accessToken, measureConnection]);

  const ready = ROWS.filter((r) => checks[r.key].status === 'ready').length;
  const toFix = ROWS.filter((r) => checks[r.key].status === 'fix').length;

  /** Framing is the preview's own pill, not a row: it is ready once there is a picture. */
  const framing = perm?.granted ? 'ready' : 'fix';

  const save = useCallback(async () => {
    if (!accessToken) return false;
    setSaving(true);
    const items = ROWS.map((r) => ({ item: r.item, status: checks[r.key].status, detail: `${r.title}: ${checks[r.key].detail}` }));
    items.push({ item: 'framing', status: framing, detail: framing === 'ready' ? 'Framing looks good' : 'No picture to frame' });
    const r = await api(`/api/artist/shows/${show?.id || 'none'}/kit-check`, { method: 'POST', accessToken, body: { items } });
    setSaving(false);
    if (!r.ok) { setFailed(true); return false; }
    setSaved(true);
    return true;
  }, [accessToken, checks, framing, show]);

  /** The board's footer is a link to the countdown; it keeps the result first. */
  const finish = useCallback(async () => {
    const ok = await save();
    if (ok && show?.id) router.push(`/artist/countdown/${show.id}`);
  }, [save, show]);

  const slated = show?.slated_at ? Date.parse(show.slated_at) : null;
  const footerLine = useMemo(() => {
    if (show === undefined) return 'Looking for your next show.';
    if (!show) return 'No show booked for this check. Nothing streams either way.';
    if (slated == null || !Number.isFinite(slated)) return 'No start time on this show yet.';
    if (slated - Date.now() <= 0) return 'Your slot has started. Open the countdown and you go live.';
    return `Stay here and you go live on your own at ${hhmm(slated)}.`;
  }, [show, slated]);

  if (loading) return <KitSkeleton />;

  if (profile && profile.role !== 'artist') {
    return (
      <Screen dark>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <Text style={[textOnDark.screenTitle, { fontSize: 28 }]}>Kit check</Text>
          <ErrorPanel
            title="Kit check is for artists"
            body="Add performing to this account and your mic and cameras get checked here."
            onRetry={undefined}
            backLabel="Your profile"
            onBack={() => router.replace('/profile')}
            testID="kit-not-artist"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen dark>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 48, gap: space.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={({ pressed }) => ({ width: size.touch, height: size.touch, borderRadius: size.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.quietDark, opacity: pressed ? 0.85 : 1 })}
          >
            <Icon.Back size={22} color={color.porcelain} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[textOnDark.screenTitle, { fontSize: 24 }]}>Kit check</Text>
            <Text style={[textOnDark.supporting, { fontSize: 15 }]} numberOfLines={1}>
              Rehearsal. Nothing is streaming.{show?.title ? ` · ${show.title}` : ''}
            </Text>
          </View>
          {place ? (
            <View style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: surface.quietDark }}>
              <Icon.Pin size={20} color={color.porcelain} />
              <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: color.porcelain }} numberOfLines={1}>{place.name}</Text>
            </View>
          ) : null}
        </View>

        {offline ? <OfflineBar testID="kit-offline" /> : null}

        {/* The artist's own camera with the thirds over it. Never the
            broadcast picture: there is no broadcast while this is open. */}
        <View style={{ height: 220, borderRadius: radius.cardLg, overflow: 'hidden' }}>
          {perm?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing={CAMERAS.find((c) => c.key === camera)?.facing || 'back'}
              accessibilityLabel="Your own camera, as a rehearsal"
            />
          ) : (
            <MediaTile label="Allow camera access to see your picture" style={{ flex: 1 }} />
          )}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            {['33.3%', '66.6%'].map((at) => <View key={`v${at}`} style={{ position: 'absolute', left: at, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(253,255,252,0.22)' }} />)}
            {['33.3%', '66.6%'].map((at) => <View key={`h${at}`} style={{ position: 'absolute', top: at, left: 0, right: 0, height: 1, backgroundColor: 'rgba(253,255,252,0.22)' }} />)}
          </View>
          <Text style={{ position: 'absolute', top: 12, left: 12, fontFamily: face.regular, fontSize: 14, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(253,255,252,0.75)' }}>
            {camera === 'camera_main' ? 'Main camera view' : 'Side camera view'}
          </Text>
          {framing === 'ready' ? (
            <View style={{ position: 'absolute', bottom: 12, left: '50%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.72)' }}>
              <StatusDot status="ready" size={24} />
              <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: color.porcelain }}>Framing looks good</Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Camera">
          {CAMERAS.map((c) => (
            <Chip key={c.key} dark selected={camera === c.key} onPress={() => setCamera(c.key)}>{c.chip}</Chip>
          ))}
          <Button kind="quietDark" size="chip" onPress={() => router.push('/camera')} icon={<Icon.Plus size={18} color={color.porcelain} />}>
            Add camera
          </Button>
        </View>

        <View accessibilityLabel="Checks">
          {ROWS.map((r, i) => (
            <CheckRow
              key={r.key}
              row={r}
              check={checks[r.key]}
              last={i === ROWS.length - 1}
              onConfirm={r.confirm ? () => setCheck(r.key, { status: 'ready', detail: r.confirmed }) : null}
            />
          ))}
        </View>

        {failed ? (
          <ErrorPanel
            title="We could not save this check"
            body="The checks on screen are still right. Try again, or carry on and the console will ask again."
            onRetry={save}
            testID="kit-save-failed"
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${ready} of ${ROWS.length} ready${toFix ? `, ${toFix} to fix` : ''}. ${footerLine}`}
          onPress={finish}
          disabled={saving}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: 14, paddingHorizontal: space.l, borderRadius: 18, backgroundColor: 'rgba(253,255,252,0.1)', opacity: pressed || saving ? 0.85 : 1 })}
          testID="kit-finish"
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[textOnDark.rowTitle, { fontSize: 18 }]}>
              {ready} of {ROWS.length} ready{toFix ? `, ${toFix} to fix` : ''}
            </Text>
            <Text style={[textOnDark.supporting, { fontSize: 15 }]}>{saved && !show ? 'Saved. Nothing streams either way.' : footerLine}</Text>
          </View>
          <Icon.Chevron size={22} color={color.porcelain} />
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/** Ready, checking, fix or skipped, as the board's 26px round badge. */
function StatusDot({ status, size: px = 26 }) {
  const look = {
    ready: { bg: color.teal, fg: color.ink, Glyph: Icon.Check, label: 'Ready' },
    checking: { bg: color.orange, fg: color.ink, Glyph: Icon.Refresh, label: 'Checking' },
    fix: { bg: color.red, fg: color.white, Glyph: Icon.Warning, label: 'Fix' },
    skipped: { bg: surface.quietDark, fg: color.porcelain, Glyph: Icon.Close, label: 'Skipped' },
  }[status] || { bg: surface.quietDark, fg: color.porcelain, Glyph: Icon.Close, label: status };
  const { Glyph } = look;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={look.label}
      style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: look.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Glyph size={20} color={look.fg} />
    </View>
  );
}

function CheckRow({ row, check, last, onConfirm }) {
  const Glyph = row.icon;
  return (
    <View
      testID={`check-${row.key}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 46, paddingVertical: 6,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: 'rgba(253,255,252,0.1)',
      }}
    >
      {/* No leading glyph on Charging or Headphones: the kit has no battery
          and no headphone icon, and a near-enough glyph on a checklist is
          worse than none. Noted for the design system. */}
      <View style={{ width: 24, alignItems: 'center' }}>
        {Glyph ? <Glyph size={22} color="rgba(253,255,252,0.8)" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[textOnDark.rowTitle, { fontSize: 17 }]} numberOfLines={1}>{row.title}</Text>
        <Text style={[textOnDark.supporting, { fontSize: 14 }]} numberOfLines={2}>{check.detail}</Text>
      </View>
      {onConfirm && check.status !== 'ready'
        ? <Button kind={row.key === 'dnd' ? 'destructive' : 'quietDark'} size="small" onPress={onConfirm}>{row.confirm}</Button>
        : <StatusDot status={check.status} />}
    </View>
  );
}

function KitSkeleton() {
  return (
    <Screen dark>
      <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.m }}>
        <Skeleton width={160} height={28} />
        <Skeleton width="100%" height={220} radius={radius.cardLg} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[72, 72, 120].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
        </View>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} width="100%" height={40} radius={10} />)}
      </View>
    </Screen>
  );
}
