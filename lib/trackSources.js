// lib/trackSources.js
// ─────────────────────────────────────────────────────────────
// WHAT IS THIS TRACK? — the single answer, for every caller.
//
// ── THE BUG THIS FILE EXISTS TO KILL ──
// Until now, "what kind of shot is this track" was answered by parsing
// the LiveKit PARTICIPANT IDENTITY — `camfeed-a-wide-3f9c`, split on
// hyphens, take the third piece — in six different places across three
// files. That works exactly as long as one participant publishes exactly
// one track.
//
// B-roll breaks it. A clip is published by the ARTIST'S OWN participant,
// so it carries the artist's identity. Every one of those parsers would
// look at a b-roll track, see `contestant-a-…`, and answer "this is the
// performer's camera". The director would tap B-ROLL CLIP and cut to the
// artist's face — and worse, the recorder would bake that into the file.
//
// So the discriminator moved down a level, from the participant to the
// PUBLICATION. A track published with the name `broll` is a clip; any
// other track from a performer or camfeed identity is a camera. Identity
// still answers "whose is it and which slot", because that is genuinely
// what identity is for. It no longer answers "what is it".
//
// ── THE RULE, stated once so every parser can be checked against it ──
//
//     NO FUNCTION IN THIS FILE MAY EVER RESOLVE A B-ROLL TRACK TO A
//     CAMERA ROLE, AND NO CAMERA ROLE MAY EVER RESOLVE TO A B-ROLL
//     TRACK.
//
// Both directions matter. The first stops a cut to b-roll landing on a
// face. The second stops a cut to WIDE landing on a clip.
//
// ── WHY ScreenShare AND NOT Camera ──
// The b-roll track is published as `Track.Source.ScreenShare`, not as a
// second Camera source. That is not cosmetic:
//
// `<LiveKitRoom video>` drives `setCameraEnabled()`, which owns the
// Camera source and RE-ASSERTS ITSELF ON EVERY SignalConnected — there
// are already two fixes in components/LiveDemo.jsx (1b and 1d) that
// exist because of that re-assertion. A second Camera-source track
// invites the SDK's camera management to find, mute, replace or stop the
// b-roll track on any reconnect. ScreenShare is a source that path never
// touches.
//
// The cost is one line: every `useTracks([Track.Source.Camera])` that
// should see b-roll must also list ScreenShare. That is deliberate too —
// it means a surface only sees b-roll if someone decided it should.
// components/CamPage.jsx (a phone looking at itself) and
// components/RehearsalRoom.jsx (no b-roll in rehearsal) are correctly
// left alone.
// ─────────────────────────────────────────────────────────────

import { Track } from 'livekit-client';

/**
 * The published track NAME that marks a b-roll clip. This string is the
 * whole discriminator — it travels with the publication to every
 * subscriber, so viewers and the recorder classify a track identically
 * to the artist who published it, with no side channel and no state to
 * keep in sync.
 */
export const BROLL_TRACK_NAME = 'broll';

/** The role b-roll occupies in the shot grammar (lib/shotTypes.js). */
export const BROLL_ROLE = 'broll';

/** See the long note above on why this is not Camera. */
export const BROLL_TRACK_SOURCE = Track.Source.ScreenShare;

/**
 * The sources a surface must subscribe to in order to see b-roll.
 * Exported as one array so a surface opts in by using this constant
 * rather than by remembering to add a second enum value.
 */
export const STAGE_TRACK_SOURCES = [Track.Source.Camera, Track.Source.ScreenShare];

/** Camera roles, as distinct from b-roll. 'main' is the performer's own. */
export const CAMERA_ROLES = ['main', 'wide', 'close', 'side'];

export function isCameraRole(role) {
  return CAMERA_ROLES.includes(role);
}

/**
 * Strip b-roll out of a role list.
 *
 * Used by every AUTOMATIC path. The auto director and the staccato
 * sequencer must never cut to a clip on their own — going to b-roll is
 * an editorial decision a person makes, and a sequencer hard-cutting
 * into a clip every 500ms is not a thing anyone wants to watch.
 */
export function cameraRolesOnly(roles) {
  return (roles || []).filter(isCameraRole);
}

// ─── The primitives ───────────────────────────────────────────

function identityOf(trackRef) {
  return trackRef?.participant?.identity ?? null;
}

function trackNameOf(trackRef) {
  // `trackName` on the publication, not `track.name` — the publication is
  // what every remote subscriber sees, and it is populated before the
  // media object exists.
  return trackRef?.publication?.trackName ?? null;
}

