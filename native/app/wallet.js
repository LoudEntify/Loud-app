// Wallet.dc.html — a fan's tokens, and where they went.
//
// Balance only, never a buy button: no payments in the native apps
// (CLAUDE.md §4). The board says so in its own words — "Use them to
// support artists during a show" — and there is no price anywhere on it.
// Tokens are bought on the website, and this screen says that plainly
// rather than leaving someone hunting for a button that is not there.
//
// The balance is summed from the ledger, so `complete: false` means the
// sum could not be derived from every leg. That is shown rather than
// hidden: a number someone spends against has to be honest about when it
// might be short.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Empty, ErrorPanel, Skeleton, Row, Icon,
  color, space, text, face, useLoadingPhase,
} from '../src/ui';
import { api } from '../src/api';
import { useSession } from '../src/session';

export default function Wallet() {
  const { accessToken, loading } = useSession();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const phase = useLoadingPhase(data === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    const r = await api('/api/viewer/wallet', { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setData(r.data);
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  if (phase !== 'done' && phase !== 'slow') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <Skeleton width={140} height={36} />
          <Skeleton width="100%" height={140} radius={16} />
          <Skeleton width="100%" height={64} radius={16} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 120, gap: space.l }}>
        <Text style={text.screenTitle}>Wallet</Text>

        {failed ? <ErrorPanel title="We could not load your wallet" body="Your tokens are safe; this is only the view." onRetry={load} /> : null}

        <Card style={{ gap: 4 }}>
          <Text style={text.label}>Your balance</Text>
          <Text style={{ fontFamily: face.bold, fontSize: 44, fontWeight: '700', color: color.ink }}>{data?.balance ?? 0}</Text>
          <Text style={text.supporting}>tokens. Use them to support artists during a show.</Text>
          {data && data.complete === false ? (
            <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>
              Some of your history could not be read just now, so this number may be short. It corrects itself.
            </Text>
          ) : null}
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text style={text.rowTitle}>How tokens work</Text>
          <Text style={text.supporting}>
            Tokens are how fans support artists mid-show. The artist keeps 72.5% of what you send, recorded at the moment you send it.
            You buy them on loudentify.app; the app shows what you have.
          </Text>
        </Card>

        {data?.spendingLimit ? (
          <Row icon={<Icon.Coin size={22} color={color.ink} />} title="My spending limit" subtitle={String(data.spendingLimit)} />
        ) : (
          <Row icon={<Icon.Coin size={22} color={color.ink} />} title="My spending limit" subtitle="Not set" />
        )}

        <View style={{ gap: space.s }}>
          <Text style={text.sectionHeading}>History</Text>
          {data?.history?.length ? data.history.map((h) => (
            <Row
              key={h.id}
              title={h.title}
              subtitle={`${h.detail ? `${h.detail} · ` : ''}${new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
              right={<Text style={{ fontFamily: face.bold, fontSize: 17, fontWeight: '700', color: h.amount < 0 ? color.ink : color.teal }}>{h.amount > 0 ? `+${h.amount}` : h.amount}</Text>}
            />
          )) : (
            <Empty
              icon={<Icon.Coin size={24} color={color.ink} />}
              title="Nothing here yet"
              body="Tokens you buy and support you send will show up here."
              actionLabel="Find a show"
              onAction={() => router.push('/live')}
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
