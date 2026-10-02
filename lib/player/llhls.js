// lib/player/llhls.js
// ─────────────────────────────────────────────────────────────
// The loudentify-llhls PlayerSource: Loudentify's own low-latency HLS
// delivery from our origin and CDN. "Added when funded" (docs/CLAUDE.md
// §5). This is the seat at the table, not the implementation: it honours
// the contract, reports 'offline' with an honest message, and exposes a
// position of null, so a show mis-configured to this delivery degrades
// instead of crashing. When it is built it plays `show.llhls_url` with a
// native <video> on Safari and hls.js elsewhere, and positionMs() returns
// video.currentTime * 1000.
// ─────────────────────────────────────────────────────────────
import { makeStateReporter } from './PlayerSource.js';

export function createLlhlsSource() {
  let report = () => {};
  return {
    kind: 'loudentify-llhls',
    mount(el, opts = {}) {
      report = makeStateReporter(opts);
      report('offline');
      opts.onError?.("Loudentify's own delivery is not switched on yet. This show should be on YouTube delivery.");
      return this;
    },
    play() {},
    pause() {},
    positionMs() { return null; },
    setVersusView() {},
    destroy() {},
  };
}
