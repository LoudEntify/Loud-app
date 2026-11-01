// BecomeArtist.dc.html and ArtistAgreement.dc.html — a viewer adding
// performing to the account they already have.
//
// The board's promise is the important part, and it is literal: "Same
// account, same login. You keep everything you follow, and you can still
// watch as you do now." /api/profile/become-artist upgrades the role on
// the same row; nothing is migrated and nothing is lost.
//
// The agreement is on the same screen rather than behind a second one.
// The board draws two screens because it is a web flow; on a phone an
// agreement you must scroll past to reach the button is better than one
// you can skip by tapping through, and it keeps the promise and the terms
// in the same eyeline.
import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Field, Toggle, ErrorPanel, Icon,
  color, space, radius, text, face,
} from '../src/ui';
import { api } from '../src/api';
import { supabase, useSession } from '../src/session';

const PROMISES = [
  { icon: Icon.Camera, line: 'Your phones become the cameras. Nothing else to buy.' },
  { icon: Icon.Calendar, line: 'Free viewer-hours every month to get started.' },
  { icon: Icon.Coin, line: 'Keep 72.5% of what fans send you.' },
];

export default function BecomeArtist() {
  const { session, profile, accessToken } = useSession();
  const [stageName, setStageName] = useState(profile?.display_name || '');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function go() {
    const name = stageName.trim();
    if (!name) { setErr('Pick a stage name. It is what audiences see.'); return; }
    if (!agreed) { setErr('Read the agreement and tick the box to carry on.'); return; }
    setBusy(true); setErr(null);

    const r = await api('/api/profile/become-artist', { method: 'POST', accessToken });
    if (!r.ok) {
      setBusy(false);
      setErr(r.data?.error || 'We could not set that up just now. Try again in a moment.');
      return;
    }
    // The stage name is the profile's display name; there is no route for
    // it and the row is the person's own under row-level security.
    if (name !== profile?.display_name && session?.user?.id) {
      await supabase().from('profiles').update({ display_name: name }).eq('id', session.user.id);
    }
    setBusy(false);
    router.replace('/create');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 40, gap: space.l }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4 }}>
          <Text style={text.screenTitle}>Perform on Loudentify</Text>
          <Text style={text.body}>
            Same account, same login. You keep everything you follow, and you can still watch as you do now.
          </Text>
        </View>

        <View style={{ gap: space.s }}>
          {PROMISES.map(({ icon: Glyph, line }) => (
            <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: 14, borderRadius: radius.card, backgroundColor: 'rgba(46,196,182,0.18)' }}>
              <Glyph size={22} color={color.ink} />
              <Text style={[text.body, { flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </View>

        <Field
          label="Pick your stage name"
          value={stageName}
          onChangeText={setStageName}
          placeholder="What audiences see"
          hint="This is what audiences see. You can change it later."
          testID="stage-name"
        />

        <Card style={{ gap: space.sm }}>
          <Text style={text.rowTitle}>The agreement, in plain words</Text>
          <Text style={text.supporting}>
            Your shows stay yours. We carry the picture and keep the record: the show, the recording, the chat, the votes and the money.
            You keep 72.5% of the tokens fans send you, recorded at the moment they send them.
            Your performance may help the director learn, only your own and only inside Loudentify, and you can switch that off any time in Settings.
            You can stop performing whenever you like and keep watching as you do now.
          </Text>
        </Card>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <Toggle value={agreed} onValueChange={setAgreed} label="Agree to the artist agreement" />
          <Text style={[text.supporting, { flex: 1 }]}>I have read the agreement and I am happy with it.</Text>
        </View>

        {err ? <ErrorPanel title="Not quite" body={err} onRetry={() => setErr(null)} retryLabel="Dismiss" /> : null}

        <Button kind="main" busy={busy} onPress={go} testID="become-artist">Agree and continue</Button>
        <Text style={text.supporting}>Next you will read the artist agreement and set up your stage.</Text>
        <Button kind="quiet" size="medium" onPress={() => router.back()}>Not now</Button>
      </ScrollView>
    </Screen>
  );
}
