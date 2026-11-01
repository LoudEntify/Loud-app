// native/src/ui/states.js — the four states that are not the happy path.
//
// StatesPatterns.dc.html, verbatim on each:
//
//   Loading  "Grey shapes in the layout the real content will take, so
//            nothing jumps when it arrives. No spinners on full screens."
//            "After 10 seconds with nothing back, switch to the error state."
//   Empty    "Say plainly what is not here, then give the one action that
//            fills it. Never a blank screen, never a sad face."
//   Error    "Say what failed in plain words, and give a way forward. No
//            codes, no apology paragraphs, never 'something went wrong'."
//   Offline  "A bar across the top, not a screen that blocks everything.
//            Anything already loaded stays readable, and it clears itself
//            when the connection returns." Mid-show the artist gets the
//            Fix sheet instead, which is the one exception.
//
// Every screen in the app is expected to use these rather than inventing
// its own, which is the whole reason they are built once here.
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Animated, Easing } from 'react-native';
import { Button } from './Button';
import { text, textOnDark, color, surface, space, radius, LOADING_GIVE_UP_MS } from './tokens';
import { Warning, Cloud } from './Icon';

/**
 * One grey shape in the layout the real content will take. It breathes
 * between 0.5 and 1 so a stalled screen does not look like a finished one;
 * a person who has asked for less motion gets the still version.
 */
export function Skeleton({ width, height = 16, radius: r = 8, style, animate = true }) {
  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (!animate) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.6, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, pulse]);
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: surface.skeleton, opacity: animate ? pulse : 1 }, style]} />;
}

/**
 * "Say plainly what is not here, then give the one action that fills it."
 * One action, never two: a second button is a second decision on a screen
 * that already has nothing on it.
 */
export function Empty({ icon, title, body, actionLabel, onAction, dark = false, testID }) {
  const t = dark ? textOnDark : text;
  return (
    <View testID={testID} style={{ alignItems: 'center', paddingHorizontal: space.xxl, paddingVertical: 40, gap: space.m }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(46,196,182,0.35)', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <Text style={[t.rowTitle, { fontSize: 19, textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[t.body, { textAlign: 'center', color: dark ? color.mutedOnDark : color.mutedOnLight }]}>{body}</Text> : null}
      {actionLabel ? <Button kind="strong" size="medium" onPress={onAction} style={{ marginTop: space.xs }}>{actionLabel}</Button> : null}
    </View>
  );
}

/**
 * "No codes, no apology paragraphs, never 'something went wrong'." The two
 * buttons are the board's: a way to try again, and a way out.
 */
export function ErrorPanel({ title, body, retryLabel = 'Try again', onRetry, backLabel, onBack, testID }) {
  return (
    <View testID={testID} style={{ backgroundColor: surface.errorPanel, borderRadius: radius.card, padding: space.l, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Warning size={22} color={surface.errorIcon} />
        <Text style={[text.rowTitle, { flex: 1 }]}>{title}</Text>
      </View>
      {body ? <Text style={text.body}>{body}</Text> : null}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
        {onRetry ? <Button kind="strong" size="small" onPress={onRetry}>{retryLabel}</Button> : null}
        {onBack && backLabel ? <Button kind="quiet" size="small" onPress={onBack}>{backLabel}</Button> : null}
      </View>
    </View>
  );
}

/**
 * "A bar across the top, not a screen that blocks everything." It never
 * covers content: the caller renders it above the scroll area, not over it.
 */
export function OfflineBar({ message = 'No connection. Trying to reconnect.', testID }) {
  return (
    <View testID={testID} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.l, paddingVertical: space.sm, borderRadius: 999, backgroundColor: color.ink }}>
      <Cloud size={20} color={color.porcelain} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: color.porcelain }}>{message}</Text>
    </View>
  );
}

/**
 * The loading rule as a hook: a screen is loading until it has something,
 * and after ten seconds with nothing back it is an error instead. Returns
 * 'loading' | 'slow', so a screen can keep its skeletons and still say
 * something honest when the wait has gone past reasonable.
 */
export function useLoadingPhase(loading, giveUpMs = LOADING_GIVE_UP_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), giveUpMs);
    return () => clearTimeout(t);
  }, [loading, giveUpMs]);
  return loading ? (slow ? 'slow' : 'loading') : 'done';
}

/** A small inline spinner, for a button or a row. Never a whole screen. */
export function Spinner({ dark = false }) {
  return <ActivityIndicator color={dark ? color.porcelain : color.ink} />;
}
