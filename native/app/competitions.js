// Competitions.dc.html — the one screen in the app that is honest about
// not existing yet.
//
// There is no competitions backend: no table, no round, no vote, no
// notification list. So this screen fetches nothing, which is also why it
// has no loading or error state — there is no request that could be slow
// or fail. The board's "COMING SOON" panel IS the empty state, and it is
// the board's copy rather than a placeholder of ours.
//
// "Tell me when it opens" is deliberately disabled. Nothing in this build
// could record that someone asked, so a button that lit up and said
// "we'll tell you" would be a promise with nowhere to keep it. The line
// under it says what to do instead, which is the one honest action
// available: follow the artists, who will be in these rounds.
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Button, IconButton, Icon,
  color, space, radius, surface, text, textOnDark, face,
} from '../src/ui';

// The three the board names, in the board's order. They are not read from
// lib/genres.js on purpose: a list of every genre we support would imply a
// round per genre, which is not what the board says is coming.
const GENRES_LINED_UP = ['Afrobeats', 'Gospel', 'R&B'];

const slug = (genre) => genre.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default function Competitions() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          <Text style={[text.screenTitle, { fontSize: 30, flex: 1 }]}>Competitions</Text>
        </View>

        <View style={{ padding: space.xl, borderRadius: radius.cardLg, backgroundColor: color.ink, gap: space.s }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.teal, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Sparkle size={26} color={color.ink} />
          </View>
          <Text style={[textOnDark.label, { color: color.teal }]}>COMING SOON</Text>
          <Text style={[textOnDark.screenTitle, { fontSize: 28 }]}>Monthly genre competitions</Text>
          <Text style={[textOnDark.body, { fontSize: 17 }]}>
            Artists perform live in their genre. Fans vote, and only verified-fan votes count.
          </Text>
          <Button
            kind="quietDark"
            size="medium"
            disabled
            onPress={undefined}
            icon={<Icon.Bell size={20} color={color.porcelain} />}
            style={{ alignSelf: 'flex-start' }}
            testID="competitions-notify"
          >
            Tell me when it opens
          </Button>
          <Text style={[textOnDark.supporting, { fontSize: 15 }]}>
            We cannot take your name down yet. Follow the artists you like and you will see their shows either way.
          </Text>
        </View>

        <Text style={[text.sectionHeading, { fontSize: 20 }]}>Genres lined up</Text>

        <View style={{ borderRadius: radius.cardLg, backgroundColor: surface.card, overflow: 'hidden' }}>
          {GENRES_LINED_UP.map((genre, i) => (
            <Pressable
              key={genre}
              accessibilityRole="button"
              accessibilityLabel={genre}
              onPress={() => router.push(`/competition/${slug(genre)}`)}
              style={({ pressed }) => ({
                minHeight: 56,
                paddingHorizontal: space.l,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.m,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: surface.hairline,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon.Mic size={22} color={color.ink} />
              <Text style={[text.rowTitle, { flex: 1 }]}>{genre}</Text>
              {/* The board puts a [Month] here. No round has a month yet, so
                  the slot says that instead of showing an invented date. */}
              <Text style={text.supporting}>Month to be announced</Text>
              <Icon.Chevron size={20} color={color.mutedOnLight} />
            </Pressable>
          ))}
        </View>

        <Text style={[text.supporting, { fontFamily: face.regular }]}>
          Nothing is open for entry or voting yet.
        </Text>
      </ScrollView>
    </Screen>
  );
}
