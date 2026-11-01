// Book a show, on the phone (Schedule.dc.html; the web twin is
// components/artist/ScheduleScreen.jsx).
//
// Native rather than the website in a frame, because this is one of the
// screens an artist meets before they trust us with a show, and a web page
// inside an app announces itself: the keyboard behaves differently, the
// back gesture does the wrong thing, and the scroll bounces twice.
//
// The rules are the shared ones (lib/schedule.js validateBooking,
// lib/orientation.js), so the phone and the website cannot drift apart on
// what counts as a valid booking.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/api';
import { supabase, useSession } from '../../src/session';
import { styles } from '../../src/theme';
import { color } from '../../src/shared';
import { validateBooking, earliestStart, LENGTH_OPTIONS } from '@loud/lib/schedule.js';
import { ORIENTATION_CHOICES, DEFAULT_ORIENTATION } from '@loud/lib/orientation.js';
import { GENRES } from '@loud/lib/genres.js';
import { explainYouTubeError } from '@loud/lib/youtube/api.js';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** A row of choices that behave like radio buttons, which is what every section here needs. */
function Choices({ options, value, onChange, label }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
      {options.map((o) => {
        const key = typeof o === 'string' ? o : o.key;
        const text = typeof o === 'string' ? o : o.label;
        const on = value === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(key)}
            style={[styles.btn, { height: 40, paddingHorizontal: 14, backgroundColor: on ? color.porcelain : 'rgba(1,22,39,0.07)', borderWidth: on ? 2 : 0, borderColor: color.ink }]}
          >
            <Text style={{ fontWeight: on ? '700' : '400', fontSize: 16 }}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Schedule() {
  const { session, profile, loading, accessToken } = useSession();
  const first = earliestStart();
  const [form, setForm] = useState({
    mode: 'solo', orientation: DEFAULT_ORIENTATION,
    date: localDate(first), time: localTime(first), minutes: 45,
    title: '', genre: '', inviteeUsername: '', description: '', placeId: '',
  });
  const [places, setPlaces] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);
  useEffect(() => {
    if (!accessToken) return;
    // Places are read straight from the table (row-level security scopes them to
    // this artist), the same way the web screen reads them: no route to keep in step.
    supabase().from('places').select('id, name, mic_label').then(({ data }) => {
      const rows = data || [];
      setPlaces(rows);
      if (rows[0]) setForm((f) => ({ ...f, placeId: rows[0].id, genre: f.genre || profile?.genres?.[0] || '' }));
    }, () => setPlaces([]));
  }, [accessToken, profile]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const startAt = form.date && form.time ? new Date(`${form.date}T${form.time}:00`).toISOString() : '';

  async function book() {
    const v = validateBooking({ ...form, startAt });
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setBusy(true);
    const r = await api('/api/artist/shows', { method: 'POST', accessToken, body: { ...form, startAt } });
    setBusy(false);
    if (!r.ok) { setErrors(r.data?.errors || { form: r.data?.error || 'Could not book the show. Try again.' }); return; }
    setResult(r.data);
  }

  if (loading || places === null) return <View style={[styles.screenLight, { padding: 20, paddingTop: 80 }]}><Text style={styles.muted}>Loading…</Text></View>;
  if (profile?.role !== 'artist') {
    return (
      <View style={[styles.screenLight, { padding: 20, paddingTop: 80, gap: 12 }]}>
        <Text style={styles.h1}>Scheduling is for artists</Text>
        <Text style={styles.muted}>Become an artist from your profile first.</Text>
        <Pressable style={[styles.btn, styles.btnGhostLight]} onPress={() => router.replace('/profile')}><Text style={styles.btnText}>Your profile</Text></Pressable>
      </View>
    );
  }

  if (result) {
    const failed = (result.broadcasts || []).filter((b) => b.state === 'failed');
    return (
      <ScrollView style={styles.screenLight} contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 12 }}>
        <Text style={styles.h1}>Booked</Text>
        <View style={[styles.card, { gap: 6 }]}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{result.show.title}</Text>
          <Text style={styles.muted}>
            {new Date(result.show.slated_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}{result.show.duration_minutes} min{' · '}{result.show.performance_mode === 'versus' ? 'Versus' : 'Solo'}
            {' · '}{result.show.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
          </Text>
          {failed.length
            ? <Text style={{ color: color.red }}>{explainYouTubeError(failed[0].last_error)} The show itself is booked.</Text>
            : <Text style={styles.muted}>Your YouTube broadcast is created and waiting.</Text>}
        </View>
        <Pressable style={[styles.btn, styles.btnTeal, { height: 52 }]} onPress={() => router.replace(`/artist/console/${result.show.id}`)}><Text style={styles.btnText}>Open the console</Text></Pressable>
        <Pressable style={[styles.btn, styles.btnGhostLight, { height: 52 }]} onPress={() => router.replace('/profile')}><Text style={styles.btnText}>Back to profile</Text></Pressable>
      </ScrollView>
    );
  }

  const orientation = ORIENTATION_CHOICES.find((o) => o.key === form.orientation);
  return (
    <ScrollView style={styles.screenLight} contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Schedule a show</Text>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Shape</Text>
        <Choices label="Shape" options={ORIENTATION_CHOICES.map((o) => ({ key: o.key, label: `${o.label} ${o.shape}` }))} value={form.orientation} onChange={set('orientation')} />
        <Text style={styles.muted}>{orientation?.note}</Text>
        <Text style={styles.muted}>{orientation?.youtube}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Show type</Text>
        <Choices label="Show type" options={[{ key: 'solo', label: 'Solo' }, { key: 'versus', label: 'Versus' }]} value={form.mode} onChange={set('mode')} />
        {form.mode === 'versus' && (
          <>
            <TextInput value={form.inviteeUsername} onChangeText={set('inviteeUsername')} placeholder="@artist to invite" autoCapitalize="none" style={styles.field} placeholderTextColor="#c9cfd1" />
            {errors.invitee && <Text style={{ color: color.red }}>{errors.invitee}</Text>}
          </>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>When</Text>
        <View style={[styles.row, { gap: 8 }]}>
          <TextInput value={form.date} onChangeText={set('date')} placeholder="YYYY-MM-DD" style={[styles.field, { flex: 1 }]} placeholderTextColor="#c9cfd1" />
          <TextInput value={form.time} onChangeText={set('time')} placeholder="HH:MM" style={[styles.field, { width: 110 }]} placeholderTextColor="#c9cfd1" />
        </View>
        <Text style={styles.muted}>The earliest start is 30 minutes from now.</Text>
        {errors.startAt && <Text style={{ color: color.red }}>{errors.startAt}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Length</Text>
        <Choices label="Length" options={LENGTH_OPTIONS.map((m) => ({ key: m, label: m >= 60 ? `${m / 60} hr${m % 60 ? ` ${m % 60}` : ''}` : `${m} min` }))} value={form.minutes} onChange={set('minutes')} />
        {errors.minutes && <Text style={{ color: color.red }}>{errors.minutes}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Title</Text>
        <TextInput value={form.title} onChangeText={set('title')} placeholder="What should people see?" style={styles.field} placeholderTextColor="#c9cfd1" />
        {errors.title && <Text style={{ color: color.red }}>{errors.title}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Genre</Text>
        <Choices label="Genre" options={GENRES.slice(0, 8).map((g) => ({ key: g, label: g }))} value={form.genre} onChange={set('genre')} />
      </View>

      {places.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>Place</Text>
          <Choices label="Place" options={places.map((p) => ({ key: p.id, label: p.name }))} value={form.placeId} onChange={set('placeId')} />
        </View>
      )}

      {errors.form && <Text style={{ color: color.red }}>{errors.form}</Text>}
      <Pressable style={[styles.btn, styles.btnTeal, { height: 52 }]} disabled={busy} onPress={book} testID="book">
        <Text style={styles.btnText}>{busy ? 'Booking…' : 'Book the show'}</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnGhostLight, { height: 52 }]} onPress={() => router.back()}><Text style={styles.btnText}>Cancel</Text></Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
