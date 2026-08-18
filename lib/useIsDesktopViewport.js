// lib/useIsDesktopViewport.js
// ─────────────────────────────────────────────────────────────
// Desktop portrait stage -- backs the ONE JS-level layout branch this
// feature needs (BroadcastStage.jsx choosing which wrapper structure
// holds DirectorShotPanel/AudioDeckPanel/VideoDeckPanel: today's mobile
// SwipePages deck, or the desktop side columns). Still CSS-first, not
// user-agent sniffing -- the source of truth is a real CSS media
// feature (window.matchMedia), the exact same 1025px breakpoint
// reactions.css already uses, just read via JS so React can pick a
// single render branch instead of mounting both.
//
// Deliberately NOT used for the centred-stage/blur-fill treatment
// itself (components/BlurFillBackground.jsx, reactions.css's .stage-root
// override) -- those are pure CSS with no interactive/side-effecting
// content to worry about duplicating. This hook exists specifically for
// the one case where mounting both branches at once would risk two live
// instances of something that can talk to the room (DirectorShotPanel's
// staccato sequencer, the camfeed picker's active-performer switch).
//
// PRD: Multi-Camera & Production | S&I: none (display-only, no new
// server/LiveKit state)
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1025px)';

export function useIsDesktopViewport() {
  // Lazy init reads matchMedia synchronously on the client so the first
  // real render already has the right answer (no mobile->desktop flash
  // on load) -- SSR-safe via the typeof guard, matching this app's
  // existing convention for window-dependent lazy state (e.g.
  // LiveDemo.jsx's canUseFullscreenApi).
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setIsDesktop(e.matches);
    // addEventListener over the deprecated addListener -- this app's
    // target browsers (confirmed via the rest of the codebase's own
    // feature-detects, e.g. requestVideoFrameCallback usage in
    // ShotRendering.jsx) are all modern enough not to need the fallback.
    mql.addEventListener('change', onChange);
    setIsDesktop(mql.matches); // re-sync in case it changed between lazy-init and mount
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
