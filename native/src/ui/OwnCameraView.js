// What the artist's own camera looks like on screen.
//
// Shared by the console's "You" window and Kit Check's shot preview, so
// the guard that stops LiveKit crashing exists once. VideoTrack reads
// trackRef.publication.track without checking it, which crashed the
// spike on 14 Oct; nothing renders until the publication and its track
// both exist.
//
// Every state says what it is rather than showing an empty rectangle.
// A black box on a live screen is indistinguishable from a camera that
// has died, and the whole point of this window is to tell an artist
// their picture is going out.
import { View, Text } from 'react-native';
import { MediaTile } from './Surface';
import { Button } from './Button';
import { color, space, face } from './tokens';
import { OWN_CAMERA_LIVE, OWN_CAMERA_FAILED, OWN_CAMERA_STARTING } from '../ownCamera';

let VideoTrack = null;
try { VideoTrack = require('@livekit/react-native').VideoTrack; } catch { /* Expo Go: no native LiveKit */ }

export function OwnCameraView({ camera, label = 'You', style, onRetry, compact = false }) {
  const { phase, error, session } = camera || {};
  const pub = session?.room
    ? (session.publication || session.room.localParticipant?.getTrackPublication?.('camera'))
    : null;

  if (phase === OWN_CAMERA_LIVE && VideoTrack && pub?.track && session?.room?.localParticipant) {
    return (
      <View style={[{ overflow: 'hidden', backgroundColor: color.ink }, style]}>
        <VideoTrack
          trackRef={{ participant: session.room.localParticipant, publication: pub, source: 'camera' }}
          style={{ flex: 1 }}
          objectFit="cover"
        />
        {label ? (
          <Text style={{ position: 'absolute', left: 6, bottom: 4, fontFamily: face.bold, fontSize: 12, fontWeight: '700', color: color.porcelain }}>
            {label}
          </Text>
        ) : null}
      </View>
    );
  }

  if (phase === OWN_CAMERA_FAILED) {
    return (
      <View style={[{ backgroundColor: 'rgba(231,29,54,0.22)', padding: compact ? space.xs : space.m, justifyContent: 'center', gap: space.xs }, style]}>
        <Text numberOfLines={compact ? 3 : 6} style={{ fontFamily: face.regular, fontSize: compact ? 12 : 15, color: color.porcelain }}>
          {error || 'Your camera is not sending.'}
        </Text>
        {onRetry && !compact ? <Button kind="quietDark" size="small" onPress={onRetry}>Try again</Button> : null}
      </View>
    );
  }

  return <MediaTile label={phase === OWN_CAMERA_STARTING ? 'Starting your camera' : label} style={style} />;
}
