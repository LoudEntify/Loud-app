// The input meter, read from the vocal chain.
//
// Korey, 5 Nov: "There is no audio signal indicator." This is the phone
// half of it. LoudVocalChain measures the input level on every 10ms
// frame of microphone audio — after the input trim, before the chain,
// which is "what the microphone is hearing" — and holds the peak until
// it is read. So polling ten times a second loses nothing: each read
// reports the loudest frame since the last one rather than whichever
// frame it happened to land on.
//
// What a level MEANS is not decided here. lib/audio/meter.js decides
// that, and the browser's meter reads the same module, so a voice that
// reads "good" on a laptop reads "good" on a phone.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { describeLevel, describeReduction, METER_POLL_MS } from '@loud/lib/audio/meter.js';
import { vocalChainState } from '../modules/loud-camera';

export const SILENT = Object.freeze({
  installed: false,
  level: describeLevel({ peak: 0, rms: 0 }),
  reduction: describeReduction(0),
});

/**
 * Poll the chain's meter while `enabled` and the app is in front.
 *
 * Stops when the app goes to the background, because nothing is being
 * captured there and a timer that keeps firing is a battery cost during
 * a show for a bar nobody can see.
 */
export function useAudioMeter(enabled = true) {
  const [meter, setMeter] = useState(SILENT);
  // A read in flight must not overlap the next tick: the native call
  // clears the peak, so two in flight would race for the same frames.
  const reading = useRef(false);

  useEffect(() => {
    if (!enabled) { setMeter(SILENT); return undefined; }
    let alive = true;
    let timer = null;

    const tick = async () => {
      if (!alive || reading.current) return;
      reading.current = true;
      try {
        const s = await vocalChainState();
        if (!alive) return;
        setMeter({
          installed: Boolean(s?.installed),
          configured: Boolean(s?.configured),
          level: describeLevel({ peak: s?.peak ?? 0, rms: s?.rms ?? 0 }),
          reduction: describeReduction(s?.reductionDb ?? 0),
        });
      } catch {
        // A meter that cannot be read is a meter that shows nothing. It
        // is never a reason to interrupt what the artist is doing.
        if (alive) setMeter(SILENT);
      } finally {
        reading.current = false;
      }
    };

    const start = () => { if (!timer) { timer = setInterval(tick, METER_POLL_MS); tick(); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    start();
    const away = AppState.addEventListener('change', (state) => {
      if (state === 'active') start(); else { stop(); setMeter(SILENT); }
    });

    return () => { alive = false; stop(); away.remove(); };
  }, [enabled]);

  return meter;
}
