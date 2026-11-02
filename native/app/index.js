// Launch.dc.html — the first second of the app.
//
// The board is a dark screen with the mark on it and the whole screen as
// one link forward. It exists so the app has a held moment while the
// session is read from storage, instead of flashing an empty Discover and
// then a login sheet.
//
// "Every animation, including the launch whale, has a still fallback", so
// the mark fades up only when the person has not asked for less motion,
// and the screen is tappable throughout: nobody waits on an animation.
import { useEffect, useRef, useState } from 'react';
import { Text, Pressable, Animated, Easing, AccessibilityInfo, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Screen, Wordmark, WORDMARK_ASPECT, space, textOnDark, face } from '../src/ui';
import { useSession } from '../src/session';

const HOLD_MS = 1200;

export default function Launch() {
  const { loading } = useSession();
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setReduceMotion(!!on); }, () => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) { fade.setValue(1); lift.setValue(0); return undefined; }
    const anim = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, fade, lift]);

  // Discover plays for a signed-out viewer too, so the launch always lands
  // there. Nothing here decides whether someone is signed in; the tabs do.
  const go = () => router.replace('/discover');
  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(go, HOLD_MS);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <Screen dark>
      <Pressable accessibilityRole="button" accessibilityLabel="Open Discover" onPress={go} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m }}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: lift }], alignItems: 'center', gap: space.m }}>
          <Wordmark height={Math.min(width * 0.66, 300) / WORDMARK_ASPECT} />
          <Text style={[textOnDark.supporting, { fontFamily: face.regular }]}>Live music, directed as it happens.</Text>
        </Animated.View>
      </Pressable>
    </Screen>
  );
}
