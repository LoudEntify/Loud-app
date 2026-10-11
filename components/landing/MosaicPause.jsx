'use client';
// components/landing/MosaicPause.jsx — pauses every landing animation while
// the tab is hidden. One listener, one attribute toggle; the stylesheet
// does the rest (animation-play-state). No React state, no loop.
import { useEffect } from 'react';

export default function MosaicPause() {
  useEffect(() => {
    const root = document.querySelector('.lm-root');
    if (!root) return undefined;
    const sync = () => { if (document.hidden) root.setAttribute('data-paused', ''); else root.removeAttribute('data-paused'); };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); root.removeAttribute('data-paused'); };
  }, []);
  return null;
}
