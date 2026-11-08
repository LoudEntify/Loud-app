// lib/audio/meter.js
// ─────────────────────────────────────────────────────────────
// What a level MEANS. Shared, because a meter that reads "good" on a
// laptop and "too quiet" on a phone for the same voice is worse than no
// meter: the artist would trust whichever one they saw last.
//
// Korey, 5 Nov: "There is no audio signal indicator." The number now
// exists on both platforms — the browser reads it off an AnalyserNode,
// the phone off LoudVocalChain's per-frame peak — and this module turns
// either of them into the same verdict.
//
// ── WHY dB AND NOT THE RAW NUMBER ─────────────────────────────
// Both platforms hand over an amplitude on the 0..1 sample scale, where
// half the scale is a sixth of the way up a meter, because loudness is
// logarithmic. Drawing the raw number would put a healthy singing voice
// at a tenth of the bar and make everyone turn themselves up until they
// clipped.
//
// ── WHAT THE BANDS ARE FOR ────────────────────────────────────
// A meter an artist looks at thirty seconds before a show has to answer
// one question: is this right? So each band carries the line to show and
// the action that fixes it, and "good" carries no action, because the
// answer is yes.
//
// Imports nothing, names no platform. Same rule as chain.js and dsp.js.
// ─────────────────────────────────────────────────────────────

/** The bottom of the meter. Below this a phone microphone is hearing room noise, not a person. */
export const FLOOR_DB = -60;
export const CEILING_DB = 0;

/** Amplitude (0..1 on the sample scale) to dBFS. Silence is -Infinity, which every caller clamps. */
export function levelDb(amplitude) {
  const a = Math.abs(Number(amplitude));
  if (!Number.isFinite(a) || a <= 0) return -Infinity;
  return 20 * Math.log10(Math.min(1, a));
}

