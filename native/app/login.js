import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/session';
import { styles } from '../src/theme';
import { color } from '../src/shared';
export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setErr(null); const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password }); setBusy(false); if (error) { setErr("That email and password don't match."); return; } router.replace('/discover'); }
  return (
    <View style={[styles.screenLight, { padding: 20, paddingTop: 80, gap: 12 }]}>
      <Text style={styles.h1}>Log in</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" style={styles.field} placeholderTextColor="#c9cfd1" />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry style={styles.field} placeholderTextColor="#c9cfd1" />
      {err && <Text style={{ color: color.red }}>{err}</Text>}
      <Pressable style={[styles.btn, { backgroundColor: color.ink, height: 52 }]} disabled={busy} onPress={go}><Text style={styles.btnTextDark}>{busy ? 'Logging in' : 'Log in'}</Text></Pressable>
      <Pressable onPress={() => router.push('/signup')}><Text style={{ fontWeight: '700', textDecorationLine: 'underline', textAlign: 'center' }}>Sign up</Text></Pressable>
    </View>
  );
}
