'use client';

import { useEffect, useRef } from 'react';

const METER_HEIGHT = 120;
const MIN_DB = -60; // meter floor -- quieter than this reads as empty
const MAX_DB = 0;   // 0dB = digital ceiling, meter reads full at this point

// A vertical level meter (real-time, reads from a Web Audio AnalyserNode)
// paired with a vertical gain slider. Used for both the input meter
// (mic level going into processing) and the output meter (final level
// being published) -- same component, different analyser/gain node.
export default function LevelMeterFader({ label, analyser, gainDb, onChangeGainDb, minDb = -24, maxDb = 12 }) {
  const barRef = useRef(null);
  const rafRef = useRef(null);

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

      if (barRef.current) {
        barRef.current.style.height = `${pct}%`;
        // Green under -6dB, amber approaching 0, red right at the ceiling --
        // standard traffic-light convention so clipping is obvious at a glance.
        barRef.current.style.background = clamped > -3 ? '#e71d36' : clamped > -12 ? '#ff9f1c' : '#2ec4b6';
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
    </div>
  );
}
