'use client';

import { useEffect, useRef } from 'react';

const METER_HEIGHT = 120;
const MIN_DB = -60; // meter floor -- quieter than this reads as empty
const MAX_DB = 0;   // 0dB = digital ceiling, meter reads full at this point

// A vertical level meter (real-time, reads from a Web Audio AnalyserNode)
// paired with a vertical gain slider. Used for both the input meter
// (mic level going into processing) and the output meter (final level
// being published) -- same component, different analyser/gain node.
// Named zone thresholds (dB) -- shared by the bar color and the word label
// below it, so "what the color means" is never left for the artist to
// infer from a bare traffic-light convention alone.
const TOO_QUIET_MAX_DB = -36;
const HEALTHY_MAX_DB = -12;
const HOT_MAX_DB = -3;

function zoneFor(db) {
  if (db > HOT_MAX_DB) return { label: 'Clipping', color: '#e71d36' };
  if (db > HEALTHY_MAX_DB) return { label: 'Hot -- pull back', color: '#ff9f1c' };
  if (db > TOO_QUIET_MAX_DB) return { label: 'Healthy', color: '#2ec4b6' };
  return { label: 'Too quiet', color: '#55544f' };
}

export default function LevelMeterFader({ label, analyser, gainDb, onChangeGainDb, minDb = -24, maxDb = 12 }) {
  const barRef = useRef(null);
  const rafRef = useRef(null);
  const zoneLabelRef = useRef(null);

  useEffect(() => {
    if (!analyser) return;
    const buffer = new Float32Array(analyser.fftSize);

    function tick() {
      analyser.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) sumSquares += buffer[i] * buffer[i];
      const rms = Math.sqrt(sumSquares / buffer.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB;
      const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
      const pct = ((clamped - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
      const zone = zoneFor(clamped);

      if (barRef.current) {
        barRef.current.style.height = `${pct}%`;
        barRef.current.style.background = zone.color;
      }
      if (zoneLabelRef.current) {
        zoneLabelRef.current.textContent = zone.label;
        zoneLabelRef.current.style.color = zone.color;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#B4B2A9', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ width: 14, height: METER_HEIGHT, background: '#1a1a19', borderRadius: 4, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
          <div ref={barRef} style={{ width: '100%', height: '0%', background: '#2ec4b6', transition: 'background 0.1s linear' }} />
        </div>
        <div style={{ height: METER_HEIGHT, display: 'flex', alignItems: 'center' }}>
          <input
            type="range"
            min={minDb}
            max={maxDb}
            step={0.5}
            value={gainDb}
            onChange={(e) => onChangeGainDb(Number(e.target.value))}
            style={{
              width: METER_HEIGHT,
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
            }}
          />
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fdfffc' }}>{gainDb > 0 ? '+' : ''}{gainDb}dB</span>
      <span ref={zoneLabelRef} style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }} />
    </div>
  );
}
