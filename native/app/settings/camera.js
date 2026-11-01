// CameraSettings.dc.html — what each camera does during a show.
//
// This screen reads the capturer and then tells the truth about it,
// which is a shorter screen than the board but a more useful one.
//
// What the capturer (native/modules/loud-camera) can do: survey every
// lens on the phone, and — while a camera is actually running — move a
// lens, lock exposure, focus and white balance, and set the frame
// orientation. What it cannot do: remember any of that. There is no
// per-camera settings table, no route, and no column, so a toggle here
// would change nothing about the next show.
//
// So the locks, the zoom and the moves are drawn as facts about this
// phone rather than as controls: this is what your camera can do, this
// is where it is decided. The numbers come from src/spike/survey.js and
// src/spike/facing.js — the same derivation the director uses, not a
// second opinion about the same lens.
//
// The board's camera tabs are the paired rig (Main, Side). A paired
// phone cannot be surveyed from here — only the phone in your hand
// answers — so the tabs are this phone's own cameras, and the rig
// lives on the devices screen where it is managed.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Chip, Row, ScreenHeader, ErrorPanel, Skeleton, Icon,
  color, space, text, useLoadingPhase,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { available as capturerAvailable, survey } from '../../modules/loud-camera';
import { normaliseProfile } from '../../src/spike/survey';
import { facingCapabilities, FACING_LABEL } from '../../src/spike/facing';

