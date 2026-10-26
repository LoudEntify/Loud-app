// native/app/forgot-password.js — ask for a reset link from the phone.
//
// The link itself lands on the website (/reset-password), because that is
// where an email link can open: a person tapping a link in their mail app
// should not need the app installed, signed in and on the right screen for
// it to work. The phone's job is to ask for the link and say what happens
// next; the new password is typed in the browser and used here at the next
// log in.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/session';
import { styles } from '../src/theme';
import { color } from '../src/shared';
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
    <View style={[styles.screenLight, { padding: 20, paddingTop: 80, gap: 12 }]}>
      <Text style={styles.h1}>Forgot password</Text>
      {sent ? (
        <>
          <Text style={{ fontWeight: '700', fontSize: 17 }}>Check your email</Text>
          <Text style={styles.muted}>{RESET_SENT_MESSAGE}</Text>
          <Text style={styles.muted}>Open it on any device, choose a new password, then come back here and log in with it.</Text>
          <Pressable style={[styles.btn, { backgroundColor: color.ink, height: 52 }]} onPress={() => router.replace('/login')}><Text style={styles.btnTextDark}>Back to log in</Text></Pressable>
        </>
      ) : (
        <>
          <Text style={styles.muted}>Type the email you signed up with and we will send you a link.</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.field} placeholderTextColor="#c9cfd1" testID="reset-email" />
          {err ? <Text style={{ color: color.red }}>{err}</Text> : null}
          <Pressable style={[styles.btn, { backgroundColor: color.ink, height: 52 }]} disabled={busy} onPress={send} testID="send-link"><Text style={styles.btnTextDark}>{busy ? 'Sending' : 'Send the link'}</Text></Pressable>
          <Text style={styles.muted}>Signed up with Apple or Google? There is no password to reset. Go back and use that button instead.</Text>
          <Pressable onPress={() => router.replace('/login')}><Text style={{ fontWeight: '700', textDecorationLine: 'underline', textAlign: 'center' }}>Back to log in</Text></Pressable>
        </>
      )}
    </View>
  );
}
