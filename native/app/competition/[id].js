// CompetitionDetail.dc.html — one genre's round, before any round exists.
//
// Like /competitions this screen fetches nothing, because there is nothing
// to fetch: no competitions table, no entrants, no votes. So most of what
// the board draws cannot be shown without making it up, and is left out
// rather than filled with invented numbers:
//
//   · "VOTING OPEN" becomes the board's own "COMING SOON". Nothing is open.
//   · "[n] artists, one round left", the prize, and "Closes in [d] days"
//     have no source. A placeholder pound figure on a screen about money
//     and fairness is the worst kind of placeholder.
//   · "In this round" has no artists, so it carries the empty state.
//   · "Full competition rules" links to "#" even on the board, so it is a
//     statement here rather than a link to nowhere.
//
// What is real and therefore kept word for word is "How the winner is
// decided". Those three lines are settled product rules, not filler, and
// they are the reason to put this screen in front of anyone at all.
import { View, Text, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Screen, Card, Empty, ErrorPanel, IconButton, Icon,
  color, space, radius, text, textOnDark,
} from '../../src/ui';

// The same three the Competitions board lines up, keyed by the slug that
// screen pushes. An unknown slug is a bad link, not an empty round.
const GENRES = { afrobeats: 'Afrobeats', gospel: 'Gospel', 'r-b': 'R&B' };

const HOW_THE_WINNER_IS_DECIDED = [
  'One vote each, and only from accounts that watched the show.',
  'Tokens count for nothing here. Money cannot buy a result.',
  'You can change your vote until voting closes.',
];

export default function Competition() {
  const { id } = useLocalSearchParams();
  const genre = GENRES[String(id).toLowerCase()];

  if (!genre) {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.l }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          <ErrorPanel
            title="We could not find that competition"
            body="The link may be wrong. The genres lined up are on the Competitions screen."
            backLabel="Back to Competitions"
            onBack={() => router.replace('/competitions')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 32, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <IconButton label="Back" onPress={() => router.back()}><Icon.Back size={22} color={color.ink} /></IconButton>
          {/* The board writes "Afrobeats, [Month]". No round has a month. */}
          <Text style={[text.screenTitle, { fontSize: 26, flex: 1 }]} numberOfLines={2}>{genre}</Text>
        </View>

        <View style={{ padding: space.xl, borderRadius: radius.cardLg, backgroundColor: color.ink, gap: space.s }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.teal, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Sparkle size={26} color={color.ink} />
          </View>
          <Text style={[textOnDark.label, { color: color.teal }]}>COMING SOON</Text>
          <Text style={[textOnDark.screenTitle, { fontSize: 26 }]}>Monthly genre competitions</Text>
          <Text style={[textOnDark.body, { fontSize: 17 }]}>
            Artists perform live in their genre. Fans vote, and only verified-fan votes count.
          </Text>
        </View>

        <View style={{ gap: space.m }}>
          <Text style={[text.sectionHeading, { fontSize: 20 }]}>In this round</Text>
          <Card>
            <Empty
              icon={<Icon.Person size={24} color={color.ink} />}
              title="No artists yet"
              body={`When the first ${genre} round opens, everyone performing in it will be listed here.`}
              actionLabel="See what's on"
              onAction={() => router.replace('/live')}
              testID="competition-empty"
            />
          </Card>
        </View>

        <Card style={{ padding: space.l, gap: space.s }}>
          <Text style={[text.rowTitle, { fontSize: 19 }]}>How the winner is decided</Text>
          {HOW_THE_WINNER_IS_DECIDED.map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: space.s }}>
              <Icon.Check size={20} color={color.ink} />
              <Text style={[text.body, { flex: 1, fontSize: 16 }]}>{line}</Text>
            </View>
          ))}
        </Card>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l }}>
          <Icon.Flag size={22} color={color.mutedOnLight} />
          <Text style={[text.body, { flex: 1, fontSize: 17 }]}>
            The full competition rules will be published before the first round opens.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
