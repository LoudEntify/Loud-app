// native/src/ui/Layout.js — the three arrangements every screen repeats.
//
//   ScreenHeader  the 34px title with its back arrow and up to two actions
//   Section       a heading with its content under it
//   Row           the tappable list row: icon, title, subtitle, chevron
//
// These exist so a screen is a list of what it contains rather than a pile
// of padding numbers, and so the screen edge (16 on a phone) and the 44px
// minimum tap target are decided once.
import { View, Text, Pressable } from 'react-native';
import { color, space, text, textOnDark, radius, surface, size } from './tokens';
import { Back, Chevron } from './Icon';

/** The round 44px icon button the boards put in headers and over video. */
export function IconButton({ children, onPress, label, dark = false, style, testID }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [{
        width: size.touch, height: size.touch, borderRadius: size.touch / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: dark ? surface.quietDark : surface.quiet,
        opacity: pressed ? 0.85 : 1,
      }, style]}
    >
      {children}
    </Pressable>
  );
}

export function ScreenHeader({ title, onBack, actions = null, dark = false, style }) {
  const t = dark ? textOnDark : text;
  return (
    <View style={[{ paddingHorizontal: space.screenEdge, gap: space.m }, style]}>
      {onBack ? (
        <IconButton label="Back" onPress={onBack} dark={dark}>
          <Back size={22} color={dark ? color.porcelain : color.ink} />
        </IconButton>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text style={[t.screenTitle, { flex: 1 }]} numberOfLines={2}>{title}</Text>
        {actions}
      </View>
    </View>
  );
}

export function Section({ title, action, dark = false, children, style }) {
  const t = dark ? textOnDark : text;
  return (
    <View style={[{ gap: space.s }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[t.sectionHeading, { flex: 1 }]}>{title}</Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * The list row the settings screens are made of: a 64px tappable band with
 * an optional leading icon, a title, a supporting line, and either a
 * chevron or whatever the caller puts on the right (a toggle, a value).
 */
export function Row({ icon = null, title, subtitle, right, onPress, dark = false, style, testID }) {
  const t = dark ? textOnDark : text;
  const body = (
    <View style={[{
      minHeight: 64, borderRadius: radius.card, paddingHorizontal: 14,
      flexDirection: 'row', alignItems: 'center', gap: space.m,
      backgroundColor: dark ? surface.quietDark : surface.quiet,
    }, style]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={t.supporting} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Chevron size={20} color={dark ? color.mutedOnDark : color.mutedOnLight} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} testID={testID} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}
