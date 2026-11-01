// Profile-Public.dc.html — an artist as everyone else sees them.
//
// There is no API route behind this screen, and that is on purpose: the
// web twin (components/viewer/PublicProfile.jsx) reads the
// `public_profiles` view and the public `shows`, `recordings` and `clips`
// rows straight through the anon client, because row-level security is
// already the whole rule. `public_profiles` exposes public columns only
// and excludes closed accounts, and every table read here has a
// "visibility = 'public'" policy. A route in front of that would be a
// second copy of a decision the database has already made.
//
// Two things the boards draw that this screen cannot honestly show:
//
//   · "[n] followers". Under the `follows` policies a count query returns
//     the caller's own row and nothing else, so every artist would read
//     "1 follower" (the note in docs/overnight2_03_follows.sql spells this
//     out). A public count needs a counter column or a security-definer
//     function; neither exists, so no number is claimed.
//   · "Add to calendar" beside the next show. Nothing in this build can
//     write to the phone's calendar, so the card opens the show instead
//     of offering something that would do nothing.
//
// "Message" is left out for the same reason: Thread.dc.html has no screen
// yet, and a button that leads nowhere is worse than one that is absent.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share as RNShare, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Screen, Card, MediaTile, Chip, Badge, Button, IconButton, Empty, ErrorPanel, Skeleton, Icon,
  color, space, radius, surface, text, face, useLoadingPhase,
} from '../../src/ui';
import { supabase, AUTH_CONFIGURED, useSession } from '../../src/session';
import { API_BASE } from '../../src/config';

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'shows', label: 'Shows' },
  { key: 'clips', label: 'Clips' },
  { key: 'about', label: 'About' },
];

const dayTime = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

