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
import {
  describeLevel, describeReduction, describeNoInput, meterSource, METER_POLL_MS,
} from '@loud/lib/audio/meter.js';
import {
  vocalChainState, startInputMeter, stopInputMeter, inputMeterState,
} from '../modules/loud-camera';

export const SILENT = Object.freeze({
  installed: false,
  source: 'none',
  level: describeLevel({ peak: 0, rms: 0 }),
  reduction: describeReduction(0),
  blocked: null,
});

/**
 * Poll whichever microphone is readable, while `enabled` and the app is
 * in front.
 *
 * ── TWO PATHS, ONE MICROPHONE ─────────────────────────────────
 * This used to read the vocal chain and only the vocal chain, which made
 * it a meter that worked during a broadcast and nowhere else — and the
 * screens that show it, Settings → Audio and Kit Check, are both
 * outside a broadcast. An artist sang into a bar that never moved.
 *
 * So: the chain while it is capturing (that is the audio that actually
 * leaves), and a standalone capture otherwise, started here and stopped
 * when this screen goes away or a show takes the microphone. The choice
 * is meterSource() in lib/audio/meter.js rather than a condition here,
 * because it is a rule and it is tested.
 *
 * Stops when the app goes to the background, because nothing is being
 * captured there and a timer that keeps firing is a battery cost during
 * a show for a bar nobody can see. The standalone capture is released
 * then too: holding a phone's microphone open behind a backgrounded app
 * is not something to do quietly.
 */
export function useAudioMeter(enabled = true) {
  const [meter, setMeter] = useState(SILENT);
  // A read in flight must not overlap the next tick: the native call
  // clears the peak, so two in flight would race for the same frames.
  const reading = useRef(false);
  // Whether THIS hook opened the standalone capture, so it only ever
  // closes its own.
  const opened = useRef(false);

  useEffect(() => {
    if (!enabled) { setMeter(SILENT); return undefined; }
    let alive = true;
    let timer = null;

    const release = async () => {
      if (!opened.current) return;
      opened.current = false;
      await stopInputMeter().catch(() => {});
    };

    const tick = async () => {
      if (!alive || reading.current) return;
      reading.current = true;
      try {
        const chain = await vocalChainState();
        if (!alive) return;
        if (meterSource(chain) === 'broadcast') {
          // A show has the microphone. Anything this hook opened is
          // already stopping itself natively; tell it so in order, so a
          // later tick does not find two sources half-open.
          await release();
          if (!alive) return;
          setMeter({
            installed: true,
            source: 'broadcast',
            configured: Boolean(chain?.configured),
            level: describeLevel({ peak: chain?.peak ?? 0, rms: chain?.rms ?? 0 }),
            reduction: describeReduction(chain?.reductionDb ?? 0),
            blocked: null,
          });
          return;
        }

        if (!opened.current) {
          const r = await startInputMeter();
          if (!alive) return;
          if (r?.ok) opened.current = true;
          else {
            setMeter({ ...SILENT, source: 'microphone', blocked: describeNoInput(r?.reason) });
            return;
          }
        }

        const s = await inputMeterState();
        if (!alive) return;
        if (!s?.running) {
          // It stopped on its own — a show took the microphone, or the
          // hardware went away. Let the next tick decide afresh rather
          // than assuming which.
          opened.current = false;
          setMeter({ ...SILENT, source: 'microphone', blocked: describeNoInput(s?.stoppedBecause) });
          return;
        }
        setMeter({
          installed: Boolean(chain?.installed),
          source: 'microphone',
          configured: Boolean(chain?.configured),
          level: describeLevel({ peak: s?.peak ?? 0, rms: s?.rms ?? 0 }),
          // Nothing is compressing outside the broadcast path, and a
          // reduction bar fed zeros would read as "not compressing yet"
          // as though it had looked.
          reduction: describeReduction(0),
          blocked: null,
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
      if (state === 'active') start(); else { stop(); release(); setMeter(SILENT); }
    });

    return () => { alive = false; stop(); release(); away.remove(); };
  }, [enabled]);

  return meter;
}
