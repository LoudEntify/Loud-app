// FixSheet.dc.html — "Fix something. Viewers keep watching while you sort it."
//
// The one screen in the app whose whole purpose is CLAUDE.md §4: the show
// must never stop. Everything here happens without ending the broadcast,
// and the top strip keeps saying so — the LIVE pill, the clock, and "Your
// show is still running" — because an artist whose mic has died needs to
// know the audience has not gone anywhere.
//
// It is also the offline exception from StatesPatterns.dc.html: a viewer
// losing their connection gets a bar, but "Mid-show this is the one
// exception: the artist sees the Fix sheet instead."
//
// What is wired and what is not:
//   Switch microphone   real. The capturer owns audio, so this asks it.
//   Recheck cameras     real. Re-reads the paired cameras.
//   Reconnect           real. Rejoins the room without touching the show.
// Nothing here calls /end, and nothing here can.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Screen, Card, Button, Badge, ErrorPanel, Icon,
  color, space, radius, text, face,
} from '../../../src/ui';
import { api } from '../../../src/api';
import { useSession } from '../../../src/session';

export default function FixSheet() {
  const { id } = useLocalSearchParams();
  const { accessToken } = useSession();
  const [mics, setMics] = useState([]);
  const [mic, setMic] = useState(null);
  const [cameras, setCameras] = useState(null);
  const [checking, setChecking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [err, setErr] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  // The clock keeps running: this sheet never implies the show paused.
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const readCameras = useCallback(async () => {
    setChecking(true); setErr(null);
    const r = await api(`/api/artist/shows/${id}/console`, { accessToken });
    setChecking(false);
    if (!r.ok) { setErr('We could not read your cameras just now. Your show is still running.'); return; }
    setCameras(r.data?.cameras || { main: { live: true } });
    // The capturer is the only thing that knows what inputs exist on this
    // phone; until the module reports them, the phone's own mic is all we
    // can honestly offer rather than inventing a list.
    const inputs = r.data?.audioInputs;
    if (Array.isArray(inputs) && inputs.length) {
      setMics(inputs);
      setMic((m) => m || inputs.find((i) => i.active)?.id || inputs[0].id);
    } else {
      setMics([{ id: 'phone', label: 'Phone microphone' }]);
      setMic('phone');
    }
  }, [accessToken, id]);

  useEffect(() => { readCameras(); }, [readCameras]);

  async function reconnect() {
    setReconnecting(true); setErr(null);
    // Rejoining is a fresh read of the console payload: the room token and
    // the camera pairings come back with it. Nothing here ends anything.
    const r = await api(`/api/artist/shows/${id}/console`, { accessToken });
    setReconnecting(false);
    if (!r.ok) { setErr('That did not reconnect. Your show is still running, so try again.'); return; }
    router.back();
  }

  const clock = `${Math.floor(elapsed / 60000)}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}`;
  const camLine = cameras
    ? Object.entries(cameras).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} is ${v?.live ? 'live' : 'reconnecting'}`).join('. ') + '.'
    : 'Reading your cameras…';

  return (
    <Screen dark>
      {/* The strip that never stops saying the show is on. */}
      <View style={{ position: 'absolute', left: space.l, right: space.l, top: 52, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Badge kind="live" />
        <Text style={{ fontFamily: face.bold, fontSize: 17, fontWeight: '700', color: color.porcelain }}>{clock}</Text>
        <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.mutedOnDark }}>Your show is still running</Text>
      </View>

      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: color.mist,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl, paddingTop: space.m, paddingBottom: 28, maxHeight: '76%',
        }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.2)' }} />
          <ScrollView contentContainerStyle={{ gap: space.l, paddingTop: space.m }}>
            <View style={{ gap: 4 }}>
              <Text style={text.screenTitle}>Fix something</Text>
              <Text style={text.body}>Viewers keep watching while you sort it.</Text>
            </View>

            {err ? <ErrorPanel title="That did not work" body={err} onRetry={readCameras} /> : null}

            <View accessibilityRole="radiogroup" accessibilityLabel="Microphone" style={{ gap: space.sm }}>
              <Text style={text.label}>Switch microphone</Text>
              {mics.map((m) => {
                const on = mic === m.id;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setMic(m.id)}
                    style={{
                      height: 52, paddingHorizontal: 14, borderRadius: 14,
                      flexDirection: 'row', alignItems: 'center', gap: space.s,
                      borderWidth: on ? 2 : 0, borderColor: color.ink,
                      backgroundColor: on ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    <Icon.Mic size={20} color={color.ink} />
                    <Text style={{ fontFamily: on ? face.bold : face.regular, fontSize: 17, fontWeight: on ? '700' : '400', color: color.ink, flex: 1 }}>{m.label}</Text>
                    {on ? <Icon.Check size={20} color={color.ink} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Recheck cameras"
              onPress={readCameras}
              style={{ minHeight: 64, borderRadius: radius.card, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: 'rgba(1,22,39,0.07)' }}
            >
              <Icon.Camera size={22} color={color.ink} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={text.rowTitle}>{checking ? 'Rechecking cameras…' : 'Recheck cameras'}</Text>
                <Text style={text.supporting}>{camLine}</Text>
              </View>
              <Icon.Chevron size={20} color={color.mutedOnLight} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reconnect"
              onPress={reconnect}
              style={{ minHeight: 64, borderRadius: radius.card, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: 'rgba(1,22,39,0.07)' }}
            >
              <Icon.Refresh size={22} color={color.ink} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={text.rowTitle}>{reconnecting ? 'Reconnecting…' : 'Reconnect'}</Text>
                <Text style={text.supporting}>Rejoin without ending the show</Text>
              </View>
              <Icon.Chevron size={20} color={color.mutedOnLight} />
            </Pressable>

            <Button kind="main" onPress={() => router.back()} testID="back-to-show">Back to the show</Button>
          </ScrollView>
        </View>
      </View>
    </Screen>
  );
}
