'use client';

import { useEffect, useRef, useState } from 'react';
import Knob from './Knob';
import LevelMeterFader from './LevelMeterFader';
import BackingTrackPanel from './BackingTrackPanel';
import CalibrateSyncPanel from './CalibrateSyncPanel';
import {
  tuneHighpass, tuneCompressor, tuneMakeupGainDb, tuneReverbMix,
  tuneInputGainDb, tuneOutputGainDb, tuneMonitorEnabled, tuneEffectsBypass,
} from '../lib/audioProcessing';
import { probeLog } from '../lib/tapProbeBus';

const AUTO_DISABLED_NOTICE_MS = 4_000; // how long "Monitoring off -- you're live" stays visible

// The tested-good starting point every performer goes live with. Manual
// mix is off by default -- these values are already applied by
// createPilotAudioTrack()'s own defaults, this object just mirrors them so
// the knobs display correctly and so re-enabling "preset" can restore them.
const PRESET = {
  inputDb: 0,
  highpass: 80,
  threshold: -24,
  ratio: 3,
  gainDb: 4,
  reverbMix: 0.12,
  outputDb: 0,
};

export default function AudioDeckPanel({ nodes, audioContext, showEnded, showPhase }) {
  const [manualMix, setManualMix] = useState(false);
  const [values, setValues] = useState(PRESET);
  // Matches createPilotAudioTrack's own default (bypassGain 1 / processedGain
  // 0) -- a pilot-only safety valve since the preset can't be tuned before
  // pilot, not a verdict that processing is wrong in concept. Available in
  // both soundcheck and live -- see toggleEffects.
  const [effectsOn, setEffectsOn] = useState(false);
  const [monitorOn, setMonitorOn] = useState(false);
  const [autoDisabledNotice, setAutoDisabledNotice] = useState(false);
  const noticeTimerRef = useRef(null);
  // Session-scoped only -- resets on remount, never persisted, never
  // inherited across artists/devices/shows. trackGain/delayNode are
  // recreated per backing-track load, so backingPlayerRef lets a fresh
  // load re-apply whatever's currently calibrated.
  const [syncDelayMs, setSyncDelayMs] = useState(0);
  const backingPlayerRef = useRef(null);

  // Soundcheck-only feature -- the instant the show leaves soundcheck
  // (goes live), force monitoring off regardless of what the artist left
  // it at. This is the latency-during-performance guard, not just a UI
  // default: monitoring delay that's fine while judging your own sound is
  // NOT fine once you're actually performing. Only surfaces the "you're
  // live" notice if monitoring was actually on -- no need to explain a
  // no-op.
  useEffect(() => {
    if (showPhase !== 'soundcheck' && nodes && monitorOn) {
      tuneMonitorEnabled(nodes, false);
      setMonitorOn(false);
      setAutoDisabledNotice(true);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setAutoDisabledNotice(false), AUTO_DISABLED_NOTICE_MS);
    }
  }, [showPhase, monitorOn, nodes]);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  if (!nodes) {
    return <p style={{ fontSize: 12, color: '#888780' }}>Connecting audio...</p>;
  }

  function toggleMonitor() {
    const next = !monitorOn;
    setMonitorOn(next);
    tuneMonitorEnabled(nodes, next);
  }

  // Live AND soundcheck -- this changes the actually-published signal, not
  // just local monitoring, so unlike toggleMonitor there's no showPhase
  // gate: an artist mid-show hearing the processing go wrong needs to be
  // able to kill it immediately.
  function toggleEffects() {
    const next = !effectsOn;
    setEffectsOn(next);
    tuneEffectsBypass(nodes, next);
  }

  function applyPreset() {
    setValues(PRESET);
    tuneInputGainDb(nodes, PRESET.inputDb);
    tuneHighpass(nodes, PRESET.highpass);
    tuneCompressor(nodes, { threshold: PRESET.threshold, ratio: PRESET.ratio });
    tuneMakeupGainDb(nodes, PRESET.gainDb);
    tuneReverbMix(nodes, PRESET.reverbMix);
    tuneOutputGainDb(nodes, PRESET.outputDb);
  }

  function toggleManualMix() {
    const next = !manualMix;
    setManualMix(next);
    if (!next) applyPreset(); // turning manual mix off snaps back to the known-good preset
  }

  function update(key, tuneFn) {
    return (v) => {
      // DEBUG (live pilot bug, round 2) -- see lib/tapProbeBus.js. Safe
      // to delete once the real cause is found and fixed.
      probeLog(`AUDIO: update("${key}") called with v=${v}`);
      setValues((prev) => ({ ...prev, [key]: v }));
      tuneFn(v);
    };
  }

  // The input/output faders and every knob are DELIBERATELY inert while
  // manualMix is off (Knob's own `disabled` prop, and the input fader's
  // onChangeGainDb below) -- "Preset sound (locked)" is the default,
  // by-design state, not a bug. Logged so a report of "the mic level
  // fader doesn't respond" can be told apart from an actual bug: if this
  // fires, the control IS wired and IS intentionally a no-op right now.
  function lockedFaderTap(key) {
    probeLog(`AUDIO: ${key} fader onChange fired but manualMix is OFF -- intentional no-op (Preset sound is locked)`);
  }

  function handleBackingPlayerChange(player) {
    backingPlayerRef.current = player;
    player?.setSyncDelayMs(syncDelayMs);
  }

  function applySyncDelay(ms) {
    setSyncDelayMs(ms);
    backingPlayerRef.current?.setSyncDelayMs(ms);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          {manualMix ? 'Manual mix -- tuning live' : 'Preset sound (locked)'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
          Manual mix
          <span
            onClick={toggleManualMix}
            style={{
              width: 36, height: 20, borderRadius: 10,
              background: manualMix ? '#2ec4b6' : '#3a3a37',
              position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: manualMix ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
              transition: 'left 0.15s ease',
            }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          {effectsOn ? 'Effects on -- processed vocal' : 'Effects off -- raw vocal published'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
          Effects
          <span
            onClick={toggleEffects}
            style={{
              width: 36, height: 20, borderRadius: 10,
              background: effectsOn ? '#2ec4b6' : '#3a3a37',
              position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: effectsOn ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
              transition: 'left 0.15s ease',
            }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-around', padding: '4px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>INPUT</span>
          <LevelMeterFader
            label="Mic level"
            analyser={nodes.inputAnalyser}
            gainDb={values.inputDb}
            onChangeGainDb={manualMix ? update('inputDb', (v) => tuneInputGainDb(nodes, v)) : () => lockedFaderTap('inputDb')}
            minDb={-12}
            maxDb={24}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>FILTER</span>
          <Knob label="Rumble cut" value={values.highpass} min={40} max={160} step={5} unit="Hz"
            disabled={!manualMix || !effectsOn} onChange={update('highpass', (v) => tuneHighpass(nodes, v))} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>COMPRESSOR</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <Knob label="Threshold" value={values.threshold} min={-40} max={-10} step={1} unit="dB"
              disabled={!manualMix || !effectsOn} onChange={update('threshold', (v) => tuneCompressor(nodes, { threshold: v }))} />
            <Knob label="Ratio" value={values.ratio} min={1} max={8} step={0.5} unit=":1"
              disabled={!manualMix || !effectsOn} onChange={update('ratio', (v) => tuneCompressor(nodes, { ratio: v }))} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* This "Gain" knob is the makeup-gain stage -- it compensates for
              level lost during compression, applied BEFORE the reverb send.
              It is not the same as the OUTPUT fader on the right, which
              controls the final published level after everything else. */}
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>SEND</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <Knob label="Makeup gain" value={values.gainDb} min={0} max={12} step={0.5} unit="dB"
              disabled={!manualMix || !effectsOn} onChange={update('gainDb', (v) => tuneMakeupGainDb(nodes, v))} />
            <Knob label="Reverb" value={values.reverbMix} min={0} max={0.4} step={0.01} unit=""
              disabled={!manualMix || !effectsOn} onChange={update('reverbMix', (v) => tuneReverbMix(nodes, v))} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>OUTPUT</span>
          <LevelMeterFader
            label="Published level"
            analyser={nodes.outputAnalyser}
            gainDb={values.outputDb}
            onChangeGainDb={manualMix ? update('outputDb', (v) => tuneOutputGainDb(nodes, v)) : () => lockedFaderTap('outputDb')}
            minDb={-12}
            maxDb={12}
          />
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
        {manualMix
          ? 'Have someone play/sing at real volume and listen from a separate device while tuning. Input meter shows raw mic level; output meter shows what viewers actually hear.'
          : 'Going live uses this tested preset. Switch on Manual mix during soundcheck to adjust.'}
      </p>

      {showPhase === 'soundcheck' && (
        <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
              Monitor my voice
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
              {monitorOn ? 'On' : 'Off'}
              <span
                onClick={toggleMonitor}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: monitorOn ? '#2ec4b6' : '#3a3a37',
                  position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: monitorOn ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
                  transition: 'left 0.15s ease',
                }} />
              </span>
            </label>
          </div>

          <div style={{ border: '1px solid #ff9f1c', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#ff9f1c', lineHeight: 1.4 }}>
            ⚠ Use earphones only. Monitoring through speakers feeds your own processed voice back into the mic and causes feedback.
          </div>

          <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
            Hear your processed vocal (high-pass, compressor, reverb) live so you can judge it before going live. Off by
            default every soundcheck -- turns off automatically the moment you go live, since monitoring delay that's fine
            for judging your sound is not fine while actually performing.
          </p>
        </div>
      )}

      {autoDisabledNotice && (
        <div style={{ border: '1px solid #2ec4b6', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#2ec4b6', lineHeight: 1.4 }}>
          Monitoring off -- you're live
        </div>
      )}

      <CalibrateSyncPanel
        audioContext={audioContext}
        inputGain={nodes.inputGain}
        syncDelayMs={syncDelayMs}
        onApply={applySyncDelay}
      />

      <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4 }}>
        <BackingTrackPanel
          audioContext={audioContext}
          outputBus={nodes.outputBus}
          showEnded={showEnded}
          onPlayerChange={handleBackingPlayerChange}
        />
      </div>
    </div>
  );
}
