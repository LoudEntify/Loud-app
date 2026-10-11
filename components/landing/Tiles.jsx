// components/landing/Tiles.jsx — one mosaic tile: a device frame showing a
// performer picture under a live-view overlay, or a brand tile between
// them. Server-rendered; nothing here has state. The overlay is HTML, never
// baked into the picture, and sits at the top and bottom edges only.
import { IMAGE_DIR } from './tiles';

// The reaction glyphs are defined once (ReactionSymbols, rendered by the
// mosaic) and referenced from every tile, which keeps the page small.
export function ReactionSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
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

// The signal arc is the mark's own motif, drawn here as three plain
// strokes in the brand accents (never the logo file, never redrawn from it).
function Arc({ tone }) {
  const stroke = tone === 'ink' || tone === 'card' ? ['#2ec4b6', '#e71d36', '#ff9f1c'] : ['currentColor', 'currentColor', 'currentColor'];
  return (
    <svg className="lm-motif" viewBox="0 0 100 70" fill="none" strokeWidth="9" strokeLinecap="round" aria-hidden="true">
      <path d="M12 64a60 60 0 0 1 60-60" stroke={stroke[0]} />
      <path d="M30 64a42 42 0 0 1 42-42" stroke={stroke[1]} opacity={tone === 'ink' || tone === 'card' ? 1 : .72} />
      <path d="M48 64a24 24 0 0 1 24-24" stroke={stroke[2]} opacity={tone === 'ink' || tone === 'card' ? 1 : .5} />
    </svg>
  );
}

const WAVE = ['34%', '62%', '100%', '48%', '80%', '40%', '66%'];
function Wave() {
  return <span className="lm-motif-wave" aria-hidden="true">{WAVE.map((h, i) => <i key={i} style={{ '--h': h }} />)}</span>;
}

export function BrandTile({ tone, motif, cut }) {
  return (
    <div className={`lm-tile lm-tile-brand lm-tone-${tone}`} style={{ '--cut': cut }}>
      {motif === 'arc' ? <Arc tone={tone} /> : motif === 'wave' ? <Wave /> : null}
      <i className="lm-ring" />
    </div>
  );
}
