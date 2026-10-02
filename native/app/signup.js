// One-page sign-up: the same rules as the web (validateSignup is shared), the
// same server route, the same kind stop screen for under-18s.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api';
import { supabase } from '../src/session';
import { styles } from '../src/theme';
import { color, validateSignup } from '../src/shared';

export default function SignUp() {
  const { trigger = 'direct' } = useLocalSearchParams();
  const [f, setF] = useState({ role: 'viewer', firstName: '', lastName: '', username: '', dateOfBirth: '', country: 'GB', city: '', email: '', password: '', acceptTerms: false, trainingDataOptOut: false });
  const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false); const [underage, setUnderage] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  async function submit() {
    const v = validateSignup(f);
    if (v.underage) { setUnderage(true); return; }
    if (!v.ok) { setErrors(v.errors); return; }
    setBusy(true); setErrors({});
    const r = await api('/api/viewer/signup', { method: 'POST', body: { ...f, trigger } });
    if (r.data?.underage) { setBusy(false); setUnderage(true); return; }
    if (!r.ok) { setBusy(false); setErrors(r.data?.errors || { form: r.data?.error || 'Could not sign you up.' }); return; }
    const { error } = await supabase().auth.signInWithPassword({ email: v.values.email, password: v.values.password });
    setBusy(false);
    if (error) { setErrors({ form: 'Account created but sign-in failed. Try logging in.' }); return; }
    router.replace(f.role === 'artist' ? '/create' : '/discover');
  }
  if (underage) return (
    <View style={[styles.screenDark, { padding: 20, paddingTop: 80, gap: 18 }]}>
      <Text style={styles.h1Dark}>You need to be 18 to use Loudentify</Text>
      <Text style={styles.bodyDark}>Thanks for your interest. Shows here are live and unedited, and fans can send money to artists, so we keep it to adults.</Text>
      <Text style={styles.bodyDark}>We have not kept the date you entered. Come back when you turn 18 and the music will still be here.</Text>
      <Pressable style={[styles.btn, styles.btnGhostDark, { height: 52 }]} onPress={() => { setUnderage(false); set('dateOfBirth')(''); }}><Text style={styles.btnTextDark}>I entered the wrong date</Text></Pressable>
    </View>
  );
  const Field = ({ k, label, ...rest }) => <View style={{ gap: 6 }}><Text style={{ fontWeight: '700', fontSize: 14 }}>{label}</Text><TextInput value={f[k]} onChangeText={set(k)} style={styles.field} placeholderTextColor="#c9cfd1" {...rest} />{errors[k] && <Text style={{ color: color.red }}>{errors[k]}</Text>}</View>;
  return (
    <ScrollView style={styles.screenLight} contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 12 }}>
      <Text style={styles.h1}>Keep watching, free</Text>
      <Text style={styles.muted}>Under a minute.</Text>
      <View style={[styles.row, { backgroundColor: 'rgba(1,22,39,0.07)', borderRadius: 999, padding: 4 }]}>{[['viewer', "I'm here to watch"], ['artist', "I'm here to perform"]].map(([r, l]) => <Pressable key={r} onPress={() => set('role')(r)} style={[styles.btn, { flex: 1, height: 40, backgroundColor: f.role === r ? color.porcelain : 'transparent', borderWidth: 2, borderColor: f.role === r ? color.ink : 'transparent' }]}><Text style={{ fontWeight: f.role === r ? '700' : '400' }}>{l}</Text></Pressable>)}</View>
      <Field k="firstName" label="First name" placeholder="First name" />
      <Field k="lastName" label="Last name" placeholder="Last name" />
      <Field k="username" label="Username" placeholder="@yourname" autoCapitalize="none" />
      <Field k="dateOfBirth" label="Date of birth" placeholder="DD / MM / YYYY" keyboardType="numeric" />
      <Field k="city" label="City" placeholder="City" />
      <Field k="email" label="Email" placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
      <Field k="password" label="Password" placeholder="8+ characters" secureTextEntry />
      <View style={[styles.row, { alignItems: 'flex-start' }]}><Switch value={f.acceptTerms} onValueChange={set('acceptTerms')} /><Text style={{ flex: 1, fontSize: 14 }}>By continuing you confirm you are 18 or over and agree to the Terms and Conditions and Community Guidelines.</Text></View>
      {errors.acceptTerms && <Text style={{ color: color.red }}>{errors.acceptTerms}</Text>}
      {f.role === 'artist' && <View style={[styles.row, { alignItems: 'flex-start', backgroundColor: 'rgba(46,196,182,0.14)', padding: 12, borderRadius: 12 }]}><Switch value={!f.trainingDataOptOut} onValueChange={(v) => set('trainingDataOptOut')(!v)} /><Text style={{ flex: 1, fontSize: 14 }}>Help the AI director learn from my shows. On by default, only your own performance, only inside Loudentify. Switch it off any time in Settings.</Text></View>}
      {errors.form && <Text style={{ color: color.red }}>{errors.form}</Text>}
      <Pressable style={[styles.btn, { backgroundColor: color.ink, height: 52 }]} disabled={busy} onPress={submit}><Text style={styles.btnTextDark}>{busy ? 'Creating your account' : 'Continue with email'}</Text></Pressable>
      <Pressable onPress={() => router.push('/login')}><Text style={{ fontWeight: '700', textDecorationLine: 'underline', textAlign: 'center' }}>Log in</Text></Pressable>
      <Text style={styles.muted}>Apple and Google sign-in arrive with the store credentials (NEEDS_KOREY).</Text>
    </ScrollView>
  );
}
