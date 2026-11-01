// ViewerOnboarding.dc.html — "What do you love to hear? Pick three or
// more. You can change this later."
//
// This board was drawn and then never linked to anything, which is part of
// why there was no journey: a new viewer landed in a feed that knew
// nothing about them. It now sits directly after sign-up for a viewer, and
// Skip is a real answer — the feed falls back to what is live.
//
// The picks are written to the account's own profile row. There is no
// route for this yet (the web writes `profiles` straight from the client
// under row-level security), so the phone does the same thing, through the
// same policy, rather than inventing an endpoint this screen alone uses.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen, Button, color, space, radius, text, face, gradient, Icon } from '../../src/ui';
import { supabase, useSession } from '../../src/session';
import { GENRES } from '@loud/lib/genres.js';

const WANTED = 3;

/** The board tints the chosen tiles; the first few carry the brand washes. */
const TINTS = [
  ['rgba(46,196,182,0.45)', 'rgba(255,255,255,0.8)'],
  ['rgba(255,159,28,0.40)', 'rgba(255,255,255,0.8)'],
  ['rgba(231,29,54,0.26)', 'rgba(255,255,255,0.8)'],
];

export default function Genres() {
  const { session } = useSession();
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  const toggle = (g) => setPicked((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));

  async function go(save) {
    if (save && session?.user?.id) {
      setBusy(true);
      // Best effort: a taste list is not worth blocking someone's first
      // minute over, so a failure here still lets them into the app.
      await supabase().from('profiles').update({ genres: picked }).eq('id', session.user.id);
      setBusy(false);
    }
    router.replace('/discover');
  }

  const enough = picked.length >= WANTED;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.xl, paddingTop: 56, gap: space.m, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Pressable accessibilityRole="link" onPress={() => go(false)} hitSlop={8}>
            <Text style={{ fontFamily: face.bold, fontSize: 17, fontWeight: '700', color: color.ink }}>Skip</Text>
          </Pressable>
        </View>

        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Step 1 of 2"
          accessibilityValue={{ min: 0, max: 2, now: 1 }}
          style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.07)', overflow: 'hidden' }}
        >
          <View style={{ width: '50%', height: 6, borderRadius: 3, backgroundColor: color.ink }} />
        </View>

        <View style={{ gap: 4 }}>
          <Text style={text.screenTitle}>What do you love to hear?</Text>
          <Text style={[text.body, { fontSize: 18 }]}>Pick three or more. You can change this later.</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.m, gap: space.s }} showsVerticalScrollIndicator={false}>
          <View accessibilityRole="group" accessibilityLabel="Genres" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {GENRES.map((g, i) => {
              const on = picked.includes(g);
              const tint = TINTS[picked.indexOf(g) % TINTS.length] || TINTS[0];
              return (
                <Pressable
                  key={g}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(g)}
                  style={{
                    width: '48%', height: 72, borderRadius: 18, paddingHorizontal: space.l,
                    justifyContent: 'center', overflow: 'hidden',
                    borderWidth: on ? 2 : 0, borderColor: color.ink,
                    backgroundColor: on ? 'transparent' : 'rgba(255,255,255,0.72)',
                  }}
                >
                  {on ? (
                    <LinearGradient colors={tint} start={gradient.tealButton.start} end={gradient.tealButton.end} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                  ) : null}
                  <Text style={{ fontFamily: on ? face.bold : face.regular, fontSize: 20, fontWeight: on ? '700' : '400', color: color.ink }} numberOfLines={1}>{g}</Text>
                  {on ? (
                    <View style={{ position: 'absolute', right: 10, top: 10 }}>
                      <Icon.Check size={20} color={color.ink} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={{ paddingBottom: 28 }}>
          <Button kind="main" busy={busy} disabled={!enough} onPress={() => go(true)} testID="genres-continue">
            {enough ? `Continue with ${picked.length} picked` : `Pick ${WANTED - picked.length} more`}
          </Button>
        </View>
      </View>
    </Screen>
  );
}
