// ForgotPassword.dc.html — ask for a reset link from the phone.
//
// The link itself lands on the website (/reset-password), because that is
// where an email link can open: a person tapping a link in their mail app
// should not need the app installed, signed in and on the right screen for
// it to work. The phone's job is to ask for the link and say what happens
// next; the new password is typed in the browser and used here at the next
// log in.
//
// The answer is the same whether or not that email has an account, and the
// wording comes from lib/passwordReset.js rather than this screen so the
// website cannot say it differently. "User not found" from the provider is
// deliberately swallowed: telling a stranger which addresses are
// registered hands them a list of our users.
//
// The board draws a wordmark where this puts the name in type, the same
// way app/login.js does: the logo file is a web asset and the two screens
// are the same sheet.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Screen, Button, Field, Icon,
  color, space, radius, surface, text, face, size, gradient,
} from '../src/ui';
import { supabase } from '../src/session';
import { API_BASE } from '../src/config';
import { validateResetRequest, resetErrorMessage, resetRedirectTo, RESET_SENT_MESSAGE } from '@loud/lib/passwordReset.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function send() {
    const v = validateResetRequest(email);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase().auth.resetPasswordForEmail(v.email, { redirectTo: resetRedirectTo(API_BASE) });
    setBusy(false);
    // Never say whether that email has an account: the same answer either way.
    if (error && !/user not found/i.test(error.message || '')) { setErr(resetErrorMessage(error) || 'We could not send the link just now. Try again in a minute.'); return; }
    setSent(true);
  }

  return (
    <Screen dark>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: color.mist,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: 28, maxHeight: '82%',
        }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(1,22,39,0.2)' }} />
          <ScrollView contentContainerStyle={{ gap: space.l, paddingTop: 14 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => router.replace('/login')}
                style={({ pressed }) => ({ width: size.touch, height: size.touch, borderRadius: size.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.quiet, opacity: pressed ? 0.85 : 1 })}
              >
                <Icon.Back size={22} color={color.ink} />
              </Pressable>
              <Text style={[text.rowTitle, { fontSize: 17 }]}>Loudentify</Text>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={[text.screenTitle, { fontSize: 30 }]}>Reset your password</Text>
              <Text style={[text.body, { color: 'rgba(1,22,39,0.78)' }]}>Type the email you signed up with and we will send you a link.</Text>
            </View>

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              error={err}
              testID="reset-email"
            />

            <Button kind="main" busy={busy} onPress={send} testID="send-link">Send the link</Button>

            {/* The board shows this card on the screen as drawn; it only
                means anything once a link has been asked for, so that is
                when it appears. */}
            {sent ? (
              <View
                // The board marks this role="status"; React Native has no
                // such role, so the live region is what carries it to a
                // screen reader.
                accessibilityLiveRegion="polite"
                style={{ flexDirection: 'row', gap: space.m, padding: 14, paddingHorizontal: space.l, borderRadius: radius.card, backgroundColor: 'rgba(46,196,182,0.22)' }}
                testID="reset-sent"
              >
                <View style={{ width: 26, height: 26, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  <LinearGradient
                    colors={gradient.tealButton.colors}
                    locations={gradient.tealButton.locations}
                    start={gradient.tealButton.start}
                    end={gradient.tealButton.end}
                    style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                  />
                  <Icon.Check size={20} color={color.ink} />
                </View>
                <Text style={[text.body, { flex: 1, fontSize: 16 }]}>{RESET_SENT_MESSAGE}</Text>
              </View>
            ) : null}

            <Text style={[text.body, { fontSize: 16, color: 'rgba(1,22,39,0.78)' }]}>
              Signed up with Apple or Google? Go back and use that button instead.
            </Text>

            <Pressable
              accessibilityRole="link"
              onPress={() => router.replace('/login')}
              hitSlop={12}
              style={{ alignSelf: 'center', padding: space.sm }}
            >
              <Text style={{ fontFamily: face.bold, fontSize: 16, fontWeight: '700', color: color.ink }}>Back to log in</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
