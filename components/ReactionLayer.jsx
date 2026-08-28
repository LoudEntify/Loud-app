'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REACTION_EMOJI, REACTION_MIN_INTERVAL_MS } from '../lib/reactions';

// Reactions, on stage. PRD row 54.
//
// TWO PARTS, and keeping them separate is what makes this feel right:
//
//   THE BAR is a row of six native emoji at the bottom of the stage. One
//   tap, no picker, no confirmation. A reaction is a reflex — anything
//   that turns it into a decision has already lost.
//
//   THE LAYER is where every reaction in the room floats up and fades,
//   yours and everyone else's, indistinguishable from each other. That
//   indistinguishability is deliberate: the feeling being built is "this
//   room is enjoying this", and a UI that highlighted your own would turn
//   a shared moment into a personal receipt.
//
// pointer-events: none on the layer, so the whole thing is invisible to
// the mouse — a reaction floating past must never eat a click meant for
// the video underneath it.
//
// The animation is CSS keyframes with per-reaction randomised drift, set
// once as inline custom properties at creation. Randomising in CSS is not
// possible and randomising per frame in JS would be a re-render per frame
// per reaction; this way each emoji gets its own path and then React
// never touches it again until it is removed.

const LIFETIME_MS = 2600;

export default function ReactionLayer({ reactions = [], onReact, canReact = true, cost = 0 }) {
  const [visible, setVisible] = useState([]);
  const lastTapRef = useRef(0);
  const timersRef = useRef(new Set());

  // New reactions in → animate. Keyed on the reaction's own id, which the
  // sender generates, so the same reaction arriving locally and over the
  // data channel cannot animate twice.
  const seenRef = useRef(new Set());
  useEffect(() => {
    const fresh = reactions.filter((r) => r?.id && !seenRef.current.has(r.id));
    if (fresh.length === 0) return;
    fresh.forEach((r) => seenRef.current.add(r.id));

    // Bounded. Over a two-hour show with an enthusiastic room this set
    // would otherwise grow without limit — a memory leak that scales with
    // how much the audience is enjoying itself, which is a bleakly funny
    // way to run out of memory. The incoming array is itself capped at 60
    // by LiveDemo, so 400 is far more history than can ever be needed to
    // recognise a repeat.
    if (seenRef.current.size > 400) {
      seenRef.current = new Set(Array.from(seenRef.current).slice(-200));
    }

    setVisible((prev) => [
      ...prev,
      ...fresh.map((r) => ({
        ...r,
        // Fixed at creation and never recomputed — see the note above.
        drift: Math.round((Math.random() - 0.5) * 90),
        rise: 180 + Math.round(Math.random() * 120),
        scale: 0.85 + Math.random() * 0.5,
        delay: Math.round(Math.random() * 120),
      })),
    ]);

    fresh.forEach((r) => {
      const t = setTimeout(() => {
        setVisible((prev) => prev.filter((v) => v.id !== r.id));
        timersRef.current.delete(t);
      }, LIFETIME_MS);
      timersRef.current.add(t);
    });
  }, [reactions]);

  // Every pending removal cancelled on unmount. Without this, leaving a
  // show mid-reaction schedules a setState against a component that is
  // gone.
  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const tap = useCallback((emoji) => {
    // Rate limit on the SENDER, which is the only place it can be both
    // effective and free. One person cannot fill everybody else's screen,
    // and the check costs a comparison.
    const now = Date.now();
    if (now - lastTapRef.current < REACTION_MIN_INTERVAL_MS) return;
    lastTapRef.current = now;
    onReact?.(emoji);
  }, [onReact]);

  return (
    <>
      <div className="reaction-layer" aria-hidden="true">
        {visible.map((r) => (
          <span
            key={r.id}
            className="reaction-float"
            style={{
              '--reaction-drift': `${r.drift}px`,
              '--reaction-rise': `${r.rise}px`,
              '--reaction-scale': r.scale,
              animationDelay: `${r.delay}ms`,
            }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {canReact && (
        <div className="reaction-bar">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reaction-btn"
              onClick={() => tap(emoji)}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          {/* Only rendered when reactions actually cost something. A price
              label on a free action is noise; a free action that silently
              charges is worse than either. */}
          {cost > 0 && <span className="reaction-cost">{cost} token{cost === 1 ? '' : 's'}</span>}
        </div>
      )}
    </>
  );
}
