// lib/audio/tracks.js
// ─────────────────────────────────────────────────────────────
// Cueing a backing track: the transport, the identity rule and the
// balance. Step 2a of docs/ONE_JOURNEY.md.
//
// Korey asked for this twice — "the cue, upload track is not working"
// and "ensure that i can cue track on the app". Uploading was fixed on
// 3 November (PR #45). Cueing was not, and they are different things:
// the file arriving is not the file playing.
//
// ── WHY THIS MODULE EXISTS BEFORE EITHER PLATFORM GETS IT ─────
// The web can already cue a track: components/BackingTrackPanel.jsx,
// 700 lines, performed through in the pilot. The phone cannot, and the
// new web journey does not import the panel. Both of those are about to
// be built, so the rules go in one place FIRST — because the last three
// audio features each turned out to have two copies of their numbers by
// the time anyone looked (docs/DECISIONS.md, 6 November, twice).
//
// What belongs here is anything the two platforms could answer
// differently: when a loaded track may play, what a seek does, whether
// the file on disk is still the file the cue sheet was written against.
// What does not belong here is playback itself — an HTMLAudioElement or
// a Web Audio source on one side, a native player on the other.
//
// Cue CONTENT is already shared, in lib/cueSheetValidation.js. This is
// the transport the cues run against.
//
// Imports nothing, names no platform.
// ─────────────────────────────────────────────────────────────

/** The pilot's own default: the track sits under the voice rather than over it. */
export const TRACK_DEFAULTS = Object.freeze({ volume: 0.8 });

/** What the cue editor's nudge buttons move by, in milliseconds. */
export const NUDGE_STEPS_MS = Object.freeze([-1000, -100, 100, 1000]);

/** m:ss, for a transport readout. */
export function formatClock(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

/**
 * m:ss.hh, for a cue time.
 *
 * A cue needs hundredths and a clock does not: a cue sheet is written
 * against a beat. Both formatters lived in a panel each
 * (BackingTrackPanel's formatTime, CueEditorPanel's formatMs) and the
 * two disagreed about padding, so a cue at 1:05.00 read as 1:5.00 in one
 * place.
 */
export function formatCueTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '0:00.00';
  const total = n / 1000;
  const m = Math.floor(total / 60);
  return `${m}:${(total % 60).toFixed(2).padStart(5, '0')}`;
}

// ── The identity rule ───────────────────────────────────────────
/**
 * May this file be played under this cue sheet?
 *
 * The rule, from BackingTrackPanel's own comment: if the stored object
 * and its row have diverged, playing it "would put the wrong audio under
 * the artist's cue sheet". A cue sheet is a list of times, and times
 * only mean anything against one recording. A different mix of the same
 * song — one bar longer at the top — moves every cue in the set.
 *
 * So this refuses rather than warns, and it refuses the UNKNOWN case
 * too: no hash on either side is not evidence that they match.
 */
export function trackIdentityOk({ rowHash, fileHash } = {}) {
  if (!rowHash || !fileHash) return { ok: false, reason: 'unverified' };
  if (rowHash !== fileHash) return { ok: false, reason: 'mismatch' };
  return { ok: true, reason: null };
}

export function describeIdentity(result) {
  if (result?.ok) return null;
  if (result?.reason === 'mismatch') {
    return 'This file is not the one your cue sheet was written against. Your cues would land in the wrong places.';
  }
  return 'We could not check that this is the file your cue sheet was written against, so the cues may not line up.';
}

// ── The transport ───────────────────────────────────────────────
export const TRANSPORT_STATES = Object.freeze(['empty', 'paused', 'playing', 'ended']);

export const newTransport = () => Object.freeze({
  state: 'empty',
  trackId: null,
  durationS: 0,
  positionS: 0,
  volume: TRACK_DEFAULTS.volume,
});

const clampPosition = (s, durationS) => Math.min(Math.max(Number(s) || 0, 0), Math.max(0, durationS));

