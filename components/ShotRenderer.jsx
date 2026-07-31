// components/ShotRenderer.jsx
// ─────────────────────────────────────────────────────────────
// Applies the active shot's transform to a video element.
// Used inside ViewerStage (and DirectorView programme preview).
//
// Props:
//   track       — LiveKit RemoteVideoTrack (or LocalVideoTrack) to attach
//   command     — the latest SHOT_COMMAND for this slot (or null)
//   className   — passthrough for sizing (the wrapper must have a fixed
//                 aspect box; the video fills it with object-fit: cover)
//
// All transforms are GPU-accelerated CSS (scale/translate). Last
// command wins: a new command immediately replaces any in-flight
// animation. Fades are handled here via a brief opacity dip timed
// to FADE_MS so every viewer agrees.
//
// PRD: Director Experience | S&I: Real-time media
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { SHOT_TYPES, FADE_MS } from '../lib/shotTypes';

// Pan direction → start/end translate offsets (percent of overscan slack)
const PAN_VECTORS = {
  left: { from: [8, 0], to: [-8, 0] },
  right: { from: [-8, 0], to: [8, 0] },
  up: { from: [0, 8], to: [0, -8] },
  down: { from: [0, -8], to: [0, 8] },
};

export default function ShotRenderer({ track, command, className = '' }) {
  const videoRef = useRef(null);
  const [style, setStyle] = useState({});
  const [faded, setFaded] = useState(false);
  const rafRef = useRef(null);

  // Attach / detach the LiveKit track
  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  // Apply the shot transform whenever a new command lands
  useEffect(() => {
    if (!command) {
      setStyle({});
      return;
    }

    const shot = SHOT_TYPES[command.shot];
    if (!shot) return;

    // Cancel any scheduled animation kick from a previous command
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    // Fade handling: dip opacity, swap transform at the midpoint
    const applyWithTransition = (fn) => {
      if (command.transition === 'fade') {
        setFaded(true);
        setTimeout(() => {
          fn();
          setFaded(false);
        }, FADE_MS / 2);
      } else {
        fn();
      }
    };

    const t = shot.transform;

    // No transform (wide, follow) → reset
    if (!t || (t.optional && !command.params?.vertigo)) {
      applyWithTransition(() =>
        setStyle({ transform: 'scale(1)', transition: 'none' })
      );
      return;
    }

    if (t.kind === 'crop') {
      applyWithTransition(() =>
        setStyle({
          transform: `scale(${t.scale})`,
          transformOrigin: `${t.originX}% ${t.originY}%`,
          transition: 'none', // static crops snap — they are framings, not moves
        })
      );
      return;
    }

    if (t.kind === 'animatedZoom') {
      applyWithTransition(() => {
        // Set start state with no transition, then kick the animation
        setStyle({
          transform: `scale(${t.from})`,
          transformOrigin: `${t.originX}% ${t.originY}%`,
          transition: 'none',
        });
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            setStyle({
              transform: `scale(${t.to})`,
              transformOrigin: `${t.originX}% ${t.originY}%`,
              transition: `transform ${t.durationMs}ms ${t.easing}`,
            });
          });
        });
      });
      return;
    }

    if (t.kind === 'animatedPan') {
      const dir = command.params?.direction || t.direction;
      const vec = PAN_VECTORS[dir] || PAN_VECTORS.left;
      applyWithTransition(() => {
        setStyle({
          transform: `scale(${t.overscan}) translate(${vec.from[0]}%, ${vec.from[1]}%)`,
          transition: 'none',
        });
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            setStyle({
              transform: `scale(${t.overscan}) translate(${vec.to[0]}%, ${vec.to[1]}%)`,
              transition: `transform ${t.durationMs}ms ${t.easing}`,
            });
          });
        });
      });
      return;
    }

    // hardCutSequence never reaches here — the sequencer emits
    // concrete static-shot commands, so viewers only ever see
    // wide/closeUp/bRoll cuts.
  }, [command]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  return (
    <div
      className={className}
      style={{
        overflow: 'hidden',          // crops/overscan must clip
        position: 'relative',
        background: '#011627',       // Ink Black under fades
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: faded ? 0 : 1,
          transition: `opacity ${FADE_MS / 2}ms ease`,
          willChange: 'transform, opacity',
          ...style,
        }}
      />
    </div>
  );
}
