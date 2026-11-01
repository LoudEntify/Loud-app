// WalletPayouts.dc.html — what an artist has earned, and what stands
// between that and their bank.
//
// This replaces a WebView. Earnings used to open the website inside the
// app, which is the thing that made it feel like two apps.
//
// One honest limit, which the board states itself: "Cashing out, the
// identity check and payout details are done on the web, from a computer
// or browser." That is not a shortcut. Cash-out is a protected path, the
// identity provider is not chosen yet (docs/NEEDS_KOREY.md), and no
// payment detail should be typed into a phone screen we have not built
// for it. So this screen shows the money and sends the person to a
// browser for the two steps that move it.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Empty, ErrorPanel, Skeleton, Row, Badge, Icon,
  color, space, text, face, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { API_BASE } from '../../src/config';

const money = (minor, currency = 'GBP') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((minor || 0) / 100);

const KYC = {
  verified: { label: 'Verified', tone: 'teal' },
  pending: { label: 'In review', tone: 'orange' },
  not_started: { label: 'Not started', tone: 'quiet' },
};

export default function Earnings() {
  const { accessToken, loading } = useSession();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const phase = useLoadingPhase(data === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    const r = await api('/api/artist/earnings', { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setData(r.data);
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  if (phase !== 'done' && phase !== 'slow') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <Skeleton width={220} height={36} />
          <Skeleton width="100%" height={160} radius={16} />
          <Skeleton width="100%" height={64} radius={16} />
          <Skeleton width="100%" height={64} radius={16} />
        </View>
      </Screen>
    );
  }

  const kyc = KYC[data?.kycStatus] || KYC.not_started;
  const web = `${API_BASE || 'https://loudentify.app'}/artist/earnings`;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 120, gap: space.l }}>
        <Text style={text.screenTitle}>Wallet and payouts</Text>

        {failed ? <ErrorPanel title="We could not load your earnings" body="Nothing is lost; this is only the view." onRetry={load} /> : null}

        <Card style={{ gap: space.m }}>
          <Text style={text.label}>Your earnings</Text>
          <View style={{ flexDirection: 'row', gap: space.xl }}>
            <View style={{ gap: 2 }}>
              <Text style={text.supporting}>Ready to cash out</Text>
              <Text style={{ fontFamily: face.bold, fontSize: 30, fontWeight: '700', color: color.ink }}>{money(data?.availableMinor)}</Text>
            </View>
            <View style={{ gap: 2 }}>
              <Text style={text.supporting}>Pending</Text>
              <Text style={{ fontFamily: face.bold, fontSize: 30, fontWeight: '700', color: color.ink }}>{money(data?.pendingMinor)}</Text>
            </View>
          </View>
          <Text style={text.supporting}>You keep 72.5% of the tokens fans send you.</Text>
        </Card>

        <Row
          icon={<Icon.Person size={22} color={color.ink} />}
          title="Identity check"
          subtitle={data?.identityProvider ? undefined : 'Required before a first cash-out'}
          right={<Badge kind={kyc.tone === 'teal' ? 'versus' : 'soon'}>{kyc.label}</Badge>}
        />

        <Row
          icon={<Icon.Coin size={22} color={color.ink} />}
          title="Payout account"
          subtitle="Held by our payment provider, never by us"
          right={<Text style={text.supporting}>{data?.payoutAccount || 'Not added'}</Text>}
        />

        <Card style={{ gap: space.sm }}>
          <Text style={text.supporting}>
            Cashing out, the identity check and payout details are done on the web, from a computer or browser.
          </Text>
          <Button kind="quiet" size="medium" onPress={() => Linking.openURL(web)} icon={<Icon.Share size={18} color={color.ink} />}>
            Open on the web
          </Button>
        </Card>

        <Row
          icon={<Icon.Coin size={22} color={color.ink} />}
          title="Token balance"
          subtitle="For supporting other artists"
          right={<Text style={{ fontFamily: face.bold, fontSize: 19, fontWeight: '700', color: color.ink }}>{data?.balanceTokens ?? 0}</Text>}
          onPress={() => router.push('/wallet')}
        />

        <View style={{ gap: space.s }}>
          <Text style={text.sectionHeading}>Payout history</Text>
          {data?.cashouts?.length ? data.cashouts.map((c) => (
            <Row
              key={c.id}
              title={money(c.amount_minor, data.currency)}
              subtitle={new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              right={<Badge kind="soon">{String(c.status || '').toUpperCase()}</Badge>}
            />
          )) : (
            <Text style={text.supporting}>No payouts yet. They will show here with their status.</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
