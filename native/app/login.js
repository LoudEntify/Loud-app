// Login.dc.html — "Welcome back. Log in and the show carries on."
//
// The board puts the form on a light sheet over the live show, with the
// LIVE pill and the artist's name still visible at the top. That framing is
// the point: signing in is something you do while the music plays, not a
// gate you pass through first. The sheet is anchored 176px down and keeps
// the show's own screen behind it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Button, Field, Badge, ErrorPanel, color, space, radius, text, textOnDark, face } from '../src/ui';
import { supabase } from '../src/session';

export default function Login() {
  const { next } = useLocalSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function logIn() {
    if (!email.trim() || !password) { setError('Type your email and password.'); return; }
    setBusy(true); setError(null);
    const { error: e } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) {
      // "Say what failed in plain words. No codes, no apology paragraphs."
      setError(/invalid login/i.test(e.message || '')
        ? 'That email and password do not match an account.'
        : 'We could not log you in just now. Try again in a moment.');
      return;
    }
    router.replace(typeof next === 'string' && next ? next : '/discover');
  }

  return (
    <Screen dark>
      {/* What is playing behind the sheet. The board keeps it visible. */}
      <View style={{ position: 'absolute', left: space.l, right: space.l, top: 56, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Badge kind="live" />
        <Text style={[textOnDark.rowTitle, { fontSize: 19 }]} numberOfLines={1}>Loudentify</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: color.mist,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: 28, maxHeight: '82%',
        }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.2)' }} />
          <ScrollView contentContainerStyle={{ gap: 14, paddingTop: 14 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[text.rowTitle, { fontSize: 17 }]}>Loudentify</Text>
              <Pressable accessibilityRole="link" onPress={() => router.replace('/signup')} hitSlop={8}>
                <Text style={{ fontFamily: face.bold, fontSize: 16, fontWeight: '700', color: color.ink }}>Sign up</Text>
              </Pressable>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={[text.screenTitle, { fontSize: 30 }]}>Welcome back</Text>
              <Text style={text.body}>Log in and the show carries on.</Text>
            </View>

            {error ? <ErrorPanel title="We could not log you in" body={error} onRetry={logIn} retryLabel="Try again" /> : null}

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              testID="login-email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secure
              autoCapitalize="none"
              textContentType="password"
              testID="login-password"
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <Pressable accessibilityRole="link" style={{ flex: 1 }} onPress={() => router.push('/forgot-password')} hitSlop={8}>
                <Text style={{ fontFamily: face.bold, fontSize: 16, fontWeight: '700', color: color.ink }}>Forgot password?</Text>
              </Pressable>
              <Button kind="main" size="medium" busy={busy} onPress={logIn} testID="login" style={{ paddingHorizontal: 28 }}>Log in</Button>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
