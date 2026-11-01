// AudioSettings.dc.html — the microphone, the vocal preset, the balance.
//
// Nothing on this board can be honoured yet, and the screen says which
// part of the build each piece is waiting on rather than drawing it.
//
// The capturer is the only thing that could answer any of it, and
// native/modules/loud-camera/index.js has no audio surface at all: it
// surveys cameras, starts video, moves a lens, reads and sets the pro
// exposure controls. There is no microphone enumeration, no level
// metering, no vocal chain and no backing-track mixer, so a microphone
// picker here would be a list of one invented row, a "Mic health" line
// would be an assertion about a signal nobody measured, and three
// sliders would move and change nothing about the next show.
//
// Saved places have no store either — no table, no route, no column —
// so "Settings for [Saved place]" and "Save to [Saved place]" have
// nothing to save to and nothing to save.
//
// Everything the board writes as copy is kept. What is missing is the
// controls, and each one is named where it would have been.
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Row, ScreenHeader, Icon,
  color, space, text,
} from '../../src/ui';
import { NotStored } from '../../src/settings';

export default function AudioSettings() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Audio" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          <NotStored testID="audio-places">
            Audio settings are not saved per place yet. There is no store behind
            a saved place, so there is nothing to choose between and nothing to
            save to.
          </NotStored>

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Microphone</Text>
            <NotStored>
              The camera module does not report this phone&apos;s audio inputs, so
              there is no list to choose from. Your show uses whichever
              microphone the phone is using when it starts.
            </NotStored>
            <Row
              icon={<Icon.Mic size={22} color={color.ink} />}
              title="Mic health"
              subtitle="Checked on the raw input at kit check, not here."
            />
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Vocal preset</Text>
            <Text style={text.supporting}>Clean-up, compression and space (reverb).</Text>
            <NotStored>
              There is no vocal chain in the capturer yet, so these three have
              nothing to change. Your voice goes out as the microphone hears it.
            </NotStored>
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>Backing track balance</Text>
            {/* The board labels the two ends of a slider. Kept as the
                description of what the control will do, since the slider
                itself would not move anything. */}
            <Text style={text.supporting}>More track, or more voice.</Text>
            <NotStored>
              The balance between your voice and the backing track is set on the
              console during the show. It cannot be set ahead of time yet.
            </NotStored>
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>Headphone delay check</Text>
            <Text style={text.supporting}>For Bluetooth earphones. Wired is best for singing.</Text>
            <NotStored>
              There is no delay check in this build. The advice above still
              holds: wire your earphones in if you are singing to a track.
            </NotStored>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
