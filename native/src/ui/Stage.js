// What the viewers are seeing, on the artist's own screen.
//
// ── WHAT IT REPLACES ──────────────────────────────────────────
// The console drew the words "ON AIR · CLOSE" on an empty dark screen
// and put the artist's own camera in a 96x128 window in the corner,
// with this comment: "the console cannot show the composed frame itself
// (it is built server-side for the broadcast), so it names the camera
// on air rather than implying a preview it does not have."
//
// That was true of the COMPOSED frame and false of the picture. The
// artist's phone is in the room and its token carries canSubscribe, so
// every camera in the show is already on this device. Composing them
// the way the broadcast composes them is the same job the egress
// template does (components/EgressPage.jsx) and the same job a viewer's
// screen does — it does not need the server.
//
// So: solo fills the screen with whatever is on air, which is what a
// viewer sees. Versus splits, and the small window is the OTHER artist,
// which is the only thing a small window was ever for.
//
// ── AND IT IS THE DIAGNOSTIC ──────────────────────────────────
// A show that reaches YouTube as audio over a black frame has lost its
// video somewhere between the phone and the ingest. This view renders
// from the room itself, so it answers the question that narrows it: if
// the picture is here and not on YouTube, the fault is in the
// compositor; if it is missing here too, the fault is in the room.
import { useEffect, useReducer } from 'react';
import { View, Text } from 'react-native';
import { color, space, face } from './tokens';
import { MediaTile } from './Surface';

let VideoTrack = null;
try { VideoTrack = require('@livekit/react-native').VideoTrack; } catch { /* Expo Go: no native LiveKit */ }

/** 'camfeed-{slot}-{role}-…' and 'contestant-{slot}-…', as the room names them. */
export function roleOfIdentity(identity) {
  if (typeof identity !== 'string') return null;
  if (identity.startsWith('contestant-')) return 'main';
  if (identity.startsWith('camfeed-')) return identity.split('-')[2] || null;
  return null;
}

export function slotOfIdentity(identity) {
  if (typeof identity !== 'string') return null;
  if (identity.startsWith('contestant-') || identity.startsWith('camfeed-')) {
    return identity.split('-')[1] || null;
  }
  return null;
}

/**
 * Every camera in the room, local and remote, as
 * { identity, slot, role, participant, publication }.
 *
 * Built from the room rather than from the server's idea of the rig:
 * the room is what the broadcast composes, so this is the same list the
 * compositor is working from, and a camera missing here is missing
 * there too.
 */
export function camerasInRoom(room) {
  if (!room) return [];
  const out = [];
  const add = (participant) => {
    const pubs = participant?.videoTrackPublications || participant?.videoTracks;
    if (!pubs?.forEach) return;
    pubs.forEach((pub) => {
      if (!pub?.track || pub.isMuted) return;
      // Screen share is how a b-roll clip is published; a clip is a
      // camera for cutting purposes and is labelled by its own role.
      const identity = participant.identity;
      out.push({ identity, slot: slotOfIdentity(identity), role: roleOfIdentity(identity), participant, publication: pub });
    });
  };
  add(room.localParticipant);
  const remotes = room.remoteParticipants || room.participants;
  if (remotes?.forEach) remotes.forEach(add);
  return out;
}

/**
 * The camera a cut should show.
 *
 * Same fallback chain the egress template uses: the requested role
 * first, then the performer's own camera, then anything. A cut whose
 * camera has gone shows a picture rather than nothing, because a black
 * screen on a live show is indistinguishable from a broken one.
 */
export function cameraForCut(cameras, cut, slot = 'a') {
  const mine = cameras.filter((c) => !c.slot || c.slot === slot);
  const want = cut === 'main' ? 'main' : cut;
  return (
    mine.find((c) => c.role === want)
    || mine.find((c) => c.role === 'main')
    || mine[0]
    || cameras[0]
    || null
  );
}

function Feed({ camera, style, label }) {
  if (VideoTrack && camera?.publication?.track && camera?.participant) {
    return (
      <View style={[{ overflow: 'hidden', backgroundColor: color.ink }, style]}>
        <VideoTrack
          trackRef={{ participant: camera.participant, publication: camera.publication, source: 'camera' }}
          style={{ flex: 1 }}
          objectFit="cover"
        />
        {label ? (
          <Text style={{ position: 'absolute', left: 8, bottom: 6, fontFamily: face.bold, fontSize: 12, fontWeight: '700', color: color.porcelain }}>{label}</Text>
        ) : null}
      </View>
    );
  }
  return <MediaTile label={label || 'Waiting for a camera'} style={style} />;
}

/**
 * @param room      the LiveKit room this phone is in
 * @param cut       the cut on air ('main' | 'side' | 'close' | 'broll')
 * @param versus    true for a two-artist show
 * @param slot      this artist's slot
 */
export function Stage({ room, cut = 'main', versus = false, slot = 'a', style }) {
  // The room is a mutable object, not state: a camera joining or
  // dropping changes nothing React can see. Without this the stage
  // shows whatever was in the room at the moment it first rendered,
  // which on a show that starts before the second phone is scanned is
  // one camera, forever.
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!room?.on) return undefined;
    const EVENTS = [
      'trackSubscribed', 'trackUnsubscribed', 'trackPublished', 'trackUnpublished',
      'localTrackPublished', 'localTrackUnpublished',
      'trackMuted', 'trackUnmuted',
      'participantConnected', 'participantDisconnected',
      'connectionStateChanged',
    ];
    for (const e of EVENTS) room.on(e, bump);
    bump();
    return () => { for (const e of EVENTS) room.off?.(e, bump); };
  }, [room]);

  const cameras = camerasInRoom(room);
  const mine = cameraForCut(cameras, cut, slot);

  if (!versus) {
    // Solo: what a viewer sees, and nothing else. No small window —
    // there is no second artist for it to hold.
    return <Feed camera={mine} style={[{ flex: 1 }, style]} />;
  }

  const otherSlot = slot === 'a' ? 'b' : 'a';
  const theirs = cameras.find((c) => c.slot === otherSlot) || null;
  return (
    <View style={[{ flex: 1 }, style]}>
      <Feed camera={mine} style={{ flex: 1 }} label="You" />
      <View style={{ height: space.xs }} />
      <Feed camera={theirs} style={{ flex: 1 }} label="Them" />
    </View>
  );
}
