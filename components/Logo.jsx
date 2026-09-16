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
// Below this the whale stops being an animal and becomes a dark blob
// inside a letter. At 4.56:1 the lowercase 'o' is roughly half the
// mark's height and the whale sits inside its counter, so it renders at
// roughly 0.3 × height:
//
//     height 14px  ->  whale ~4px   a smudge
//     height 24px  ->  whale ~7px   reads as a shape
//     height 32px  ->  whale ~10px  reads clearly
//
// 24 is the floor, not the target. Use more wherever there is room.
// /logo-preview renders every placement at its real size so this is a
// judgement made by looking rather than by arithmetic.
export const MIN_LEGIBLE_HEIGHT = 24;

const SRC = {
  dark: '/logo/loudentify-on-dark.png',   // porcelain mark, for dark surfaces
  light: '/logo/loudentify-on-light.png', // ink mark, for light surfaces
};

export default function Logo({ surface = 'dark', height = 28, style, className }) {
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
