// The four doors: Discover, Live, Create (artists only) and Profile.
//
// The bar itself is native/src/ui/TabBar.js rather than the router's own,
// because the boards ask for things the default cannot do: a teal pill
// behind the chosen icon, a gradient capsule for Create, and a bar that
// turns dark on Discover and light everywhere else.
import { Tabs } from 'expo-router';
import { TabBar } from '../../src/ui';
import { useSession } from '../../src/session';

export default function TabsLayout() {
  const { profile } = useSession();
  const artist = profile?.role === 'artist';
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="live" options={{ title: 'Live' }} />
      <Tabs.Screen name="create" options={{ title: 'Create', href: artist ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
