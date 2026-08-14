'use client';

import { logTap } from '../lib/tapDebug';

// Stage 5 of MULTI_PERFORMER_SPEC.md, generalized for N performer slots,
// then corrected twice more against real feedback: (1) the thumbnail
// row now floats as a transparent absolute overlay on the full-bleed
// active video -- matching this app's own established "every live-
// screen panel is a floating overlay directly on the video" convention
// (BroadcastStage.jsx's own header comment) -- rather than the first
// draft's flex-column layout, which left a solid Ink band showing
// through wherever the row's own padding/gaps weren't covered by a
// tile. (2) the strip IS the switch control now -- one row, one
// meaning -- rather than duplicating the same thumbnails in a separate
// SwipePages tab.
//
// `onSwitch` is only ever passed by the caller for slot 'a''s own
// render (BroadcastStage) -- everyone else gets a display-only strip.
// That's a UI convenience, same as always: the real authorization is
// server-side in /api/show/active-performer, checked against a session
// token regardless of what this component renders.
export default function SpotlightStage({ activeSlot, slots, renderSlot, onSwitch, switching }) {
  const activePresent = slots.includes(activeSlot);
  const others = slots.filter((s) => s !== activeSlot);

  return (
    <div className="spotlight-stage">
      <div className="spotlight-active">
        {activePresent ? (
          renderSlot(activeSlot)()
        ) : (
          <div className="spotlight-reconnecting">
            <span>Reconnecting {activeSlot ? `performer ${activeSlot.toUpperCase()}` : ''}…</span>
          </div>
        )}
      </div>
      {others.length > 0 && (
        <div className="spotlight-thumbnail-row">
          {others.map((slot) => {
            const tile = (
              <div className="spotlight-thumbnail-tile" key={slot}>
                {renderSlot(slot)()}
              </div>
            );
            if (!onSwitch) return tile;
            return (
              <button
                key={slot}
                type="button"
                className="spotlight-thumbnail-tile spotlight-thumbnail-tile--interactive"
                disabled={switching}
                onTouchStart={() => logTap(`[${slot}] touchstart (disabled=${switching})`)}
                onTouchMove={() => logTap(`[${slot}] touchmove (movement detected -- may cancel the click as a scroll gesture)`)}
                onTouchEnd={() => logTap(`[${slot}] touchend`)}
                onPointerDown={() => logTap(`[${slot}] pointerdown`)}
                onPointerUp={() => logTap(`[${slot}] pointerup`)}
                onClick={() => {
                  logTap(`[${slot}] CLICK FIRED -> calling onSwitch`);
                  onSwitch(slot);
                }}
              >
                {renderSlot(slot)()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
