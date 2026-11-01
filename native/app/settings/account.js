// AccountSettings.dc.html — profile and sign-in, and your data.
//
// Four of the six rows are real, and the two that are not say so:
//
//   Edit profile        real. Display name, bio and genres are written
//                       straight to `profiles` under row-level security,
//                       exactly as the website writes them. The board
//                       links this out to the owner profile; the fields
//                       are here because this is where they are wired.
//   Password, passkeys  not in the app. No route, no provider.
//   Log out everywhere  real. Supabase signs out every session.
//   Request my data     real. POST /api/account/export builds the whole
//                       account and this saves and shares the file.
//   Close my account    real. GET /api/account/close says whether the
//                       database can do it; POST does it, and only after
//                       the word is typed. Deliberately not a wipe, and
//                       the board's own sentence is what says so.
//   How you use it      not on the board. Becoming an artist has its own
//                       screen (/become-artist) and its agreement, so
//                       this links there; becoming a viewer again has no
//                       screen at all, so it is done here.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Screen, Card, Field, Button, Chip, Sheet, Row, Section, ScreenHeader, ErrorPanel, Icon,
  color, space, text,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { api } from '../../src/api';
import { supabase, useSession, AUTH_CONFIGURED } from '../../src/session';
import { GENRES } from '@loud/lib/genres.js';

const CONFIRM = 'CLOSE';

