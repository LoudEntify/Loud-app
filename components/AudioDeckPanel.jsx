'use client';

import { useState } from 'react';
import Knob from './Knob';
import { tuneHighpass, tuneCompressor, tuneMakeupGainDb, tuneReverbMix } from '../lib/audioProcessing';

// The tested-good starting point every performer goes live with. Manual
// mix is off by default -- these values are already applied by
// createPilotAudioTrack()'s own defaults, this object just mirrors them so
// the knobs display correctly and so re-enabling "preset" can restore them.
const PRESET = {
  highpass: 80,
  threshold: -24,
  ratio: 3,
  gainDb: 4,
  reverbMix: 0.12,
};

export default function AudioDeckPanel({ nodes }) {
  const [manualMix, setManualMix] = useState(false);
  const [values, setValues] = useState(PRESET);

  if (!nodes) {
    return <p style={{ fontSize: 12, color: '#888780' }}>Connecting audio...</p>;
  }

  function applyPreset() {
    setValues(PRESET);
    tuneHighpass(nodes, PRESET.highpass);
    tuneCompressor(nodes, { threshold: PRESET.threshold, ratio: PRESET.ratio });
    tuneMakeupGainDb(nodes, PRESET.gainDb);
    tuneReverbMix(nodes, PRESET.reverbMix);
  }

  function toggleManualMix() {
    const next = !manualMix;
    setManualMix(next);
    if (!next) applyPreset(); // turning manual mix off snaps back to the known-good preset
  }

  function update(key, tuneFn) {
    return (v) => {
      setValues((prev) => ({ ...prev, [key]: v }));
      tuneFn(v);
    };
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

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'space-around', padding: '4px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>FILTER</span>
          <Knob label="Rumble cut" value={values.highpass} min={40} max={160} step={5} unit="Hz"
            disabled={!manualMix} onChange={update('highpass', (v) => tuneHighpass(nodes, v))} />
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>COMPRESSOR</span>
            <div style={{ display: 'flex', gap: 16 }}>
              <Knob label="Threshold" value={values.threshold} min={-40} max={-10} step={1} unit="dB"
                disabled={!manualMix} onChange={update('threshold', (v) => tuneCompressor(nodes, { threshold: v }))} />
              <Knob label="Ratio" value={values.ratio} min={1} max={8} step={0.5} unit=":1"
                disabled={!manualMix} onChange={update('ratio', (v) => tuneCompressor(nodes, { ratio: v }))} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>SEND</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <Knob label="Gain" value={values.gainDb} min={0} max={12} step={0.5} unit="dB"
              disabled={!manualMix} onChange={update('gainDb', (v) => tuneMakeupGainDb(nodes, v))} />
            <Knob label="Reverb" value={values.reverbMix} min={0} max={0.4} step={0.01} unit=""
              disabled={!manualMix} onChange={update('reverbMix', (v) => tuneReverbMix(nodes, v))} />
          </div>
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
        {manualMix
          ? 'Have someone play/sing at real volume and listen from a separate device while tuning.'
          : 'Going live uses this tested preset. Switch on Manual mix during soundcheck to adjust.'}
      </p>
    </div>
  );
}
