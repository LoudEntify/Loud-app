// lib/design/tokens.js
// ─────────────────────────────────────────────────────────────
// The design tokens, as data. One source for the web app (app/viewer.css
// and inline styles), the website and the native apps (Phase 4 imports
// this file; nothing here depends on the DOM).
//
// Values come from design/DesignSystem.dc.html and docs/CLAUDE.md §6:
// Ink Black #011627, Porcelain #fdfffc, Teal #2ec4b6, Red #e71d36,
// Orange #ff9f1c, PT Sans Narrow, silk gradients, 44px touch targets,
// 4.5:1 text contrast (teal or orange text only on ink).
// ─────────────────────────────────────────────────────────────

export const color = {
  ink: '#011627',
  porcelain: '#fdfffc',
  teal: '#2ec4b6',
  red: '#e71d36',
  orange: '#ff9f1c',
  // derived surfaces used throughout the boards
  inkDeep: '#0a1f2e',
  inkPanel: '#0a2234',
  inkCard: '#0a2a40',
  inkSoft: '#1d4a66',
  mist: '#f6f9f6',       // light-surface base ("porcelain silk")
  mutedOnLight: 'rgba(1, 22, 39, 0.72)',
  mutedOnDark: '#c9cfd1',
  white: '#ffffff',
};

export const font = {
  family: "'PT Sans Narrow', 'Arial Narrow', sans-serif",
  weightRegular: 400,
  weightBold: 700,
};

// The silk backgrounds. Dark silk sits under every show screen; light silk
// under lists and sheets. Kept as strings so CSS, inline styles and native
// gradient definitions can all be derived from the same stops.
export const silk = {
  dark:
    'radial-gradient(80% 45% at 88% 8%, rgba(46, 196, 182, 0.38), rgba(46, 196, 182, 0) 65%), ' +
    'radial-gradient(75% 45% at 8% 52%, rgba(231, 29, 54, 0.26), rgba(231, 29, 54, 0) 65%), ' +
    'radial-gradient(95% 55% at 55% 100%, rgba(255, 159, 28, 0.24), rgba(255, 159, 28, 0) 62%), ' +
    'linear-gradient(125deg, rgba(253, 255, 252, 0) 30%, rgba(253, 255, 252, 0.07) 46%, rgba(253, 255, 252, 0) 58%), #011627',
  light:
    'radial-gradient(110% 55% at 100% 0%, rgba(46, 196, 182, 0.26), rgba(46, 196, 182, 0) 62%), ' +
    'radial-gradient(90% 45% at 0% 40%, rgba(255, 159, 28, 0.16), rgba(255, 159, 28, 0) 60%), ' +
    'radial-gradient(100% 50% at 70% 100%, rgba(46, 196, 182, 0.16), rgba(46, 196, 182, 0) 60%), ' +
    'linear-gradient(118deg, rgba(255, 255, 255, 0) 28%, rgba(255, 255, 255, 0.7) 44%, rgba(255, 255, 255, 0) 60%), #f6f9f6',
  teal: 'linear-gradient(135deg, #2ec4b6 0%, #8fe6dd 48%, #2ec4b6 100%)',
  inkButton: 'linear-gradient(135deg, #011627 0%, #123f57 55%, #011627 100%)',
  // the poster behind a player before it loads
  poster:
    'radial-gradient(90% 60% at 70% 20%, rgba(46, 196, 182, 0.22), rgba(46, 196, 182, 0) 70%), ' +
    'radial-gradient(80% 50% at 20% 85%, rgba(231, 29, 54, 0.2), rgba(231, 29, 54, 0) 70%), #0a1f2e',
  card:
    'radial-gradient(90% 60% at 80% 10%, rgba(46, 196, 182, 0.45), rgba(46, 196, 182, 0) 65%), ' +
    'radial-gradient(90% 60% at 10% 90%, rgba(231, 29, 54, 0.32), rgba(231, 29, 54, 0) 65%), #0a2a40',
};

export const radius = { pill: 999, sheet: 24, card: 16, cardLg: 20, field: 12 };

export const size = {
  touch: 44,          // minimum tap target
  composer: 48,
  tabBar: 88,
  readingWidth: 700,  // settings and legal text never run edge to edge
};

// ResponsiveRules.dc.html: one app, four widths.
export const breakpoint = {
  fold: 600,      // 600–839: Fold open, small tablet (two columns)
  tablet: 840,    // 840–1279: rail + content + side panel
  computer: 1280, // 1280+: full sidebar with labels
};

// The player frame sizes from docs/YOUTUBE_ADDENDUM.md "Viewer screen rules".
// Width x height, portrait 9:16. The YouTube minimum is 200 x 200.
export const playerFrame = {
  min: { w: 200, h: 200 },
  phone: { w: 304, h: 540 },
  bigger: { w: 340, h: 604 },
  vote: { w: 270, h: 480 },
  guest: { w: 200, h: 356 },
  foldTablet: { w: 360, h: 640 },
  computer: { w: 405, h: 720 },
};

export const z = { offlineBar: 60, sheet: 50, banner: 70 };
