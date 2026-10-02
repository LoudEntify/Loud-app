// The three doors (Discover, Live, Profile) plus Create for artists.
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { color } from '../../src/shared';
import { useSession } from '../../src/session';
const Icon = (glyph) => ({ color: c }) => <Text style={{ color: c, fontSize: 20 }}>{glyph}</Text>;
export default function TabsLayout() {
  const { profile } = useSession();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: 'rgba(1,22,39,0.96)', borderTopColor: 'rgba(253,255,252,0.1)', height: 88, paddingTop: 8 }, tabBarActiveTintColor: color.teal, tabBarInactiveTintColor: 'rgba(253,255,252,0.72)', tabBarLabelStyle: { fontSize: 13 } }}>
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: Icon('⌂') }} />
      <Tabs.Screen name="live" options={{ title: 'Live', tabBarIcon: Icon('◉') }} />
      <Tabs.Screen name="create" options={{ title: 'Create', tabBarIcon: Icon('+'), href: profile?.role === 'artist' ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: Icon('●') }} />
    </Tabs>
  );
}
