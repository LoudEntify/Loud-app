'use client';

// Stage 5 of MULTI_PERFORMER_SPEC.md, generalized for N performer slots
// (originally built two-slot-shaped, corrected before Stage 6 so egress
// wouldn't inherit the same limitation). Active performer large on top;
// every OTHER present slot renders into a horizontal scrollable
// thumbnail strip along the bottom -- same layout on every viewport,
// desktop and mobile, per the actual sketch (the first draft guessed a
// side-column placement on desktop; wrong, corrected here). No
// orientation detection at all as a result -- unlike VersusSplit (and
// this component's own first draft), there's nothing left that needs
// to know landscape vs portrait, so there's no equivalent of today's
// earlier pointer:coarse-headless bug possible here.
//
// `slots` is the live "present" list (LiveDemo.jsx's presentSlots,
// derived from actual published camera tracks, not from show_slots'
// seeded list) -- `renderSlot` is the generic per-letter closure each
// caller already owns, called fresh per slot here rather than
// pre-invoked into renderA/renderB (the original two-slot-shaped
// prop contract).
//
// Disconnect handling (explicit product decision, not a default):
// if `activeSlot` itself isn't in `slots` right now (that performer
// dropped), this does NOT auto-switch to someone else -- the active
// pane shows a "Reconnecting" placeholder and activePerformerSlot in
// the shows table is left exactly as it was. Only a deliberate switch
// (the session-token-guarded route) ever changes who's active.
export default function SpotlightStage({ activeSlot, slots, renderSlot }) {
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
          {others.map((slot) => (
            <div key={slot} className="spotlight-thumbnail-tile">
              {renderSlot(slot)()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
