// Allowance.dc.html — viewer-hours, show slots, prepaid packs.
//
// There is no allowance anywhere in the build: no route, no table, no
// column, no ledger of viewer-hours. Every number on the board is a
// placeholder, and the two progress bars are drawn at 72% and 50% of
// nothing.
//
// So this screen explains the thing and refuses to measure it. A bar at
// a made-up width is the most convincing lie a settings screen can
// tell: an artist who reads "72% used" will plan their month around it.
//
// What is true today is the sentence the boards already settled on and
// CLAUDE.md §5 repeats: "Hours running out never stops a show." That is
// the part worth saying before billing exists, and it is said.
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Row, Section, ScreenHeader, Icon,
  color, gradient, radius, space, text, textOnDark,
} from '../../src/ui';
import { NotStored } from '../../src/settings';

export default function Allowance() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Allowance and packs" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {/* The board's dark panel, with its heading and the two things
              it counts named — and no figures, because there are none. */}
          <View style={{ backgroundColor: gradient.base.dark, borderRadius: radius.cardLg, padding: space.l, gap: space.m }}>
            <Text style={textOnDark.label}>THIS MONTH</Text>
            <Text style={[textOnDark.rowTitle]}>Viewer-hours</Text>
            <Text style={textOnDark.supporting}>
              One viewer-hour is one person watching for an hour. Your free
              allowance is counted in these rather than in how long you played.
            </Text>
            <Text style={[textOnDark.rowTitle]}>Show slots</Text>
            <Text style={textOnDark.supporting}>
              How many shows you may book in a month.
            </Text>
          </View>

          <NotStored testID="allowance-no-figures">
            Neither figure can be shown yet: there is nothing counting
            viewer-hours or show slots, and no date they reset on. Both arrive
            with billing, and this screen will show them when they do.
          </NotStored>

          <Card style={{ gap: space.xs }}>
            <Text style={text.sectionHeading}>Prepaid packs</Text>
            <Text style={text.body}>
              Packs add viewer-hours and show slots when your free allowance is
              not enough. Packs are bought outside the app.
            </Text>
          </Card>

          {/* The board's amber "hours borrowed" strip, as the rule it
              stands for rather than a count of something uncounted. */}
          <Row
            icon={<Icon.Check size={22} color={color.ink} />}
            title="A show never stops for hours"
            subtitle="If a show runs past your free hours, it keeps going and the extra is borrowed. Nothing is cut off."
          />

          <Section title="Recent use">
            <Text style={text.supporting}>
              What each show used will be listed here once hours are counted.
            </Text>
          </Section>
        </View>
      </ScrollView>
    </Screen>
  );
}
