// components/landing/Mosaic.jsx — the moving mosaic beside the hero. Five
// columns are rendered; the stylesheet shows two, three, four or five of
// them by width. Each column's tiles appear twice so the loop is seamless.
// Decorative: aria-hidden, every picture has an empty alt.
import { planColumns } from './tiles';
import { DeviceTile, BrandTile, ReactionSymbols } from './Tiles';
import MosaicPause from './MosaicPause';

const COLUMNS = planColumns();

// The first tile of each of the two columns every screen shows loads
// eagerly, at high priority: they are the largest things on the first
// paint. Everything else, and every loop copy, is lazy; a lazy picture
// that is already in view still loads as soon as the page is laid out.
function eagerFor(columnIndex, tileIndex, copy) { return copy === 0 && columnIndex < 2 && tileIndex === 0; }

export default function Mosaic() {
  return (
    <div className="lm-mosaic" aria-hidden="true" data-testid="mosaic" data-lm-mosaic>
      <ReactionSymbols />
      <div className="lm-cols">
        {COLUMNS.map((col) => (
          <div key={col.index} className={`lm-col lm-col-${col.direction}`} data-direction={col.direction}>
            <div className="lm-track" style={{ '--phase': col.phase }}>
              {[0, 1].map((copy) => col.tiles.map((t, i) => (
                t.kind === 'image'
                  ? <DeviceTile key={`${copy}-${i}`} image={t.image} cut={t.cut} eager={eagerFor(col.index, i, copy)} priority={eagerFor(col.index, i, copy)} />
                  : <BrandTile key={`${copy}-${i}`} tone={t.tone} motif={t.motif} cut={t.cut} />
              )))}
            </div>
          </div>
        ))}
      </div>
      <span className="lm-illus">Illustrative images</span>
      <MosaicPause />
    </div>
  );
}