const clock = (ms) => {
  if (!Number.isFinite(Number(ms))) return null;
  const total = Math.round(Number(ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A follow this screen cannot write is reported, not quietly swallowed. */
const missingTable = (error) => {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
};

export default function ArtistProfile() {
  const { username } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const { session, profile: me, loading: sessionLoading } = useSession();

  const [artist, setArtist] = useState(null);
  const [shows, setShows] = useState(null);
  const [recordings, setRecordings] = useState(null);
  const [clips, setClips] = useState(null);
  const [failure, setFailure] = useState(null);      // 'notfound' | 'load' | 'follow'
  const [following, setFollowing] = useState(false);
  const [savingFollow, setSavingFollow] = useState(false);
  const [tab, setTab] = useState('upcoming');

  const phase = useLoadingPhase(artist === null && !failure);

  const load = useCallback(async () => {
    setFailure(null);
    if (!AUTH_CONFIGURED) { setFailure('load'); return; }
    const sb = supabase();
    const { data, error } = await sb.from('public_profiles').select('*').eq('username', username).maybeSingle();
    if (error) { setFailure('load'); return; }
    if (!data) { setFailure('notfound'); return; }
    setArtist(data);

    // Shows the artist is on either side of, from four hours ago onwards —
    // the same window the web uses, so a show that has just finished is
    // still on the page rather than vanishing the moment it ends.
    const since = new Date(Date.now() - 4 * 3600000).toISOString();
    const [listed, recorded, cut] = await Promise.all([
      sb.from('shows')
        .select('id, title, slated_at, performance_mode, actual_started_at, actual_ended_at')
        .or(`artist_id.eq.${data.id},artist_b_id.eq.${data.id}`)
        .eq('visibility', 'public').is('cancelled_at', null).gte('slated_at', since)
        .order('slated_at').limit(20),
      sb.from('recordings')
        .select('id, title, recorded_at, duration_ms')
        .eq('artist_id', data.id).eq('visibility', 'public')
        .order('recorded_at', { ascending: false }).limit(20),
      sb.from('clips')
        .select('id, title, recording_id, start_ms, end_ms')
        .eq('artist_id', data.id).eq('visibility', 'public')
        .order('created_at', { ascending: false }).limit(20),
    ]);
    setShows(listed.data || []);
    setRecordings(recorded.data || []);
    setClips(cut.data || []);
  }, [username]);

  useEffect(() => { load(); }, [load]);

  // Whether this person already follows the artist. Own follow rows are the
  // one part of the follow graph row-level security lets anyone read.
  useEffect(() => {
    const viewer = session?.user?.id;
    if (!viewer || !artist) { setFollowing(false); return; }
    supabase().from('follows').select('artist_id')
      .eq('follower_id', viewer).eq('artist_id', artist.id).maybeSingle()
      .then(({ data }) => setFollowing(!!data), () => setFollowing(false));
  }, [session, artist]);

  async function toggleFollow() {
    if (!session) { router.push('/signup?trigger=follow'); return; }
    setSavingFollow(true);
    setFailure((f) => (f === 'follow' ? null : f));
    const sb = supabase();
    // Written straight to the table, like lib/follows.js on the web: the
    // policies say a person may only ever create and delete their own
    // follows, which is the entire rule, so there is nothing for a server
    // to decide. The upsert ignores duplicates so a second tap on a stale
    // button is a no-op rather than a conflict to interpret.
    const { error } = following
      ? await sb.from('follows').delete().eq('follower_id', session.user.id).eq('artist_id', artist.id)
      : await sb.from('follows').upsert(
        { follower_id: session.user.id, artist_id: artist.id },
        { onConflict: 'follower_id,artist_id', ignoreDuplicates: true },
      );
    setSavingFollow(false);
    // If the write is refused the button goes back to where it was and says
    // so. Showing "Following" over a row that was never written is the one
    // outcome worth avoiding here.
    if (error) { setFailure('follow'); return; }
    setFollowing((f) => !f);
  }

  function share() {
    const url = `${API_BASE}/u${artist?.username ? `/${artist.username}` : ''}`;
    RNShare.share({ url, message: url }).catch(() => { /* the person closed the sheet */ });
  }

  if (failure === 'notfound') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          <ErrorPanel
            title="We could not find that profile"
            body="The link may be wrong, or the account was closed."
            backLabel="Back to Discover"
            onBack={() => router.replace('/discover')}
          />
        </View>
      </Screen>
    );
  }

  if (failure === 'load') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          <ErrorPanel
            title="We could not load this profile"
            body="It may be the connection. Try again."
            onRetry={load}
            backLabel="Back to Discover"
            onBack={() => router.replace('/discover')}
          />
        </View>
      </Screen>
    );
  }

  if (phase !== 'done' || sessionLoading) return <ProfileSkeleton />;

  const live = (shows || []).find((s) => s.actual_started_at && !s.actual_ended_at);
  const next = (shows || []).find((s) => !s.actual_ended_at && Date.parse(s.slated_at) > Date.now());
  const isOwner = me?.id === artist.id;
  const isArtist = artist.role === 'artist';
  const tile = (width - space.screenEdge * 2 - space.xs) / 2;
  const subtitle = artist.genres?.length ? artist.genres.slice(0, 3).join(' · ') : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          <Text style={[text.rowTitle, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
            {artist.username ? `@${artist.username}` : artist.display_name}
          </Text>
          <IconButton label="Share profile" onPress={share}><Icon.Share size={22} color={color.ink} /></IconButton>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
          <MediaTile style={{ width: 88, height: 88, borderRadius: 44 }}>
            <Icon.Person size={40} color={color.mutedOnDark} />
          </MediaTile>
          <View style={{ flex: 1, gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[text.screenTitle, { fontSize: 30, flexShrink: 1 }]} numberOfLines={2}>{artist.display_name}</Text>
              {live ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Watch the live show" onPress={() => router.push(`/show/${live.id}`)}>
                  <Badge kind="live" />
                </Pressable>
              ) : null}
            </View>
            {subtitle ? <Text style={[text.body, { fontSize: 17 }]} numberOfLines={1}>{subtitle}</Text> : null}
            {artist.city ? <Text style={[text.supporting, { fontSize: 16 }]} numberOfLines={1}>{[artist.city, artist.country].filter(Boolean).join(', ')}</Text> : null}
          </View>
        </View>

        {artist.bio ? <Text style={[text.body, { fontSize: 17 }]}>{artist.bio}</Text> : null}

        {/* The board writes "[n] followers" beside this, which is left out:
            see the note at the top of the file. */}
        <Text style={[text.body, { fontSize: 16 }]}>
          <Text style={{ fontFamily: face.bold, fontWeight: '700' }}>{(recordings || []).length}</Text>
          {(recordings || []).length === 1 ? ' show' : ' shows'}
        </Text>

        {isArtist && !isOwner ? (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                kind={following ? 'quiet' : 'main'}
                size="medium"
                busy={savingFollow}
                onPress={toggleFollow}
                style={{ flex: 1, height: 46, borderRadius: 23 }}
                testID="profile-follow"
              >
                {following ? 'Following' : 'Follow'}
              </Button>
              {next ? (
                <Button
                  kind="quiet"
                  size="medium"
                  onPress={() => router.push(`/show/${next.id}`)}
                  icon={<Icon.Bell size={20} color={color.ink} />}
                  style={{ flex: 1, height: 46, borderRadius: 23 }}
                >
                  Remind me
                </Button>
              ) : null}
            </View>
            {failure === 'follow' ? (
              <ErrorPanel
                title="We could not save that follow"
                body="Your account may not be allowed to follow yet. Try again in a moment."
                onRetry={toggleFollow}
              />
            ) : null}
          </View>
        ) : null}

        {next ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Next show: ${next.title || 'A show'}`}
            onPress={() => router.push(`/show/${next.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: 14, borderRadius: radius.card, backgroundColor: surface.quiet }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={text.label}>NEXT SHOW</Text>
              <Text style={[text.rowTitle, { fontSize: 19 }]} numberOfLines={1}>{next.title || 'A show'}</Text>
              <Text style={[text.body, { fontSize: 16 }]} numberOfLines={1}>
                {dayTime(next.slated_at)} · {next.performance_mode === 'versus' ? 'Versus' : 'Solo'}
              </Text>
            </View>
            <Icon.Chevron size={22} color={color.mutedOnLight} />
          </Pressable>
        ) : null}

        {isArtist ? (
          <>
            <View accessibilityRole="tablist" accessibilityLabel="Profile sections" style={{ flexDirection: 'row', gap: space.sm }}>
              {TABS.map((t) => (
                // Chips rather than the board's underlined tabs: the design
                // system has no segmented control, and a 44-high chip is the
                // nearest thing in it that behaves as "pick one of these".
                <Chip key={t.key} selected={tab === t.key} onPress={() => setTab(t.key)} style={{ flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 8 }}>
                  {t.label}
                </Chip>
              ))}
            </View>

            {tab === 'upcoming' ? (
              (shows || []).length ? (
                <View style={{ gap: space.s }}>
                  {shows.map((s) => (
                    <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                      <Pressable style={{ flex: 1, gap: 2 }} accessibilityRole="button" accessibilityLabel={s.title || 'A show'} onPress={() => router.push(`/show/${s.id}`)}>
                        <Text style={text.rowTitle} numberOfLines={1}>{s.title || 'A show'}</Text>
                        <Text style={text.supporting} numberOfLines={1}>
                          {dayTime(s.slated_at)}{s.performance_mode === 'versus' ? ' · Versus' : ''}
                        </Text>
                      </Pressable>
                      {s.actual_started_at && !s.actual_ended_at
                        ? <Badge kind="live" />
                        : <Icon.Bell size={20} color={color.mutedOnLight} />}
                    </Card>
                  ))}
                </View>
              ) : (
                <Empty
                  icon={<Icon.Calendar size={24} color={color.ink} />}
                  title="No shows booked yet"
                  body={`${artist.display_name} has not scheduled anything. Follow to hear when they do.`}
                  actionLabel={following || isOwner ? undefined : 'Follow'}
                  onAction={toggleFollow}
                  testID="profile-no-shows"
                />
              )
            ) : null}

            {tab === 'shows' ? (
              (recordings || []).length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {recordings.map((r) => (
                    <Pressable
                      key={r.id}
                      accessibilityRole="button"
                      accessibilityLabel={r.title}
                      onPress={() => router.push(`/recording/${r.id}`)}
                      style={{ width: tile }}
                    >
                      <MediaTile style={{ width: tile, height: 160, borderRadius: 8 }}>
                        {clock(r.duration_ms) ? (
                          <View style={{ position: 'absolute', left: 6, bottom: 6 }}>
                            <Text style={{ fontFamily: face.bold, fontSize: 13, fontWeight: '700', color: color.porcelain }}>{clock(r.duration_ms)}</Text>
                          </View>
                        ) : null}
                      </MediaTile>
                    </Pressable>
                  ))}
                </View>
              ) : (
                // "No shows yet" is ProfileEmpty.dc.html's wording. The line
                // under it there is written to the artist ("Every show you
                // play…"), so on someone else's profile it is replaced with
                // the same fact told to a visitor.
                <Empty
                  icon={<Icon.Film size={24} color={color.ink} />}
                  title="No shows yet"
                  body="Shows appear here after they have been performed."
                  testID="profile-no-recordings"
                />
              )
            ) : null}

            {tab === 'clips' ? (
              (clips || []).length ? (
                <View style={{ gap: space.s }}>
                  {clips.map((c) => (
                    <Card key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                      <Pressable
                        style={{ flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' }}
                        accessibilityRole="button"
                        accessibilityLabel={c.title}
                        // A clip is a range of a recording, so it opens the
                        // recording it was cut from. Clips with no recording
                        // left behind them are not tappable.
                        onPress={c.recording_id ? () => router.push(`/recording/${c.recording_id}`) : undefined}
                      >
                        <Text style={text.rowTitle} numberOfLines={1}>{c.title}</Text>
                        <Text style={text.supporting}>{clock(Number(c.end_ms) - Number(c.start_ms)) || ''}</Text>
                      </Pressable>
                      <Icon.Film size={20} color={color.mutedOnLight} />
                    </Card>
                  ))}
                </View>
              ) : (
                <Empty
                  icon={<Icon.Film size={24} color={color.ink} />}
                  title="No clips yet"
                  body="Clips are cut from a show once it has been performed."
                  testID="profile-no-clips"
                />
              )
            ) : null}

            {tab === 'about' ? (
              <Card style={{ gap: space.sm, padding: space.l }}>
                <Text style={[text.body, { fontSize: 16 }]}>
                  {artist.bio || `${artist.display_name} has not written a bio yet.`}
                </Text>
                {artist.city || artist.country ? (
                  <Text style={text.supporting}>{[artist.city, artist.country].filter(Boolean).join(', ')}</Text>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : (
          <Empty
            icon={<Icon.Person size={24} color={color.ink} />}
            title={`${artist.display_name} is a fan`}
            body="Fans do not have public pages beyond this."
            testID="profile-fan"
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function ProfileSkeleton() {
  return (
    <Screen>
      <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Skeleton width={44} height={44} radius={22} />
          <Skeleton width={120} height={20} />
          <Skeleton width={44} height={44} radius={22} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
          <Skeleton width={88} height={88} radius={44} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="70%" height={30} />
            <Skeleton width="45%" height={17} />
            <Skeleton width="35%" height={16} />
          </View>
        </View>
        <Skeleton width="100%" height={46} radius={23} />
        <Skeleton width="100%" height={88} radius={16} />
        <Skeleton width="100%" height={44} radius={22} />
        <Skeleton width="100%" height={160} radius={8} />
      </View>
    </Screen>
  );
}
