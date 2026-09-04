'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';

// Stage 5 of MULTI_PERFORMER_SPEC.md, generalized for N performer slots,
// then corrected against real feedback twice more: (1) the thumbnail
// row floats as a transparent absolute overlay on the full-bleed active
// video -- matching this app's own established "every live-screen panel
// is a floating overlay directly on the video" convention -- rather
// than a flex-column layout that left a solid Ink band showing through.
// (2) the strip IS the switch control -- one row, one meaning, no
// duplicate thumbnails in a separate deck tab.
//
// `onSwitch` is only ever passed by the caller for slot 'a''s own
// render (BroadcastStage) -- everyone else gets a display-only strip.
// That's a UI convenience, same as always: the real authorization is
// server-side in /api/show/active-performer.
//
// `collapsed`/`onToggleCollapse` (mobile declutter fix) -- same
// optionality convention as onSwitch: only BroadcastStage passes these
// (ViewerStage doesn't), so the collapse arrow/reveal tab only ever
// exist for performers, matching "viewers get only comments+menu
// collapsible". Collapsing to the LEFT edge is deliberately paired with
// device controls collapsing to the RIGHT (BroadcastStage.jsx) -- the
// two groups sharing one bottom band, each with its own edge, is what
// removes the z-index collision with .stage-mic-cam that was silently
// swallowing every tap on a tile (the actual root cause, confirmed via
// elementsFromPoint before this fix, not guessed).
// ── ⚠️ NO LONGER ROUTED TO (round 3, Versus) ─────────────────
// Versus now renders as a SPLIT — both performers on screen at once, at
// whatever ratio each participant has dragged their own divider to
// (components/VersusSplit.jsx). This file is not rendered by
// BroadcastStage, ViewerStage or EgressPage any more.
//
// Why the layout changed: the spotlight sized one performer larger than
// the other, and in a battle that reads as a verdict — most damagingly
// in the RECORDING, which outlives the show and gets watched by people
// who were not there. Who is currently performing is now shown by a teal
// border driven by mic state, which cannot fight a viewer's own split
// setting the way size did.
//
// Kept rather than deleted, deliberately and in a separate change from
// the routing switch: the spotlight is still the right shape if this
// ever grows past two performers, where a split stops working.
export default function SpotlightStage({ activeSlot, slots, renderSlot, onSwitch, switching, collapsed, onToggleCollapse, reconnectingPlaceholder, showEnded }) {
  const activePresent = slots.includes(activeSlot);
  const others = slots.filter((s) => s !== activeSlot);

  return (
    <div className="spotlight-stage">
      <div className="spotlight-active">
        {activePresent ? (
          renderSlot(activeSlot)()
        ) : (
          // `reconnectingPlaceholder` (Finding 4, egress half) overrides
          // the text entirely. EgressPage passes the clean Ink fill: this
          // string is UI chrome, and burning "Reconnecting performer A…"
          // into a recording is exactly what the egress template exists
          // to prevent. Live surfaces keep the default.
          reconnectingPlaceholder ?? (
            <div className="spotlight-reconnecting">
              {/* Finding 4, live half -- an absent active performer means
                  two completely different things depending on whether the
                  show is over. Without showEnded this component can only
                  see "their tracks are gone" and always guessed
                  "reconnecting", so End Show read to the other performer
                  as A having dropped out. */}
              <span>
                {showEnded
                  ? 'Show ended'
                  : `Reconnecting ${activeSlot ? `performer ${activeSlot.toUpperCase()}` : ''}…`}
              </span>
            </div>
          )
        )}
      </div>
      {others.length > 0 && (
        <div className={`spotlight-thumbnail-row ${collapsed ? 'spotlight-thumbnail-row--collapsed' : ''}`}>
          {onToggleCollapse && (
            <button
              type="button"
              className="spotlight-feeds-collapse-btn"
              onClick={onToggleCollapse}
              aria-label="hide performer feeds"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
          )}
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
                onClick={() => onSwitch(slot)}
              >
                {renderSlot(slot)()}
              </button>
            );
          })}
        </div>
      )}
      {collapsed && others.length > 0 && onToggleCollapse && (
        <button
          type="button"
          className="spotlight-feeds-reveal-tab"
          onClick={onToggleCollapse}
          aria-label="show performer feeds"
        >
          <CaretRight size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}
