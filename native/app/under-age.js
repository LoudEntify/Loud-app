// UnderAge.dc.html — the stop after a date of birth under 18.
//
// Two things the board is careful about, and so is this screen:
//
//   "We have not kept the date you entered." That has to be true, so the
//   date is never sent anywhere. lib/signupRules.js decides the age on the
//   device and this screen is reached with nothing but the fact that the
//   answer was no. There is no row, no event and no parameter carrying it.
//
//   The tone. "Thanks for your interest" and "the music will still be
//   here" — a refusal, written as one, without blame.
//
// The board links both buttons to `#`. "I entered the wrong date" has an
// obvious destination (back to sign-up, where nothing was kept, so the
// form is empty). "Find music elsewhere" has none we can honestly name,
// so it goes back to the free Discover feed rather than off to a search
// engine: there is music here to watch, just not an account to make.
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Button, space, textOnDark, color, Icon } from '../src/ui';
import { MIN_AGE } from '../src/shared';

export default function UnderAge() {
  return (
    <Screen dark>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.xl, gap: space.l }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(253,255,252,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Warning size={26} color={color.porcelain} />
        </View>

        <Text style={textOnDark.screenTitle}>You need to be {MIN_AGE} to use Loudentify</Text>
        <Text style={[textOnDark.body, { fontSize: 18 }]}>
          Thanks for your interest. Shows here are live and unedited, and fans can send money to artists, so we keep it to adults.
        </Text>
        <Text style={textOnDark.body}>
          We have not kept the date you entered. Come back when you turn {MIN_AGE} and the music will still be here.
        </Text>

        <View style={{ gap: space.m, marginTop: space.s }}>
          <Button kind="quietDark" onPress={() => router.replace('/discover')}>Watch what is live</Button>
          <Button kind="quietDark" size="medium" onPress={() => router.replace('/signup')} style={{ alignSelf: 'center', backgroundColor: 'transparent' }} textStyle={{ color: color.porcelain }}>
            I entered the wrong date
          </Button>
        </View>
      </View>
    </Screen>
  );
}
