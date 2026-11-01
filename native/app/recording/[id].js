// Recording.dc.html — a show watched back after it happened.
//
// Three sources, and each one is there for a different reason:
//
//   · the `recordings` row, read straight from the table. Row-level
//     security already allows a public recording to anyone and a private
//     one only to its artist, so there is no route to put in front of it.
//   · GET /api/recordings/[id]/url → { url, expiresIn }. This is the gate
//     on the file itself, independent of the metadata row: the client
//     never holds a storage path, only an id it exchanges for a signed URL
//     that lasts a minute. It is asked on load as much to find out whether
//     this person may play the recording at all as to get the link.
//   · GET /api/viewer/comments?show= for what people said at the time. A
//     recording's comments are the show's comments — they are stamped with
//     the viewer's playback position rather than wall clock, which is what
//     makes them readable back against a recording at all.
//
// Nothing is drawn over the player. Recording.dc.html predates the YouTube
// decision and puts a pause button and a scrub bar on top of the picture;
// under YouTube delivery (docs/YOUTUBE_ADDENDUM.md, docs/CLAUDE.md §6)
// nothing may sit over that frame, and the player carries its own
// controls, so the board's own transport is left off rather than drawn
// twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Linking, Share as RNShare, useWindowDimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Screen, Card, MediaTile, Badge, Button, Field, IconButton, Empty, ErrorPanel, Skeleton, Icon,
  color, space, radius, playerFrame, textOnDark, face, useLoadingPhase,
} from '../../src/ui';
import { Player } from '../../src/player/PlayerSource';
import { api } from '../../src/api';
import { supabase, AUTH_CONFIGURED, useSession } from '../../src/session';
import { API_BASE } from '../../src/config';

const onDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function Recording() {
  const { id } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const { session, accessToken, loading: sessionLoading } = useSession();

  const [recording, setRecording] = useState(null);
  const [show, setShow] = useState(null);
  const [playback, setPlayback] = useState(null);      // { url, expiresIn }
  const [comments, setComments] = useState(null);
  const [failure, setFailure] = useState(null);        // 'notfound' | 'load' | 'blocked'
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const playerRef = useRef(null);
  const phase = useLoadingPhase(recording === null && !failure);

  const load = useCallback(async () => {
    setFailure(null);
    if (!AUTH_CONFIGURED) { setFailure('load'); return; }
    const sb = supabase();
    const { data, error } = await sb.from('recordings')
      .select('id, show_id, artist_id, title, recorded_at, duration_ms, visibility')
      .eq('id', id).maybeSingle();
    // A private recording and a deleted one look the same through
    // row-level security, which is the point: either way there is nothing
    // here for this person, and the screen says that rather than guessing.
    if (error) { setFailure('load'); return; }
    if (!data) { setFailure('notfound'); return; }
    setRecording(data);

    const [artist, parent, signed] = await Promise.all([
      sb.from('public_profiles').select('id, display_name, username').eq('id', data.artist_id).maybeSingle(),
      data.show_id
        ? sb.from('shows').select('id, title, delivery, youtube_video_id, performance_mode').eq('id', data.show_id).maybeSingle()
        : Promise.resolve({ data: null }),
      api(`/api/recordings/${data.id}/url`, { accessToken }),
    ]);

    setShow({ ...(parent.data || {}), artist: artist.data || null });
    if (signed.ok && signed.data?.url) setPlayback(signed.data);
    else if (signed.status === 401 || signed.status === 403) setFailure('blocked');
  }, [id, accessToken]);

  useEffect(() => { if (!sessionLoading) load(); }, [sessionLoading, load]);

  // The chat as it was, oldest first, exactly as the route returns it.
  const loadComments = useCallback(async () => {
    if (!recording?.show_id) { setComments([]); return; }
    const r = await api(`/api/viewer/comments?show=${recording.show_id}`);
    setComments(r.ok ? (r.data?.comments || []) : []);
  }, [recording]);

  useEffect(() => { if (recording) loadComments(); }, [recording, loadComments]);

  /**
   * The signed URL lasts a minute, so it is fetched again at the moment
   * someone asks for it rather than handing over the one from page load.
   */
  async function openTheFile() {
    const r = await api(`/api/recordings/${id}/url`, { accessToken });
    const url = r.ok ? r.data?.url : null;
    if (!url) { setFailure('blocked'); return; }
    Linking.openURL(url).catch(() => setFailure('blocked'));
  }

  function share() {
    const url = `${API_BASE}/watch/${id}`;
    RNShare.share({ url, message: url }).catch(() => { /* the person closed the sheet */ });
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (!session) { router.push('/signup?trigger=comment'); return; }
    setSending(true); setSendError(null);
    const position = await playerRef.current?.positionMs?.().catch?.(() => null);
    const r = await api('/api/viewer/comments', {
      method: 'POST',
      accessToken,
      body: { showId: recording.show_id, body, playbackPositionMs: position ?? null },
    });
    setSending(false);
    if (!r.ok) { setSendError(r.data?.error || 'We could not send that. Try again.'); return; }
    setDraft('');
    setComments((c) => [...(c || []), r.data.comment]);
  }

  if (failure === 'notfound' || failure === 'blocked') {
    return (
      <Screen dark>
        <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.l }}>
          <IconButton label="Back" dark onPress={() => router.back()}><Icon.Back size={22} color={color.porcelain} /></IconButton>
          <ErrorPanel
            title={failure === 'notfound' ? 'We could not find this recording' : 'This recording is not yours to play'}
            body={failure === 'notfound'
              ? 'The link may be wrong, or the artist has taken it down.'
              : 'The artist keeps this one private. Their public shows are on their profile.'}
            backLabel="Back"
            onBack={() => router.back()}
          />
        </View>
      </Screen>
    );
  }

  if (failure === 'load') {
    return (
      <Screen dark>
        <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.l }}>
          <IconButton label="Back" dark onPress={() => router.back()}><Icon.Back size={22} color={color.porcelain} /></IconButton>
          <ErrorPanel title="We could not load this recording" body="It may be the connection. Try again." onRetry={load} backLabel="Back" onBack={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (phase !== 'done' || sessionLoading) return <RecordingSkeleton />;

  // Phone frame from the shared player rules, scaled to this phone and
  // never under YouTube's 200 x 200 minimum.
  const frameW = Math.max(playerFrame.min.w, Math.min(playerFrame.phone.w, width - space.screenEdge * 2));
  const frameH = Math.max(playerFrame.min.h, Math.round(frameW * 16 / 9));
  const stageName = show?.artist?.display_name || 'Artist';
  const youtube = show?.youtube_video_id ? { ...show, delivery: 'youtube' } : null;

  return (
    <Screen dark>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 28, gap: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <IconButton label="Back" dark onPress={() => router.back()}><Icon.Back size={22} color={color.porcelain} /></IconButton>
            <View style={{ flex: 1 }}>
              <Text style={[textOnDark.rowTitle, { fontSize: 19 }]} numberOfLines={1}>{recording.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {/* Badge has no neutral kind; its documented fallback is the
                    ink pill this board asks for. */}
                <Badge kind="neutral">RECORDING</Badge>
                <Text style={[textOnDark.supporting, { fontSize: 14, flex: 1 }]} numberOfLines={1}>
                  {stageName} · {onDate(recording.recorded_at)}
                </Text>
              </View>
            </View>
            <IconButton label="Share recording" dark onPress={share}><Icon.Share size={22} color={color.porcelain} /></IconButton>
          </View>

          <View style={{ alignSelf: 'center', width: frameW, height: frameH, borderRadius: radius.card, overflow: 'hidden' }} accessibilityLabel="Recorded show">
            {youtube ? (
              <Player ref={playerRef} show={youtube} width={frameW} height={frameH} />
            ) : (
              // No file player in this build: PlayerSource has YouTube and
              // the fixture clock, and nothing that decodes an mp4. Rather
              // than a dead picture, the signed URL is handed to whatever
              // the phone uses for video.
              <MediaTile label="[Recorded show]" style={{ flex: 1 }} />
            )}
          </View>

          {!youtube ? (
            <Button
              kind="strong"
              onPress={openTheFile}
              disabled={!playback}
              icon={<Icon.Film size={20} color={color.porcelain} />}
            >
              Open the recording
            </Button>
          ) : null}

          <Text style={textOnDark.label}>COMMENTS FROM THE SHOW</Text>

          {comments === null ? (
            <View style={{ gap: space.sm }}>
              <Skeleton width="80%" height={18} />
              <Skeleton width="65%" height={18} />
              <Skeleton width="72%" height={18} />
            </View>
          ) : comments.length ? (
            <View style={{ gap: space.sm }} accessibilityLabel="Comments from the show">
              {comments.map((c) => (
                <Text key={c.id} style={[textOnDark.body, { fontSize: 16 }]}>
                  <Text style={{ fontFamily: face.bold, fontWeight: '700', color: color.orange }}>{c.author}</Text>
                  {` ${c.body}`}
                </Text>
              ))}
            </View>
          ) : (
            <Card dark>
              <Empty
                dark
                icon={<Icon.Chat size={24} color={color.ink} />}
                title="Nobody said anything"
                body={recording.show_id
                  ? 'The chat was quiet during this one. You can still leave the first word.'
                  : 'This recording is not attached to a show, so it has no chat behind it.'}
                testID="recording-no-comments"
              />
            </Card>
          )}

          {recording.show_id ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
              <Field
                dark
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment"
                error={sendError}
                style={{ flex: 1 }}
                testID="recording-comment"
              />
              <Button
                kind="main"
                size="medium"
                busy={sending}
                onPress={send}
                accessibilityLabel="Send"
                style={{ width: 48, height: 48, borderRadius: 24, paddingHorizontal: 0 }}
                icon={<Icon.Chevron size={22} color={color.ink} />}
              >
                {''}
              </Button>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function RecordingSkeleton() {
  return (
    <Screen dark>
      <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Skeleton width={44} height={44} radius={22} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="70%" height={19} />
            <Skeleton width="45%" height={14} />
          </View>
          <Skeleton width={44} height={44} radius={22} />
        </View>
        <Skeleton width="100%" height={420} radius={16} />
        <Skeleton width={180} height={16} />
        <Skeleton width="80%" height={18} />
        <Skeleton width="65%" height={18} />
      </View>
    </Screen>
  );
}
