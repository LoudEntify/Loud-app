// Settings → YouTube: connect, reconnect, disconnect.
//
// This screen is not on any board, and it has to exist anyway. The
// privacy policy (/privacy, "Loudentify and YouTube") promises an artist
// can disconnect YouTube in Settings at any time and that we then delete
// the tokens — a promise the phone could not keep once the WebView went,
// because the only Connect and Disconnect buttons were on the website.
// components/YouTubeSettings.jsx is the web twin and this follows it
// through the same three routes, so there is one connection store, one
// OAuth flow and one disconnect.
//
// Connecting finishes in a browser, and that is not a shortcut. Google's
// consent screen will not run inside an app's own web view for a native
// client, and the callback has to land on the site that holds the signed
// state. So the app opens the system browser, the artist approves there,
// and comes back; this screen reads the status again when it regains
// focus, so returning shows the result without anyone pressing anything.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Linking, AppState } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Badge, ErrorPanel, Skeleton, ScreenHeader, Icon,
  color, space, text, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { explainYouTubeError } from '@loud/lib/youtube/api.js';

export default function YouTubeConnection() {
  const { accessToken, profile, loading } = useSession();
  const [mode, setMode] = useState(null);        // 'google' | 'mock'
  const [conn, setConn] = useState(null);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState('');          // '' | 'connect' | 'disconnect'
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const phase = useLoadingPhase(!read && !error);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError('');
    const r = await api('/api/artist/youtube/status', { accessToken });
    setRead(true);
    if (!r.ok) { setError(r.data?.error || 'We could not read your YouTube connection.'); return; }
    setMode(r.data?.mode || null);
    setConn(r.data?.connection?.connected ? r.data.connection : null);
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  // Coming back from the browser is the moment the answer changes, and
  // nobody should have to press refresh to see it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  async function connect() {
    setError(''); setNotice(''); setBusy('connect');
    const r = await api('/api/artist/youtube/connect', { method: 'POST', accessToken, body: { returnTo: 'settings' } });
    if (!r.ok) { setBusy(''); setError(r.data?.error || 'We could not start the connection.'); return; }
    if (r.data?.url) {
      // Google's consent screen, in the real browser. The callback lands
      // on the website; this screen updates when the app comes back.
      await Linking.openURL(r.data.url).catch(() => setError('We could not open your browser. Try again.'));
      setBusy('');
      setNotice('Approve Loudentify in your browser, then come back here.');
      return;
    }
    // Mock mode connects straight away, with no browser involved.
    setBusy(''); setNotice('YouTube connected.'); await load();
  }

  async function disconnect() {
    setError(''); setNotice(''); setBusy('disconnect');
    const r = await api('/api/artist/youtube/disconnect', { method: 'POST', accessToken });
    setBusy(''); setConfirming(false);
    if (!r.ok) { setError(r.data?.error || 'We could not disconnect. Try again.'); return; }
    setNotice(r.data?.revoked === false
      ? 'Disconnected. Your tokens are deleted here. Google did not confirm, so also remove Loudentify at myaccount.google.com/permissions.'
      : 'Disconnected. Your tokens and stream keys are deleted.');
    await load();
  }

  if (profile && profile.role !== 'artist') {
    return (
      <Screen>
        <ScreenHeader title="YouTube" onBack={() => router.push('/settings')} style={{ paddingTop: 56 }} />
        <View style={{ padding: space.screenEdge }}>
          <Text style={text.body}>YouTube carries your shows, so this belongs to a performer account.</Text>
        </View>
      </Screen>
    );
  }

  const liveLine = conn?.live_enabled === true
    ? 'Live streaming enabled'
    : conn?.live_enabled === false
      ? 'Live streaming not enabled on this channel yet'
      : 'Live streaming not checked yet';
  // The status route records Google's last refusal to refresh: the weekly
  // expiry while the consent screen is in testing, or access removed.
  const broken = Boolean(conn?.last_refresh_error);

  return (
    <Screen>
      <ScreenHeader title="YouTube" onBack={() => router.push('/settings')} style={{ paddingTop: 56 }} />
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, gap: space.l }}>
        {phase !== 'done' && phase !== 'slow' ? (
          <Card style={{ gap: space.sm }}>
            <Skeleton width="60%" height={20} />
            <Skeleton width="80%" height={16} />
          </Card>
        ) : error ? (
          <ErrorPanel title="We could not read your connection" body={error} onRetry={load} />
        ) : conn ? (
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon.Film size={22} color={color.ink} />
              <Text style={[text.rowTitle, { flex: 1 }]} numberOfLines={1}>{conn.channel_title || conn.channel_id}</Text>
              {mode === 'mock' ? <Badge kind="soon">MOCK</Badge> : null}
            </View>
            <Text style={[text.supporting, conn.live_enabled === false ? { color: color.red } : null]}>{liveLine}</Text>
            {broken ? (
              <Text style={{ fontSize: 15, color: color.red }}>
                {explainYouTubeError(conn.last_refresh_error)}
              </Text>
            ) : null}
            {!confirming ? (
              <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
                <Button kind={broken ? 'main' : 'quiet'} size="medium" style={{ flex: 1 }} busy={busy === 'connect'} onPress={connect} testID="youtube-reconnect">Reconnect</Button>
                <Button kind="quiet" size="medium" style={{ flex: 1 }} onPress={() => setConfirming(true)} testID="youtube-disconnect">Disconnect</Button>
              </View>
            ) : (
              <View style={{ gap: space.s, marginTop: space.xs }}>
                <Text style={text.supporting}>
                  Disconnecting deletes the tokens we hold and wipes your stream keys. Shows already booked keep their broadcast; new ones cannot be created until you connect again.
                </Text>
                <View style={{ flexDirection: 'row', gap: space.s }}>
                  <Button kind="destructive" size="medium" style={{ flex: 1 }} busy={busy === 'disconnect'} onPress={disconnect} testID="youtube-disconnect-confirm">Yes, disconnect</Button>
                  <Button kind="quiet" size="medium" style={{ flex: 1 }} onPress={() => setConfirming(false)}>Keep it</Button>
                </View>
              </View>
            )}
          </Card>
        ) : (
          <Card style={{ gap: space.sm }}>
            <Text style={text.rowTitle}>No channel connected</Text>
            <Text style={text.supporting}>
              YouTube carries the picture for your shows. Connect the channel you want to stream to; we never see your password, and you can disconnect here at any time.
            </Text>
            <Button kind="main" busy={busy === 'connect'} onPress={connect} testID="youtube-connect">Connect YouTube</Button>
          </Card>
        )}

        {notice ? <Text style={text.supporting}>{notice}</Text> : null}

        <Card style={{ gap: space.sm }}>
          <Text style={text.rowTitle}>If it stops working</Text>
          <Text style={text.supporting}>
            A connection can expire while our Google consent screen is still being reviewed. Reconnecting fixes it, and nothing about your shows or recordings is lost when it happens.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