export default function AccountSettings() {
  const { session, profile, accessToken, loading } = useSession();
  const userId = session?.user?.id || null;

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);        // 'export' | 'logout' | 'close' | 'role'
  const [closure, setClosure] = useState(null);  // { available, reason } from the route
  const [confirm, setConfirm] = useState('');
  const [sheet, setSheet] = useState(null);      // 'close' | 'role'

  // An account screen belongs to an account.
  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);

  // The profile arrives with the session, so the form starts from it
  // rather than from a second read of the same row.
  useEffect(() => {
    if (!profile || form) return;
    setForm({
      display_name: profile.display_name || '',
      bio: profile.bio || '',
      genres: Array.isArray(profile.genres) ? profile.genres : [],
    });
  }, [profile, form]);

  const readClosure = useCallback(async () => {
    if (!accessToken) return;
    const r = await api('/api/account/close', { accessToken });
    setClosure(r.ok ? r.data : { available: false, reason: 'read_failed' });
  }, [accessToken]);

  useEffect(() => { if (!loading) readClosure(); }, [loading, readClosure]);

  async function saveProfile() {
    if (!userId || !AUTH_CONFIGURED || !form) return;
    const name = (form.display_name || '').trim();
    if (!name) { setError('A name is needed: it is what people see on your shows.'); return; }
    setSaving(true); setError(null); setSaved(false);
    const { error: err } = await supabase().from('profiles')
      .update({ display_name: name, bio: (form.bio || '').trim() || null, genres: form.genres || [] })
      .eq('id', userId);
    setSaving(false);
    if (err) { setError('That did not save. Try again.'); return; }
    setSaved(true);
  }

  /**
   * The export route answers with the whole account as one JSON body
   * and a Content-Disposition the phone has no use for, so the file is
   * written here and handed to the share sheet. Without sharing there is
   * nowhere for it to go, and that is said rather than left as a button
   * that appears to do nothing.
   */
  async function requestData() {
    setBusy('export'); setError(null); setNotice(null);
    const r = await api('/api/account/export', { method: 'POST', accessToken });
    if (!r.ok) {
      setBusy(null);
      setError(r.data?.error || 'We could not build your export. Try again.');
      return;
    }
    try {
      const name = `loudentify-export-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.document, name);
      file.write(JSON.stringify(r.data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name });
        setNotice('Your data is ready. It was saved as a file you can keep.');
      } else {
        setNotice(`Your data was saved to this phone as ${name}. This phone cannot share files, so it stays there.`);
      }
    } catch {
      setError('Your data was built but could not be saved to this phone.');
    }
    setBusy(null);
  }

  async function logOutEverywhere() {
    if (!AUTH_CONFIGURED) return;
    setBusy('logout'); setError(null);
    const { error: err } = await supabase().auth.signOut({ scope: 'global' });
    setBusy(null);
    if (err) { setError('We could not sign you out everywhere. Try again.'); return; }
    router.replace('/login');
  }

  async function closeAccount() {
    setBusy('close'); setError(null);
    const r = await api('/api/account/close', { method: 'POST', accessToken, body: { confirm } });
    setBusy(null);
    if (!r.ok) { setError(r.data?.error || 'We could not close your account. Nothing has been changed.'); return; }
    setSheet(null);
    // Login is disabled by the route, so there is nothing to stay on.
    if (AUTH_CONFIGURED) await supabase().auth.signOut().catch(() => { /* already gone */ });
    router.replace('/login');
  }

  /**
   * Going back to watching, only. The other direction has its own
   * screen (/become-artist) because it carries the artist agreement,
   * and an upgrade that skipped the agreement would be an upgrade
   * nobody agreed to.
   */
  async function becomeViewer() {
    setBusy('role'); setError(null);
    const r = await api('/api/profile/become-viewer', { method: 'POST', accessToken });
    setBusy(null);
    if (!r.ok) { setError(r.data?.error || 'That did not work. Nothing has been changed.'); return; }
    setSheet(null);
    setNotice('You are a viewer again. Your recordings, wallet and history are kept.');
  }

  const artist = profile?.role === 'artist';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 140, gap: space.xl }}>
        <ScreenHeader title="Account" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.xl }}>
          {error ? <ErrorPanel title="That did not work" body={error} /> : null}
          {notice ? (
            <Card style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
              <Icon.Check size={22} color={color.ink} />
              <Text style={[text.body, { flex: 1 }]}>{notice}</Text>
            </Card>
          ) : null}

          <Section title="Profile and sign-in">
            <Card style={{ gap: space.m }}>
              <Text style={text.rowTitle}>Edit profile</Text>
              <Field
                label="Name"
                value={form?.display_name ?? ''}
                onChangeText={(v) => { setSaved(false); setForm((f) => ({ ...f, display_name: v })); }}
                placeholder="The name on your shows"
                testID="account-name"
              />
              <Field
                label="About you"
                value={form?.bio ?? ''}
                onChangeText={(v) => { setSaved(false); setForm((f) => ({ ...f, bio: v })); }}
                placeholder="A line or two"
                multiline
                inputStyle={{ height: 96, paddingTop: 12, textAlignVertical: 'top' }}
                testID="account-bio"
              />
              <View style={{ gap: space.sm }}>
                <Text style={[text.supporting, { fontWeight: '700', color: color.ink }]}>Genres</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {GENRES.map((g) => {
                    const on = (form?.genres || []).includes(g);
                    return (
                      <Chip
                        key={g}
                        role="checkbox"
                        selected={on}
                        onPress={() => { setSaved(false); setForm((f) => { const have = f?.genres || []; return { ...f, genres: on ? have.filter((x) => x !== g) : [...have, g] }; }); }}
                      >
                        {g}
                      </Chip>
                    );
                  })}
                </View>
              </View>
              <Button kind="main" busy={saving} onPress={saveProfile} testID="account-save">
                {saved ? 'Saved' : 'Save profile'}
              </Button>
            </Card>

            <Row
              icon={<Icon.Person size={22} color={color.ink} />}
              title="Password and passkeys"
            />
            <NotStored testID="account-no-password">
              Changing your password and adding a passkey are on the website.
              Neither is in the app yet.
            </NotStored>

            <Row
              icon={<Icon.Refresh size={22} color={color.ink} />}
              title="Log out everywhere"
              subtitle="Signs this account out of every phone and browser"
              right={(
                <Button kind="quiet" size="small" busy={busy === 'logout'} onPress={logOutEverywhere} accessibilityLabel="Log out everywhere">
                  Log out
                </Button>
              )}
            />
          </Section>

          <Section title="Your data">
            <Row
              icon={<Icon.Doc size={22} color={color.ink} />}
              title="Request my data"
              subtitle="A download of your profile, shows, wallet and notifications"
              right={(
                <Button kind="quiet" size="small" busy={busy === 'export'} onPress={requestData} accessibilityLabel="Request my data">
                  Request
                </Button>
              )}
            />

            {closure && !closure.available ? (
              <NotStored testID="account-close-unavailable">
                Closing an account needs a database update that has not been
                applied here yet. Nothing about your account has changed.
              </NotStored>
            ) : (
              <Row
                icon={<Icon.Warning size={22} color={color.red} />}
                title="Close my account"
                subtitle="Hides your profile and makes recordings private. Money records are kept."
                right={(
                  <Button kind="quiet" size="small" onPress={() => { setConfirm(''); setSheet('close'); }} accessibilityLabel="Close my account">
                    Close
                  </Button>
                )}
              />
            )}
          </Section>

          {/* Not on the board. /api/profile/become-viewer is wired,
              audited, and has nowhere else to be reached from on the
              phone; becoming an artist already has its own screen. */}
          <Section title="How you use Loudentify">
            {artist ? (
              <Row
                icon={<Icon.Mic size={22} color={color.ink} />}
                title="You perform on Loudentify"
                subtitle="Going back to watching keeps your recordings and your wallet."
                right={(
                  <Button kind="quiet" size="small" onPress={() => setSheet('role')} accessibilityLabel="Become a viewer">
                    Just watch
                  </Button>
                )}
              />
            ) : (
              <Row
                icon={<Icon.Mic size={22} color={color.ink} />}
                title="You watch on Loudentify"
                subtitle="Performing lets you book shows. You must be 18 or over."
                onPress={() => router.push('/become-artist')}
              />
            )}
          </Section>
        </View>
      </ScrollView>

      {sheet === 'close' ? (
        <Sheet onDismiss={() => setSheet(null)} label="Close my account">
          <Text style={text.sectionHeading}>Close my account</Text>
          <Text style={text.body}>
            Your profile is hidden, your recordings become private and upcoming
            shows are cancelled. Your money records and your stage name are
            kept. This is not a deletion, and there is no self-service way back
            in: you would have to ask us.
          </Text>
          <Field
            label={`Type ${CONFIRM} to confirm`}
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="account-confirm"
          />
          <Button
            kind="destructive"
            busy={busy === 'close'}
            disabled={confirm.trim().toUpperCase() !== CONFIRM}
            onPress={closeAccount}
          >
            Close my account
          </Button>
          <Button kind="quiet" onPress={() => setSheet(null)}>Keep my account</Button>
        </Sheet>
      ) : null}

      {sheet === 'role' ? (
        <Sheet onDismiss={() => setSheet(null)} label="Become a viewer">
          <Text style={text.sectionHeading}>Go back to watching</Text>
          <Text style={text.body}>
            Your recordings, wallet and history stay exactly as they are. You
            can start performing again whenever you like.
          </Text>
          <Button kind="strong" busy={busy === 'role'} onPress={becomeViewer}>Just watch</Button>
          <Button kind="quiet" onPress={() => setSheet(null)}>Not now</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
