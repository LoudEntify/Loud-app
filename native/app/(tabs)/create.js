import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { styles } from '../../src/theme';
export default function Create() {
  const rows = [['/camera', 'Use this phone as a camera', 'Scan the code from your main device'], ['web:/artist/schedule', 'Schedule a show', 'Book a slot at least 30 minutes ahead (opens the web console)'], ['web:/artist/kit-check', 'Kit check', 'Check your mic and cameras']];
  return (
    <View style={[styles.screenLight, { padding: 16, paddingTop: 56, gap: 12 }]}>
      <Text style={styles.h1}>Create</Text>
      {rows.map(([h, t, s]) => <Pressable key={h} style={styles.card} onPress={() => (h.startsWith('web:') ? router.push(`/web?path=${encodeURIComponent(h.slice(4))}`) : router.push(h))}><Text style={{ fontSize: 19, fontWeight: '700' }}>{t}</Text><Text style={styles.muted}>{s}</Text></Pressable>)}
      <Text style={styles.muted}>Performing from the phone (console, director) lands in the next native build; today the phone is the camera and the viewer.</Text>
    </View>
  );
}
