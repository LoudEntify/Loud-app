// PrivacySettings.dc.html — who can reach you, and what you never see.
//
// One real control on this screen, and it is the smallest one: clearing
// the search history, which lives on this phone in AsyncStorage and
// nowhere else (native/app/search.js says so on its own face, "Search
// history lives on the device, not here"). Clearing it is therefore a
// real, complete, verifiable action, and it is wired.
//
// "Save search history" is NOT wired, even though it would be one line
// to store: the search screen would have to read it, and a preference
// nothing reads is a switch that lies. Said plainly instead.
//
// "Who can message me" has no column and messaging itself is not built
// (the inbox's Messages tab is drawn and cannot be chosen). Blocking has
// no table. Both go to the screens and sentences that tell the truth
// about that rather than to switches that cannot act.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Screen, Card, Field, Button, Sheet, Row, ScreenHeader, ErrorPanel, Icon,
  color, space, text,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { api } from '../../src/api';
import { useSession } from '../../src/session';

// The same key native/app/search.js writes. Named here rather than
// imported because a screen importing another screen is worse than one
// string in two files, and the string is checked by this screen clearing
// something the search screen then shows as empty.
const RECENT_KEY = 'loudentify.recentSearches';

export default function PrivacySettings() {
  const { session, profile } = useSession();
  const [recent, setRecent] = useState(null);     // how many searches are stored
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cleared, setCleared] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [reportEmail, setReportEmail] = useState(session?.user?.email || '');
  const [reportBody, setReportBody] = useState('');
  const [reportError, setReportError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // The signed-in email is a sensible default and is still editable: a
  // person reporting something may not want the reply at that address.
  useEffect(() => {
    if (session?.user?.email) setReportEmail((e) => e || session.user.email);
  }, [session]);

  async function sendReport() {
    setSending(true); setReportError(null);
    const r = await api('/api/site/contact', {
      method: 'POST',
      body: {
        topic: 'report',
        name: profile?.display_name || 'Loudentify app',
        email: reportEmail.trim(),
        message: reportBody.trim(),
      },
    });
    setSending(false);
    if (!r.ok) {
      // The route answers with a sentence per field, so its words are
      // better than ours: it knows which field it refused and why.
      const fields = r.data?.errors ? Object.values(r.data.errors).join(' ') : null;
      setReportError(fields || r.data?.error || 'That did not send. Try again.');
      return;
    }
    setSent(true);
  }

  const read = useCallback(async () => {
    setError(null);
    try {
      const raw = await AsyncStorage.getItem(RECENT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      setRecent(Array.isArray(list) ? list.length : 0);
    } catch {
      setRecent(0);
    }
  }, []);

  useEffect(() => { read(); }, [read]);

  async function clearHistory() {
    setBusy(true); setError(null);
    try {
      await AsyncStorage.removeItem(RECENT_KEY);
      setRecent(0);
      setCleared(true);
    } catch {
      setError('We could not clear it. Try again.');
    }
    setBusy(false);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Privacy and safety" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {error ? <ErrorPanel title="That did not work" body={error} onRetry={read} /> : null}

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Who can message me</Text>
            <Text style={text.supporting}>Everyone, people you follow, or nobody.</Text>
            <NotStored testID="privacy-no-messaging">
              Messaging is not built yet, so there is nobody to let in or keep
              out. Nobody can message you at all today.
            </NotStored>
          </Card>

          <Row
            icon={<Icon.Flag size={22} color={color.ink} />}
            title="Blocking and filters"
            subtitle="Blocked accounts, and words you never want to see"
            onPress={() => router.push('/settings/blocked-words')}
          />

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Search history</Text>
            <Text style={text.supporting}>
              Your searches are kept on this phone only. They are never sent to
              us, so clearing them here clears them completely.
            </Text>
            <Text style={text.body}>
              {recent == null ? 'Reading…'
                : recent === 0 ? (cleared ? 'Cleared. Nothing is saved.' : 'Nothing saved yet.')
                  : `${recent} ${recent === 1 ? 'search' : 'searches'} saved on this phone.`}
            </Text>
            <Button
              kind="quiet"
              size="small"
              busy={busy}
              disabled={recent === 0}
              onPress={clearHistory}
              style={{ alignSelf: 'flex-start' }}
              testID="privacy-clear-history"
            >
              Clear search history
            </Button>
            <NotStored>
              Turning saving off is not in this build: the search screen would
              have to be taught to obey it, so there is no switch here that
              could.
            </NotStored>
          </Card>

          {/* Real: the same place the Report button on a show writes to,
              /api/site/contact with topic 'report', which lands in
              site_messages where a person reads it. */}
          <Row
            icon={<Icon.Warning size={22} color={color.ink} />}
            title="Report a problem"
            subtitle="Goes to a person, with a reference you can quote"
            onPress={() => { setSent(false); setSheet(true); }}
          />
          <Row
            icon={<Icon.Doc size={22} color={color.ink} />}
            title="Your data"
            subtitle="Download everything we hold, or close your account"
            onPress={() => router.push('/settings/account')}
          />
        </View>
      </ScrollView>

      {sheet ? (
        <Sheet onDismiss={() => setSheet(null)} label="Report a problem">
          <Text style={text.sectionHeading}>Report a problem</Text>
          {sent ? (
            <>
              <Text style={text.body}>
                Thank you. A person reads these. If you need to follow it up,
                quote the time you sent it.
              </Text>
              <Button kind="main" onPress={() => setSheet(null)}>Done</Button>
            </>
          ) : (
            <>
              <Text style={text.supporting}>
                Tell us what happened. If it is about a show, say which one.
              </Text>
              <Field
                label="Your email"
                value={reportEmail}
                onChangeText={setReportEmail}
                placeholder="So we can reply"
                keyboardType="email-address"
                autoCapitalize="none"
                testID="privacy-report-email"
              />
              <Field
                label="What happened"
                value={reportBody}
                onChangeText={setReportBody}
                multiline
                inputStyle={{ height: 120, paddingTop: 12, textAlignVertical: 'top' }}
                testID="privacy-report-body"
              />
              {reportError ? <ErrorPanel title="That did not send" body={reportError} /> : null}
              <Button kind="main" busy={sending} onPress={sendReport}>Send</Button>
              <Button kind="quiet" onPress={() => setSheet(null)}>Cancel</Button>
            </>
          )}
        </Sheet>
      ) : null}
    </Screen>
  );
}
