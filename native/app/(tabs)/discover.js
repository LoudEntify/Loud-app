// Discover: a full-screen vertical feed, one card per swipe, live first.
// Guests get 60 seconds across cards (PreviewMeter, shared with the web).
import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { styles } from '../../src/theme';
import { color, PreviewMeter } from '../../src/shared';
import { Player } from '../../src/player/PlayerSource';
import { States } from '../../src/components/States';

export default function Discover() {
  const { width, height } = useWindowDimensions();
  const { session, accessToken, loading } = useSession();
  const [cards, setCards] = useState(null); const [error, setError] = useState(null); const [active, setActive] = useState(0); const [chip, setChip] = useState(false); const [expired, setExpired] = useState(false);
  const meter = useRef(new PreviewMeter());
  const load = async () => { setError(null); const r = await api('/api/viewer/feed', { accessToken }); if (!r.ok) { setError(true); setCards((c) => c || []); return; } setCards(r.data.cards); };
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loading]);
  useEffect(() => { const t = setInterval(() => { if (!session && !loading) { if (meter.current.expired()) setExpired(true); else if (meter.current.chipDue()) setChip(true); } }, 1000); return () => clearInterval(t); }, [session, loading]);
  if (cards === null && !error) return <States.Loading dark />;
  if (error && !cards?.length) return <States.Error dark title="We couldn't load Discover" onRetry={load} />;
  if (!cards.length) return <States.Empty dark title="Nothing live right now" body="See what's coming on Live." action="Open Live" onAction={() => router.push('/live')} />;
  return (
    <View style={styles.screenDark}>
      <FlatList data={cards} keyExtractor={(c, i) => (c.show?.id || c.recording?.id) + i} pagingEnabled showsVerticalScrollIndicator={false} onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.y / height))}
        renderItem={({ item, index }) => <Card card={item} active={index === active} width={width} height={height} onState={(s) => meter.current.onPlayerState(s)} />} />
      {chip && !session && !expired && <Pressable onPress={() => router.push('/signup?trigger=timer')} style={{ position: 'absolute', left: 16, right: 16, top: 60, padding: 12, borderRadius: 999, backgroundColor: color.porcelain }}><Text style={{ fontWeight: '700', fontSize: 17 }}>Sign up free to keep watching</Text><Text style={styles.muted}>Preview ends in {Math.ceil(meter.current.remainingMs() / 1000)} seconds</Text></Pressable>}
      {expired && !session && <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: '45%', backgroundColor: color.mist, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 }}><Text style={styles.h1}>Keep watching, free</Text><Text style={styles.muted}>Your free minute is up. Sign up in under a minute and the music carries on.</Text><Pressable style={[styles.btn, { backgroundColor: color.ink, height: 52 }]} onPress={() => router.push('/signup?trigger=timer')}><Text style={styles.btnTextDark}>Sign up free</Text></Pressable></View>}
    </View>
  );
}

function Card({ card, active, width, height, onState }) {
  const show = card.show; const rec = card.recording; const artist = show?.artist || rec?.artist; const live = card.kind === 'live';
  const name = show?.performance_mode === 'versus' ? `${artist?.display_name} vs ${show.artist_b?.display_name}` : artist?.display_name || show?.artist_name || 'Artist';
  return (
    <View style={{ width, height, backgroundColor: color.ink, justifyContent: 'flex-end' }}>
      {live && active ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}><Player show={show} width={Math.min(width, height * 9 / 16)} height={height} onState={onState} /></View> : null}
      <View style={{ padding: 16, paddingBottom: 110, gap: 10, marginRight: 72 }}>
        <View style={styles.row}>{live ? <Text style={styles.badgeLive}>LIVE</Text> : <Text style={styles.badgeSoon}>{card.kind === 'soon' ? 'STARTING SOON' : 'RECORDING'}</Text>}{show?.performance_mode === 'versus' && <Text style={styles.badgeSoon}>VERSUS</Text>}</View>
        <Text style={{ color: color.porcelain, fontSize: 28, fontWeight: '700' }}>{name}</Text>
        <Text style={{ color: color.porcelain, fontSize: 18 }}>{show?.title || rec?.title}</Text>
        {live && <Pressable style={[styles.btn, styles.btnTeal, { height: 52, marginTop: 6 }]} onPress={() => router.push(`/show/${show.id}`)}><Text style={styles.btnText}>Join the show</Text></Pressable>}
        {card.kind === 'soon' && <Pressable style={[styles.btn, styles.btnGhostDark, { height: 52, marginTop: 6 }]} onPress={() => router.push(`/show/${show.id}`)}><Text style={styles.btnTextDark}>Remind me</Text></Pressable>}
      </View>
    </View>
  );
}
