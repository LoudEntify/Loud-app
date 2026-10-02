// Profile: balance only, never a buy button (docs/CLAUDE.md §4).
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/api';
import { useSession, supabase } from '../../src/session';
import { styles } from '../../src/theme';
import { States } from '../../src/components/States';

export default function Profile() {
  const { session, profile, loading, accessToken } = useSession();
  const [wallet, setWallet] = useState(null);
  useEffect(() => { if (accessToken) api('/api/viewer/wallet', { accessToken }).then((r) => r.ok && setWallet(r.data)); }, [accessToken]);
  if (loading) return <States.Loading />;
  if (!session) return <States.Empty title="Your profile lives with your account" body="Sign up free to follow artists and hold tokens." action="Sign up free" onAction={() => router.push('/signup')} secondary="Log in" onSecondary={() => router.push('/login')} />;
  return (
    <ScrollView style={styles.screenLight} contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 110, gap: 14 }}>
      <Text style={styles.h1}>{profile?.display_name || 'You'}</Text>
      <Text style={styles.muted}>@{profile?.username}{profile?.role === 'artist' ? ' · artist' : ''}</Text>
      <View style={[styles.cardDark, { gap: 4 }]}><Text style={{ color: 'rgba(253,255,252,0.85)', fontWeight: '700', letterSpacing: 1 }}>YOUR BALANCE</Text><Text style={{ color: '#fdfffc', fontSize: 40, fontWeight: '700' }}>{wallet ? `${wallet.balance} tokens` : '…'}</Text><Text style={{ color: 'rgba(253,255,252,0.85)' }}>Tokens are bought on loudentify.app. The app shows your balance.</Text></View>
      {profile?.role === 'artist' && <Pressable style={[styles.btn, styles.btnGhostLight]} onPress={() => router.push('/web?path=/artist/earnings')}><Text style={styles.btnText}>Earnings and payouts (web)</Text></Pressable>}
      <Pressable style={[styles.btn, styles.btnGhostLight]} onPress={() => router.push('/web?path=/settings')}><Text style={styles.btnText}>Settings</Text></Pressable>
      <Pressable style={[styles.btn, styles.btnGhostLight]} onPress={async () => { await supabase().auth.signOut(); router.replace('/discover'); }}><Text style={[styles.btnText, { color: '#e71d36' }]}>Log out</Text></Pressable>
    </ScrollView>
  );
}
