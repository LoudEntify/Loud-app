// A message on the live screen that covers what it sits on.
//
// The console drew its errors with `ErrorPanel`, whose surface is
// rgba(231,29,54,0.12) — twelve per cent of a red. That is right on a
// settings screen, where it tints a card that is already opaque. On the
// console it was laid over the four actions and the Go live button, so
// the words and the buttons were printed on top of each other and both
// became unreadable, and the buttons underneath were still live: an
// artist reading "that did not work" could press Cuts through the
// sentence telling them so.
//
// So this is the opposite of a tint. It is opaque, it covers the whole
// lower region rather than only the text's own box, it swallows every
// touch that is not its own dismiss, and it fades rather than appearing
// between two frames — a thing that blinks into existence over a live
// show reads as a fault in the show.
//
// It stays until the artist dismisses it. Nothing on a live screen
// should time out on its own: a message that vanishes while the artist
// is looking at their hands is a message that was never delivered.
import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, Pressable } from 'react-native';
import { color, space, radius } from './tokens';
import { face } from './tokens';
import { Button } from './Button';
import { Warning } from './Icon';

export const NOTICE_FADE_MS = 220;

/**
 * @param message   the sentence. Falsy renders nothing and fades out.
 * @param title     the heading above it.
 * @param onDismiss what the button does. Required: there is no timeout.
 * @param cover     how far up the screen it reaches, in points from the
 *                  bottom. The caller knows what sits below it.
 * @param tone      'error' | 'notice' — red rule or teal.
 */
export function LiveNotice({ message, title = 'That did not work', onDismiss, cover = 240, tone = 'error', dismissLabel = 'Dismiss', testID }) {
  const shown = Boolean(message);
  const fade = useRef(new Animated.Value(0)).current;
  // The message is held through the fade out, so the words do not vanish
  // a frame before the panel carrying them.
  const held = useRef(message);
  if (shown) held.current = message;

  useEffect(() => {
    const anim = Animated.timing(fade, {
      toValue: shown ? 1 : 0,
      duration: NOTICE_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [shown, fade]);

  // pointerEvents is what makes it a cover rather than a picture of one.
  // Without it the buttons underneath stay pressable through the panel.
  return (
    <Animated.View
      pointerEvents={shown ? 'auto' : 'none'}
      accessibilityViewIsModal={shown}
      accessibilityLiveRegion="assertive"
      testID={testID}
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: cover,
        opacity: fade,
        backgroundColor: color.ink,
        borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
        paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.xl,
        justifyContent: 'center', gap: space.s,
      }}
    >
      {/* Swallows anything aimed at what is underneath, including a tap
          on the padding either side of the button. */}
      <Pressable accessible={false} onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Warning size={22} color={tone === 'error' ? color.red : color.teal} />
        <Text style={{ fontFamily: face.bold, fontSize: 19, fontWeight: '700', color: color.porcelain, flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ fontFamily: face.regular, fontSize: 17, lineHeight: 23, color: 'rgba(253,255,252,0.86)' }}>
        {held.current}
      </Text>
      <View style={{ flexDirection: 'row', marginTop: space.xs }}>
        <Button kind="quietDark" size="medium" onPress={onDismiss} testID={testID ? `${testID}-dismiss` : undefined}>{dismissLabel}</Button>
      </View>
    </Animated.View>
  );
}
