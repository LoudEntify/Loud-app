import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { styles } from '../../src/theme';
import { States } from '../../src/components/States';

export default function Live() {
  const { accessToken, loading } = useSession();
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const load = async () => { setError(null); const r = await api('/api/viewer/live', { accessToken }); if (!r.ok) { setError(true); return; } setData(r.data); };
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loading]);
  if (error && !data) return <States.Error title="We couldn't load Live" onRetry={load} />;
  if (!data) return <States.Loading />;
  const name = (s) => s.performance_mode === 'versus' ? `${s.artist?.display_name} vs ${s.artist_b?.display_name}` : s.artist?.display_name || s.artist_name;
  const Row = ({ s, live }) => <Pressable onPress={() => router.push(`/show/${s.id}`)} style={[styles.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }]}><View style={{ flex: 1 }}><Text style={{ fontSize: 18, fontWeight: '700' }}>{name(s)}</Text><Text style={styles.muted}>{s.title}{live ? '' : ` · ${new Date(s.slated_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}</Text></View>{live ? <Text style={styles.badgeLive}>LIVE</Text> : <Text style={styles.badgeSoon}>SOON</Text>}</Pressable>;
  return (
    <ScrollView style={styles.screenLight} contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 110, gap: 12 }}>
      <Text style={styles.h1}>Live</Text>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Live now</Text>
      {data.liveNow.length ? data.liveNow.map((s) => <Row key={s.id} s={s} live />) : <States.Empty inline title="Nothing live right now" body={data.soon.length ? `${data.soon.length} starting in the next few hours.` : 'Shows are booked at least 30 minutes ahead.'} />}
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Starting soon</Text>
      {data.soon.length ? data.soon.map((s) => <Row key={s.id} s={s} />) : <Text style={styles.muted}>Nothing in the next few hours.</Text>}
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Upcoming</Text>
      {data.upcoming.map((s) => <Row key={s.id} s={s} />)}
    </ScrollView>
  );
}
