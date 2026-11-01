// SignUp.dc.html — "Keep watching, free. Under a minute. The show keeps
// playing behind this."
//
// One page, as the board draws it: who you are here as, your name, a
// username, a date of birth, where you are, then email and a password.
// The sheet sits over the show, which keeps playing: the sign-up is a
// thing you do while watching, not a wall in front of the music.
//
// The age check happens on the device (lib/signupRules.js) and a refusal
// goes to /under-age without the date travelling anywhere, which is what
// lets that screen say "We have not kept the date you entered" honestly.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Screen, Button, Field, Badge, Toggle, ErrorPanel,
  color, space, radius, text, textOnDark, face,
} from '../src/ui';
import { api } from '../src/api';
import { supabase } from '../src/session';
import { validateSignup } from '../src/shared';

const ROLE_CHOICES = [
  { key: 'viewer', label: "I'm here to watch" },
  { key: 'artist', label: "I'm here to perform" },
];

export default function SignUp() {
  const { trigger = 'direct' } = useLocalSearchParams();
  const [f, setF] = useState({
    role: 'viewer', firstName: '', lastName: '', username: '', dateOfBirth: '',
    country: 'GB', city: '', email: '', password: '', acceptTerms: false, trainingDataOptOut: false,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    const v = validateSignup(f);
    // The date never leaves the device when the answer is no.
    if (v.underage) { router.replace('/under-age'); return; }
    if (!v.ok) { setErrors(v.errors); return; }

    setBusy(true); setErrors({});
    const r = await api('/api/viewer/signup', { method: 'POST', body: { ...f, trigger } });
    if (r.data?.underage) { setBusy(false); router.replace('/under-age'); return; }
    if (!r.ok) {
      setBusy(false);
      setErrors(r.data?.errors || { form: r.data?.error || 'We could not create your account just now. Try again in a moment.' });
      return;
    }
    const { error } = await supabase().auth.signInWithPassword({ email: v.values.email, password: v.values.password });
    setBusy(false);
    if (error) { setErrors({ form: 'Your account is made, but signing you in did not work. Log in and you are through.' }); return; }
    // A viewer picks what they like next; a performer goes to their own side.
    router.replace(f.role === 'artist' ? '/create' : '/onboarding/genres');
  }

  return (
    <Screen dark>
      <View style={{ position: 'absolute', left: space.l, right: space.l, top: 56, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Badge kind="live" />
        <Text style={[textOnDark.rowTitle, { fontSize: 19 }]} numberOfLines={1}>Loudentify</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: color.mist,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: 28, maxHeight: '88%',
        }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.2)' }} />
          <ScrollView contentContainerStyle={{ gap: space.m, paddingTop: 14, paddingBottom: space.s }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[text.rowTitle, { fontSize: 17 }]}>Loudentify</Text>
              <Pressable accessibilityRole="link" onPress={() => router.replace('/login')} hitSlop={8}>
                <Text style={{ fontFamily: face.bold, fontSize: 16, fontWeight: '700', color: color.ink }}>Log in</Text>
              </Pressable>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={[text.screenTitle, { fontSize: 30 }]}>Keep watching, free</Text>
              <Text style={text.body}>Under a minute. The show keeps playing behind this.</Text>
            </View>

            {/* Two pills in one track, the way the board draws them. */}
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Why you are here"
              style={{ flexDirection: 'row', backgroundColor: 'rgba(1,22,39,0.07)', borderRadius: 999, padding: 4, gap: 4 }}
            >
              {ROLE_CHOICES.map((c) => {
                const on = f.role === c.key;
                return (
                  <Pressable
                    key={c.key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => set('role')(c.key)}
                    style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.porcelain : 'transparent', borderWidth: on ? 2 : 0, borderColor: color.ink }}
                  >
                    <Text style={{ fontFamily: on ? face.bold : face.regular, fontSize: 16, fontWeight: on ? '700' : '400', color: color.ink }}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Field style={{ flex: 1 }} label="First name" value={f.firstName} onChangeText={set('firstName')} placeholder="First name" error={errors.firstName} textContentType="givenName" testID="signup-first" />
              <Field style={{ flex: 1 }} label="Last name" value={f.lastName} onChangeText={set('lastName')} placeholder="Last name" error={errors.lastName} textContentType="familyName" />
            </View>

            <Field label="Username" value={f.username} onChangeText={set('username')} placeholder="@yourname" autoCapitalize="none" autoCorrect={false} error={errors.username} testID="signup-username" />

            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Field style={{ width: 150 }} label="Date of birth" value={f.dateOfBirth} onChangeText={set('dateOfBirth')} placeholder="DD / MM / YYYY" keyboardType="numbers-and-punctuation" error={errors.dateOfBirth} testID="signup-dob" />
              <Field style={{ flex: 1 }} label="Location" value={f.city} onChangeText={set('city')} placeholder="City" error={errors.city} textContentType="addressCity" />
            </View>

            <Field label="Email" value={f.email} onChangeText={set('email')} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" error={errors.email} testID="signup-email" />
            <Field label="Password" value={f.password} onChangeText={set('password')} placeholder="8 characters or more" secure autoCapitalize="none" textContentType="newPassword" error={errors.password} testID="signup-password" />

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
              <Toggle value={f.acceptTerms} onValueChange={set('acceptTerms')} label="Confirm you are 18 or over and accept the terms" />
              <Text style={[text.supporting, { flex: 1, color: 'rgba(1,22,39,0.8)' }]}>
                By continuing you confirm you are 18 or over and agree to the Terms and Conditions and Community Guidelines.
              </Text>
            </View>
            {errors.acceptTerms ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>{errors.acceptTerms}</Text> : null}

            {f.role === 'artist' ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, backgroundColor: 'rgba(46,196,182,0.14)', padding: space.m, borderRadius: radius.field }}>
                <Toggle value={!f.trainingDataOptOut} onValueChange={(v) => set('trainingDataOptOut')(!v)} label="Help the director learn from my shows" />
                <Text style={[text.supporting, { flex: 1 }]}>
                  Help the AI director learn from my shows. On by default, only your own performance, only inside Loudentify. Switch it off any time in Settings.
                </Text>
              </View>
            ) : null}

            {errors.form ? <ErrorPanel title="We could not finish signing you up" body={errors.form} onRetry={submit} /> : null}

            <Button kind="main" busy={busy} onPress={submit} testID="signup">Continue</Button>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
