// components/DirectorShotPanel.jsx
// ─────────────────────────────────────────────────────────────
// One-tap shot console for DirectorView.
//
// Every tap = one SHOT_COMMAND broadcast + one flywheel row.
// Transitions are resolved by the rules engine — the director
// never sees a transition control. Staccato is a toggled mode
// (exclusive): starting it should pause your auto-rotate timer
// via the onExclusiveMode callback; stopping resumes it.
//
// Props:
//   room            — connected LiveKit Room
//   showId          — current show id
//   slot            — performer slot this panel controls ('A' | 'B')
//   availableRoles  — roles currently publishing for the slot,
//                     e.g. ['wide','close','side']
//   tracks          — live track list (for resolveTargetIdentity) --
//                     read fresh on every tap/cut, never cached
//   onExclusiveMode — (isExclusive: boolean) => void
//                     called true when staccato starts, false on stop.
//                     Wire this to pause/resume the auto-rotate timer.
//   onCommand       — optional (command) => void, fires after each
//                     broadcast (use to drive the local programme preview)
//   mode            — 'manual' | 'auto' | 'cue' (CD-4's three-state
//                     control, replaces the old Auto on/off toggle)
//   onModeChange    — (next: 'manual'|'auto'|'cue') => void
//   cueModeAvailable — whether a saved cue sheet exists for the
//                     currently loaded track -- gates the Cue segment
//   autoState       — 'running' | 'suspended' | 'off', display only:
//                     drives the small "suspended" sub-label on the Auto
//                     segment while staccato holds it (mode itself
//                     already shows which of the three is active)
//
// PRD: Director Experience | S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { SHOT_TYPES, resolveSourceRole } from '../lib/shotTypes';
import {
  buildShotCommand,
  broadcastShotCommand,
  createStaccatoSequencer,
  resolveTargetIdentity,
} from '../lib/shotCommands';

// Loudentify palette — Ink Black base, Porcelain text,
// Teal = live/selected, Orange = running mode, Red = stop states.
const C = {
  ink: '#011627',
  porcelain: '#fdfffc',
  teal: '#2ec4b6',
  red: '#e71d36',
  orange: '#ff9f1c',
};

const GROUPS = [
  { title: 'Static', keys: ['wide', 'mediumCU', 'closeUp', 'bRoll'] },
  { title: 'Moving', keys: ['zoomIn', 'zoomOut', 'pan'] },
  { title: 'Camera Op', keys: ['dolly', 'follow'] },
  { title: 'Mode', keys: ['staccato'] },
];

// CD-4: Manual/Auto/Cue are three top-level modes, not a togglable
// overlay -- this replaces the old single AUTO/AUTO·COOLDOWN/AUTO·
// SUSPENDED/AUTO·OFF button. 'cooldown' no longer exists as a state
// (lib/autoDirector.js dropped the fixed-cooldown override mechanism --
// a human tap now just gets silently overwritten by auto's own
// already-scheduled next cut, no separate hold window to display).
const MODES = ['manual', 'auto', 'cue'];
const MODE_LABELS = { manual: 'Manual', auto: 'Auto', cue: 'Cue' };

