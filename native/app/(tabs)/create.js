import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { styles } from '../../src/theme';
export default function Create() {
  // Schedule and the console are native screens now; kit check is still the
  // website in a frame until it is ported (docs/NEEDS_KOREY.md). The zoom
  // spike is a developer tool and only reachable in a dev build.
  const rows = [
    ['/artist/schedule', 'Schedule a show', 'Book a slot at least 30 minutes ahead'],
    ['/camera', 'Use this phone as a camera', 'Scan the code from your main device'],
    ['web:/artist/kit-check', 'Kit check', 'Check your mic and cameras'],
    ['/spike/zoom', 'Device zoom spike (dev build)', 'Camera, controller or capability survey: docs/DIRECTOR_DATA_SPEC.md'],
  ];
  return (
    <View style={[styles.screenLight, { padding: 16, paddingTop: 56, gap: 12 }]}>
      <Text style={styles.h1}>Create</Text>
      {rows.map(([h, t, s]) => <Pressable key={h} style={styles.card} onPress={() => (h.startsWith('web:') ? router.push(`/web?path=${encodeURIComponent(h.slice(4))}`) : router.push(h))}><Text style={{ fontSize: 19, fontWeight: '700' }}>{t}</Text><Text style={styles.muted}>{s}</Text></Pressable>)}
      <Text style={styles.muted}>Booking and running a show both work here now. Open a show from your profile to reach its console.</Text>
    </View>
  );
}
