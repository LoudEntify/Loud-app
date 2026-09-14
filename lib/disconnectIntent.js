// lib/disconnectIntent.js
// ─────────────────────────────────────────────────────────────
// Did somebody DECIDE this disconnect, or did the transport fail?
//
// PRD: Live Show · S&I: Real-time media
//
// ── WHY THIS EXISTS (item 8 §4.3) ──
// components/ReleaseOnShowEnd.jsx treated all eight DisconnectReasons
// identically:
//
//     function onDisconnected() { release('room_disconnected'); }
//
// That was survivable only because this system had never produced a
// deliberate teardown. Layer B introduces ROOM_DELETED — the first
// disconnect anyone ever MEANT — and the moment it exists, "released
// because the show ended" and "released because wifi blipped" become
// indistinguishable at the one site where the difference is most
// expensive: a paired camera that releases on a transport blip is a
// camera gone for the rest of the show, mid-performance, with no way
// back except somebody walking over and re-pairing it.
//
// So the split lands BEFORE Layer B, not alongside it.
//
// ── THE DEFAULT IS THE IMPORTANT PART ──
// An unrecognised reason is treated as a TRANSPORT FAILURE, not intent.
// The two mistakes are not symmetric:
//
//   release on a blip        -> a camera dies mid-show and stays dead
//   fail to release on intent -> a camera holds a few seconds longer
//                                until the poll notices the show ended
//
// The second is a tidiness problem. The first is on-air. LiveKit may add
// reasons; every one it adds will arrive here unrecognised, and the safe
// reading of an unknown reason is "nobody told me this was deliberate".
// ─────────────────────────────────────────────────────────────

// Someone decided this. Terminal — release.
//
// CLIENT_INITIATED     this device called disconnect()
// ROOM_DELETED         Layer B deleted the room. The show is over.
// PARTICIPANT_REMOVED  the server evicted this participant specifically.
const INTENTIONAL = new Set(['CLIENT_INITIATED', 'ROOM_DELETED', 'PARTICIPANT_REMOVED']);

/**
 * Normalise LiveKit's DisconnectReason to a comparable string.
 *
 * The SDK has passed this as a numeric enum, as an enum-keyed string,
 * and as undefined across versions, and the handler receives whatever
 * RoomEvent.Disconnected happens to emit. Everything non-string is
 * normalised to null, which the classifier then reads as "unknown",
 * which is the safe answer — rather than letting `0` or an object
 * coerce into something that accidentally matches.
 */
export function disconnectReasonName(reason) {
  if (typeof reason === 'string' && reason.trim()) return reason.trim().toUpperCase();
  return null;
}

/**
 * Should a paired device RELEASE on this disconnect?
 *
 * True only for a reason we recognise as deliberate. Everything else —
 * including no reason at all — keeps the poll alive so the device can
 * recover on its own.
 */
export function isIntentionalDisconnect(reason) {
  const name = disconnectReasonName(reason);
  return name !== null && INTENTIONAL.has(name);
}

/**
 * The label to log, so a release (or a non-release) is diagnosable after
 * the fact. "room_disconnected" told us nothing, which is how this
 * survived unnoticed.
 */
export function describeDisconnect(reason) {
  const name = disconnectReasonName(reason);
  return {
    reason: name,
    intentional: isIntentionalDisconnect(reason),
    action: isIntentionalDisconnect(reason) ? 'release' : 'hold',
  };
}
