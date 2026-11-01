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

/**
 * PT Sans Narrow, loaded in app/_layout.js. React Native picks a face by
 * its exact family name rather than by weight, so bold is a different
 * family, not a `fontWeight` — and `fontWeight` is still set alongside it
 * so the system face degrades sensibly if the font ever fails to load.
 */
export const face = { regular: 'PTSansNarrow_400Regular', bold: 'PTSansNarrow_700Bold' };
export const fontFamilyFor = (w) => (Number(w) >= 700 ? face.bold : face.regular);

const weight = (w) => (w === 700 ? '700' : '400');
const typeStyle = (step, color) => ({
  fontFamily: fontFamilyFor(step.weight),
  fontSize: step.size,
  lineHeight: step.lineHeight,
  fontWeight: weight(step.weight),
  color,
});

/** The type scale as styles, in the two colours text is ever written in. */
export const text = {
  screenTitle: typeStyle(t.screenTitle, c.ink),
  sectionHeading: typeStyle(t.sectionHeading, c.ink),
  rowTitle: typeStyle(t.rowTitle, c.ink),
  body: typeStyle(t.body, c.ink),
  supporting: typeStyle(t.supporting, c.mutedOnLight),
  label: { ...typeStyle(t.label, c.mutedOnLight), letterSpacing: t.label.letterSpacing, textTransform: 'uppercase' },
};

/** The same scale on a dark screen. Only the colour changes. */
export const textOnDark = Object.fromEntries(
  Object.entries(text).map(([k, v]) => [k, {
    ...v,
    color: k === 'supporting' || k === 'label' ? c.mutedOnDark : c.porcelain,
  }]),
);
