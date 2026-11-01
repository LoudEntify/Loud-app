// BlockedWords.dc.html — "Blocking and filters".
//
// Nothing on this board exists in the build. There is no blocked-words
// list, no blocked-accounts table, and no comment filter of any kind:
// comments are carried on the data channel and written to
// `show_comments`, and nothing between the two reads a word list.
//
// That makes this the screen where drawing the controls would do the
// most harm. Somebody who adds the word that is being used against them,
// sees it appear as a chip and closes the screen has been told they are
// protected. They are not. So the input, the Add button, the chips, the
// house-list switch and the Unblock buttons are all absent, and the
// screen says what to do instead — which is report it, where a person
// actually reads it.
//
// Back goes to Privacy and safety, which is where the board's own back
// arrow points: this is the one settings screen that is two levels deep.
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Row, ScreenHeader, Icon,
  color, space, text,
} from '../../src/ui';
import { NotStored } from '../../src/settings';

export default function BlockedWords() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Blocking and filters" onBack={() => router.push('/settings/privacy')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Words you never want to see</Text>
            <Text style={text.body}>
              Comments containing these are hidden from your shows and your
              chat. The person who wrote it is not told.
            </Text>
            <NotStored testID="blocked-words-not-stored">
              There is no word filter in the build yet, so there is nowhere to
              keep a list and nothing that would read it. A list added here
              would not hide anything, which is why there is no box to add one.
            </NotStored>
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Blocked accounts</Text>
            <Text style={text.body}>
              Blocked people cannot message you, comment on your shows, or see
              your profile.
            </Text>
            <NotStored testID="blocked-accounts-not-stored">
              Blocking is not built yet: there is no list of blocked accounts to
              show and no way to add one. Messaging does not work at all today,
              so nobody can message you either.
            </NotStored>
          </Card>

          {/* The one thing that does work, and the only thing worth
              offering on a screen about being got at. */}
          <Row
            icon={<Icon.Warning size={22} color={color.ink} />}
            title="Report a problem"
            subtitle="A person reads these, and acts on them"
            onPress={() => router.push('/settings/privacy')}
          />
          <Text style={text.supporting}>
            If somebody is being abusive in a show, the Report button on the
            show itself is the fastest route: it names the show for us.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
