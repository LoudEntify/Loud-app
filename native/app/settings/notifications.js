// NotificationSettings.dc.html — which of these reach you.
//
// Eight switches on the board. ONE of them has somewhere to be stored.
//
// "Email updates" is marketing email, and that is a consent with a
// lawful basis and a table built for it: `consent_records`, insert-own
// under row-level security, every change a new row and every row
// audited by a trigger (supabase/migrations/20261001160300). So that
// one is real, and switching it writes a record of the switch.
//
// The other seven are push-notification preferences. There is no column
// for them, no route, and no push notifications in this build at all, so
// there is nothing for a toggle to mean. They are drawn as the board
// writes them, without switches, and the screen says why. The inbox is
// where every one of these already arrives.
import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Toggle, Row, Section, ScreenHeader, ErrorPanel, Skeleton, Icon,
  color, space, useLoadingPhase,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { supabase, useSession, AUTH_CONFIGURED } from '../../src/session';

/** The board's rows, in its order and its words. */
const SHOWS = [
  ['My show reminders', '24 hours, 4 hours, 1 hour and 30 minutes before'],
  ['Shows I set reminders for', 'When they are about to start'],
  ['Artists I follow go live', 'The moment their show starts'],
  ['Recordings ready', 'From shows I watched or performed'],
];
const PEOPLE = [
  ['Messages', null],
  ['Replies to my comments', null],
  ['New followers', null],
];

export default function NotificationSettings() {
  const { session, loading } = useSession();
  const userId = session?.user?.id || null;
  const [email, setEmail] = useState(null);        // true | false, or null while unknown
  const [stored, setStored] = useState(null);      // true when consent_records answered
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const phase = useLoadingPhase(stored === null && !error);

  const load = useCallback(async () => {
    if (!userId || !AUTH_CONFIGURED) { setStored(false); return; }
    setError(null);
    // The current answer is the latest row for this (user, type) pair —
    // the table is append-only, so there is nothing else it could be.
    const { data, error: err } = await supabase().from('consent_records')
      .select('granted, recorded_at')
      .eq('user_id', userId).eq('consent_type', 'marketing_email')
      .order('recorded_at', { ascending: false }).limit(1);
    if (err) { setStored(false); return; }
    setStored(true);
    // "Off unless you turn it on": no row means nobody ever agreed.
    setEmail(data?.length ? Boolean(data[0].granted) : false);
  }, [userId]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  async function setEmailUpdates(next) {
    const before = email;
    setEmail(next); setSaving(true); setError(null);
    const { error: err } = await supabase().from('consent_records')
      .insert({ user_id: userId, consent_type: 'marketing_email', granted: next, source: 'settings' });
    setSaving(false);
    if (err) {
      setEmail(before);          // put it back: nothing was recorded
      setError('That did not save, so it has gone back to what it was. Try again.');
    }
  }

  if (phase === 'loading') return <NotificationsSkeleton />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.xxl }}>
        <ScreenHeader title="Notifications" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.xxl }}>
          {error ? <ErrorPanel title="That did not save" body={error} onRetry={load} /> : null}

          <NotStored testID="notifications-no-push">
            Push notifications are not in this build, so none of the choices
            below can be stored or obeyed yet. Everything they describe already
            arrives in your inbox.
          </NotStored>

          <Row
            icon={<Icon.Bell size={22} color={color.ink} />}
            title="Open your inbox"
            subtitle="Reminders, invites, replies and follows"
            onPress={() => router.push('/inbox')}
          />

          <Section title="Shows">
            {SHOWS.map(([title, subtitle]) => (
              <Row key={title} title={title} subtitle={subtitle || undefined} />
            ))}
          </Section>

          <Section title="People">
            {PEOPLE.map(([title, subtitle]) => (
              <Row key={title} title={title} subtitle={subtitle || undefined} />
            ))}
          </Section>

          <Section title="From Loudentify">
            {stored ? (
              <Row
                title="Email updates"
                subtitle="News and features. Off unless you turn it on."
                right={(
                  <Toggle
                    label="Email updates"
                    value={Boolean(email)}
                    disabled={saving}
                    onValueChange={setEmailUpdates}
                  />
                )}
              />
            ) : (
              <>
                <Row title="Email updates" subtitle="News and features. Off unless you turn it on." />
                <NotStored testID="notifications-no-consent">
                  We could not reach the record of what you have agreed to, so
                  this cannot be changed here. No email is sent until it can be.
                </NotStored>
              </>
            )}
          </Section>
        </View>
      </ScrollView>
    </Screen>
  );
}

function NotificationsSkeleton() {
  return (
    <Screen>
      <View style={{ paddingTop: 52, paddingHorizontal: space.screenEdge, gap: space.l }}>
        <Skeleton width={44} height={44} radius={22} />
        <Skeleton width={200} height={34} />
        <Skeleton width="100%" height={72} radius={12} />
        <Skeleton width={90} height={21} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={64} radius={16} />
      </View>
    </Screen>
  );
}