/**
 * Is this a b-roll clip rather than a camera?
 *
 * Matched by prefix rather than equality so a future `broll:<clipId>`
 * naming (useful for telemetry) classifies correctly without touching
 * any of the six call sites again.
 */
export function isBrollTrack(trackRef) {
  const name = trackNameOf(trackRef);
  return typeof name === 'string' && name.startsWith(BROLL_TRACK_NAME);
}

/**
 * The performer slot a track belongs to — 'a', 'b', … or null.
 *
 * B-roll DOES belong to a slot: it is the artist's clip, cut into their
 * own stage. This is why `presentSlots` needs a different predicate
 * (isPerformerCameraTrack) rather than reusing this one.
 */
export function slotOfTrack(trackRef) {
  const identity = identityOf(trackRef);
  if (typeof identity !== 'string') return null;
  if (identity.startsWith('contestant-') || identity.startsWith('camfeed-')) {
    return identity.split('-')[1] || null;
  }
  return null;
}

/**
 * The shot-grammar role of a track: 'main' | 'wide' | 'close' | 'side' |
 * 'broll' | null.
 *
 * THE B-ROLL CHECK COMES FIRST, ON PURPOSE. It is the single line that
 * makes the rule at the top of this file true, and putting it anywhere
 * else would let identity parsing win for a clip published by a
 * performer's own participant — which is the entire bug.
 */
export function roleOfTrack(trackRef) {
  if (isBrollTrack(trackRef)) return BROLL_ROLE;
  const identity = identityOf(trackRef);
  if (typeof identity !== 'string') return null;
  if (identity.startsWith('contestant-')) return 'main';
  if (identity.startsWith('camfeed-')) return identity.split('-')[2] || null;
  return null;
}

/** Does this track belong to this slot, in any capacity (camera or clip)? */
export function belongsToSlot(trackRef, slot) {
  return slotOfTrack(trackRef) === String(slot);
}

/**
 * A performer's own CAMERA — not their b-roll.
 *
 * `presentSlots` is built from this: a slot is "present" because a human
 * is there with a camera on, and a clip playing on an empty stage must
 * never make it look like somebody is standing on it.
 */
export function isPerformerCameraTrack(trackRef) {
  if (isBrollTrack(trackRef)) return false;
  const identity = identityOf(trackRef);
  return typeof identity === 'string' && identity.startsWith('contestant-');
}

/** Every track for a slot EXCEPT b-roll. The camera pool. */
export function cameraTracksOnly(trackRefs) {
  return (trackRefs || []).filter((t) => !isBrollTrack(t));
}

/**
 * THE identifier a shot command targets.
 *
 * `targetIdentity` alone was sufficient while one participant meant one
 * track, and stopped being sufficient the moment a participant could
 * publish both a camera and a clip. This is identity PLUS what the track
 * is — so a command that means "the clip" can never resolve to "the
 * face", and vice versa.
 *
 * `#camera` rather than an empty suffix so the two halves are always
 * present and the string is readable in a log line.
 */
export function sourceKey(trackRef) {
  const identity = identityOf(trackRef);
  if (!identity) return null;
  return `${identity}#${isBrollTrack(trackRef) ? BROLL_TRACK_NAME : 'camera'}`;
}

/**
 * Does this track satisfy a command's target?
 *
 * BACKWARD COMPATIBLE BY CONSTRUCTION. A command with no
 * `targetSourceKey` — every command broadcast before this round, and any
 * emitted by a client that has not reloaded — matches on identity alone,
 * exactly as it always did. Only a command that explicitly carries a
 * source key gets the stricter test.
 *
 * That matters during a deploy: an artist on a new build and a viewer on
 * an old one, or the reverse, both keep working. The viewer on the old
 * build simply cannot distinguish the clip from the camera — which is
 * the behaviour they had five minutes ago, not a new failure.
 */
export function matchesTarget(trackRef, command) {
  if (!command?.targetIdentity) return false;
  if (identityOf(trackRef) !== command.targetIdentity) return false;
  if (!command.targetSourceKey) return true; // legacy command: identity is the whole test
  return sourceKey(trackRef) === command.targetSourceKey;
}

/**
 * One-line description for logs and health events. Reading
 * `contestant-a-9f2c#broll` in a timeline is the difference between
 * diagnosing a b-roll cut in a minute and diagnosing it in an hour.
 */
export function describeTrack(trackRef) {
  return {
    identity: identityOf(trackRef),
    trackName: trackNameOf(trackRef),
    slot: slotOfTrack(trackRef),
    role: roleOfTrack(trackRef),
    isBroll: isBrollTrack(trackRef),
    sourceKey: sourceKey(trackRef),
  };
}
