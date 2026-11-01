// RegionSettings.dc.html — country, city, time zone, language.
//
// One of the four is stored: `profiles.country`, which signup already
// writes and which this screen can change under row-level security. It
// is stored as the ISO code, never the name (lib/countries.js), because
// display names differ by locale and codes do not.
//
// City has no column, so it is not offered. Location is not asked for
// anywhere in the app, so there is no permission to turn on. The time
// zone is simply the phone's, and every show time in the app is already
// rendered in it — the board's switch has nothing to switch between, so
// the phone's zone is shown as the fact it is.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Field, Button, Sheet, Row, ScreenHeader, ErrorPanel, Icon,
  color, space, text,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { supabase, useSession, AUTH_CONFIGURED } from '../../src/session';
import { countryOptions, countryName } from '@loud/lib/countries.js';

/** The phone's own zone, which is the only one the app ever uses. */
function deviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

export default function RegionSettings() {
  const { session, profile, loading } = useSession();
  const userId = session?.user?.id || null;
  const [code, setCode] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (profile && code === null) setCode(profile.country || '');
  }, [profile, code]);

  const all = useMemo(() => countryOptions(), []);
  // Capped: a 249-row list inside a sheet is a wall, and the person
  // already knows which country they are in — they only need to find it.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q).slice(0, 12);
  }, [all, query]);

  const save = useCallback(async (next) => {
    if (!userId || !AUTH_CONFIGURED) return;
    const before = code;
    setCode(next); setSheet(false); setSaving(true); setError(null);
    const { error: err } = await supabase().from('profiles').update({ country: next }).eq('id', userId);
    setSaving(false);
    if (err) {
      setCode(before);           // put it back: nothing was saved
      setError('That did not save, so your country is unchanged. Try again.');
    }
  }, [userId, code]);

  const zone = deviceZone();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Region" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {error ? <ErrorPanel title="That did not save" body={error} /> : null}

          <Row
            icon={<Icon.Pin size={22} color={color.ink} />}
            title="Country"
            subtitle={loading ? 'Reading…' : (code ? countryName(code) : 'Not set')}
            right={(
              <Button kind="quiet" size="small" busy={saving} onPress={() => { setQuery(''); setSheet(true); }} accessibilityLabel="Change country">
                Change
              </Button>
            )}
          />

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>City</Text>
            <NotStored testID="region-no-city">
              There is no city on your account, so there is nothing to set. Your
              country is what we hold.
            </NotStored>
          </Card>

          <Row
            icon={<Icon.Calendar size={22} color={color.ink} />}
            title="Time zone"
            subtitle={zone ? `Now using ${zone}` : 'Using this phone’s own time zone'}
          />

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>Use my location</Text>
            <Text style={text.supporting}>Shows artists and shows near you</Text>
            <NotStored testID="region-no-location">
              The app never asks for your location, and nothing uses it. There
              is no permission here to turn on or off.
            </NotStored>
          </Card>

          <Row
            icon={<Icon.Doc size={22} color={color.ink} />}
            title="Language"
            subtitle="More languages later"
            right={<Text style={text.rowTitle}>English</Text>}
          />

          <Text style={text.supporting}>
            Show times always appear in your own time zone, wherever the artist
            is.
          </Text>
        </View>
      </ScrollView>

      {sheet ? (
        <Sheet onDismiss={() => setSheet(false)} label="Country" style={{ maxHeight: '80%' }}>
          <Text style={text.sectionHeading}>Country</Text>
          <Field
            label="Find a country"
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing"
            autoCorrect={false}
            testID="region-country-search"
          />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
            {matches.map((c) => (
              <Row
                key={c.code}
                title={c.name}
                right={c.code === code ? <Icon.Check size={20} color={color.ink} /> : undefined}
                onPress={() => save(c.code)}
                testID={`country-${c.code}`}
              />
            ))}
            {!matches.length ? (
              <Text style={text.supporting}>No country matches that. Try fewer letters.</Text>
            ) : null}
          </ScrollView>
        </Sheet>
      ) : null}
    </Screen>
  );
}
