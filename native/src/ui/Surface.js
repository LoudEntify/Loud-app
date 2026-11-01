// native/src/ui/Surface.js — the four surfaces the design system names.
//
//   Screen   light or dark, with the silk washes painted on
//   Card     white at 72% over the page wash
//   MediaTile the placeholder behind video and covers
//   Sheet    anchored to the bottom, with a scrim and a grab handle
//
// The silks are radial gradients on the web and there is no radial
// gradient in React Native, so each wash is drawn as one linear gradient
// laid over the base at the angle and corner the board puts it in. Stacked,
// they read as the same screen; `pointerEvents="none"` keeps every layer
// out of the way of anything the person can touch.
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradient, surface, radius, space, color, face } from './tokens';

/** The stack of washes that makes a silk, as absolutely-positioned layers. */
function Washes({ layers }) {
  return layers.map((g, i) => (
    <LinearGradient
      key={i}
      pointerEvents="none"
      colors={g.colors}
      start={g.start}
      end={g.end}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
    />
  ));
}

/**
 * A whole screen. `dark` for video and anything live, light for everything
 * else — the first of the six rules that are easy to break.
 */
export function Screen({ dark = false, style, children, ...rest }) {
  return (
    <View
      style={[{ flex: 1, backgroundColor: dark ? gradient.base.dark : gradient.base.light }, style]}
      {...rest}
    >
      <Washes layers={dark ? gradient.darkSilk : gradient.lightSilk} />
      {children}
    </View>
  );
}

/** White at 72% over the page wash. 14–18 radius. */
export function Card({ dark = false, style, children, ...rest }) {
  return (
    <View
      style={[{
        borderRadius: radius.card,
        backgroundColor: dark ? surface.cardDark : surface.card,
        padding: 14,
      }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

/**
 * What sits behind a cover or a camera view until the real thing arrives,
 * and what a camera preview is composited over. `label` is the board's
 * centred `[Live performance video]` style caption.
 */
export function MediaTile({ label, style, children, ...rest }) {
  return (
    <View
      style={[{ backgroundColor: gradient.base.mediaTile, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, style]}
      {...rest}
    >
      <Washes layers={gradient.mediaTile} />
      {label ? (
        <Text style={{ fontFamily: face.regular, fontSize: 14, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(253,255,252,0.7)', textAlign: 'center', paddingHorizontal: space.l }}>
          {label}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/**
 * A bottom sheet: scrim over what is behind, 24 on the top corners only,
 * and the 40x5 grab handle. `onDismiss` fires on the scrim, because a
 * sheet you cannot leave by tapping away is a sheet people feel trapped in.
 */
export function Sheet({ onDismiss, dark = false, style, children, label }) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onDismiss}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: surface.scrim }}
      />
      <View
        accessibilityViewIsModal
        accessibilityLabel={label}
        style={[{
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          backgroundColor: dark ? color.ink : color.porcelain,
          paddingHorizontal: space.l,
          paddingTop: space.m,
          paddingBottom: 28,
          gap: space.m,
        }, style]}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: dark ? 'rgba(253,255,252,0.25)' : 'rgba(1,22,39,0.2)' }} />
        {children}
      </View>
    </View>
  );
}
