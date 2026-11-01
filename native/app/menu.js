// Menu.dc.html — the short list behind the profile header.
//
// Four rows and a way out. It is deliberately not a settings screen: the
// board keeps it to the things people reach for often, with everything
// else one level down under Settings.
//
// Log out is the one destructive thing here, so it is the only red item
// and it sits apart from the rest.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, MediaTile, Button, Row, IconButton, Icon,
  color, space, text, useLoadingPhase,
} from '../src/ui';
import { api } from '../src/api';
import { supabase, useSession } from '../src/session';

export default function Menu() {
  const { profile, accessToken, session } = useSession();
  const [wallet, setWallet] = useState(null);
  const artist = profile?.role === 'artist';

  useEffect(() => {
    if (!accessToken) return;
    api('/api/viewer/wallet', { accessToken }).then((r) => { if (r.ok) setWallet(r.data); });
  }, [accessToken]);

  async function logOut() {
    await supabase().auth.signOut();
    router.replace('/discover');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <MediaTile style={{ width: 56, height: 56, borderRadius: 28 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={text.rowTitle} numberOfLines={1}>{profile?.display_name || profile?.username || 'You'}</Text>
            <Text style={text.supporting}>View your profile</Text>
          </View>
          <IconButton label="Close menu" onPress={() => router.back()}>
            <Icon.Close size={22} color={color.ink} />
          </IconButton>
        </View>

        <View style={{ gap: space.s }}>
          <Row
            icon={<Icon.Coin size={22} color={color.ink} />}
            title={artist ? 'Wallet and payouts' : 'Wallet'}
            subtitle={wallet ? `${wallet.balance} tokens` : 'Loading…'}
            onPress={() => router.push(artist ? '/artist/earnings' : '/wallet')}
          />
          <Row
            icon={<Icon.Gear size={22} color={color.ink} />}
            title="Settings"
            subtitle="Your stage, your account, your privacy"
            onPress={() => router.push('/settings')}
          />
          <Row
            icon={<Icon.Doc size={22} color={color.ink} />}
            title="Help and legal"
            subtitle="loudentify.app/help"
            onPress={() => router.push('/settings')}
          />
        </View>

        {session ? (
          <Button kind="quiet" onPress={logOut} textStyle={{ color: color.red }} testID="log-out">Log out</Button>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
