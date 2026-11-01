// Main.dc.html / Discover-Preview.dc.html / DiscoverEmpty.dc.html —
// the feed, in all three of its states.
//
// One show per swipe, playing full screen, with the artist's name and the
// show title over the bottom of the picture and a column of actions down
// the right. A signed-out viewer gets sixty seconds across the whole feed
// (PreviewMeter, shared with the web), a quiet chip when the minute is
// nearly up, and the sign-up sheet when it is.
//
// The scrims matter: the board puts a dark gradient over the top 150px and
// another over the bottom 420px, so white text stays readable whatever the
// video behind it is doing. Without them the copy disappears against a
// bright stage.
import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Screen, Button, Badge, Empty, ErrorPanel, Skeleton, Icon,
  color, space, size, text, textOnDark, face, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { PreviewMeter } from '../../src/shared';
import { Player } from '../../src/player/PlayerSource';

export default function Discover() {
  const { width, height } = useWindowDimensions();
  const { session, accessToken, loading } = useSession();
  const [cards, setCards] = useState(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [chip, setChip] = useState(false);
  const [expired, setExpired] = useState(false);
  const meter = useRef(new PreviewMeter());
  const phase = useLoadingPhase(cards === null && !failed);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await api('/api/viewer/feed', { accessToken });
    if (!r.ok) { setFailed(true); setCards((c) => c || []); return; }
    setCards(r.data.cards);
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  // The free minute, counted across cards rather than per card.
  useEffect(() => {
    if (session || loading) return undefined;
    const t = setInterval(() => {
      if (meter.current.expired()) setExpired(true);
      else if (meter.current.chipDue()) setChip(true);
    }, 1000);
    return () => clearInterval(t);
  }, [session, loading]);

  if (phase !== 'done' && phase !== 'slow') return <FeedSkeleton />;

  if (failed && !cards?.length) {
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.l }}>
          <ErrorPanel
            title="We could not load Discover"
            body="It may be the connection. Try again, or see what is on Live."
            onRetry={load}
            backLabel="Open Live"
            onBack={() => router.push('/live')}
          />
        </View>
      </Screen>
    );
  }

  if (!cards.length) {
    // DiscoverEmpty.dc.html: say what is not here, then the one action.
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty
            dark
            icon={<Icon.Eye size={24} color={color.ink} />}
            title="Nothing live right now"
            body="Shows are booked at least thirty minutes ahead, so there is always something coming."
            actionLabel="See what is coming"
            onAction={() => router.push('/live')}
            testID="discover-empty"
          />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <FlatList
        data={cards}
        keyExtractor={(c, i) => `${c.show?.id || c.recording?.id || 'card'}-${i}`}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.y / height))}
        renderItem={({ item, index }) => (
          <FeedCard
            card={item}
            active={index === active}
            width={width}
            height={height}
            onState={(s) => meter.current.onPlayerState(s)}
          />
        )}
      />

      {chip && !session && !expired ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/signup?trigger=timer')}
          style={{ position: 'absolute', left: space.l, right: space.l, top: 60, paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: 999, backgroundColor: color.porcelain, gap: 2 }}
        >
          <Text style={[text.rowTitle, { fontSize: 17 }]}>Sign up free to keep watching</Text>
          <Text style={text.supporting}>Your free minute ends in {Math.max(0, Math.ceil(meter.current.remainingMs() / 1000))} seconds</Text>
        </Pressable>
      ) : null}

      {expired && !session ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: '45%', backgroundColor: color.mist, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, gap: space.m }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.2)' }} />
          <Text style={[text.screenTitle, { fontSize: 30 }]}>Your free minute is up</Text>
          <Text style={text.body}>Sign up in under a minute and the music carries on from here.</Text>
          <Button kind="main" onPress={() => router.push('/signup?trigger=timer')}>Keep watching, free</Button>
          <Button kind="quiet" size="medium" onPress={() => router.push('/login')}>I already have an account</Button>
        </View>
      ) : null}
    </View>
  );
}