export default function CameraSettings() {
  const [caps, setCaps] = useState(null);
  const [failed, setFailed] = useState(null);
  const [facing, setFacing] = useState('back');
  const phase = useLoadingPhase(capturerAvailable && caps === null && !failed);

  const load = useCallback(async () => {
    if (!capturerAvailable) return;
    setFailed(null);
    try {
      // A survey opens no camera, so this is safe to run on a settings
      // screen: it reads the capability profile and nothing else.
      const profile = normaliseProfile(await survey(), {});
      setCaps(facingCapabilities(profile));
    } catch {
      setFailed('We could not read this phone’s cameras.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (phase === 'loading') return <CameraSkeleton />;

  const cap = caps?.[facing] || null;
  const present = Object.keys(caps || {}).filter((f) => caps[f].available);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Camera" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {!capturerAvailable ? (
            <NotStored testID="camera-no-module">
              This build does not carry the camera module, so nothing here can
              be read from the phone. A development build reports every lens,
              its zoom range and its manual controls.
            </NotStored>
          ) : null}

          {failed || phase === 'slow' ? (
            <ErrorPanel
              title="We could not read your cameras"
              body="It can happen if another app holds the camera. Try again."
              onRetry={load}
              backLabel="Back to Settings"
              onBack={() => router.push('/settings')}
            />
          ) : null}

          {present.length ? (
            <View accessibilityRole="tablist" accessibilityLabel="Cameras" style={{ flexDirection: 'row', gap: space.sm }}>
              {present.map((f) => (
                <Chip key={f} role="tab" selected={facing === f} onPress={() => setFacing(f)} testID={`facing-${f}`}>
                  {FACING_LABEL[f]}
                </Chip>
              ))}
            </View>
          ) : null}

          <Row
            icon={<Icon.Camera size={22} color={color.ink} />}
            title="Add camera"
            subtitle="Pair a second phone as another angle"
            onPress={() => router.push('/settings/devices')}
          />

          {cap ? (
            <>
              <NotStored testID="camera-not-stored">
                These are what this camera can do, not settings. Exposure,
                focus and white balance are locked by the director while the
                show runs; nothing on this screen is saved for next time yet.
              </NotStored>

              <Card style={{ gap: space.s }}>
                <Text style={text.sectionHeading}>Exposure, focus and colour</Text>
                <Text style={text.supporting}>
                  Locking exposure stops brightness jumping when lights change,
                  and locking focus keeps it on where you stand.
                </Text>
                <Text style={text.body}>{lockLine(cap)}</Text>
              </Card>

              <Card style={{ gap: space.s }}>
                <Text style={text.sectionHeading}>Zoom</Text>
                {cap.deviceZoom.available ? (
                  <Text style={text.supporting}>
                    Uses this camera&apos;s own lens, never digital crop, so nothing
                    is lost from the picture.
                  </Text>
                ) : (
                  // design/CameraSettings.dc.html promises the lens is always
                  // used. On a phone whose camera reports no zoom range that
                  // is not true, and docs/DECISIONS.md (2026-10-12) is what
                  // happens instead: a digital crop, capped at 1.2x.
                  <Text style={text.supporting}>
                    This camera reports no zoom range of its own, so a zoom is a
                    crop of the picture, capped at 1.2x.
                  </Text>
                )}
                <Text style={text.body}>{zoomLine(cap)}</Text>
                <Text style={text.supporting}>{cap.qualityCeiling.reason}</Text>
              </Card>

              <Card style={{ gap: space.s }}>
                <Text style={text.sectionHeading}>Moves</Text>
                <Text style={text.supporting}>
                  A moving zoom is a slow push in or out during a shot; a pan is
                  a slow sweep across the room.
                </Text>
                <Text style={text.body}>{movesLine(cap)}</Text>
              </Card>

              {/* Both of the board's remaining controls are decided
                  elsewhere, and both of those places are real. */}
              <Row
                icon={<Icon.Sparkle size={22} color={color.ink} />}
                title="Which moves the director uses"
                subtitle="Turned on and off in Direction, and saved there"
                onPress={() => router.push('/settings/direction')}
              />
              <Row
                icon={<Icon.Rotate size={22} color={color.ink} />}
                title="Orientation"
                subtitle="Portrait or landscape is chosen for the whole show when you book it"
                onPress={() => router.push('/artist/schedule')}
              />
              <Row
                icon={<Icon.Check size={22} color={color.ink} />}
                title="Room and light check"
                subtitle="Checks light and framing for this place, in kit check"
                onPress={() => router.push('/artist/kit-check')}
              />
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Which of the three locks this camera's hardware offers, in plain words. */
function lockLine(cap) {
  const have = ['iso', 'shutter', 'wb', 'focus', 'ev'].filter((k) => cap.proSupport?.[k]?.supported);
  if (!have.length) return 'This camera offers no manual exposure or colour control, so the director leaves both automatic.';
  const names = { iso: 'sensitivity', shutter: 'shutter', wb: 'white balance', focus: 'focus', ev: 'brightness' };
  return `This camera can be held at a fixed ${have.map((k) => names[k]).join(', ')}.`;
}

/** The real zoom range, and the point past which 1080p stops being full quality. */
function zoomLine(cap) {
  const { min, max, available } = cap.deviceZoom;
  if (!available) return 'Fixed at 1x on the lens.';
  const ceiling = cap.qualityCeiling.zoom;
  const range = `${min}x to ${max}x on the lens`;
  return ceiling != null && ceiling < max
    ? `${range}, at full sensor quality up to ${ceiling}x.`
    : `${range}.`;
}

function movesLine(cap) {
  const on = ['deviceZoom', 'lensSwitch', 'digitalZoom', 'pan', 'bop'].filter((k) => cap.features[k]?.on);
  const names = { deviceZoom: 'lens zoom', lensSwitch: 'lens switching', digitalZoom: 'digital zoom', pan: 'pan', bop: 'bop' };
  return on.length ? `Available on this camera: ${on.map((k) => names[k]).join(', ')}.` : 'No moves are available on this camera.';
}

function CameraSkeleton() {
  return (
    <Screen>
      <View style={{ paddingTop: 52, paddingHorizontal: space.screenEdge, gap: space.l }}>
        <Skeleton width={44} height={44} radius={22} />
        <Skeleton width={140} height={34} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Skeleton width={120} height={36} radius={18} />
          <Skeleton width={120} height={36} radius={18} />
        </View>
        <Skeleton width="100%" height={88} radius={16} />
        <Skeleton width="100%" height={120} radius={16} />
        <Skeleton width="100%" height={120} radius={16} />
      </View>
    </Screen>
  );
}
