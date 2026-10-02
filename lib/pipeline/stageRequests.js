// lib/pipeline/stageRequests.js — the Versus view state machine. Pure.
//
// PRD 122, 123; docs/YOUTUBE_ADDENDUM.md: "Each artist has Conversation and
// Perform buttons. Tapping Perform while the other artist is performing
// sends a stage request. The performing artist must confirm ('Hand over
// the stage' or 'Not yet'). Switching to Conversation is immediate."
export const REQUEST_TTL_MS = 60_000;

export function performingSlot(view) { return view === 'a_performing' ? 'a' : view === 'b_performing' ? 'b' : null; }
export const viewFor = (slot) => (slot === 'a' ? 'a_performing' : 'b_performing');

/**
 * What tapping a button does. Returns one of:
 *   { kind:'set_view', view }                       immediate change
 *   { kind:'request', from, to }                    needs the other artist's confirmation
 *   { kind:'noop', reason }
 */
export function decideAction({ currentView, slot, action, pending = null, nowMs = Date.now() }) {
  if (action === 'conversation') return currentView === 'conversation' ? { kind: 'noop', reason: 'already' } : { kind: 'set_view', view: 'conversation' };
  if (action !== 'perform') return { kind: 'noop', reason: 'unknown_action' };
  const other = slot === 'a' ? 'b' : 'a';
  const onStage = performingSlot(currentView);
  if (onStage === slot) return { kind: 'noop', reason: 'already_on_stage' };
  if (onStage == null) return { kind: 'set_view', view: viewFor(slot) }; // nobody is performing: take the stage
  if (pending && pending.state === 'pending' && pending.from_slot === slot && nowMs - Date.parse(pending.created_at) < REQUEST_TTL_MS) return { kind: 'noop', reason: 'already_asked' };
  return { kind: 'request', from: slot, to: other };
}

/** The performing artist answers. Returns the new view (or null if declined) and the request state. */
export function resolveRequest({ request, by, answer, nowMs = Date.now() }) {
  if (!request || request.state !== 'pending') return { error: 'no_pending_request' };
  if (by !== request.to_slot) return { error: 'not_yours_to_answer' };
  if (nowMs - Date.parse(request.created_at) > REQUEST_TTL_MS) return { state: 'expired', view: null };
  if (answer === 'handover') return { state: 'accepted', view: viewFor(request.from_slot) };
  return { state: 'declined', view: null };
}
