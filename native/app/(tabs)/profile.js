// Profile-Owner.dc.html, ViewerProfile.dc.html and ProfileEmpty.dc.html —
// one tab, three people.
//
// An artist sees their next show, the thing to do about it, and their own
// shows, clips and numbers. A viewer sees who they follow and the way to
// become an artist on the same account. An artist with nothing booked yet
// sees the two things standing between them and a first show.
//
// What left with this rewrite: two WebViews. Earnings and Settings used to
// open the website in a frame, which is most of what made the app feel
// like two apps stitched together. Both are native screens now.
//
// Money rule, unchanged: balance only, never a buy button (CLAUDE.md §4).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, MediaTile, Button, Chip, Badge, Empty, ErrorPanel, Skeleton, Row, IconButton, Icon,
  color, space, radius, text, face, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { supabase, useSession } from '../../src/session';
import { formatDuration } from '@loud/lib/insights.js';

const TABS = ['Shows', 'Clips', 'Upcoming', 'Insights'];

export default function Profile() {
  const { session, profile, loading, accessToken } = useSession();
  const [wallet, setWallet] = useState(null);
  const [shows, setShows] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [clips, setClips] = useState([]);
  const [insights, setInsights] = useState([]);
  const [following, setFollowing] = useState([]);
  const [tab, setTab] = useState('Shows');
  const [failed, setFailed] = useState(false);
  const artist = profile?.role === 'artist';
  const phase = useLoadingPhase(!!session && shows === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken || !session?.user?.id) return;
    setFailed(false);
    const uid = session.user.id;
    const sb = supabase();

    const w = await api('/api/viewer/wallet', { accessToken });
    if (w.ok) setWallet(w.data);

    if (artist) {
      // An artist's own rows, read under row-level security: there is no
      // route that lists them and the policy is already the whole rule.
      const [{ data: s }, { data: r }, { data: c }, i] = await Promise.all([
        sb.from('shows').select('id, title, slated_at, performance_mode, state, actual_started_at, actual_ended_at, cancelled_at, genre').eq('artist_id', uid).order('slated_at', { ascending: false }).limit(50),
        sb.from('recordings').select('id, title, duration_ms, recorded_at, show_id, visibility').eq('artist_id', uid).order('recorded_at', { ascending: false }).limit(50),
        sb.from('clips').select('id, title, start_ms, end_ms, created_at, recording_id').eq('artist_id', uid).order('created_at', { ascending: false }).limit(50),
        api('/api/artist/insights', { accessToken }),
      ]);
      setShows(s || []);
      setRecordings(r || []);
      setClips(c || []);
      setInsights(i.ok ? (i.data.shows || []) : []);
      if (!s) setFailed(true);
    } else {
      const { data: f } = await sb.from('follows').select('artist_id').eq('follower_id', uid).limit(100);
      const ids = (f || []).map((x) => x.artist_id);
      if (ids.length) {
        const { data: who } = await sb.from('public_profiles').select('id, username, display_name, genres').in('id', ids);
        setFollowing(who || []);
      }
      setShows([]);
    }
  }, [accessToken, session, artist]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  if (loading) return <ProfileSkeleton />;

  if (!session) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty
            icon={<Icon.Person size={24} color={color.ink} />}
            title="Your profile lives with your account"
            body="Sign up free to follow artists, set reminders and hold tokens."
            actionLabel="Sign up free"
            onAction={() => router.push('/signup?trigger=profile')}
          />
          <Button kind="quiet" size="medium" style={{ alignSelf: 'center' }} onPress={() => router.push('/login')}>I already have an account</Button>
        </View>
      </Screen>
    );
  }

  if (phase !== 'done' && phase !== 'slow') return <ProfileSkeleton />;

  const name = profile?.display_name || profile?.username || 'You';
  const nextShow = (shows || [])
    .filter((s) => !s.cancelled_at && !s.actual_ended_at && Date.parse(s.slated_at) > Date.now() - 2 * 3600_000)
    .sort((a, b) => Date.parse(a.slated_at) - Date.parse(b.slated_at))[0];
  const past = (shows || []).filter((s) => s.actual_ended_at);
  const noShowsYet = artist && !(shows || []).length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 120, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <MediaTile style={{ width: 72, height: 72, borderRadius: 36 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[text.screenTitle, { fontSize: 30 }]} numberOfLines={1}>{name}</Text>
            <Text style={text.supporting}>@{profile?.username}</Text>
            {artist && profile?.genres?.length ? <Text style={text.supporting}>{profile.genres.slice(0, 2).join(' · ')}</Text> : null}
          </View>
          <IconButton label="Menu" onPress={() => router.push('/menu')} testID="menu">
            <Icon.Gear size={22} color={color.ink} />
          </IconButton>
        </View>

        {failed ? <ErrorPanel title="We could not load your profile" body="It may be the connection." onRetry={load} /> : null}

        {artist ? (
          <>
            {noShowsYet ? (
              // ProfileEmpty.dc.html: two things left before a first show.
              <Card style={{ gap: space.m }}>
                <Text style={text.rowTitle}>Two things left before your first show</Text>
                <Row icon={<Icon.Camera size={22} color={color.ink} />} title="Pair a camera" subtitle="Use this phone, or a second one" onPress={() => router.push('/camera')} />
                <Row icon={<Icon.Calendar size={22} color={color.ink} />} title="Book your first show" subtitle="At least thirty minutes ahead" onPress={() => router.push('/artist/schedule')} />
              </Card>
            ) : null}

            {nextShow ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/artist/console/${nextShow.id}`)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: 14, borderRadius: radius.card, backgroundColor: 'rgba(46,196,182,0.24)' }}
              >
                <Icon.Calendar size={22} color={color.ink} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={text.rowTitle} numberOfLines={1}>
                    Next show {new Date(nextShow.slated_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={text.supporting}>Stage ready. Tap to run Kit Check.</Text>
                </View>
                <Icon.Chevron size={20} color={color.ink} />
              </Pressable>
            ) : null}

            <Button kind="strong" onPress={() => router.push('/artist/schedule')} icon={<Icon.Plus size={20} color={color.porcelain} />}>Schedule a show</Button>

            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button kind="quiet" size="medium" style={{ flex: 1 }} onPress={() => router.push('/artist/kit-check')} icon={<Icon.Wrench size={18} color={color.ink} />}>Kit check</Button>
              <Button kind="quiet" size="medium" style={{ flex: 1 }} onPress={() => router.push('/artist/earnings')} icon={<Icon.Coin size={18} color={color.ink} />}>Earnings</Button>
            </View>

            <View accessibilityRole="tablist" accessibilityLabel="Your sections" style={{ flexDirection: 'row', gap: space.sm }}>
              {TABS.map((t) => <Chip key={t} selected={tab === t} onPress={() => setTab(t)}>{t}</Chip>)}
            </View>

            {tab === 'Shows' ? <RecordingList rows={recordings} /> : null}
            {tab === 'Clips' ? <ClipList rows={clips} /> : null}
            {tab === 'Upcoming' ? <UpcomingList rows={(shows || []).filter((s) => !s.actual_ended_at && !s.cancelled_at)} /> : null}
            {tab === 'Insights' ? <InsightList rows={insights} past={past.length} /> : null}
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/become-artist')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: space.l, borderRadius: radius.cardLg, backgroundColor: color.ink }}
            >
              <Icon.Note size={24} color={color.porcelain} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: face.bold, fontSize: 19, fontWeight: '700', color: color.porcelain }}>Become an artist</Text>
                <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.mutedOnDark }}>Same account. Book shows and get paid.</Text>
              </View>
              <Icon.Chevron size={22} color={color.porcelain} />
            </Pressable>

            <Card style={{ gap: 4 }}>
              <Text style={text.label}>Your balance</Text>
              <Text style={{ fontFamily: face.bold, fontSize: 40, fontWeight: '700', color: color.ink }}>{wallet ? `${wallet.balance}` : '—'}</Text>
              <Text style={text.supporting}>tokens. Buy them on loudentify.app; the app shows what you have.</Text>
            </Card>

            <View style={{ gap: space.s }}>
              <Text style={text.sectionHeading}>Following</Text>
              {following.length ? following.map((a) => (
                <Row
                  key={a.id}
                  icon={<MediaTile style={{ width: 44, height: 44, borderRadius: 22 }} />}
                  title={a.display_name || a.username}
                  subtitle={(a.genres || []).slice(0, 2).join(' · ') || `@${a.username}`}
                  onPress={() => router.push(`/artist/${a.username}`)}
                />
              )) : (
                <Empty
                  icon={<Icon.Heart size={24} color={color.ink} />}
                  title="You are not following anyone yet"
                  body="Follow an artist and their shows turn up here."
                  actionLabel="Find artists"
                  onAction={() => router.push('/discover')}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function RecordingList({ rows }) {
  if (!rows.length) {
    return <Empty icon={<Icon.Film size={24} color={color.ink} />} title="No shows yet" body="Every show you play is recorded here." actionLabel="Schedule a show" onAction={() => router.push('/artist/schedule')} />;
  }
  return (
    <View style={{ gap: space.s }}>
      {rows.map((r) => (
        <Row
          key={r.id}
          icon={<MediaTile style={{ width: 56, height: 56, borderRadius: radius.field }} />}
          title={r.title || 'Untitled show'}
          subtitle={`${r.visibility === 'public' ? 'Public' : r.visibility === 'unlisted' ? 'Unlisted' : 'Private'} · ${formatDuration(r.duration_ms || 0)}`}
          onPress={() => router.push(`/recording/${r.id}`)}
        />
      ))}
    </View>
  );
}

function ClipList({ rows }) {
  if (!rows.length) return <Empty icon={<Icon.Film size={24} color={color.ink} />} title="No clips yet" body="Cut a clip from a show and it appears here." />;
  return (
    <View style={{ gap: space.s }}>
      {rows.map((c) => (
        <Row
          key={c.id}
          icon={<MediaTile style={{ width: 56, height: 56, borderRadius: radius.field }} />}
          title={c.title || 'Clip'}
          subtitle={formatDuration((c.end_ms || 0) - (c.start_ms || 0))}
          onPress={() => c.recording_id && router.push(`/recording/${c.recording_id}`)}
        />
      ))}
    </View>
  );
}

function UpcomingList({ rows }) {
  if (!rows.length) return <Empty icon={<Icon.Calendar size={24} color={color.ink} />} title="Nothing booked" body="Shows are booked at least thirty minutes ahead." actionLabel="Schedule a show" onAction={() => router.push('/artist/schedule')} />;
  return (
    <View style={{ gap: space.s }}>
      {rows.map((s) => (
        <Row
          key={s.id}
          title={s.title || 'Untitled show'}
          subtitle={new Date(s.slated_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          right={s.performance_mode === 'versus' ? <Badge kind="versus" /> : null}
          onPress={() => router.push(`/artist/console/${s.id}`)}
        />
      ))}
    </View>
  );
}

function InsightList({ rows, past }) {
  if (!rows.length) {
    return <Empty icon={<Icon.Chart size={24} color={color.ink} />} title={past ? 'Numbers are still being counted' : 'No numbers yet'} body={past ? 'They appear within a few minutes of a show ending.' : 'Play a show and its numbers turn up here.'} />;
  }
  return (
    <View style={{ gap: space.s }}>
      {rows.map((r) => (
        <Card key={r.show_id} style={{ gap: space.sm }}>
          <Text style={text.rowTitle} numberOfLines={1}>{r.title || 'Show'}</Text>
          <Text style={text.supporting}>{r.slated_at ? new Date(r.slated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</Text>
          <View style={{ flexDirection: 'row', gap: space.l }}>
            <Stat label="Peak" value={r.peak_viewers ?? 0} />
            <Stat label="Watch time" value={formatDuration(r.watch_time_ms || 0)} />
            <Stat label="Votes" value={r.votes_cast ?? 0} />
            <Stat label="Tokens" value={r.tokens_received ?? 0} />
          </View>
        </Card>
      ))}
    </View>
  );
}

const Stat = ({ label, value }) => (
  <View style={{ gap: 2 }}>
    <Text style={text.supporting}>{label}</Text>
    <Text style={{ fontFamily: face.bold, fontSize: 20, fontWeight: '700', color: color.ink }}>{value}</Text>
  </View>
);

function ProfileSkeleton() {
  return (
    <Screen>
      <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Skeleton width={72} height={72} radius={36} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="70%" height={30} />
            <Skeleton width="40%" height={18} />
          </View>
        </View>
        <Skeleton width="100%" height={72} radius={16} />
        <Skeleton width="100%" height={52} radius={26} />
        <Skeleton width="100%" height={88} radius={16} />
      </View>
    </Screen>
  );
}