/**
 * Load a track. It arrives PAUSED, at `positionS`, never playing.
 *
 * That is the pilot's behaviour and its comment says why: an artist who
 * loads a track thirty seconds before a show should not have it start
 * in their ears. It is also the safer default on the phone, where the
 * track will be mixed into the published audio — a track that began on
 * load would go out.
 */
export function loadTrack(transport, { trackId, durationS = 0, positionS = 0 } = {}) {
  const duration = Math.max(0, Number(durationS) || 0);
  return Object.freeze({
    ...transport,
    state: 'paused',
    trackId: trackId ?? null,
    durationS: duration,
    positionS: clampPosition(positionS, duration),
  });
}

/** Unload, keeping the volume the artist set: that is a preference, not a property of the track. */
export function unloadTrack(transport) {
  return Object.freeze({ ...newTransport(), volume: transport?.volume ?? TRACK_DEFAULTS.volume });
}

/**
 * The play/pause toggle, as a decision rather than a boolean flip.
 *
 * An empty transport cannot play, and a track at its end plays from the
 * start rather than refusing — which is what an artist means by pressing
 * play on a finished track.
 */
export function togglePlay(transport) {
  if (!transport || transport.state === 'empty') return transport;
  if (transport.state === 'playing') return Object.freeze({ ...transport, state: 'paused' });
  if (transport.state === 'ended') return Object.freeze({ ...transport, state: 'playing', positionS: 0 });
  return Object.freeze({ ...transport, state: 'playing' });
}

/** Where the playhead goes, clamped to the track. Seeking does not start or stop playback. */
export function seekTo(transport, positionS) {
  if (!transport || transport.state === 'empty') return transport;
  const at = clampPosition(positionS, transport.durationS);
  const state = transport.state === 'ended' && at < transport.durationS ? 'paused' : transport.state;
  return Object.freeze({ ...transport, state, positionS: at });
}

/** The player reporting where it is. Reaching the end is 'ended', not 'paused': they are different to a cue sheet. */
export function reportPosition(transport, positionS) {
  if (!transport || transport.state === 'empty') return transport;
  const at = clampPosition(positionS, transport.durationS);
  if (transport.durationS > 0 && at >= transport.durationS) {
    return Object.freeze({ ...transport, state: 'ended', positionS: transport.durationS });
  }
  return Object.freeze({ ...transport, positionS: at });
}

export function setVolume(transport, volume) {
  const v = Math.min(1, Math.max(0, Number(volume)));
  return Object.freeze({ ...transport, volume: Number.isFinite(v) ? v : TRACK_DEFAULTS.volume });
}

/** May a cue be dropped right now? Either paused or playing — a cue sheet is written both ways. */
export const canDropCue = (transport) => Boolean(transport) && transport.state !== 'empty';

/** The playhead as a cue time, which is what "drop a cue here" means. */
export const playheadMs = (transport) => Math.round((transport?.positionS || 0) * 1000);

/**
 * The gain pair for the voice/track balance.
 *
 * Returned as a pair for the same reason bypassGains is in chain.js: a
 * platform applies BOTH numbers. One slider, two gains, and the voice is
 * never silenced by it — an artist who pushes the balance to the track
 * end is asking for more track, not for their voice to disappear.
 */
export function balanceGains(volume = TRACK_DEFAULTS.volume) {
  const v = Math.min(1, Math.max(0, Number(volume)));
  const track = Number.isFinite(v) ? v : TRACK_DEFAULTS.volume;
  return { trackGain: track, voiceGain: 1 };
}

/** One line for the transport, so both platforms label it the same. */
export function describeTransport(transport) {
  if (!transport || transport.state === 'empty') return 'No track loaded.';
  const at = `${formatClock(transport.positionS)} / ${formatClock(transport.durationS)}`;
  if (transport.state === 'playing') return `Playing — ${at}`;
  if (transport.state === 'ended') return `Finished — ${formatClock(transport.durationS)}`;
  return `Ready — ${at}`;
}
