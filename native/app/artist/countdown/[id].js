// Countdown.dc.html — the last minute, and nothing to do in it.
//
// Kit check leads here and this leads to the console. The board's promise
// is the whole screen: "Stay on this screen. Your show starts on its own
// at zero." So the number is not a button that has to be pressed, and
// going live is not the artist's job — at zero this calls /go-live itself
// and hands over to the console.
//
// The clock is lib/showWindow.js handoverState, which is the same predicate
// the web Kit Check uses. It is shared rather than retyped because this
// countdown has been wrong twice before: once counting from the window
// opening instead of showtime, once not firing at all. Both were a
// predicate nobody could test on its own.
//
// Fix is the one way out, and it never ends anything (CLAUDE.md §4: the
// show must never stop).
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import {
  Screen, ErrorPanel, Skeleton, Icon,
  color, space, surface, textOnDark, face, size,
} from '../../../src/ui';
import { api } from '../../../src/api';
import { useSession } from '../../../src/session';
import { handoverState, HANDOVER_COUNTDOWN_SECONDS } from '@loud/lib/showWindow.js';

export default function Countdown() {
  const { id } = useLocalSearchParams();
  useKeepAwake();                      // the screen must not sleep in its own last minute
  const { session, loading, accessToken } = useSession();
  const [show, setShow] = useState(null);
  const [failed, setFailed] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [going, setGoing] = useState(false);
  const [goFailed, setGoFailed] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const handedOver = useRef(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    const r = await api(`/api/artist/shows/${id}/console`, { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setShow(r.data.show);
  }, [accessToken, id]);

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);

  const state = handoverState(show, now);

  // Zero. The artist is told their show starts on its own, so it does.
  // `handedOver` guards the one call: the tick runs four times a second and
  // go-live is not a thing to ask for twice.
  useEffect(() => {
    if (!show?.id || handedOver.current) return;
    if (show.actual_started_at) { handedOver.current = true; router.replace(`/artist/console/${show.id}`); return; }
    if (state.status !== 'due') return;
    handedOver.current = true;
    setGoing(true);
    (async () => {
      const r = await api(`/api/artist/shows/${show.id}/go-live`, { method: 'POST', accessToken });
      setGoing(false);
      if (r.ok) { router.replace(`/artist/console/${show.id}`); return; }
      // Nothing is ended and nothing is hidden: the artist is told, and the
      // console is still reachable by hand.
      handedOver.current = false;
      setGoFailed(r.data?.error || 'Your show did not start on its own. Open the console and start it by hand.');
    })();
  }, [state.status, show, accessToken]);

  if (loading || (!show && !failed)) return <CountdownSkeleton />;

  if (failed) {
    return (
      <Screen dark>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <Text style={[textOnDark.screenTitle, { fontSize: 28 }]}>Going live</Text>
          <ErrorPanel
            title="We could not read this show"
            body="It may have been cancelled. Try again, or go back to your profile."
            onRetry={load}
            backLabel="Your profile"
            onBack={() => router.replace('/profile')}
            testID="countdown-failed"
          />
        </View>
      </Screen>
    );
  }

  // Reaching this screen early is possible — a reminder, a back gesture out
  // of the console — and a frozen "60" would be a lie. Outside the final
  // minute the screen says what it is really waiting for and keeps ticking,
  // so the artist sees the number start moving rather than wondering.
  const waiting = state.status === 'none' || state.status === 'waiting';
  const seconds = Math.min(
    HANDOVER_COUNTDOWN_SECONDS,
    Math.max(0, state.countdown ?? state.secondsToShowtime ?? HANDOVER_COUNTDOWN_SECONDS),
  );
  const minutesAway = state.secondsToShowtime == null ? null : Math.ceil(state.secondsToShowtime / 60);

  return (
    <Screen dark>
      {/* The board's placeholder for the picture. There is no composed
          frame yet — the show has not started — so this says what will be
          here rather than pretending a broadcast is already running. */}
      <Text style={{ position: 'absolute', left: 0, right: 0, top: 120, textAlign: 'center', fontFamily: face.regular, fontSize: 14, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(253,255,252,0.7)' }}>
        Main camera view
      </Text>

      <View style={{ position: 'absolute', left: space.l, right: space.l, top: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon.Camera size={22} color={color.porcelain} />
          <Text style={{ fontFamily: face.bold, fontSize: 18, fontWeight: '700', color: color.porcelain }}>Going live</Text>
        </View>
        <View style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: surface.quietDark }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color.teal, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Check size={14} color={color.ink} />
          </View>
          <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: color.porcelain }}>Kit check passed</Text>
        </View>
      </View>

      <View
        accessibilityRole="timer"
        accessibilityLabel={`${seconds} seconds until you go live`}
        style={{ position: 'absolute', left: 0, right: 0, top: 250, alignItems: 'center', gap: space.xs }}
      >
        <Text style={{ fontFamily: face.bold, fontSize: 190, lineHeight: 200, fontWeight: '700', color: color.porcelain, opacity: 0.5 }}>
          {seconds}
        </Text>
        <Text style={{ fontFamily: face.bold, fontSize: 22, fontWeight: '700', color: color.porcelain }}>
          {going ? 'starting your show' : 'seconds to live'}
        </Text>
        <Text style={{ fontFamily: face.regular, fontSize: 17, textAlign: 'center', paddingHorizontal: space.xl, color: 'rgba(253,255,252,0.85)' }}>
          Stay on this screen. Your show starts on its own at zero.
        </Text>
        {waiting ? (
          <Text style={{ fontFamily: face.regular, fontSize: 17, textAlign: 'center', paddingHorizontal: space.xl, color: color.mutedOnDark }}>
            {state.status === 'none' || minutesAway == null
              ? 'This show is not inside its window yet. The last minute starts on its own.'
              : `${minutesAway} min to go. The last minute starts counting on its own.`}
          </Text>
        ) : null}
      </View>

      {goFailed ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 160 }}>
          <ErrorPanel
            title="Your show did not start on its own"
            body={goFailed}
            retryLabel="Try again"
            onRetry={() => { setGoFailed(null); handedOver.current = false; setNow(Date.now()); }}
            backLabel="Open the console"
            onBack={() => router.replace(`/artist/console/${id}`)}
            testID="countdown-go-failed"
          />
        </View>
      ) : null}

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 56, flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
        <RoundAction
          label={micOn ? 'Microphone on' : 'Microphone off'}
          caption="Mic"
          onPress={() => setMicOn((m) => !m)}
        >
          <Icon.Mic size={24} color={micOn ? color.porcelain : color.mutedOnDark} />
        </RoundAction>
        <RoundAction label="Cameras" caption="Cameras" onPress={() => router.push('/camera')}>
          <Icon.Camera size={24} color={color.porcelain} />
        </RoundAction>
        <RoundAction label="Fix something" caption="Fix" strong onPress={() => router.push(`/artist/fix/${id}`)}>
          <Icon.Wrench size={24} color={color.ink} />
        </RoundAction>
      </View>
    </Screen>
  );
}

/** The board's 56px round action with its label under it; 64 wide, so the tap target clears 44. */
function RoundAction({ label, caption, onPress, strong = false, children }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 64, alignItems: 'center', gap: 6, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: strong ? color.orange : surface.quietDark }}>
        {children}
      </View>
      <Text style={{ fontFamily: strong ? face.bold : face.regular, fontSize: 14, fontWeight: strong ? '700' : '400', color: color.porcelain }}>{caption}</Text>
    </Pressable>
  );
}

function CountdownSkeleton() {
  return (
    <Screen dark>
      <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.xl, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between' }}>
          <Skeleton width={130} height={size.touch - 20} radius={10} />
          <Skeleton width={150} height={32} radius={16} />
        </View>
        <Skeleton width={220} height={190} radius={20} style={{ marginTop: 120 }} />
        <Skeleton width={180} height={22} />
      </View>
    </Screen>
  );
}
