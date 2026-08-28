'use client';

import { useState, useRef, useEffect } from 'react';
import { loadBackingTrack } from '../lib/audioProcessing';
import { shotFamilyColor } from '../lib/shotTypes';
import { computeTrackHash } from '../lib/trackHash';
import { getAudioHost, setBackingPlayer, getBackingPlayer, subscribeAudioHost } from '../lib/audioHost';
import { needsRepick, currentPositionMs } from '../lib/showSessionState';

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
  const [peaks, setPeaks] = useState(null);
  const rafRef = useRef(null);
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
      setDuration(player.duration);
      setPlaying(!!player.isPlaying?.());
      setPeaks((prev) => (prev ? prev : computePeaks(player.audioBuffer)));
    }
    sync();
    // Also follow the host: another surface loading a track (or End Show
    // releasing it) must be reflected here without a remount.
    return subscribeAudioHost(sync);
  }, []);

  useEffect(() => {
    function tick() {
      const player = getBackingPlayer();
      if (player && duration > 0) {
        const elapsed = player.getElapsed();
        const pct = Math.min(100, (elapsed / duration) * 100);
        if (playheadRef.current) playheadRef.current.style.width = `${pct}%`;
        if (elapsedLabelRef.current) elapsedLabelRef.current.textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(rafRef.current);
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
      <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
        Backing track (from your device -- not uploaded anywhere)
      </span>

      {!fileName ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* The resume offer. Names the exact file and the exact time,
              because "you had something loaded" is not actionable and
              this is read at speed, mid-show, by someone who has just
              watched their deck go blank. */}
          {resume && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: '#fdfffc' }}>{resume.name}</span>
              <span style={{ fontSize: 11, color: '#2ec4b6' }}>
                {resume.positionMs > 0
                  ? `Re-select this file to resume at ${formatTime(resume.positionMs / 1000)}`
                  : 'Re-select this file to load it again'}
              </span>
              <span style={{ fontSize: 11, color: '#888780' }}>
                Your device cannot reopen it on its own — the file never left this browser.
              </span>
            </div>
          )}
          <label style={{ display: 'inline-block' }}>
            <span className="control-btn" style={{ display: 'inline-block' }}>
              {loading ? 'Loading...' : resume ? 'Re-select audio file' : 'Choose audio file'}
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
    </div>
  );
}
