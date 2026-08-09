'use client';

import { useState, useRef, useEffect } from 'react';
import { loadBackingTrack } from '../lib/audioProcessing';
import { probeLog } from '../lib/tapProbeBus';

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
export default function BackingTrackPanel({ audioContext, outputBus, showEnded, onPlayerChange }) {
  const [fileName, setFileName] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [loading, setLoading] = useState(false);
  const [peaks, setPeaks] = useState(null);
  const playerRef = useRef(null);
  const rafRef = useRef(null);
  const playheadRef = useRef(null); // DOM ref -- width updated directly, not via React state, so 200 bars don't re-render every frame
  const elapsedLabelRef = useRef(null);

  useEffect(() => {
    function tick() {
      if (playerRef.current && duration > 0) {
        const elapsed = playerRef.current.getElapsed();
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
    if (showEnded && playerRef.current) {
      playerRef.current.stop();
      setPlaying(false);
    }
  }, [showEnded]);

  // Catch-all for every OTHER way the performer session tears down --
  // leaving via BroadcastStage's floating leave button, a room disconnect,
  // or anything else that unmounts this panel -- none of which set
  // showEnded, so the effect above never fires for them. Unmounting this
  // component doesn't stop the Web Audio source node on its own (it keeps
  // playing through the still-alive AudioContext), so this has to call
  // stop() explicitly.
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
    };
  }, []);

  async function handleFile(e) {
    // DEBUG (live pilot bug, round 2) -- see lib/tapProbeBus.js. Safe to
    // delete once the real cause is found and fixed.
    probeLog(`AUDIO: handleFile() called -- files=${e.target.files?.length ?? 0}, audioContext=${!!audioContext}, outputBus=${!!outputBus}`);
    const file = e.target.files?.[0];
    if (!file || !audioContext || !outputBus) {
      probeLog(`AUDIO: handleFile() ABORTED early -- file=${!!file} audioContext=${!!audioContext} outputBus=${!!outputBus}`);
      return;
    }
    try {
      setLoading(true);
      playerRef.current?.disconnect();
      const player = await loadBackingTrack(audioContext, outputBus, file);
      player.setVolume(volume);
      playerRef.current = player;
      setDuration(player.duration);
      setPeaks(computePeaks(player.audioBuffer));
      setFileName(file.name);
      setPlaying(false);
      setLoading(false);
      // trackGain/delayNode are created fresh per load -- the parent
      // re-applies whatever sync compensation is currently calibrated.
      onPlayerChange?.(player);
      probeLog(`AUDIO: handleFile() completed -- loaded "${file.name}"`);
    } catch (err) {
      probeLog(`AUDIO: handleFile() THREW: ${err?.message || String(err)}`);
      setLoading(false);
      throw err;
    }
  }

  function togglePlay() {
    if (!playerRef.current) return;
    if (playing) {
      playerRef.current.pause();
    } else {
      playerRef.current.play();
    }
    setPlaying(!playing);
  }

  function stop() {
    playerRef.current?.stop();
    setPlaying(false);
    if (playheadRef.current) playheadRef.current.style.width = '0%';
  }

  function changeVolume(v) {
    setVolume(v);
    playerRef.current?.setVolume(v);
  }

  function seekTo(fraction) {
    if (!playerRef.current || !duration) return;
    playerRef.current.seek(fraction * duration);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
        Backing track (from your device -- not uploaded anywhere)
      </span>

      {!fileName ? (
        <label style={{ display: 'inline-block' }}>
          <span className="control-btn" style={{ display: 'inline-block' }}>
            {loading ? 'Loading...' : 'Choose audio file'}
          </span>
          <input
            type="file"
            accept="audio/*"
            onChange={handleFile}
            onClick={() => probeLog('AUDIO: <input type=file> onClick fired -- native dialog should be opening now')}
            style={{ display: 'none' }}
          />
        </label>
      ) : (
        <>
          <span style={{ fontSize: 13, color: '#fdfffc' }}>{fileName}</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="control-btn" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            <button className="control-btn" onClick={stop}>Stop</button>
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
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#888780' }}>Track volume</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} style={{ flex: 1 }} />
          </div>

          <label style={{ fontSize: 11, color: '#2ec4b6', cursor: 'pointer' }}>
            Choose a different file
            <input
              type="file"
              accept="audio/*"
              onChange={handleFile}
              onClick={() => probeLog('AUDIO: <input type=file> (different file) onClick fired -- native dialog should be opening now')}
              style={{ display: 'none' }}
            />
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
