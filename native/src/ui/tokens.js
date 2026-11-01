// native/src/ui/tokens.js — the design tokens, as React Native values.
//
// Everything here is derived from lib/design/tokens.js, which is itself
// derived from design/DesignSystem.dc.html. Nothing is retyped: a hex that
// appears here and nowhere else is a hex that will drift away from the
// boards the first time one of them changes.
//
// The one translation this file performs is units. The web expresses a
// gradient as a CSS string and a type step as a CSS rule; a React Native
// view needs stops in arrays and a StyleSheet object. Those conversions
// live here and only here.
export {
  color, font, silk, radius, size, breakpoint, playerFrame,
  type, space, button, icon, gradient, surface, z, LOADING_GIVE_UP_MS,
} from '@loud/lib/design/tokens.js';

import { type as t, color as c } from '@loud/lib/design/tokens.js';

const weight = (w) => (w === 700 ? '700' : '400');

/** The type scale as styles, in the two colours text is ever written in. */
export const text = {
  screenTitle: { fontSize: t.screenTitle.size, lineHeight: t.screenTitle.lineHeight, fontWeight: weight(t.screenTitle.weight), color: c.ink },
  sectionHeading: { fontSize: t.sectionHeading.size, lineHeight: t.sectionHeading.lineHeight, fontWeight: weight(t.sectionHeading.weight), color: c.ink },
  rowTitle: { fontSize: t.rowTitle.size, lineHeight: t.rowTitle.lineHeight, fontWeight: weight(t.rowTitle.weight), color: c.ink },
  body: { fontSize: t.body.size, lineHeight: t.body.lineHeight, fontWeight: weight(t.body.weight), color: c.ink },
  supporting: { fontSize: t.supporting.size, lineHeight: t.supporting.lineHeight, fontWeight: weight(t.supporting.weight), color: c.mutedOnLight },
  label: { fontSize: t.label.size, lineHeight: t.label.lineHeight, fontWeight: '700', letterSpacing: t.label.letterSpacing, textTransform: 'uppercase', color: c.mutedOnLight },
};

/** The same scale on a dark screen. Only the colour changes. */
export const textOnDark = Object.fromEntries(
  Object.entries(text).map(([k, v]) => [k, {
    ...v,
    color: k === 'supporting' || k === 'label' ? c.mutedOnDark : c.porcelain,
  }]),
);
