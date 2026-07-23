'use client';

import { useEffect, useRef, useState } from 'react';

const MAX_CONCURRENT = 10;
const RISE_DURATION_MS = 2200;

// ReactionStream renders the Google-Meet-style rising icons. Call
// streamRef.current.push(emoji) whenever a reaction data message arrives
// from LiveKit — this component doesn't know about LiveKit itself, it just
// renders whatever it's told to.
export default function ReactionStream({ streamRef }) {
  const [icons, setIcons] = useState([]);
  const idCounter = useRef(0);

  useEffect(() => {
    if (streamRef) {
      streamRef.current = {
        push(emoji) {
          setIcons((prev) => {
            const next = [
              ...prev,
              {
                id: idCounter.current++,
                emoji,
                left: 20 + Math.random() * 60, // percent
                wander: Math.round((Math.random() - 0.5) * 60), // px
              },
            ];
            return next.slice(-MAX_CONCURRENT);
          });
        },
      };
    }
  }, [streamRef]);

  useEffect(() => {
    if (icons.length === 0) return;
    const timer = setTimeout(() => {
      setIcons((prev) => prev.slice(1));
    }, RISE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [icons]);

  return (
    <div className="reaction-stream">
      {icons.map((icon) => (
        <span
          key={icon.id}
          className="floating-icon"
          style={{
            left: `${icon.left}%`,
            '--wander': `${icon.wander}px`,
            animationDuration: `${RISE_DURATION_MS}ms`,
          }}
        >
          {icon.emoji}
        </span>
      ))}
    </div>
  );
}

// GoLoudBurst is a separate, one-off full-screen event — deliberately not
// part of the rising stream above, since it represents a single collective
// moment rather than an individual reaction.
export function GoLoudBurst({ triggerKey }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (triggerKey === undefined || triggerKey === null) return;
    setActive(true);
    if (navigator.vibrate) navigator.vibrate(200);
    const timer = setTimeout(() => setActive(false), 700);
    return () => clearTimeout(timer);
  }, [triggerKey]);

  if (!active) return null;

  return (
    <div className="go-loud-overlay">
      <div className="go-loud-burst">L</div>
    </div>
  );
}
