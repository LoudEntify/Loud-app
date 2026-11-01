// Search.dc.html, SearchResults.dc.html and SearchNoResults.dc.html — one
// screen in three states.
//
// Idle is the recent searches, the genre chips and what is live. Typing
// swaps in the results under their tabs. Nothing matching swaps in the near
// spellings the route worked out and what is live instead, because a search
// that dead-ends is the one place in the app where a person gives up.
//
// The route is open and rate-limited, so this does not wait on the session
// before it will search: a guest gets the same results, they just get no
// saved history.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Screen, MediaTile, Chip, Badge, Button, Field, Empty, ErrorPanel, Skeleton, Row, IconButton, Icon,
  color, space, size, radius, surface, text, useLoadingPhase,
} from '../src/ui';
import { api } from '../src/api';
import { supabase, useSession, AUTH_CONFIGURED } from '../src/session';

// Recent searches are kept on the device on purpose. The route says so in
// as many words ("Search history lives on the device, not here"), and that
// is what lets someone search before they have an account without us
// starting a record of what they looked for.
const RECENT_KEY = 'loudentify.recentSearches';
const RECENT_MAX = 8;

const TABS = [
  { key: 'top', label: 'Top' },
  { key: 'artists', label: 'Artists' },
  { key: 'live', label: 'Live and upcoming' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'genres', label: 'Genres' },
];

const artistName = (a) => a?.display_name || a?.username || 'Artist';

const showName = (s) => (s.performance_mode === 'versus'
  ? `${artistName(s.artist)} vs ${artistName(s.artist_b)}`
  : artistName(s.artist));

const whenLabel = (iso) => (iso
  ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '');

