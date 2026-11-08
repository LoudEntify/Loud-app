
"use client";

import {
  Children,
  useEffect,
  useRef,
} from "react";

export default function AutoScrollRow({
  children,
  className = "",
  speed = 25,
  direction = "left",
}) {
  const trackRef = useRef(null);
  const pausedRef = useRef(false);
  const resumeTimerRef = useRef(null);

  const items = Children.toArray(children);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || items.length < 2) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    if (reducedMotion.matches) return;

    let frameId;
    let lastTime = null;

    const getLoopWidth = () => track.scrollWidth / 2;

    const animate = (time) => {
      if (lastTime === null) lastTime = time;

      const delta = Math.min(time - lastTime, 50);
      lastTime = time;

      if (!pausedRef.current) {
        const loopWidth = getLoopWidth();

        if (loopWidth > 0) {
          const movement = (speed * delta) / 1000;

          const next =
            track.scrollLeft +
            (direction === "right" ? -movement : movement);

          track.scrollLeft =
            ((next % loopWidth) + loopWidth) % loopWidth;
        }
      }

      frameId = requestAnimationFrame(animate);
    };

    if (direction === "right") {
      track.scrollLeft = getLoopWidth();
    }

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(resumeTimerRef.current);
    };
  }, [items.length, speed, direction]);

  const pause = () => {
    clearTimeout(resumeTimerRef.current);
    pausedRef.current = true;
  };

  const resume = (delay = 0) => {
    clearTimeout(resumeTimerRef.current);

    if (delay === 0) {
      pausedRef.current = false;
      return;
    }

    resumeTimerRef.current = setTimeout(() => {
      pausedRef.current = false;
    }, delay);
  };

  return (
    <div
      ref={trackRef}
      className={className}
      onMouseEnter={pause}
      onMouseLeave={() => resume()}
      onTouchStart={pause}
      onTouchEnd={() => resume(2500)}
      onTouchCancel={() => resume(2500)}
      onFocusCapture={pause}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resume();
        }
      }}
      aria-label="Scrollable performance collection"
    >
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexShrink: 0,
          width: "max-content",
        }}
      >
        {items}
      </div>

      <div
        aria-hidden="true"
        inert=""
        style={{
          display: "flex",
          gap: "16px",
          flexShrink: 0,
          width: "max-content",
        }}
      >
        {items}
      </div>
    </div>
  );
}