function FeedCard({ card, active, width, height, onState }) {
  const show = card.show;
  const rec = card.recording;
  const artist = show?.artist || rec?.artist;
  const live = card.kind === 'live';
  const versus = show?.performance_mode === 'versus';
  const name = versus
    ? `${artist?.display_name || 'Artist A'} vs ${show?.artist_b?.display_name || 'Artist B'}`
    : artist?.display_name || show?.artist_name || 'Artist';

  return (
    <View style={{ width, height, backgroundColor: color.ink, justifyContent: 'flex-end' }}>
      {live && active ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Player show={show} width={Math.min(width, (height * 9) / 16)} height={height} onState={onState} />
        </View>
      ) : null}

      {/* The two scrims from the board, so the copy stays readable. */}
      <LinearGradient pointerEvents="none" colors={['rgba(1,22,39,0.75)', 'rgba(1,22,39,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 150 }} />
      <LinearGradient pointerEvents="none" colors={['rgba(1,22,39,0)', 'rgba(1,22,39,0.9)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 420 }} />

      {/* Search and Inbox, top right. */}
      <View style={{ position: 'absolute', left: space.l, right: space.l, top: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm }}>
        <OverAction label="Search" onPress={() => router.push('/search')}><Icon.Search size={22} color={color.porcelain} /></OverAction>
        <OverAction label="Inbox" onPress={() => router.push('/inbox')}><Icon.Bell size={22} color={color.porcelain} /></OverAction>
      </View>

      {/* The column of actions down the right. */}
      <View style={{ position: 'absolute', right: space.m, bottom: 132, alignItems: 'center', gap: space.xl }}>
        <ColumnAction label="Follow" onPress={() => show?.artist?.username && router.push(`/artist/${show.artist.username}`)}>
          <Icon.Person size={24} color={color.porcelain} />
        </ColumnAction>
        <ColumnAction label="Share" onPress={() => {}}><Icon.Share size={22} color={color.porcelain} /></ColumnAction>
        <ColumnAction label="More" onPress={() => {}}><Icon.Flag size={22} color={color.porcelain} /></ColumnAction>
      </View>

      <View style={{ paddingLeft: space.l, paddingRight: 84, paddingBottom: 104, gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {live ? <Badge kind="live" /> : <Badge kind="soon">{card.kind === 'soon' ? 'SOON' : 'RECORDING'}</Badge>}
          {versus ? <Badge kind="versus" /> : null}
          {live && show?.viewers != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.6)' }}>
              <Icon.Eye size={16} color={color.porcelain} />
              <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{show.viewers} watching</Text>
            </View>
          ) : null}
        </View>

        <Text style={[textOnDark.screenTitle, { fontSize: 28 }]} numberOfLines={2}>{name}</Text>
        <Text style={[textOnDark.body, { fontSize: 18 }]} numberOfLines={2}>{show?.title || rec?.title}</Text>

        {show?.genre ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Pill>{show.genre}</Pill>
            <Pill>{versus ? 'Versus' : 'Solo show'}</Pill>
          </View>
        ) : null}

        {live ? (
          <Button kind="main" onPress={() => router.push(`/show/${show.id}`)} style={{ marginTop: 6 }} testID="join-show">Join the show</Button>
        ) : card.kind === 'soon' ? (
          <Button kind="quietDark" onPress={() => router.push(`/show/${show.id}`)} style={{ marginTop: 6 }}>See the show</Button>
        ) : (
          <Button kind="quietDark" onPress={() => rec?.id && router.push(`/recording/${rec.id}`)} style={{ marginTop: 6 }}>Watch the recording</Button>
        )}
      </View>
    </View>
  );
}

const Pill = ({ children }) => (
  <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(253,255,252,0.16)' }}>
    <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{children}</Text>
  </View>
);

const OverAction = ({ label, onPress, children }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: size.touch, height: size.touch, borderRadius: size.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(1,22,39,0.5)' }}>
    {children}
  </Pressable>
);

const ColumnAction = ({ label, onPress, children }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 56, alignItems: 'center', gap: 4 }}>
    <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(1,22,39,0.5)' }}>
      {children}
    </View>
    <Text style={{ fontFamily: face.regular, fontSize: 13, color: color.porcelain }}>{label}</Text>
  </Pressable>
);

/** "Grey shapes in the layout the real content will take." */
function FeedSkeleton() {
  return (
    <Screen dark>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingLeft: space.l, paddingRight: 84, paddingBottom: 104, gap: space.s }}>
        <Skeleton width={120} height={26} radius={999} />
        <Skeleton width="80%" height={34} />
        <Skeleton width="60%" height={22} />
        <Skeleton width="100%" height={52} radius={26} />
      </View>
    </Screen>
  );
}
