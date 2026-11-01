// native/src/ui/Button.js — the four button kinds, and the chip.
//
// From DesignSystem.dc.html: 52 high, 26 radius, 18px bold, in four kinds.
//
//   main        teal gradient, ink text      the one main action on a screen
//   strong      ink gradient, porcelain text a serious action, or one on a dark screen
//   quiet       ink at 7%, ink text          everything secondary
//   destructive solid red, white text        ending, deleting, stopping
//
// Teal and orange are fills and never text on a light background: both come
// out near 2:1 against porcelain where 4.5:1 is needed. That rule is why
// `main` puts ink on teal rather than teal on porcelain, and it is enforced
// by tests/native-ui.test.mjs rather than left to memory.
import { Pressable, Text, View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { color, button, gradient, surface, space } from './tokens';

const KINDS = {
  main: { gradient: gradient.tealButton, text: color.ink },
  strong: { gradient: gradient.inkButton, text: color.porcelain },
  quiet: { fill: surface.quiet, text: color.ink },
  quietDark: { fill: surface.quietDark, text: color.porcelain },
  destructive: { fill: color.red, text: color.white },
};

/**
 * @param kind     one of the five above
 * @param size     main | medium | small | chip | tiny (heights 52/44/40/36/28)
 * @param busy     shows a spinner in place of the label and blocks presses
 * @param icon     an element drawn before the label
 */
export function Button({
  children, onPress, kind = 'quiet', size = 'main', busy = false, disabled = false,
  icon = null, style, textStyle, testID, accessibilityLabel,
}) {
  const k = KINDS[kind] || KINDS.quiet;
  const s = button[size] || button.main;
  const off = disabled || busy;

  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
      {busy
        ? <ActivityIndicator color={k.text} />
        : (<>
            {icon}
            <Text numberOfLines={1} style={[{ fontSize: s.fontSize, fontWeight: '700', color: k.text }, textStyle]}>{children}</Text>
          </>)}
    </View>
  );

  const frame = {
    height: s.height,
    borderRadius: s.radius,
    paddingHorizontal: size === 'tiny' ? 10 : size === 'chip' ? 16 : 18,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: off ? 0.5 : 1,
    overflow: 'hidden',
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [frame, k.fill ? { backgroundColor: k.fill } : null, pressed && !off ? { opacity: 0.85 } : null, style]}
    >
      {k.gradient ? (
        <LinearGradient
          colors={k.gradient.colors}
          locations={k.gradient.locations}
          start={k.gradient.start}
          end={k.gradient.end}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
      ) : null}
      {inner}
    </Pressable>
  );
}

/**
 * A filter chip. Chosen is a 2px ink border on porcelain at 700; not chosen
 * is an ink-7% fill at 400. They behave as radio buttons or as independent
 * toggles depending on how the screen uses them, so the caller says which
 * with `role`.
 */
export function Chip({ children, selected = false, onPress, role = 'radio', dark = false, style, testID }) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected } : { checked: selected }}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [{
        height: button.chip.height,
        borderRadius: button.chip.radius,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? (dark ? color.porcelain : color.porcelain) : (dark ? surface.quietDark : surface.quiet),
        borderWidth: selected ? 2 : 0,
        borderColor: color.ink,
        opacity: pressed ? 0.85 : 1,
      }, style]}
    >
      <Text style={{ fontSize: button.chip.fontSize, fontWeight: selected ? '700' : '400', color: selected ? color.ink : (dark ? color.porcelain : color.ink) }}>
        {children}
      </Text>
    </Pressable>
  );
}

/** LIVE, VERSUS, SOON. Fully round, 13px bold, wide letter-spacing. */
export function Badge({ kind = 'live', children, style }) {
  const look = {
    live: { bg: color.red, fg: color.white, text: 'LIVE' },
    versus: { bg: color.orange, fg: color.ink, text: 'VERSUS' },
    soon: { bg: 'rgba(1,22,39,0.75)', fg: color.porcelain, text: 'SOON' },
  }[kind] || { bg: 'rgba(1,22,39,0.75)', fg: color.porcelain, text: '' };
  return (
    <View style={[{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: look.bg }, style]}>
      <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 1.3, color: look.fg }}>{children ?? look.text}</Text>
    </View>
  );
}

/** 52x32, 3px inset, 26px knob. Teal gradient when on. */
export function Toggle({ value, onValueChange, label, disabled = false }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      style={{ width: 52, height: 32, borderRadius: 16, padding: 3, justifyContent: 'center', backgroundColor: value ? 'transparent' : 'rgba(1,22,39,0.18)', opacity: disabled ? 0.5 : 1, overflow: 'hidden' }}
    >
      {value ? (
        <LinearGradient
          colors={gradient.tealButton.colors}
          locations={gradient.tealButton.locations}
          start={gradient.tealButton.start}
          end={gradient.tealButton.end}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
      ) : null}
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color.white, alignSelf: value ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}