export default function DirectorShotPanel({
  room,
  showId,
  slot,
  availableRoles = [],
  tracks = [],
  showPhase = 'live', // 'soundcheck' | 'live' -- tags every command this panel fires
  onExclusiveMode,
  onCommand,
  mode = 'auto',
  onModeChange,
  cueModeAvailable = false,
  autoState = 'off', // 'running' | 'suspended' | 'off' -- display only, see prop doc above
}) {
  const [activeShot, setActiveShot] = useState(null);
  const [staccatoOn, setStaccatoOn] = useState(false);
  const [panDirection, setPanDirection] = useState('left');
  const lastShotRef = useRef(null);

  // Kept in sync every render but read via .current inside the
  // sequencer's resolveTarget closure below, so a camera dropping or
  // joining mid-staccato is picked up on the NEXT cut without having to
  // recreate (and thereby interrupt) the running sequencer.
  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Same live-read pattern as tracksRef -- a staccato run spanning the
  // soundcheck->live boundary should tag each cut with whatever phase is
  // current at that moment, not whatever it was when the sequencer (or
  // the run) started.
  const showPhaseRef = useRef(showPhase);
  useEffect(() => {
    showPhaseRef.current = showPhase;
  }, [showPhase]);

  const sequencer = useMemo(
    () =>
      room
        ? createStaccatoSequencer({
            room,
            showId,
            slot,
            availableRoles,
            resolveTarget: (role) => resolveTargetIdentity(tracksRef.current, slot, role),
            showPhase: () => showPhaseRef.current,
          })
        : null,
    [room, showId, slot, availableRoles]
  );

  // Safety: kill the sequencer if the panel unmounts mid-mode
  useEffect(() => () => sequencer?.stop(), [sequencer]);

  const fire = useCallback(
    async (shotKey, params = {}) => {
      if (!room) return;
      // CD-4: a human tap needs no notification call anywhere anymore --
      // it broadcasts immediately below like always, and whichever
      // automatic mode is active (auto or cue) simply overwrites it at
      // its own next already-scheduled decision. See lib/autoDirector.js's
      // rule-of-engagement note.

      // Any direct shot tap while staccato runs = intent to leave the mode
      if (staccatoOn && shotKey !== 'staccato') {
        sequencer?.stop();
        setStaccatoOn(false);
        onExclusiveMode?.(false);
      }

      if (shotKey === 'staccato') {
        if (staccatoOn) {
          sequencer?.stop();
          setStaccatoOn(false);
          onExclusiveMode?.(false);
        } else {
          onExclusiveMode?.(true); // pause auto-rotate BEFORE the first auto cut
          sequencer?.start();
          setStaccatoOn(true);
        }
        setActiveShot(staccatoOn ? null : 'staccato');
        return;
      }

      const sourceRole = resolveSourceRole(
        shotKey,
        availableRoles,
        lastShotRef.current
          ? SHOT_TYPES[lastShotRef.current]?.source?.[0]
          : null
      );

      // Resolved from the live `tracks` prop at tap time, never from
      // stale state -- the same per-cut resolution pattern as the
      // sequencer above.
      const targetIdentity = resolveTargetIdentity(tracks, slot, sourceRole);

      const command = buildShotCommand({
        showId,
        slot,
        shotKey,
        fromShotKey: lastShotRef.current, // negative signal for the flywheel
        sourceRole,
        targetIdentity,
        params,
        decisionSource: 'human', // gold label
        showPhase,
        availableRoles, // flywheel context (L6-5) -- already a prop, captured at fire time
      });

      lastShotRef.current = shotKey;
      setActiveShot(shotKey);
      await broadcastShotCommand(room, command);
      onCommand?.(command);
    },
    [room, showId, slot, availableRoles, tracks, showPhase, staccatoOn, sequencer, onExclusiveMode, onCommand]
  );

  // Build 3c -- fully transparent, floating directly on the video inside
  // .director-panel-body (reactions.css); legibility comes from the
  // shared text halo (var(--text-halo)) on every plain label here,
  // layered UNDER each element's own existing accent-color glow rather
  // than replacing it -- the halo is what survives against a bright/
  // white video frame, the colored glow on top is what makes it read as
  // teal/orange/etc rather than plain white. The shot buttons below
  // already used exactly this transparent + border/glow pattern before
  // this build -- reused as-is, untouched, the precedent this whole
  // build generalizes from.
  return (
    <div
      style={{
        background: 'transparent',
        color: C.porcelain,
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontSize: 12, letterSpacing: 1.5, opacity: 0.6, textShadow: 'var(--text-halo)' }}>
          SHOTS — SLOT {slot}
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          {staccatoOn && (
            <span
              style={{
                fontSize: 11,
                color: C.orange,
                textShadow: 'var(--text-halo), 0 0 8px rgba(255, 159, 28, 0.55)', // mild neon per brand rule, halo underneath
              }}
            >
              ● STACCATO RUNNING
            </span>
          )}
          {/* CD-4: Manual/Auto/Cue -- three mutually exclusive modes, not
              a togglable overlay. Same transparent + glow-border language
              as the shot buttons below (isActive -> teal). Cue is
              disabled (not hidden) with a hint when no saved sheet exists
              for the currently loaded track. */}
          <div style={{ display: 'flex', gap: 4 }}>
            {MODES.map((m) => {
              const isActive = mode === m;
              const isCueDisabled = m === 'cue' && !cueModeAvailable;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={isCueDisabled}
                  onClick={() => onModeChange?.(m)}
                  title={isCueDisabled ? 'Save a cue sheet for this track to enable Cue mode' : undefined}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 6,
                    border: `1.5px solid ${isActive ? C.teal : '#fdfffc22'}`,
                    background: isActive ? `${C.teal}22` : 'transparent',
                    boxShadow: isActive ? `0 0 8px ${C.teal}66` : 'none',
                    color: isCueDisabled ? '#fdfffc44' : C.porcelain,
                    textShadow: 'var(--text-halo)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 1,
                    cursor: isCueDisabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {MODE_LABELS[m]}
                  {m === 'auto' && mode === 'auto' && autoState === 'suspended' ? ' · suspended' : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <div style={{ fontSize: 10, opacity: 0.45, marginBottom: 6, letterSpacing: 1, textShadow: 'var(--text-halo)' }}>
            {group.title.toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {group.keys.map((key) => {
              const shot = SHOT_TYPES[key];
              const isActive = activeShot === key;
              const isStaccatoBtn = key === 'staccato';
              const disabled =
                !isStaccatoBtn &&
                shot.source !== 'currentOrSelected' &&
                Array.isArray(shot.source) &&
                !shot.source.some((r) => availableRoles.includes(r));

              const activeColor = isStaccatoBtn && staccatoOn ? C.orange : C.teal;

              return (
                <button
                  key={key}
                  onClick={() =>
                    fire(key, key === 'pan' ? { direction: panDirection } : {})
                  }
                  disabled={disabled}
                  style={{
                    padding: '10px 14px',
                    minWidth: 84,
                    borderRadius: 8,
                    border: `1.5px solid ${isActive ? activeColor : '#fdfffc22'}`,
                    background: isActive ? `${activeColor}22` : 'transparent',
                    color: disabled ? '#fdfffc44' : C.porcelain,
                    textShadow: 'var(--text-halo)',
                    boxShadow: isActive ? `0 0 10px ${activeColor}66` : 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 120ms ease',
                    touchAction: 'manipulation', // no double-tap zoom on mobile
                  }}
                >
                  {isStaccatoBtn && staccatoOn ? 'Stop' : shot.label}
                </button>
              );
            })}

            {/* Pan direction selector, only shown alongside the Moving group.
                Build 3c: the CLOSED trigger gets the same transparent +
                glow-border treatment as everything else -- but the OPEN
                dropdown list is native OS chrome, not stylable from CSS
                in most browsers, and will show default (usually opaque)
                OS styling regardless of what's set here. A web-platform
                limit, not an oversight. */}
            {group.title === 'Moving' && (
              <select
                value={panDirection}
                onChange={(e) => setPanDirection(e.target.value)}
                style={{
                  background: 'transparent',
                  color: C.porcelain,
                  textShadow: 'var(--text-halo)',
                  border: '1.5px solid rgba(46, 196, 182, 0.4)',
                  boxShadow: '0 0 8px rgba(46, 196, 182, 0.2)',
                  borderRadius: 8,
                  padding: '0 10px',
                  fontSize: 12,
                }}
                aria-label="Pan direction"
              >
                {SHOT_TYPES.pan.paramOptions.direction.map((d) => (
                  <option key={d} value={d}>
                    Pan {d}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
