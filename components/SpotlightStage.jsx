'use client';

import { useState, useEffect } from 'react';

// Deliberately duplicated from VersusSplit.jsx's own useOrientation(),
// not imported/exported from it -- MULTI_PERFORMER_SPEC.md's locked
// decision keeps VersusSplit untouched. Same pointer:coarse-gated
// detection, same reason a `forceOrientation` override exists below
// (see EgressPage.jsx's own use of the equivalent VersusSplit prop):
// a headless/fine-pointer browser (LiveKit's Egress renderer) always
// resolves 'landscape' here regardless of the real canvas shape.
function useOrientation() {
  const getOrientation = () => {
    if (typeof window === 'undefined') return 'landscape';
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) return 'landscape';
    return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
  };
  const [orientation, setOrientation] = useState(getOrientation);
  useEffect(() => {
    const update = () => setOrientation(getOrientation());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return orientation;
}

// Stage 5 of MULTI_PERFORMER_SPEC.md -- active performer large, the
// other as a ~quarter-screen thumbnail. Desktop: side-by-side (flex
// row, large:small ~3:1). Mobile: stacked, with the other performer as
// a compact fixed-height strip rather than a proportional split -- a
// tiny row reads as "thumbnail"; a scaled-down full pane doesn't.
//
// Reuses renderA/renderB (each caller's own renderSlot(letter)
// closure) completely unmodified -- same director/shot-cut pipeline
// underneath (ShotVideo/ShotFadeLayer), this component only decides
// which slot gets the big box, never how that slot's own video renders.
export default function SpotlightStage({ activeSlot, renderA, renderB, forceOrientation }) {
  const detectedOrientation = useOrientation();
  const orientation = forceOrientation || detectedOrientation;
  const renderActive = activeSlot === 'b' ? renderB : renderA;
  const renderOther = activeSlot === 'b' ? renderA : renderB;

  return (
    <div className={`spotlight-stage ${orientation}`}>
      <div className="spotlight-active">{renderActive()}</div>
      <div className="spotlight-thumbnail">{renderOther()}</div>
    </div>
  );
}