export default function Search() {
  const params = useLocalSearchParams();
  const { session } = useSession();
  const userId = session?.user?.id || null;

  const [query, setQuery] = useState(String(params.q || ''));
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('top');
  const [recent, setRecent] = useState([]);
  const [following, setFollowing] = useState(() => new Set());
  const phase = useLoadingPhase(data === null && !failed);

  const load = useCallback(async (term) => {
    setFailed(false);
    const r = await api(`/api/viewer/search?q=${encodeURIComponent(term)}`);
    if (!r.ok) { setFailed(true); return; }
    setData(r.data);
  }, []);

  // Typing runs the search, but not on every keystroke: the route is rate
  // limited at 120 a minute and a person types faster than that.
  useEffect(() => {
    const term = query.trim();
    const t = setTimeout(() => load(term), term ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then(
      (raw) => { try { setRecent(JSON.parse(raw) || []); } catch { setRecent([]); } },
      () => setRecent([]),
    );
  }, []);

  // Who this person already follows, so the Follow button starts in the
  // right state. Read straight from the table under row-level security, the
  // same way lib/follows.js does on the web — there is no route for it,
  // because a follow is a row only its owner may write.
  useEffect(() => {
    if (!userId || !AUTH_CONFIGURED) return;
    supabase().from('follows').select('artist_id').eq('follower_id', userId).then(
      ({ data: rows }) => setFollowing(new Set((rows || []).map((r) => r.artist_id))),
      () => { /* the table may not exist in this environment; no follows is the safe answer */ },
    );
  }, [userId]);

  const keepRecent = useCallback((term) => {
    const t = term.trim();
    if (!t) return;
    setRecent((was) => {
      const next = [t, ...was.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => { /* history is a convenience */ });
      return next;
    });
  }, []);

  const writeRecent = useCallback((next) => {
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => { /* history is a convenience */ });
  }, []);

  // A genre chip or a spelling suggestion searches for that term here,
  // rather than pushing another copy of this screen onto the stack.
  const searchFor = useCallback((term) => { setQuery(term); setTab('top'); keepRecent(term); }, [keepRecent]);

  async function toggleFollow(artistId) {
    if (!userId || !AUTH_CONFIGURED) { router.push('/signup'); return; }
    const on = following.has(artistId);
    setFollowing((was) => { const next = new Set(was); if (on) next.delete(artistId); else next.add(artistId); return next; });
    try {
      const sb = supabase().from('follows');
      const { error } = on
        ? await sb.delete().eq('follower_id', userId).eq('artist_id', artistId)
        : await sb.upsert({ follower_id: userId, artist_id: artistId }, { onConflict: 'follower_id,artist_id', ignoreDuplicates: true });
      if (error) throw error;
    } catch {
      // Put the button back rather than leaving it claiming something the
      // database did not accept.
      setFollowing((was) => { const next = new Set(was); if (on) next.add(artistId); else next.delete(artistId); return next; });
    }
  }

  const results = data?.results || {};
  const artists = results.artists || [];
  const genres = results.genres || [];
  const liveNow = results.liveNow || [];
  const shows = results.shows || [];
  const upcoming = useMemo(() => shows.filter((s) => s.derived_state !== 'ended' && s.derived_state !== 'cancelled'), [shows]);
  const recordings = useMemo(() => shows.filter((s) => s.derived_state === 'ended'), [shows]);
  const liveArtistIds = useMemo(
    () => new Set(liveNow.flatMap((s) => [s.artist_id, s.artist_b_id]).filter(Boolean)),
    [liveNow],
  );

  const searching = query.trim().length > 0;
  const nothing = searching && !artists.length && !shows.length && !genres.length;
  const suggestions = data?.suggestions || null;
  const nearSpellings = suggestions?.spellings || [];
  const nearestGenre = suggestions?.nearestGenre || null;

  const show = (key) => tab === 'top' || tab === key;

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 52 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.screenEdge }}>
          <IconButton label="Back" onPress={() => router.back()}>
            <Icon.Back size={22} color={color.ink} />
          </IconButton>
          <SearchBar value={query} onChangeText={setQuery} onSubmit={() => keepRecent(query)} onClear={() => setQuery('')} />
        </View>

        {searching ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.screenEdge, paddingTop: space.l }}
          >
            {TABS.map((t) => (
              <Chip key={t.key} role="tab" selected={tab === t.key} onPress={() => setTab(t.key)}>{t.label}</Chip>
            ))}
          </ScrollView>
        ) : null}

        {phase === 'loading' ? (
          <SearchSkeleton />
        ) : (
          <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: space.xl, paddingBottom: 120, gap: space.xl }}>
            {/* Ten seconds with nothing back is an error, not a longer wait. */}
            {failed || phase === 'slow' ? (
              <ErrorPanel
                title="We could not run that search"
                body="It may be the connection. Try again."
                onRetry={() => load(query.trim())}
                backLabel="Back to Discover"
                onBack={() => router.push('/discover')}
              />
            ) : null}

            {/* ── Idle: what the board calls Search.dc.html ───────────── */}
            {!searching && recent.length ? (
              <View style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[text.sectionHeading, { flex: 1, fontSize: 20 }]}>Recent</Text>
                  {/* The board draws this 32 high; nothing tappable goes under 44. */}
                  <Button kind="quiet" size="medium" onPress={() => writeRecent([])}>Clear all</Button>
                </View>
                {recent.map((term) => (
                  <View key={term} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={term}
                      onPress={() => searchFor(term)}
                      style={{ flex: 1, minHeight: size.touch, flexDirection: 'row', alignItems: 'center', gap: space.m }}
                    >
                      <Icon.Search size={20} color={color.mutedOnLight} />
                      <Text style={[text.body, { flex: 1 }]} numberOfLines={1}>{term}</Text>
                    </Pressable>
                    <IconButton
                      label={`Remove ${term}`}
                      onPress={() => writeRecent(recent.filter((r) => r !== term))}
                      style={{ backgroundColor: 'transparent' }}
                    >
                      <Icon.Close size={20} color={color.ink} />
                    </IconButton>
                  </View>
                ))}
              </View>
            ) : null}

            {!searching && genres.length ? (
              <View style={{ gap: space.s }}>
                <Text style={[text.sectionHeading, { fontSize: 20 }]}>Browse genres</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {genres.slice(0, 8).map((g) => (
                    <Chip key={g} role="button" onPress={() => searchFor(g)}>{g}</Chip>
                  ))}
                </View>
              </View>
            ) : null}

            {!searching ? (
              <View style={{ gap: space.s }}>
                <LiveHeading>Live now</LiveHeading>
                {liveNow.length ? (
                  liveNow.map((s) => <LiveRow key={s.id} show={s} />)
                ) : (
                  <Empty
                    icon={<Icon.Eye size={24} color={color.ink} />}
                    title="Nothing live right now"
                    body="Search for an artist, a show or a genre and we will tell you when they are on."
                    actionLabel="Open Discover"
                    onAction={() => router.push('/discover')}
                    testID="search-live-empty"
                  />
                )}
              </View>
            ) : null}

            {/* ── Nothing matched: SearchNoResults.dc.html ────────────── */}
            {nothing ? (
              <Empty
                icon={<Icon.Search size={24} color={color.ink} />}
                title="Nothing matched that"
                body="Check the spelling, or try one of these."
                testID="search-no-results"
              />
            ) : null}

            {nothing && (nearSpellings.length || nearestGenre) ? (
              <View style={{ gap: space.s }}>
                <Text style={[text.sectionHeading, { fontSize: 18 }]}>Did you mean</Text>
                {nearSpellings.map((s) => (
                  <Row
                    key={`spelling-${s}`}
                    icon={<Icon.Search size={20} color={color.ink} />}
                    title={s}
                    onPress={() => searchFor(s)}
                  />
                ))}
                {nearestGenre && !nearSpellings.includes(nearestGenre) ? (
                  <Row
                    icon={<Icon.Sparkle size={20} color={color.ink} />}
                    title={nearestGenre}
                    onPress={() => searchFor(nearestGenre)}
                  />
                ) : null}
              </View>
            ) : null}

            {nothing && liveNow.length ? (
              <View style={{ gap: space.m }}>
                <LiveHeading>Live right now instead</LiveHeading>
                {liveNow.map((s) => <LiveCover key={s.id} show={s} />)}
              </View>
            ) : null}

            {/* ── Results: SearchResults.dc.html ─────────────────────── */}
            {searching && show('artists') && artists.length ? (
              <View style={{ gap: space.m }}>
                <Text style={text.label}>Artists</Text>
                {(tab === 'top' ? artists.slice(0, 3) : artists).map((a) => (
                  <Row
                    key={a.id}
                    icon={<MediaTile style={{ width: 52, height: 52, borderRadius: 26 }} />}
                    title={artistName(a)}
                    subtitle={[a.genres?.[0], a.username ? `@${a.username}` : null].filter(Boolean).join(' · ')}
                    right={liveArtistIds.has(a.id)
                      ? <Badge kind="live" />
                      : (
                        <Button
                          kind="quiet"
                          size="chip"
                          onPress={() => toggleFollow(a.id)}
                          accessibilityLabel={`${following.has(a.id) ? 'Unfollow' : 'Follow'} ${artistName(a)}`}
                        >
                          {following.has(a.id) ? 'Following' : 'Follow'}
                        </Button>
                      )}
                  />
                ))}
              </View>
            ) : null}

            {searching && show('live') && upcoming.length ? (
              <View style={{ gap: space.m }}>
                <Text style={text.label}>Shows</Text>
                {(tab === 'top' ? upcoming.slice(0, 3) : upcoming).map((s) => (
                  <Row
                    key={s.id}
                    icon={<MediaTile style={{ width: 76, height: 56, borderRadius: radius.field }} />}
                    title={s.title}
                    subtitle={`${showName(s)} · ${s.derived_state === 'live' ? 'Live now' : whenLabel(s.slated_at)}`}
                    onPress={() => router.push(`/show/${s.id}`)}
                  />
                ))}
              </View>
            ) : null}

            {searching && show('recordings') && recordings.length ? (
              <View style={{ gap: space.m }}>
                <Text style={text.label}>Recordings</Text>
                {(tab === 'top' ? recordings.slice(0, 2) : recordings).map((s) => (
                  <Row
                    key={s.id}
                    icon={<MediaTile style={{ width: 76, height: 56, borderRadius: radius.field }} />}
                    title={s.title}
                    subtitle={`Recording · ${showName(s)}`}
                    onPress={() => router.push(`/show/${s.id}`)}
                  />
                ))}
              </View>
            ) : null}

            {searching && show('genres') && genres.length ? (
              <View style={{ gap: space.s }}>
                <Text style={text.label}>Genres</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {genres.map((g) => (
                    <Chip key={g} role="button" onPress={() => searchFor(g)}>{g}</Chip>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

/**
 * The 48-high pill the boards draw: the magnifier inside it on the left, and
 * a clear button on the right once there is something to clear. It is the
 * kit's Field underneath, so the type, the colours and the focus behaviour
 * are the same as every other input in the app.
 */
function SearchBar({ value, onChangeText, onSubmit, onClear }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Field
        value={value}
        onChangeText={onChangeText}
        placeholder="Artists, shows, genres"
        accessibilityLabel="Search"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        testID="search-input"
        inputStyle={{
          height: 48,
          borderRadius: 24,
          backgroundColor: surface.card,
          paddingLeft: 42,
          paddingRight: value ? 48 : 14,
        }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
        <Icon.Search size={20} color={color.ink} />
      </View>
      {value ? (
        <IconButton label="Clear search" onPress={onClear} style={{ position: 'absolute', right: 2, top: 2, backgroundColor: 'transparent' }}>
          <Icon.Close size={20} color={color.ink} />
        </IconButton>
      ) : null}
    </View>
  );
}

/** The heading with the red dot beside it, as Live and both search boards draw it. */
const LiveHeading = ({ children }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.red }} />
    <Text style={[text.sectionHeading, { flex: 1, fontSize: 20 }]}>{children}</Text>
  </View>
);

/** A live show as a row: the 56x72 cover, who it is, and the LIVE badge. */
function LiveRow({ show }) {
  return (
    <Row
      icon={<MediaTile style={{ width: 56, height: 72, borderRadius: space.s }} />}
      title={showName(show)}
      subtitle={show.title}
      right={<Badge kind="live" />}
      onPress={() => router.push(`/show/${show.id}`)}
    />
  );
}

/** A live show as the full-width cover the no-results board offers instead. */
function LiveCover({ show }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={showName(show)} onPress={() => router.push(`/show/${show.id}`)} style={{ gap: 6 }}>
      <MediaTile style={{ height: 170, borderRadius: radius.card }}>
        <View style={{ position: 'absolute', left: space.sm, top: space.sm }}>
          <Badge kind="live" />
        </View>
      </MediaTile>
      <Text style={text.rowTitle} numberOfLines={1}>{showName(show)}</Text>
    </Pressable>
  );
}

function SearchSkeleton() {
  return (
    <View style={{ padding: space.screenEdge, paddingTop: space.xl, gap: space.l }}>
      <Skeleton width={110} height={22} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Skeleton width={56} height={72} radius={10} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="70%" height={18} />
            <Skeleton width="45%" height={14} />
          </View>
        </View>
      ))}
      <Skeleton width={150} height={22} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {[96, 72, 88, 104, 80].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
      </View>
    </View>
  );
}
