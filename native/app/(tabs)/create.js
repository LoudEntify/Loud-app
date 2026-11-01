// Create.dc.html — the three things an artist makes, as a sheet.
//
// The board draws it over Profile-Owner: the artist's own page dimmed
// behind, the sheet anchored to the foot, and Close returning to it. The
// tab is a sheet rather than a page for that reason, and the dimmed layer
// behind it carries the artist's @name so the sheet reads as something
// opened on top of their own profile rather than a screen of its own.
//
// What left with this rewrite: the Kit check WebView. It opened
// /web?path=/artist/kit-check, which is the website inside the app on the
// one screen an artist is standing at with a phone on a stand, minutes
// before a show. It is native now (app/artist/kit-check.js).
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Screen, Sheet, Empty, Skeleton, Icon,
  color, space, radius, surface, text, gradient, size,
} from '../../src/ui';
import { useSession } from '../../src/session';

/**
 * The three choices, in the board's order and its words.
 *
 * `to` is where each one really goes. New clip is the one the board links
 * to ClipEditor.dc.html, which has no screen on the phone yet; the clip is
 * cut from a past show, and past shows are on the profile, which is where
 * app/artist/post-show/[id].js already sends "Make a clip". Sending it
 * somewhere real beats a row that moves under a finger and arrives nowhere.
 */
const CHOICES = [
  {
    key: 'schedule',
    to: '/artist/schedule',
    title: 'Schedule a show',
    subtitle: 'Book a slot at least 30 minutes ahead',
    icon: Icon.Calendar,
    lead: true,                     // the teal badge: the board gives this row the gradient
  },
  {
    key: 'kit-check',
    to: '/artist/kit-check',
    title: 'Kit check',
    subtitle: 'Check your mic and cameras. Nothing streams.',
    icon: Icon.Wrench,
  },
  {
    key: 'clip',
    to: '/profile',
    title: 'New clip',
    subtitle: 'Trim up to 90 seconds from a past show',
    icon: Icon.Film,
  },
];

export default function Create() {
  const { profile, loading } = useSession();

  return (
    <Screen>
      {/* The profile underneath, as the board draws it: the @name and the
          shapes of what is on that page. It is behind the scrim and behind
          the sheet, so it is never read and never touched. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: space.l, right: space.l, top: 52, gap: space.l }}>
        {loading
          ? <Skeleton width={160} height={26} />
          : <Text style={[text.sectionHeading, { fontSize: 22 }]} numberOfLines={1}>@{profile?.username || 'you'}</Text>}
        <View style={{ height: 88, borderRadius: radius.card, backgroundColor: surface.quiet }} />
        <View style={{ height: 76, borderRadius: radius.card, backgroundColor: 'rgba(46,196,182,0.24)' }} />
        <LinearGradient
          colors={gradient.inkButton.colors}
          locations={gradient.inkButton.locations}
          start={gradient.inkButton.start}
          end={gradient.inkButton.end}
          style={{ height: 50, borderRadius: 25 }}
        />
      </View>

      {/* The sheet's own foot clears the tab bar, which is absolutely
          positioned over every tab screen: without this the last choice sits
          under it and cannot be tapped. */}
      <Sheet
        label="Create"
        onDismiss={() => router.replace('/profile')}
        style={{ backgroundColor: color.mist, maxHeight: '82%', paddingBottom: size.tabBar + space.m }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text style={[text.screenTitle, { flex: 1, fontSize: 30 }]}>Create</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.replace('/profile')}
            style={({ pressed }) => ({
              width: size.touch, height: size.touch, borderRadius: size.touch / 2,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: surface.quiet, opacity: pressed ? 0.85 : 1,
            })}
          >
            <Icon.Close size={22} color={color.ink} />
          </Pressable>
        </View>

        {loading ? (
          <View style={{ gap: space.m }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={76} radius={radius.card} />)}
          </View>
        ) : profile?.role !== 'artist' ? (
          // Create is hidden from the tab bar for a viewer, but a deep link
          // still arrives here, so it answers rather than showing an artist
          // three things they cannot do.
          <Empty
            icon={<Icon.Mic size={24} color={color.ink} />}
            title="Performing is not switched on yet"
            body="Add performing to this account and you keep everything you follow."
            actionLabel="Become an artist"
            onAction={() => router.push('/become-artist')}
            testID="create-not-artist"
          />
        ) : (
          <ScrollView contentContainerStyle={{ gap: space.m }} showsVerticalScrollIndicator={false}>
            {CHOICES.map((c) => <Choice key={c.key} choice={c} />)}
          </ScrollView>
        )}
      </Sheet>
    </Screen>
  );
}

function Choice({ choice }) {
  const Glyph = choice.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${choice.title}. ${choice.subtitle}`}
      onPress={() => router.push(choice.to)}
      style={({ pressed }) => ({
        minHeight: 76,
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14,
        borderRadius: radius.card, backgroundColor: surface.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: choice.lead ? undefined : surface.quiet }}>
        {choice.lead ? (
          <LinearGradient
            colors={gradient.tealButton.colors}
            locations={gradient.tealButton.locations}
            start={gradient.tealButton.start}
            end={gradient.tealButton.end}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
        ) : null}
        <Glyph size={24} color={color.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[text.rowTitle, { fontSize: 20 }]} numberOfLines={1}>{choice.title}</Text>
        <Text style={[text.supporting, { fontSize: 16 }]}>{choice.subtitle}</Text>
      </View>
      <Icon.Chevron size={20} color={color.ink} />
    </Pressable>
  );
}
