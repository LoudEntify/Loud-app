'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { loadBackingTrack } from '../lib/audioProcessing';
import { shotFamilyColor } from '../lib/shotTypes';
import { computeTrackHash } from '../lib/trackHash';
import { getAudioHost, setBackingPlayer, getBackingPlayer, subscribeAudioHost } from '../lib/audioHost';
import { needsRepick, currentPositionMs } from '../lib/showSessionState';
import { logHealthEvent } from '../lib/healthLog';
import { findUploadedTrackByHash, fetchUploadedTrackBlob } from '../lib/uploadedTracks';
import BackingTrackLibrary from './BackingTrackLibrary';
import SetListPanel from './SetListPanel';

const WAVEFORM_POINTS = 180;
const WAVEFORM_HEIGHT = 40;

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// Downsamples the decoded audio buffer into a fixed number of peak values
// -- the raw sample data is already in memory (needed for playback
// anyway), so this is just reading it, not an extra file read or network
// request. Averages channels if stereo.
function computePeaks(audioBuffer, numPoints = WAVEFORM_POINTS) {
  const channelData = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(channelData.length / numPoints);
  const peaks = new Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    let max = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      const abs = Math.abs(channelData[start + j] || 0);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }
  return peaks;
}

function Waveform({ peaks, color }) {
  const barWidth = 100 / peaks.length;
  return (
    <svg viewBox={`0 0 100 ${WAVEFORM_HEIGHT}`} preserveAspectRatio="none" style={{ width: '100%', height: WAVEFORM_HEIGHT, display: 'block' }}>
      {peaks.map((p, i) => {
        const h = Math.max(1, p * WAVEFORM_HEIGHT);
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={(WAVEFORM_HEIGHT - h) / 2}
            width={barWidth * 0.7}
            height={h}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

// Backing track player -- loads a file from the artist's own device
// (nothing uploaded, nothing stored), decodes it, and mixes it into the
// same output bus the vocal chain feeds. Requires headphones -- see the
// note in lib/audioProcessing.js for why.
// ── CPU ATTRIBUTION A/B — OPT IN PER SESSION, VIA THE URL ─────
// Enabled by loading the show with `?cpuab=1`, NOT by a constant.
//
// A deploy-time flag was the obvious shape and it is the wrong one
// here. It needs a deploy to turn on, another to turn off, and in
// between every artist on the build gets a freezing playhead — including
// on a real show nobody meant to instrument. A URL parameter is opt-in
// per session, per device, by the one person who wants the capture, and
// it cannot be left switched on for anybody else.
//
// The trade-off, stated: a query parameter is not authenticated. Anyone
// could add it. What they would get is a stuttering waveform on their
// own screen and some extra telemetry rows — no state change, nothing
// published, nothing another participant can see. That is an acceptable
// blast radius for a diagnostic; it would not be for anything else.
function deckLoopAbEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('cpuab') === '1';
  } catch {
    return false;
  }
}

// 60s phases. Long enough that the encoder's cpu accounting has several
// 2-second pub_stats samples per phase to accumulate in, short enough
// that a five-minute segment yields four or five paired periods.
export const DECK_LOOP_AB_PHASE_MS = 60_000;

export default function BackingTrackPanel({
  audioContext,
  outputBus,
  showEnded,
  onPlayerChange,
  // Cue-Sheet Director (CD-3) -- all optional, so this panel renders
  // exactly as before when omitted (e.g. nothing about the base
  // playback path changes for a caller that doesn't pass them).
  cues = [],
  activeCueId = null,
  onSelectCue,
  onDropCue,
  // TASK 1's row, read at last. Optional — omitted, this panel behaves
  // exactly as it did before, which is what keeps it usable from Kit
  // Check where there is no show to key a row by.
  sessionState = null,
  // Round 2 — needed to ask whether the row's track has an uploaded
  // copy, and to fetch it. Without it this panel degrades to exactly
  // its round 1 behaviour: local files and the re-pick prompt.
  artistAccessToken = null,
  // Round 2 Task 2 — which (show, artist) row a chosen set list binds
  // to. Kit Check passes the UPCOMING show, /live the running one.
  sessionTarget = null,
  // Assembly is a Kit Check activity. In the live room this panel is
  // for choosing what to play next, not for rebuilding the running
  // order mid-performance.
  canEditSetList = false,
}) {
  // ── ⚠️ THIS PANEL NO LONGER OWNS THE PLAYER ───────────────────
  // It used to hold it in `playerRef` and stop() it on unmount, so any
  // layout change that remounted this panel stopped the track and reset
  // the playhead to zero. The player now lives in lib/audioHost.js,
  // outside every component lifecycle; everything below is a VIEW of it.
  //
  // The state here is display-only and is REHYDRATED from the host on
  // mount (see the effect below), which is what makes a remount
  // invisible: same track, same playhead, still playing.
  const [fileName, setFileName] = useState(null);
  // The host's current track identity, mirrored into state purely so
  // needsRepick() below re-evaluates when it changes — reading
  // getAudioHost().trackHash during render would not re-render on its own.
  const [loadedHash, setLoadedHash] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [loading, setLoading] = useState(false);
  // Round 2 — the uploaded copy of whatever the row names, if there is
  // one. `undefined` means "not asked yet", null means "asked, there
  // isn't one". The distinction matters: showing the re-pick prompt
  // before the lookup returns would flash an instruction at the artist
  // and then withdraw it, which is worse than a beat of nothing.
  const [uploadedMatch, setUploadedMatch] = useState(undefined);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState(null);
  const [peaks, setPeaks] = useState(null);
  // INSTRUMENT 1 — which path produced the loaded deck, so
  // waveform-seconds can be attributed per segment. Declared up here
  // with the other refs rather than beside the effect that reads it:
  // the host-sync effect below writes it, and a const declared after
  // its first use is the temporal-dead-zone crash DECISIONS.md §17
  // records. check:tdz caught it doing exactly that.
  const loadSourceRef = useRef(null);
  const deckLoggedForRef = useRef(null);
  const rafRef = useRef(null);
  // Holds the running tick so the A/B below can restart the loop after a
  // suspension without rebuilding the effect (which would reset the
  // stats window and the waveform's own baseline).
  const tickRef = useRef(null);
  const loopSuspendedRef = useRef(false);
  const playheadRef = useRef(null); // DOM ref -- width updated directly, not via React state, so 200 bars don't re-render every frame
  const elapsedLabelRef = useRef(null);

  // ── REHYDRATE FROM THE HOST ───────────────────────────────────
  // The whole point of Task 2, in one effect. On every mount — first
  // load, a resize that remounted this subtree, arriving on /live after
  // the countdown — ask the host what is loaded and show that, instead
  // of rendering an empty "Choose audio file" over a track that is
  // audibly still playing.
  //
  // Peaks are recomputed from the host's own AudioBuffer rather than
  // cached in the host: the buffer is already in memory, the computation
  // is a single pass, and caching a derived array is one more thing that
  // can go stale against the track it describes.
  useEffect(() => {
    function sync() {
      const host = getAudioHost();
      const player = host.player;
      if (!player) {
        setFileName(null);
        setLoadedHash(null);
        setDuration(0);
        setPeaks(null);
        setPlaying(false);
        return;
      }
      setFileName(host.trackName || 'Backing track');
      setLoadedHash(host.trackHash || null);
      // A remount adopting a track the host already holds. Recorded as
      // its own source because it produces the same steady state — same
      // waveform, same loop — without any fetch or decode at all, which
      // is exactly the case that separates "the load cost something"
      // from "being loaded costs something".
      if (!loadSourceRef.current) loadSourceRef.current = 'rehydrate';
      setDuration(player.duration);
      setPlaying(!!player.isPlaying?.());
      setPeaks((prev) => (prev ? prev : computePeaks(player.audioBuffer)));
    }
    sync();
    // Also follow the host: another surface loading a track (or End Show
    // releasing it) must be reflected here without a remount.
    return subscribeAudioHost(sync);
  }, []);

  // ── INSTRUMENT 2 — WHAT THIS LOOP ACTUALLY COSTS ──────────────
  //
  // MEASUREMENT ONLY. Every DOM write below happens exactly as it did
  // before, on exactly the same frames. Nothing is skipped, gated or
  // reordered — the point is to find out what WOULD be skippable, not
  // to skip it before that is known.
  //
  // The round-2 camera glitch (show-o7vav9tl) narrowed to two survivors
  // that static reading cannot separate: this loop's per-frame paint of
  // a 360-rect SVG, or memory pressure from the ~106MB decoded
  // AudioBuffer. Both persist for the session; neither is the fetch or
  // the decode, which finished 91 seconds before the first cpu sample.
  //
  // The counters split the loop three ways, which is what decides it:
  //
  //   idleFrames    the loop ran but there was no track — it is
  //                 scheduled from MOUNT, not from load, so this is the
  //                 floor cost that exists regardless
  //   activeFrames  the loop ran and wrote to the DOM
  //   changedWidth  of those, how many actually changed the value.
  //                 A paused track advances no playhead, so a large
  //                 activeFrames with a near-zero changedWidth is a
  //                 direct measurement of wasted layout and paint.
  //   playingFrames how much of it was real playback rather than a
  //                 loaded-but-idle deck
  //
  // If cpu duration tracks activeFrames, it is this loop. If it tracks
  // time-since-decode with activeFrames flat, it is the buffer.
  const rafStatsRef = useRef(null);
  useEffect(() => {
    const REPORT_EVERY_MS = 30_000;
    const stats = {
      idleFrames: 0, activeFrames: 0, changedWidth: 0, changedLabel: 0, playingFrames: 0,
      lastWidth: null, lastLabel: null, since: performance.now(),
    };
    rafStatsRef.current = stats;

    function report(reason) {
      const elapsedMs = Math.round(performance.now() - stats.since);
      if (elapsedMs <= 0 || (stats.idleFrames + stats.activeFrames) === 0) return;
      logHealthEvent('backing_deck_raf', {
        reason,
        elapsedMs,
        idleFrames: stats.idleFrames,
        activeFrames: stats.activeFrames,
        changedWidth: stats.changedWidth,
        changedLabel: stats.changedLabel,
        playingFrames: stats.playingFrames,
        hasDuration: duration > 0,
      });
      stats.idleFrames = 0; stats.activeFrames = 0; stats.changedWidth = 0;
      stats.changedLabel = 0; stats.playingFrames = 0;
      stats.since = performance.now();
    }

    function tick() {
      const player = getBackingPlayer();
      if (player && duration > 0) {
        const elapsed = player.getElapsed();
        const pct = Math.min(100, (elapsed / duration) * 100);
        const width = `${pct}%`;
        const label = `${formatTime(elapsed)} / ${formatTime(duration)}`;

        stats.activeFrames += 1;
        if (width !== stats.lastWidth) { stats.changedWidth += 1; stats.lastWidth = width; }
        if (label !== stats.lastLabel) { stats.changedLabel += 1; stats.lastLabel = label; }
        if (player.isPlaying?.()) stats.playingFrames += 1;

        // Unchanged. Written every frame, same as before — see the note
        // above about measuring rather than fixing.
        if (playheadRef.current) playheadRef.current.style.width = width;
        if (elapsedLabelRef.current) elapsedLabelRef.current.textContent = label;
      } else {
        stats.idleFrames += 1;
      }

      if (performance.now() - stats.since >= REPORT_EVERY_MS) report('interval');

      // ── THE SUSPENSION IS A FULL STOP, NOT A SKIPPED WRITE ────
      // Returning without rescheduling ends the rAF chain entirely.
      // That is the point: the suspect is the WHOLE loop — the callback
      // at 60fps, the getElapsed read, and the two DOM writes — so a
      // version that kept requesting frames and merely skipped the
      // writes would leave most of the cost under test still running
      // and produce a null that means nothing.
      if (loopSuspendedRef.current) { rafRef.current = null; return; }
      rafRef.current = requestAnimationFrame(tick);
    }
    tickRef.current = tick;
    tick();
    return () => {
      tickRef.current = null;
      cancelAnimationFrame(rafRef.current);
      // Flush on the way out so a short segment still reports rather
      // than silently discarding everything under 30 seconds.
      report('teardown');
    };
  }, [duration]);

  // End Show must stop the beat, not just the vocal graph -- otherwise it
  // plays on indefinitely since AudioContext/outputBus stay alive for the
  // rest of this device's session (see lib/audioProcessing.js's own note:
  // there's no cleanup tied to the show's own lifecycle, only to the
  // component unmounting entirely). player.stop() resets pausedAt to 0
  // (not "paused at the end"), so this leaves the track ready to play
  // again from the start for a new show without a page reload -- no need
  // to re-decode or re-choose the file unless it's actually different.
  useEffect(() => {
    if (showEnded && getBackingPlayer()) {
      getBackingPlayer().stop();
      setPlaying(false);
    }
  }, [showEnded]);

  // ── THE A/B THAT ACTUALLY SEPARATES THE TWO SUSPECTS ──────────
  //
  // The CPU investigation has two survivors and one problem: EVERY
  // loaded segment contains BOTH of them. A loaded deck has a resident
  // ~106MB AudioBuffer AND a running waveform loop, and local vs
  // uploaded vs rehydrate differ only in how the bytes arrived, not in
  // what is present afterwards. So anything that rises with time rises
  // with both, and no comparison ACROSS segments can attribute.
  //
  // Nor is there a reachable state with one and not the other:
  // collapsing the deck applies a CSS class, and SwipePages mounts every
  // tab regardless of which is active, so the panel stays mounted and
  // the loop keeps running.
  //
  // This is the missing condition. It alternates the loop off and on
  // WITHIN one segment while the buffer stays resident and every other
  // variable is held constant — same track, same graph, same camera,
  // same encoder. If cpu follows the phases, it is the loop. If cpu is
  // flat across them, the loop is not the cause and the buffer is the
  // surviving candidate.
  //
  // ── WHY ALTERNATING RATHER THAN ONE SWITCH ────────────────────
  // A single off-period could be confounded by anything else that drifts
  // over a session — thermal state, another app, the encoder settling.
  // Several paired periods make that far less likely: a coincidence has
  // to repeat on cue, in phase, several times.
  //
  // ── WHAT THE ARTIST SEES ──────────────────────────────────────
  // The waveform playhead freezes for the off phases. That is the whole
  // visible effect, it is expected, and it is why this is OFF by default
  // and switched on for one capture rather than shipped live.
  useEffect(() => {
    if (!deckLoopAbEnabled()) return undefined;
    logHealthEvent('deck_loop_ab_started', { phaseMs: DECK_LOOP_AB_PHASE_MS });
    const id = setInterval(() => {
      const suspended = !loopSuspendedRef.current;
      loopSuspendedRef.current = suspended;
      // Logged BEFORE the restart so the row's timestamp is the moment
      // the phase changed, not the moment a frame happened to fire.
      logHealthEvent('deck_loop_suspended', { suspended, phaseMs: DECK_LOOP_AB_PHASE_MS });
      if (!suspended) {
        // Resuming: the chain ended when tick() returned without
        // rescheduling, so it has to be kicked off again.
        cancelAnimationFrame(rafRef.current);
        tickRef.current?.();
      }
    }, DECK_LOOP_AB_PHASE_MS);
    return () => {
      clearInterval(id);
      // Never leave the loop suspended behind this effect: a stopped
      // playhead outliving the capture would look like a bug.
      if (loopSuspendedRef.current) {
        loopSuspendedRef.current = false;
        cancelAnimationFrame(rafRef.current);
        tickRef.current?.();
      }
    };
  }, []);

  // ── ⚠️ THE UNMOUNT STOP IS GONE, AND ITS REMOVAL IS THE FIX ───
  //
  // This used to be:
  //
  //     useEffect(() => () => { playerRef.current?.stop(); }, []);
  //
  // The reasoning at the time was sound in isolation — unmounting a
  // component does not stop a Web Audio source node, so the panel
  // cleaned up after itself. But "this panel unmounted" and "the artist
  // wants the music to stop" are not the same event, and treating them
  // as one is exactly why minimising a panel or resizing the window
  // killed the backing track mid-performance.
  //
  // Stopping is now tied to events that actually mean stop: the End Show
  // effect above, and releaseAudioHost() when a session genuinely ends
  // (lib/audioHost.js). Unmounting means nothing to the audio any more,
  // which is the entire point.

  // ── INSTRUMENT 1 — WHEN DID THE EXPENSIVE STEADY STATE BEGIN ──
  //
  // Fires once per track, at the moment the waveform first exists —
  // which is the moment the rAF loop above stops being idle and starts
  // writing to the DOM every frame. Subtracting this timestamp from the
  // session start gives waveform-seconds per segment, which is the
  // number to correlate against qualityLimitationReason cpu duration.
  //
  // The hypothesis it tests: Task 1 did not ADD a cost, it changed WHEN
  // the cost starts. A manual file pick put the deck into this state
  // whenever the artist got round to it; the uploaded path puts it there
  // within seconds of arrival, unattended. If that is right, segment
  // cpu duration should track waveform-seconds and NOT track the number
  // of loads.
  useEffect(() => {
    if (!peaks || !loadedHash) return;
    if (deckLoggedForRef.current === loadedHash) return;
    deckLoggedForRef.current = loadedHash;
    logHealthEvent('backing_deck_loaded', {
      source: loadSourceRef.current || 'unknown',
      durationSec: Math.round(duration),
      // Bytes the decoded buffer occupies — the OTHER surviving
      // candidate. channels * samples * 4 bytes, reported so the two
      // hypotheses can be weighed against the same row.
      approxBufferBytes: duration > 0 ? Math.round(duration * 44100 * 2 * 4) : null,
      waveformPoints: peaks.length,
    });
  }, [peaks, loadedHash, duration]);

  // ── LOAD A TRACK THE APP CAN FETCH FOR ITSELF ─────────────────
  // The uploaded path. Identical to handleFile below from the decode
  // onwards — same loadBackingTrack, same computeTrackHash, same
  // setBackingPlayer — because the bytes are the same bytes. What
  // differs is only where they came from, and that a Blob from storage
  // needs no user gesture.
  const loadUploaded = useCallback(async (track, seekToMs) => {
    if (!audioContext || !outputBus || !artistAccessToken) return false;
    setAutoLoading(true);
    setAutoError(null);
    try {
      const { blob, title } = await fetchUploadedTrackBlob(track.id, artistAccessToken);
      const [player, hash] = await Promise.all([
        loadBackingTrack(audioContext, outputBus, blob),
        computeTrackHash(blob),
      ]);
      // ── THE PROPERTY, CHECKED RATHER THAN TRUSTED ─────────────
      // The bytes fetched back must hash to what the row said. If they
      // do not, the object and its row have diverged and playing it
      // would put the wrong audio under the artist's cue sheet — a
      // silent, on-air failure. Refusing and falling back to the
      // re-pick prompt is the safe direction.
      if (hash !== track.sha256) {
        setAutoError('That stored track no longer matches its record. Re-select the file.');
        setUploadedMatch(null);
        return false;
      }
      player.setVolume(volume);
      if (seekToMs > 0) player.seek(seekToMs / 1000);
      loadSourceRef.current = 'uploaded';
      setBackingPlayer(player, hash, title || track.title || 'Backing track');
      setDuration(player.duration);
      setPeaks(computePeaks(player.audioBuffer));
      setFileName(title || track.title || 'Backing track');
      setPlaying(false);
      onPlayerChange?.(player, hash, title || track.title);
      return true;
    } catch (err) {
      // Falls back to the re-pick prompt rather than dead-ending: the
      // artist can always still choose the file by hand.
      setAutoError(String(err?.message || err));
      return false;
    } finally {
      setAutoLoading(false);
    }
  }, [audioContext, outputBus, artistAccessToken, volume, onPlayerChange]);

  // ── DOES THE ROW'S TRACK EXIST IN STORAGE, AND IF SO, JUST LOAD IT ──
  // This is what removes the re-pick path for uploaded tracks. The
  // question is asked once per (hash, host state): the row names a
  // track this device is not holding — is there an uploaded copy?
  //   yes -> fetch and resume silently, seeking to where they were
  //   no  -> fall through to the re-pick prompt, unchanged from round 1
  const rowHash = sessionState?.track_hash || null;
  const autoTriedRef = useRef(null);
  useEffect(() => {
    if (!rowHash || !artistAccessToken) { setUploadedMatch(undefined); return; }
    if (loadedHash === rowHash) return;          // already holding it
    if (autoTriedRef.current === rowHash) return; // asked for this hash already
    autoTriedRef.current = rowHash;
    let cancelled = false;
    (async () => {
      const match = await findUploadedTrackByHash(rowHash, artistAccessToken);
      if (cancelled) return;
      setUploadedMatch(match);
      if (!match) return;
      // Resume where the row says they were. currentPositionMs bounds
      // its own extrapolation, so a stale row resumes at the last
      // position actually recorded rather than a guess.
      await loadUploaded(match, currentPositionMs(sessionState));
    })();
    return () => { cancelled = true; };
  }, [rowHash, loadedHash, artistAccessToken, sessionState, loadUploaded]);

  // ── WHAT THE SERVER REMEMBERS THAT THIS DEVICE CANNOT ─────────
  // The read side of Task 1, and the answer to "the row had a track name
  // and the panel showed nothing."
  //
  // needsRepick() is true exactly when the row names a track that the
  // audio host is not holding — after a hard reload, or on a second
  // device.
  //
  // It is computed here but only SHOWN when the deck is empty (the
  // !fileName branch below). That is deliberate: needsRepick is also
  // true when the artist has since loaded a different track, and in that
  // case they made a choice and do not need the previous one advertised
  // back at them mid-show. Empty deck plus a remembered track is the one
  // state where the offer is help rather than noise.
  //
  // The honest limit, restated because the UI has to express it: the
  // browser will not reopen a local file without a fresh user gesture, so
  // no amount of server state can resume this automatically. What it can
  // do is turn "start over and hope you remember" into "re-select this
  // exact file and land back where you were."
  const resume = needsRepick(sessionState, loadedHash)
    ? { name: sessionState.track_name || 'your backing track', positionMs: currentPositionMs(sessionState) }
    : null;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file || !audioContext || !outputBus) return;
    // Captured BEFORE the awaits below: decoding is slow enough that a
    // Realtime echo can land mid-decode and move the row out from under
    // us, and the artist agreed to resume from what they were shown.
    const resumeTo = resume;
    setLoading(true);
    // Replacing a loaded track: the host stops and disconnects the old
    // one inside setBackingPlayer, so two sources can never overlap.
    
    // Computed alongside the decode, not instead of it -- Blob.arrayBuffer()
    // re-reads the file's bytes each call (not a stream, safe to call
    // twice on the same File), and loadBackingTrack doesn't expose the
    // raw bytes it already read back out. Cue-Sheet Director (CD-3): this
    // hash is the only stable identity a backing track has (see
    // lib/trackHash.js) -- it's what the cue editor loads/saves against.
    const [player, trackHash] = await Promise.all([
      loadBackingTrack(audioContext, outputBus, file),
      computeTrackHash(file),
    ]);
    player.setVolume(volume);

    // ── LAND BACK WHERE THEY WERE ─────────────────────────────────
    // Only when the file they just chose is provably the same one the
    // row was tracking — same SHA-256, not the same filename. Seeking a
    // different track to 2:14 because it happens to be called the same
    // thing would be a confident lie about where they are, and a
    // renamed-or-re-exported file is exactly the case a filename check
    // would get wrong.
    //
    // Left PAUSED at that offset rather than auto-playing: the artist
    // re-picked a file, which is not the same as asking for the music to
    // start, and starting a backing track unbidden mid-show is the kind
    // of surprise this whole round exists to remove. seek() sets the
    // resume offset without starting the source node.
    if (resumeTo && trackHash === sessionState?.track_hash && resumeTo.positionMs > 0) {
      player.seek(resumeTo.positionMs / 1000);
    }

    loadSourceRef.current = 'local';
    setBackingPlayer(player, trackHash, file.name);
    setDuration(player.duration);
    setPeaks(computePeaks(player.audioBuffer));
    setFileName(file.name);
    setPlaying(false);
    setLoading(false);
    // trackGain/delayNode are created fresh per load -- the parent
    // re-applies whatever sync compensation is currently calibrated.
    onPlayerChange?.(player, trackHash, file.name);
  }

  function togglePlay() {
    const player = getBackingPlayer();
    if (!player) return;
    if (playing) player.pause(); else player.play();
    setPlaying(!playing);
  }

  function stop() {
    getBackingPlayer()?.stop();
    setPlaying(false);
    if (playheadRef.current) playheadRef.current.style.width = '0%';
  }

  function changeVolume(v) {
    setVolume(v);
    getBackingPlayer()?.setVolume(v);
  }

  function seekTo(fraction) {
    const player = getBackingPlayer();
    if (!player || !duration) return;
    player.seek(fraction * duration);
  }

  // Cue-Sheet Director (CD-3) -- "drop a cue at the playhead," available
  // whether the track is playing or paused (unlike seekTo, which needs a
  // click target on the waveform, this just reads wherever the playhead
  // already is).
  function handleDropCue() {
    const player = getBackingPlayer();
    if (!player) return;
    onDropCue?.(player.getElapsed() * 1000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Conditionalised in round 2, not replaced. "Not uploaded
          anywhere" stayed true for every track until uploads existed,
          and is still true of a locally picked one — so the label now
          says which kind is loaded rather than asserting a blanket
          policy that is only half true. */}
      <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
        {loadedHash && uploadedMatch && loadedHash === uploadedMatch.sha256
          ? 'Backing track (in your library)'
          : fileName
            ? 'Backing track (from your device -- not uploaded)'
            : 'Backing track'}
      </span>

      {!fileName ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* ── THE UPLOADED CASE: NO PROMPT, JUST A STATUS ──────
              Nothing is asked of the artist here. The app has the bytes
              and is fetching them; the only reason this renders at all
              is that a deck which sits blank for two seconds looks
              broken. */}
          {autoLoading && (
            <span style={{ fontSize: 11, color: '#2ec4b6' }}>
              Reloading {resume?.name || 'your backing track'}
              {resume?.positionMs > 0 ? ` — resuming at ${formatTime(resume.positionMs / 1000)}` : ''}…
            </span>
          )}

          {/* ── THE LOCAL CASE: THE PROMPT, NARROWED ─────────────
              Only shown once the lookup has come back empty
              (uploadedMatch === null). Before round 2 this fired for
              every remembered track; now it fires only for ones the app
              genuinely cannot fetch, which is exactly the set of
              locally-picked files. `undefined` means the lookup has not
              answered yet, and flashing an instruction and withdrawing
              it is worse than a beat of nothing. */}
          {resume && !autoLoading && uploadedMatch === null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: '#fdfffc' }}>{resume.name}</span>
              <span style={{ fontSize: 11, color: '#2ec4b6' }}>
                {resume.positionMs > 0
                  ? `Re-select this file to resume at ${formatTime(resume.positionMs / 1000)}`
                  : 'Re-select this file to load it again'}
              </span>
              {/* Conditionalised, not deleted. This sentence is still
                  exactly true of a locally picked file, and that is the
                  only case that reaches this branch. */}
              <span style={{ fontSize: 11, color: '#888780' }}>
                This one was never uploaded, so your device cannot reopen it on its own.
                Upload it once and it will come back by itself next time.
              </span>
            </div>
          )}

          {autoError && (
            <span style={{ fontSize: 11, color: '#e71d36' }}>{autoError}</span>
          )}

          <label style={{ display: 'inline-block' }}>
            <span className="control-btn" style={{ display: 'inline-block' }}>
              {loading ? 'Loading...' : resume && uploadedMatch === null ? 'Re-select audio file' : 'Choose audio file'}
            </span>
            <input type="file" accept="audio/*" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </div>
      ) : (
        <>
          <span style={{ fontSize: 13, color: '#fdfffc' }}>{fileName}</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="control-btn" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            <button className="control-btn" onClick={stop}>Stop</button>
            {onDropCue && (
              <button className="control-btn" onClick={handleDropCue}>Drop cue</button>
            )}
            <span ref={elapsedLabelRef} style={{ fontSize: 12, color: '#B4B2A9' }}>0:00 / {formatTime(duration)}</span>
          </div>

          {peaks && (
            <div
              style={{ position: 'relative', width: '100%', height: WAVEFORM_HEIGHT, cursor: 'pointer', background: '#1a1a19', borderRadius: 4, overflow: 'hidden' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seekTo((e.clientX - rect.left) / rect.width);
              }}
            >
              <Waveform peaks={peaks} color="#3a3a37" />
              <div ref={playheadRef} style={{ position: 'absolute', inset: 0, width: '0%', overflow: 'hidden', pointerEvents: 'none' }}>
                <Waveform peaks={peaks} color="#2ec4b6" />
              </div>
              {/* Cue markers (CD-3) -- same (timestamp / duration) * 100%
                  math as the playhead overlay above, positioned in the
                  same relative wrapper so they stay pixel-aligned with it.
                  stopPropagation so a marker tap doesn't also seek. */}
              {duration > 0 && cues.map((cue) => {
                const leftPct = Math.min(100, Math.max(0, (cue.timestamp_ms / 1000 / duration) * 100));
                const isActive = cue.id === activeCueId;
                const color = shotFamilyColor(cue.shot_type);
                return (
                  <div
                    key={cue.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCue?.(cue.id);
                    }}
                    title={`${cue.shot_type} @ ${formatTime(cue.timestamp_ms / 1000)}`}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: 0,
                      bottom: 0,
                      width: isActive ? 3 : 2,
                      marginLeft: isActive ? -1.5 : -1,
                      background: color,
                      boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: -4,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: color,
                        boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#888780' }}>Track volume</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} style={{ flex: 1 }} />
          </div>

          <label style={{ fontSize: 11, color: '#2ec4b6', cursor: 'pointer' }}>
            Choose a different file
            <input type="file" accept="audio/*" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </>
      )}

      <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
        Wear headphones -- this plays out loud on your device so you can perform along with it, which means your own
        mic would pick it up a second time without headphones.
      </p>

      {/* ── THE SET LIST, AS ITS OWN SECTION ─────────────────────
          Above the library, because the running order is what the
          artist reads during a show and the library is where songs come
          from before one. Both are in the AUDIO deck; b-roll is in the
          VIDEO deck and stays there. */}
      <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4 }}>
        <SetListPanel
          artistAccessToken={artistAccessToken}
          showId={sessionTarget?.showId || null}
          artistId={sessionTarget?.artistId || null}
          loadedHash={loadedHash}
          canEdit={canEditSetList}
          // The same uploaded-track loader the library uses. Loads and
          // binds the cue sheet; does not start playing.
          onPickTrack={(track) => loadUploaded(track, 0)}
        />
      </div>

      {/* ── THE LIBRARY, AS ITS OWN SECTION ──────────────────────
          Rendered here rather than beside BRollLibrary deliberately.
          They share a bucket and a 500MB allowance and nothing else: a
          clip is something you CUT TO, a track is what you PERFORM
          ALONG WITH. B-roll's library lives in the video deck for the
          same reason this one lives in the audio deck — next to the
          thing it feeds. Shared storage underneath, distinct surfaces
          above. */}
      <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4 }}>
        <BackingTrackLibrary
          artistAccessToken={artistAccessToken}
          loadedHash={loadedHash}
          onPickTrack={(track) => loadUploaded(track, 0)}
        />
      </div>
    </div>
  );
}
