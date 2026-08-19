'use client';

// components/CueEditorPanel.jsx
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director (CD-3) -- the per-cue editing UI. Rendered inside
// AudioDeckPanel, right after BackingTrackPanel (which owns the waveform
// + cue markers + the "Drop cue" action). This component is the
// "refine" half of the place-then-refine flow: pick a shot, motion,
// slot_role, and fine-tune the timing for whichever cue is selected,
// then Save.
//
// Purely presentational -- all cue state (the array, load/save network
// calls, trackHash/artistEmail) lives in AudioDeckPanel, which is the
// natural owner since BackingTrackPanel and this panel are siblings that
// both need the same cues array (markers on one side, the editor on the
// other).
//
// PRD: Cue-Sheet Director CD-3
// ─────────────────────────────────────────────────────────────

import { SHOT_TYPES, CUE_EDITOR_SHOT_KEYS, shotFamilyColor } from '../lib/shotTypes';
import { SLOT_ROLES, FALLBACK_BEHAVIOURS, MOTION_SCALE_CEILING } from '../lib/cueSheetValidation';

const NUDGE_STEPS_MS = [-1000, -100, 100, 1000];

function formatMs(ms) {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = (totalSeconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

const selectStyle = {
  background: '#1a1a19',
  color: '#fdfffc',
  border: '1px solid #3a3a37',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
};

const btnStyle = {
  background: '#1a1a19',
  color: '#fdfffc',
  border: '1px solid #3a3a37',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

export default function CueEditorPanel({
  trackReady,
  cues,
  activeCueId,
  fallbackBehaviour,
  dirty,
  saving,
  saveError,
  onSelectCue,
  onUpdateCue,
  onDeleteCue,
  onChangeFallbackBehaviour,
  onSave,
}) {
  if (!trackReady) return null;

  const sortedCues = [...cues].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const activeCue = cues.find((c) => c.id === activeCueId) || null;
  const activeShot = activeCue ? SHOT_TYPES[activeCue.shot_type] : null;
  const activeCategory = activeShot?.category;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          Cue sheet ({cues.length} cue{cues.length === 1 ? '' : 's'})
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: saveError ? '#e71d36' : dirty ? '#ff9f1c' : '#2ec4b6' }}>
            {saveError ? saveError : saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <button className="control-btn" onClick={onSave} disabled={saving || !dirty}>
            Save
          </button>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#B4B2A9' }}>
        Between/after cues
        <select
          value={fallbackBehaviour}
          onChange={(e) => onChangeFallbackBehaviour(e.target.value)}
          style={selectStyle}
        >
          {FALLBACK_BEHAVIOURS.map((v) => (
            <option key={v} value={v}>{v.replace('_', ' ')}</option>
          ))}
        </select>
      </label>

      {sortedCues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
          {sortedCues.map((cue) => {
            const isActive = cue.id === activeCueId;
            const color = shotFamilyColor(cue.shot_type);
            return (
              <div
                key={cue.id}
                onClick={() => onSelectCue(cue.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: isActive ? `${color}22` : 'transparent',
                  border: `1px solid ${isActive ? color : 'transparent'}`,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#fdfffc', fontVariantNumeric: 'tabular-nums' }}>{formatMs(cue.timestamp_ms)}</span>
                <span style={{ fontSize: 12, color: '#B4B2A9' }}>{SHOT_TYPES[cue.shot_type]?.label || cue.shot_type}</span>
                <span style={{ fontSize: 11, color: '#55544f' }}>· {cue.slot_role}</span>
              </div>
            );
          })}
        </div>
      )}

      {activeCue && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 8, border: `1px solid ${shotFamilyColor(activeCue.shot_type)}66`, background: '#1a1a19' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#fdfffc', fontVariantNumeric: 'tabular-nums' }}>{formatMs(activeCue.timestamp_ms)}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {NUDGE_STEPS_MS.map((step) => (
                <button
                  key={step}
                  style={btnStyle}
                  onClick={() => onUpdateCue(activeCue.id, {
                    timestamp_ms: Math.max(0, activeCue.timestamp_ms + step),
                  })}
                >
                  {step > 0 ? `+${step}ms` : `${step}ms`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B2A9' }}>
              Shot
              <select
                value={activeCue.shot_type}
                onChange={(e) => onUpdateCue(activeCue.id, { shot_type: e.target.value, motion: undefined })}
                style={selectStyle}
              >
                {CUE_EDITOR_SHOT_KEYS.map((key) => (
                  <option key={key} value={key}>{SHOT_TYPES[key].label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B2A9' }}>
              Role
              <select
                value={activeCue.slot_role}
                onChange={(e) => onUpdateCue(activeCue.id, { slot_role: e.target.value })}
                style={selectStyle}
              >
                {SLOT_ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>

            {activeCue.shot_type === 'pan' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B2A9' }}>
                Direction
                <select
                  value={activeCue.motion?.direction || SHOT_TYPES.pan.paramOptions.direction[0]}
                  onChange={(e) => onUpdateCue(activeCue.id, { motion: { ...activeCue.motion, direction: e.target.value } })}
                  style={selectStyle}
                >
                  {SHOT_TYPES.pan.paramOptions.direction.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
            )}

            {activeCue.shot_type === 'dolly' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B2A9', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!activeCue.motion?.vertigo}
                  onChange={(e) => onUpdateCue(activeCue.id, { motion: { ...activeCue.motion, vertigo: e.target.checked } })}
                />
                Vertigo
              </label>
            )}

            {(activeCategory === 'moving' || activeCategory === 'physical') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B2A9' }}>
                Scale (≤ {MOTION_SCALE_CEILING}x)
                <input
                  type="number"
                  min={0.1}
                  max={MOTION_SCALE_CEILING}
                  step={0.05}
                  value={activeCue.motion?.scale ?? ''}
                  placeholder="default"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      const { scale, ...rest } = activeCue.motion || {};
                      onUpdateCue(activeCue.id, { motion: Object.keys(rest).length ? rest : undefined });
                      return;
                    }
                    const clamped = Math.min(MOTION_SCALE_CEILING, Math.max(0.1, Number(raw)));
                    onUpdateCue(activeCue.id, { motion: { ...activeCue.motion, scale: clamped } });
                  }}
                  style={{ ...selectStyle, width: 60 }}
                />
              </label>
            )}

            <button style={{ ...btnStyle, color: '#e71d36', borderColor: '#e71d36', marginLeft: 'auto' }} onClick={() => onDeleteCue(activeCue.id)}>
              Delete
            </button>
          </div>
        </div>
      )}

      {cues.length === 0 && (
        <p style={{ fontSize: 11, color: '#55544f', margin: 0 }}>
          Press Play or Pause on the track above, then "Drop cue" to place your first cue at the playhead.
        </p>
      )}
    </div>
  );
}
