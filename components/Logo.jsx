// components/Logo.jsx
// ─────────────────────────────────────────────────────────────
// THE mark. One definition, eight call sites.
//
// PRD: — · S&I: —  (presentation only, no behaviour)
//
// ── WHY A COMPONENT AND NOT EIGHT <img> TAGS ──────────────────
// Eight inline images drift. One ends up with the wrong file on the
// wrong background, one loses its alt text, one gets a width as well as
// a height and stretches. All three are invisible in review and obvious
// to a user. Here the contrast rule is a prop, `alt` cannot be omitted
// because callers never pass it, and width is never set at all.
//
// ── NAMED BY THE SURFACE, NOT BY THE INK ──────────────────────
// `surface="dark"` means "this sits ON a dark background", so it loads
// the PORCELAIN file. Naming the files by their own colour would make
// every call site a small puzzle, and getting it backwards produces a
// navy mark on navy — invisible, and invisible in exactly the way a
// screenshot in review would not catch.
//
// ── NEVER STRETCHED ───────────────────────────────────────────
// Height is set; width is `auto`. There is no prop for width, so the
// aspect ratio cannot be overridden by a caller in a hurry.
// ─────────────────────────────────────────────────────────────

// The artwork is 4.56:1 — much wider than a plain wordmark, because the
// whale sits inside the O and the mark carries its own padding.
export const LOGO_ASPECT = 4.56;

// ── THE LEGIBILITY FLOOR ──────────────────────────────────────
// The floor was 24 until the signal arc was restored. With the arc in
// place the ARC is the finest detail, not the whale, and it fails first:
//
//     height 24px  ->  arc ~7px wide, ~2px per band. A coloured smudge,
//                      and the whale is a blob.
//     height 28px  ->  barely better.
//     height 32px  ->  the whale reads; the arc reads as colour.
//     height 36px  ->  the arc resolves into three distinct bands.
//
// Raised to 32 after looking at all four rendered at real size with
// nearest-neighbour magnification. 32 is the FLOOR; 36 is the target
// wherever there is room, which on every full-screen card there is.
export const MIN_LEGIBLE_HEIGHT = 32;

const SRC = {
  dark: '/logo/loudentify-on-dark.png',   // porcelain mark, for dark surfaces
  light: '/logo/loudentify-on-light.png', // ink mark, for light surfaces
};

export default function Logo({ surface = 'dark', height = MIN_LEGIBLE_HEIGHT, style, className }) {
  // Clamped, so no caller can go below the floor by accident. It is a
  // backstop, not a licence: a call site asking for less than the floor
  // is a call site whose number no longer describes what renders, so
  // they are set explicitly instead of relying on this.
  const h = Math.max(MIN_LEGIBLE_HEIGHT, height);
  return (
    // Plain <img>, not next/image: the optimiser adds nothing for a
    // small transparent PNG served from public/, and it wants explicit
    // width — which is how aspect ratios get broken.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[surface] === undefined ? SRC.dark : SRC[surface]}
      alt="Loudentify"
      height={h}
      className={className}
      style={{
        height: h,
        width: 'auto',       // never stretched
        display: 'block',
        // The source is 256px tall, so every placement is rendering a
        // downscale — crisp on 2x and 3x screens without a srcset.
        ...style,
      }}
    />
  );
}
