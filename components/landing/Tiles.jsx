// components/landing/Tiles.jsx — one mosaic tile: a device frame showing a
// performer picture under a live-view overlay, or a brand tile between
// them. Server-rendered; nothing here has state. The overlay is HTML, never
// baked into the picture, and sits at the top and bottom edges only.
import { IMAGE_DIR } from './tiles';

// The reaction glyphs and the motif gradients are defined once here
// (rendered by the mosaic) and referenced from every tile, which keeps the
// page small. Each gradient runs light to deep so a stroke reads as a
// glossy rounded bar lit from above; `lm-g-gloss` is the sheen laid over it.
export function ReactionSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="lm-g-teal" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#c4f5ef" /><stop offset=".42" stopColor="#2ec4b6" /><stop offset="1" stopColor="#157f76" /></linearGradient>
        <linearGradient id="lm-g-red" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#ffb3bc" /><stop offset=".42" stopColor="#e71d36" /><stop offset="1" stopColor="#8f1021" /></linearGradient>
        <linearGradient id="lm-g-orange" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#ffe3b3" /><stop offset=".42" stopColor="#ff9f1c" /><stop offset="1" stopColor="#a35f00" /></linearGradient>
        <linearGradient id="lm-g-warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd089" /><stop offset=".5" stopColor="#ff9f1c" /><stop offset="1" stopColor="#e71d36" /></linearGradient>
        <linearGradient id="lm-g-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <symbol id="lm-heart" viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.5 3.3 5 6.8 5c2 0 3.4 1 4.2 2.3C11.8 6 13.2 5 15.2 5c3.5 0 5.6 3.5 4.3 6.7C17.5 16.4 12 21 12 21z" /></symbol>
      <symbol id="lm-fire" viewBox="0 0 24 24"><path fill="currentColor" d="M13 2c.5 3.5-2 5-2 8 0 1.5 1 2.5 2 2.5s2-1 2-2.5c2 1.5 3 3.5 3 5.5a6 6 0 0 1-12 0c0-3 2-5 3-6.5 0 1 .5 2 1.5 2C11.5 8 9.5 5 13 2z" /></symbol>
      <symbol id="lm-clap" viewBox="0 0 24 24"><path fill="currentColor" d="M7 11V5.5a1.5 1.5 0 0 1 3 0V11h1V4.5a1.5 1.5 0 0 1 3 0V11h1V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-14 0v-3a1.5 1.5 0 0 1 3 0z" /></symbol>
    </svg>
  );
}
const Use = ({ id }) => <svg aria-hidden="true"><use href={`#${id}`} /></svg>;

export function DeviceTile({ image, cut, eager, priority }) {
  const src = `${IMAGE_DIR}${image.file}`;
  return (
    <div className={`lm-tile lm-tile-${image.frame}`} style={{ '--cut': cut }} data-file={image.file}>
      <div className="lm-shot">
        <img
          src={src}
          width={image.w}
          height={image.h}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          style={{ objectPosition: image.focus }}
        />
        <span className="lm-live"><i /> LIVE</span>
        {image.label ? <span className="lm-genre">{image.label}</span> : null}
        <span className="lm-reacts"><span className="lm-r-heart"><Use id="lm-heart" /></span><span className="lm-r-fire"><Use id="lm-fire" /></span><span className="lm-r-clap"><Use id="lm-clap" /></span></span>
      </div>
      <i className="lm-ring" />
    </div>
  );
}

// The signal arc is the mark's own motif, drawn here as three glossy
// strokes in the brand accents (never the logo file, never redrawn from
// it). Each arc is a gradient stroke with a sheen stroke laid over its
// upper edge; the glow comes from the stylesheet.
const ARCS = [
  { d: 'M12 64a60 60 0 0 1 60-60', w: 11 },
  { d: 'M30 64a42 42 0 0 1 42-42', w: 11 },
  { d: 'M48 64a24 24 0 0 1 24-24', w: 11 },
];
const ARC_TONES = { brand: ['teal', 'red', 'orange'], teal: ['teal', 'teal', 'teal'] };
function Arc({ tone }) {
  const fills = ARC_TONES[tone] || ARC_TONES.brand;
  return (
    <svg className="lm-motif lm-motif-arc" viewBox="0 0 86 72" fill="none" strokeLinecap="round" aria-hidden="true">
      {ARCS.map((a, i) => (
        <g key={i}>
          <path d={a.d} stroke={`url(#lm-g-${fills[i]})`} strokeWidth={a.w} />
          <path d={a.d} stroke="url(#lm-g-gloss)" strokeWidth={a.w * .55} transform="translate(-1.2 -2.2)" />
        </g>
      ))}
    </svg>
  );
}

// Seven glossy bars, like a level meter mid-song.
const WAVE = [26, 44, 64, 38, 56, 30, 48];
function Wave({ tone }) {
  const fill = tone === 'warm' ? 'lm-g-warm' : 'lm-g-teal';
  return (
    <svg className="lm-motif lm-motif-wave" viewBox="0 0 100 70" aria-hidden="true">
      {WAVE.map((h, i) => {
        const x = 4 + i * 14; const y = 35 - h / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width="9" height={h} rx="4.5" fill={`url(#${fill})`} />
            <rect x={x + 1.6} y={y + 1.5} width="3" height={h - 3} rx="1.5" fill="url(#lm-g-gloss)" />
          </g>
        );
      })}
    </svg>
  );
}

// No box, no ring: the motif floats on the silk between the frames.
export function BrandTile({ tone, motif }) {
  return (
    <div className={`lm-tile lm-tile-brand lm-brand-${motif}`}>
      {motif === 'arc' ? <Arc tone={tone} /> : <Wave tone={tone} />}
    </div>
  );
}