/** Where on a 0..1 bar a dB value sits, floor to ceiling. */
export function meterFraction(db) {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.min(CEILING_DB, Math.max(FLOOR_DB, db));
  return (clamped - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
}

/**
 * The bands, loudest first so the first match wins.
 *
 * The numbers are where a voice sits rather than where a standard says
 * it should: -12 dBFS peak is a comfortable singing level with headroom
 * for the loudest word in a song, which is the one that clips. Below
 * -40 a phone at arm's length is not hearing the person at all.
 */
export const LEVEL_BANDS = Object.freeze([
  { key: 'clipping', from: -1, line: 'Too loud — this will distort.', action: 'Move back, or lower Input' },
  { key: 'hot', from: -6, line: 'Very hot. The loudest word may distort.', action: 'Lower Input a little' },
  { key: 'good', from: -24, line: 'Good level.', action: null },
  { key: 'quiet', from: -40, line: 'Quiet. You will be hard to hear.', action: 'Move closer, or raise Input' },
  { key: 'silent', from: -Infinity, line: 'No signal from the microphone.', action: 'Say a few words' },
]);

/**
 * The verdict for a meter reading.
 *
 * Judged on PEAK, not average: an artist clips on their loudest
 * syllable, and an average that looks healthy hides it. `rms` is
 * returned for the bar to follow, because a bar that jumps to every
 * peak is unreadable.
 */
export function describeLevel({ peak = 0, rms = 0 } = {}) {
  const peakDb = levelDb(peak);
  const rmsDb = levelDb(rms);
  const band = LEVEL_BANDS.find((b) => peakDb >= b.from) || LEVEL_BANDS[LEVEL_BANDS.length - 1];
  return {
    band: band.key,
    line: band.line,
    action: band.action,
    ok: band.key === 'good',
    peakDb,
    rmsDb,
    // What to draw: the bar follows the average, the notch marks the peak.
    fraction: meterFraction(rmsDb),
    peakFraction: meterFraction(peakDb),
  };
}

/** The most gain reduction worth drawing. Past this the compressor is doing something nobody asked it to. */
export const REDUCTION_CEILING_DB = 12;

/**
 * How much of the compressor's own bar to fill, and whether to say
 * anything about it.
 *
 * Gain reduction is the only honest way to show that compression is
 * working: a threshold and a ratio tell an artist nothing about their
 * own voice, and "working" here means a few dB on the loud words and
 * nothing in between.
 */
export function describeReduction(reductionDb) {
  const db = Math.max(0, Number(reductionDb) || 0);
  return {
    db,
    fraction: Math.min(1, db / REDUCTION_CEILING_DB),
    working: db >= 0.5,
    line: db < 0.5 ? 'Not compressing yet.'
      : db <= REDUCTION_CEILING_DB ? `Holding back ${db.toFixed(1)} dB.`
      : `Holding back ${db.toFixed(1)} dB — more than a voice usually needs.`,
  };
}

/**
 * How often to read the meter.
 *
 * The native loop runs at 100 frames a second and holds its peak until
 * read, so a slower poll loses nothing: it reports the loudest frame
 * since last time rather than whichever one it landed on. Ten times a
 * second looks continuous to a person and costs one bridge call.
 */
export const METER_POLL_MS = 100;

/**
 * Which microphone to believe.
 *
 * There are two capture paths on a phone and exactly one may hold the
 * microphone at a time (native/.../MicOwner.kt has the whole reason).
 * The broadcast path measures the audio that actually leaves, so it wins
 * whenever it is capturing; the standalone capture is for the screens
 * where nothing is broadcasting, which is where an artist checks a
 * microphone in the first place.
 *
 * The distinction that matters is `capturing`, not `installed`: the
 * post-processor stays attached for the life of the process once a show
 * has run, so an installed chain with no frames arriving is a meter that
 * reads silence forever. That was the bug.
 *
 * @param chain  whatever vocalChainState() returned, or nothing.
 * @returns 'broadcast' | 'microphone'
 */
export function meterSource(chain) {
  return chain && chain.installed && chain.capturing ? 'broadcast' : 'microphone';
}

/**
 * What to say when no level can be read at all.
 *
 * A meter that cannot read has to end in an action, never in a statement
 * about the build (docs/ONE_JOURNEY.md §6). `reason` is the native
 * side's own words where it has any, because "your show is using the
 * microphone" and "check the app's microphone permission" are different
 * problems with different next steps.
 */
export function describeNoInput(reason) {
  const said = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  // `action` is null when the reason already names the next step, which
  // the native side's own wording usually does ("check the app's
  // microphone permission"). A line and an action that say the same
  // thing twice reads like a screen that is not sure.
  return {
    line: said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : 'No microphone reading yet.',
    action: said && /\bshow\b/i.test(said) ? 'Check it from the console instead' : null,
  };
}

/**
 * The Kit Check mic row, from a level and how long we have listened.
 *
 * ── WHY THIS IS HERE AND NOT ON EACH SCREEN ───────────────────
 * Three places decide whether a microphone passes a kit check: the
 * browser's Kit Check, the phone's, and whatever runs next. The browser
 * had this logic inline and the phone had a Confirm button, so the phone
 * asked the artist to vouch for their own microphone — which is the
 * circles Korey reported on 5 November, and docs/CLAUDE.md §5 asks for a
 * watch on the raw input, not a signature.
 *
 * ── THE PATIENCE ──────────────────────────────────────────────
 * Silence is not a failure for the first moment: a screen that has just
 * opened has not heard anything yet because nobody has sung yet. So a
 * quiet reading stays 'checking' until `samples` polls have passed, and
 * only then becomes something to fix. Loud is different — clipping is
 * worth saying the instant it happens, because the artist is making the
 * sound that clips right now and can hear what they changed.
 *
 * @param level    describeLevel()'s verdict.
 * @param samples  how many polls have been taken on this screen.
 * @param blocked  describeNoInput()'s verdict, when nothing could be read.
 * @param patience polls of quiet to tolerate before calling it a fix.
 */
export function micCheck({ level, samples = 0, blocked = null, patience = 8 } = {}) {
  if (blocked) return { status: 'fix', detail: blocked.action ? `${blocked.line} ${blocked.action}.` : blocked.line };
  if (!level) return { status: 'checking', detail: 'Listening for your voice' };
  if (level.ok) return { status: 'ready', detail: level.line };
  const loud = level.band === 'hot' || level.band === 'clipping';
  if (loud || samples > patience) return { status: 'fix', detail: `${level.line} ${level.action}.` };
  return { status: 'checking', detail: 'Say a few words' };
}
