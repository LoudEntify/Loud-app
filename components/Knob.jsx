'use client';

import { useRef, useCallback } from 'react';

// A reusable rotary knob control, DAW-style: drag vertically to change the
// value (standard convention -- up increases, down decreases), a 270-degree
// sweep with tick marks, and a live numeric readout so the performer always
// sees exactly what measure they're on while tuning, not just a dial angle.
export default function Knob({
  label, value, min, max, step = 1, unit = '', onChange, disabled = false, size = 64,
}) {
  const dragState = useRef(null);

  const valueToAngle = (v) => {
    const frac = (v - min) / (max - min);
    return -135 + frac * 270; // -135deg to +135deg sweep
  };

  const onPointerDown = useCallback((e) => {
    if (disabled) return;
    dragState.current = { startY: e.clientY, startValue: value };
    e.target.setPointerCapture?.(e.pointerId);
  }, [disabled, value]);

  const onPointerMove = useCallback((e) => {
    if (!dragState.current || disabled) return;
    const deltaY = dragState.current.startY - e.clientY; // up = positive
    const range = max - min;
    const sensitivity = range / 150; // 150px drag = full range
    let next = dragState.current.startValue + deltaY * sensitivity;
    next = Math.round(next / step) * step;
    next = Math.max(min, Math.min(max, next));
    onChange(next);
  }, [disabled, min, max, step, onChange]);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const angle = valueToAngle(value);
  const ticks = Array.from({ length: 11 }, (_, i) => -135 + i * 27);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#B4B2A9', textTransform: 'uppercase', textAlign: 'center', minHeight: 24 }}>
        {label}
      </div>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none' }}
      >
        {/* Tick marks around the sweep */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1="50" y1="8" x2="50" y2="14"
            stroke="#55544f"
            strokeWidth="2"
            transform={`rotate(${t} 50 50)`}
          />
        ))}
        {/* Knob body */}
        <circle cx="50" cy="50" r="32" fill="#1a1a19" stroke="#3a3a37" strokeWidth="2" />
        {/* Pointer indicator */}
        <line
          x1="50" y1="50" x2="50" y2="22"
          stroke="#2ec4b6"
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${angle} 50 50)`}
        />
        <circle cx="50" cy="50" r="4" fill="#2ec4b6" />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#fdfffc' }}>
        {value}{unit}
      </div>
    </div>
  );
}
