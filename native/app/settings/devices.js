// DevicesSettings.dc.html — the rig: paired cameras, and the operator.
//
// Real: the paired list and removing a camera, both through
// /api/camfeed/pair ({ action: 'list' } and { action: 'revoke' }). A
// camera is "live" by the route's own predicate, not by whether it once
// connected — CLAUDE.md §5, "camera healthy means frames keep arriving".
//
// The board draws the pairing QR here. The code that a second phone
// scans belongs to the camera screen, which mints it and shows it, so
// this links there instead of drawing a second QR from a second mint.
//
// The operator invite has no screen on the phone (OperatorInvite.dc.html
// is unbuilt), so the Invite button is not drawn. What an operator is
// allowed to do IS stored, and that row goes where it is stored.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Button, Row, Section, ScreenHeader, Empty, ErrorPanel, Skeleton, Icon,
  color, space, text, useLoadingPhase,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { api } from '../../src/api';
import { describeRig, rigSummary } from '@loud/lib/rig.js';
import { isLivePairing } from '@loud/lib/pairingLiveness.js';
import { useSession } from '../../src/session';
import { available as capturerAvailable } from '../../modules/loud-camera';


export default function DevicesSettings() {
  const { accessToken, loading } = useSession();
  const [rig, setRig] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const phase = useLoadingPhase(rig === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    setActionError(null);
    const r = await api('/api/camfeed/pair', { method: 'POST', accessToken, body: { action: 'list' } });
    if (!r.ok) { setFailed(true); return; }
    setRig({ pairings: r.data?.pairings || [], degraded: Boolean(r.data?.degraded) });
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  async function revoke(pairing) {
    setBusyId(pairing.id);
    setActionError(null);
    const r = await api('/api/camfeed/pair', { method: 'POST', accessToken, body: { action: 'revoke', id: pairing.id } });
    setBusyId(null);
    if (!r.ok) { setActionError('That camera was not removed. Try again.'); return; }
    load();
  }

  if (phase === 'loading') return <DevicesSkeleton />;

  const paired = rig?.pairings || [];
  // One description of the rig, shared with Kit Check, so the two
  // screens cannot disagree about which device holds which job.
  const devices = describeRig({ pairings: paired, ownLive: capturerAvailable, isLive: isLivePairing });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.xxl }}>
        <ScreenHeader title="Devices" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.xxl }}>
          {failed || (!rig && phase === 'slow') ? (
            <ErrorPanel
              title="We could not read your cameras"
              body="It may be the connection. Try again."
              onRetry={load}
              backLabel="Back to Settings"
              onBack={() => router.push('/settings')}
            />
          ) : null}

          {actionError ? <ErrorPanel title="That did not work" body={actionError} onRetry={load} /> : null}

          <Section title="Your rig">
            {/* The saved set-up: this phone and every device paired to
                it, each with the job it holds. Kit Check shows the same
                rig per show and wins there; this is what it starts
                from. The phone in your hand has no pairing row — there
                is nothing to pair, it is the handset running the app —
                so lib/rig.js describes it rather than the database. */}
            {devices.map((d) => (
              <Row
                key={d.id}
                icon={d.publishes
                  ? <Icon.Camera size={22} color={color.ink} />
                  : <Icon.Wrench size={22} color={color.ink} />}
                title={d.own ? d.label : `${d.label}${d.status === 'waiting' ? ' · waiting' : ''}`}
                subtitle={d.own
                  ? (capturerAvailable
                    ? 'Checked when a show starts, not from here.'
                    : 'This build has no camera module, so this phone cannot be a camera.')
                  : statusLine(paired.find((p) => p.id === d.id) || {})}
                right={d.own ? null : (
                  <Button
                    kind="quiet"
                    size="small"
                    busy={busyId === d.id}
                    onPress={() => revoke({ id: d.id })}
                    accessibilityLabel={`Remove ${d.label}`}
                  >
                    Remove
                  </Button>
                )}
              />
            ))}

            <Text style={[text.supporting, { paddingHorizontal: 4 }]}>
              {rigSummary(devices)} This is your saved set-up; Kit Check shows
              it again before each show and anything you change there counts
              for that show only.
            </Text>

            {rig?.degraded ? (
              <NotStored testID="devices-degraded">
                Pairing a second camera needs a database update that has not
                been applied here yet. One camera still works.
              </NotStored>
            ) : null}

            {!rig?.degraded && !paired.length ? (
              <Empty
                icon={<Icon.Camera size={24} color={color.ink} />}
                title="No second camera"
                body="One camera per phone, using that phone's own camera. A second phone gives the director another angle to cut to."
                actionLabel="Add a camera"
                onAction={() => router.push('/settings/pair')}
                testID="devices-empty"
              />
            ) : null}

          </Section>

          <Section title="Add a device">
            <Row
              icon={<Icon.Expand size={22} color={color.ink} />}
              title="Show the pairing code"
              subtitle={'On the other phone, open Loudentify, tap "Use this phone as a camera" and scan this code.'}
              onPress={() => router.push('/settings/pair')}
            />
          </Section>

          <Section title="Operator">
            <Row
              icon={<Icon.Person size={22} color={color.ink} />}
              title={devices.some((d) => d.role === 'director') ? 'Control panel paired' : 'No control panel yet'}
              subtitle="A second person who runs your show from a laptop. Pair it above as Control panel."
            />
            <NotStored testID="devices-no-invite">
              Inviting an operator is on the website. There is no invite screen
              in the app yet.
            </NotStored>
            <Row
              icon={<Icon.Wrench size={22} color={color.ink} />}
              title="What an operator can do"
              onPress={() => router.push('/settings/direction')}
            />
          </Section>

          <Text style={text.supporting}>
            One camera per phone, using that phone&apos;s own camera. Keep every
            device plugged in during a show.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}


/**
 * The board's two states, in its own words. A pairing that has never
 * been redeemed is a third state the board does not draw, and it reads
 * differently: nothing is offline, the code is simply unused.
 */
function statusLine(p) {
  if (p.live) return 'Ready';
  if (!p.pairedAt) return 'Waiting for that phone to scan the code.';
  return 'Offline. Open Loudentify on that phone to reconnect.';
}

function DevicesSkeleton() {
  return (
    <Screen>
      <View style={{ paddingTop: 52, paddingHorizontal: space.screenEdge, gap: space.l }}>
        <Skeleton width={44} height={44} radius={22} />
        <Skeleton width={150} height={34} />
        <Skeleton width={160} height={21} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={96} radius={16} />
      </View>
    </Screen>
  );
}
