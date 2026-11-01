// native/src/ui/TabBar.js — the bottom navigation, as the boards draw it.
//
// 88 high, the surface at 82% with a blur behind it and a one-pixel rule on
// top. The chosen tab gets a teal pill behind its icon and a bold label;
// Create is not an icon at all but a 52x30 teal capsule with a plus, which
// is how the boards mark it as the one thing you make rather than browse.
//
// It takes its colour from the screen under it: Discover is a dark screen
// and gets the ink bar, every other tab is light and gets the porcelain
// one. Expo Router's default bar could not do either, which is why this
// replaces it rather than restyling it.
import { View, Text, Pressable, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, size, space, gradient, face } from './tokens';
import { Home, Eye, Plus, Person } from './Icon';

const TABS = [
  { name: 'discover', label: 'Discover', Glyph: Home },
  { name: 'live', label: 'Live', Glyph: Eye },
  { name: 'create', label: 'Create', Glyph: Plus, capsule: true },
  { name: 'profile', label: 'Profile', Glyph: Person },
];

export function TabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  // The route being shown says which surface the bar sits on.
  const current = state.routes[state.index]?.name;
  const dark = current === 'discover';
  const fg = dark ? color.porcelain : color.ink;
  const dim = dark ? 'rgba(253,255,252,0.72)' : 'rgba(1,22,39,0.72)';

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <BlurView
        intensity={Platform.OS === 'android' ? 0 : 24}
        tint={dark ? 'dark' : 'light'}
        style={{
          paddingTop: space.sm,
          paddingBottom: Math.max(insets.bottom, space.sm),
          minHeight: size.tabBar,
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: dark ? 'rgba(1,22,39,0.92)' : 'rgba(253,255,252,0.94)',
          borderTopWidth: 1,
          borderTopColor: dark ? 'rgba(253,255,252,0.10)' : 'rgba(1,22,39,0.10)',
        }}
      >
        {TABS.map((tab) => {
          const route = state.routes.find((r) => r.name === tab.name);
          if (!route) return null;
          // A tab the artist does not have (Create, for a viewer) is hidden
          // by the layout setting its href to null.
          if (descriptors[route.key]?.options?.href === null) return null;

          const focused = current === tab.name;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              onPress={onPress}
              style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4, minHeight: size.touch }}
            >
              {tab.capsule ? (
                <View style={{ width: 52, height: 30, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  <LinearGradient
                    colors={gradient.tealButton.colors}
                    locations={gradient.tealButton.locations}
                    start={gradient.tealButton.start}
                    end={gradient.tealButton.end}
                    style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                  />
                  <tab.Glyph size={20} color={color.ink} />
                </View>
              ) : (
                <View style={{
                  paddingHorizontal: 14, paddingVertical: 2, borderRadius: 999,
                  backgroundColor: focused ? 'rgba(46,196,182,0.30)' : 'transparent',
                }}>
                  <tab.Glyph size={22} color={focused ? color.teal : dim} />
                </View>
              )}
              <Text style={{
                fontFamily: focused ? face.bold : face.regular,
                fontSize: 13,
                fontWeight: focused ? '700' : '400',
                color: focused ? fg : dim,
              }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}
