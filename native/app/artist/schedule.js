// Schedule.dc.html — book a show, on the phone.
//
// Native rather than the website in a frame, because this is one of the
// screens an artist meets before they trust us with a show, and a web page
// inside an app announces itself: the keyboard behaves differently, the
// back gesture does the wrong thing, and the scroll bounces twice.
//
// The rules are the shared ones (lib/schedule.js validateBooking,
// lib/orientation.js), so the phone and the website cannot drift apart on
// what counts as a valid booking. The web twin is
// components/artist/ScheduleScreen.jsx.
//
// Two things on the board that are not here, and why:
//
//   The Studio library rows (Backing tracks, Cue sheet, B-roll) each end
//   in "Add", and there is no screen on the phone to add any of them. A
//   row whose only action goes nowhere is worse than a section the artist
//   meets later, in the console, where those things are actually used.
//
//   The allowance card is written in placeholders — "Uses 1 of your [n]
//   show slots", "[n] viewer-hours left" — and nothing computes either
//   number: lib/site/pricing.js still has the free tier unset and no route
//   counts a month's usage. Printing a guess next to a booking is the one
//   thing worse than leaving it out.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Chip, Field, ErrorPanel, Empty, Skeleton, Icon,
  color, space, radius, surface, text, face, size,
} from '../../src/ui';
import { api } from '../../src/api';
import { supabase, useSession } from '../../src/session';
import { validateBooking, earliestStart, LENGTH_OPTIONS } from '@loud/lib/schedule.js';
import { ORIENTATION_CHOICES, DEFAULT_ORIENTATION } from '@loud/lib/orientation.js';
import { GENRES } from '@loud/lib/genres.js';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The board's own words for each length: "1 hour" and "1 hr 30", not "60 min". */
const lengthLabel = (m) => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60}` : ''}`);

/** The board's uppercase section rule, which is a step the type scale has: `label`. */
function Group({ title, children, style }) {
  return (
    <View style={[{ gap: space.sm }, style]}>
      <Text style={[text.label, { fontSize: 15 }]}>{title}</Text>
      {children}
    </View>
  );
}

/** Two pills in one track: the board draws Solo and Versus this way. */
function Segmented({ options, value, onChange, label }) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', backgroundColor: surface.quiet, borderRadius: 999, padding: 4, gap: 4 }}
    >
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.porcelain : 'transparent', borderWidth: on ? 2 : 0, borderColor: color.ink }}
          >
            <Text style={{ fontFamily: on ? face.bold : face.regular, fontSize: 17, fontWeight: on ? '700' : '400', color: color.ink }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A wrapped row of chips that behave as radio buttons. */
function Choices({ options, value, onChange, label }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => (
        <Chip key={String(o.key)} selected={value === o.key} onPress={() => onChange(o.key)}>{o.label}</Chip>
      ))}
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
  const [custom, setCustom] = useState(false);
  const [pickGenre, setPickGenre] = useState(false);
  const [pickPlace, setPickPlace] = useState(false);

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

  if (loading || places === null) return <ScheduleSkeleton />;

  if (profile?.role !== 'artist') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 72 }}>
          <Empty
            icon={<Icon.Mic size={24} color={color.ink} />}
            title="Scheduling is for artists"
            body="Become an artist from your profile first."
            actionLabel="Your profile"
            onAction={() => router.replace('/profile')}
            testID="schedule-not-artist"
          />
        </View>
      </Screen>
    );
  }

  if (result) return <Booked result={result} />;

  const orientation = ORIENTATION_CHOICES.find((o) => o.key === form.orientation);
  const place = places.find((p) => p.id === form.placeId) || null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 56, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <BackButton />
          <Text style={[text.screenTitle, { flex: 1, fontSize: 28 }]}>Schedule a show</Text>
        </View>

        <Group title="Show type">
          <Segmented
            label="Show type"
            options={[{ key: 'solo', label: 'Solo' }, { key: 'versus', label: 'Versus' }]}
            value={form.mode}
            onChange={set('mode')}
          />
          {form.mode === 'versus' ? (
            <Field
              label="Artist to invite"
              value={form.inviteeUsername}
              onChangeText={set('inviteeUsername')}
              placeholder="@artist to invite"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.invitee}
              testID="invitee"
            />
          ) : null}
        </Group>

        {/* Not on the board, and it cannot go: the shape decides the
            composed frame, the player's box, what a camera phone is told to
            do and what a clip is cut from (lib/orientation.js). An artist
            who is not asked gets portrait by default and finds out on a
            television. */}
        <Group title="Shape">
          <Choices
            label="Shape"
            options={ORIENTATION_CHOICES.map((o) => ({ key: o.key, label: `${o.label} ${o.shape}` }))}
            value={form.orientation}
            onChange={set('orientation')}
          />
          <Text style={text.supporting}>{orientation?.note}</Text>
          <Text style={text.supporting}>{orientation?.youtube}</Text>
        </Group>

        <Group title="When">
          {/* The board opens a date picker and a time picker from two 64px
              buttons. There is no picker in this app's dependencies, so the
              two values are typed, in the kit's labelled field. */}
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Field style={{ flex: 1 }} label="Date" value={form.date} onChangeText={set('date')} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" testID="date" />
            <Field style={{ width: 120 }} label="Start time" value={form.time} onChangeText={set('time')} placeholder="HH:MM" keyboardType="numbers-and-punctuation" testID="time" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon.Calendar size={20} color={color.ink} />
            <Text style={[text.supporting, { flex: 1, color: 'rgba(1,22,39,0.8)' }]}>The earliest start is 30 minutes from now.</Text>
          </View>
          {errors.startAt ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>{errors.startAt}</Text> : null}
        </Group>

        <Group title="Length">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Length">
            {LENGTH_OPTIONS.map((m) => (
              <Chip key={m} selected={!custom && form.minutes === m} onPress={() => { setCustom(false); set('minutes')(m); }}>{lengthLabel(m)}</Chip>
            ))}
            <Chip selected={custom} onPress={() => setCustom(true)}>Custom</Chip>
          </View>
          {custom ? (
            <Field
              label="Minutes"
              value={String(form.minutes)}
              onChangeText={(v) => set('minutes')(Number(String(v).replace(/[^0-9]/g, '')) || 0)}
              placeholder="15 to 180"
              keyboardType="number-pad"
              hint="Between 15 minutes and 3 hours."
              error={errors.minutes}
              testID="minutes"
            />
          ) : null}
          {!custom && errors.minutes ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>{errors.minutes}</Text> : null}
        </Group>

        <Group title="Details">
          <Field label="Show title" value={form.title} onChangeText={set('title')} placeholder="Give your show a name" error={errors.title} testID="title" />

          <View style={{ gap: 6 }}>
            <Text style={[text.supporting, { fontWeight: '700', color: color.ink }]}>Genre</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Genre, ${form.genre || 'none chosen'}`}
              accessibilityState={{ expanded: pickGenre }}
              onPress={() => setPickGenre((p) => !p)}
              style={({ pressed }) => ({ height: 48, paddingHorizontal: 14, borderRadius: radius.field, backgroundColor: surface.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={text.body}>{form.genre || 'Choose a genre'}</Text>
              <Icon.Chevron size={20} color={color.ink} />
            </Pressable>
            {pickGenre ? (
              <Choices label="Genre" options={GENRES.map((g) => ({ key: g, label: g }))} value={form.genre} onChange={(g) => { set('genre')(g); setPickGenre(false); }} />
            ) : null}
          </View>

          {/* The board's cover slot, and it is flat on purpose. A cover is a
              file, and the phone has no image picker in its dependencies and
              there is no route to upload one to (lib/schedule.js carries
              coverUrl, nothing fills it). A button that opens nothing is a
              worse answer than a slot that says what it is waiting for. */}
          <View style={{ height: 120, borderRadius: radius.card, backgroundColor: surface.card, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.l }}>
            <Icon.Camera size={24} color={color.ink} />
            <Text style={[text.rowTitle, { fontSize: 17 }]}>Add a cover image</Text>
            <Text style={[text.supporting, { textAlign: 'center' }]}>Not on the phone yet. Your show keeps the Loudentify cover until you add one on the website.</Text>
          </View>
        </Group>

        <Group title="Place">
          {place ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Place, ${place.name}`}
                accessibilityState={{ expanded: pickPlace }}
                disabled={places.length < 2}
                onPress={() => setPickPlace((p) => !p)}
                style={({ pressed }) => ({ minHeight: 68, paddingHorizontal: 14, paddingVertical: space.s, borderRadius: radius.card, backgroundColor: surface.card, flexDirection: 'row', alignItems: 'center', gap: space.m, opacity: pressed ? 0.85 : 1 })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: surface.quiet, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon.Pin size={22} color={color.ink} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[text.rowTitle, { fontSize: 18 }]} numberOfLines={1}>{place.name}</Text>
                  <Text style={text.supporting}>Loads its mic, preset and cameras</Text>
                </View>
                {places.length > 1 ? <Icon.Chevron size={20} color={color.ink} /> : null}
              </Pressable>
              {pickPlace && places.length > 1 ? (
                <Choices label="Place" options={places.map((p) => ({ key: p.id, label: p.name }))} value={form.placeId} onChange={(v) => { set('placeId')(v); setPickPlace(false); }} />
              ) : null}
            </>
          ) : (
            <Empty
              icon={<Icon.Pin size={24} color={color.ink} />}
              title="No saved places yet"
              body="A place remembers its mic, its preset and its cameras. You can book without one."
              testID="schedule-no-places"
            />
          )}
        </Group>

        {errors.form ? <ErrorPanel title="We could not book that show" body={errors.form} onRetry={book} testID="schedule-failed" /> : null}

        <View style={{ gap: space.m }}>
          <Button kind="main" busy={busy} onPress={book} testID="book">Book show</Button>
          <Button kind="quiet" onPress={() => router.back()}>Cancel</Button>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Booked. The YouTube line stays as it was written: the show is booked
 * either way, and an artist whose broadcast could not be made needs to
 * know it is the channel and not the booking, with the provider's own
 * words rather than a shrug.
 */
function Booked({ result }) {
  const failed = (result.broadcasts || []).filter((b) => b.state === 'failed');
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 52, paddingBottom: 56, gap: space.l }}>
        <Text style={[text.screenTitle, { fontSize: 28 }]}>Booked</Text>
        <Card style={{ gap: 6 }}>
          <Text style={[text.rowTitle, { fontSize: 18 }]}>{result.show.title}</Text>
          <Text style={text.supporting}>
            {new Date(result.show.slated_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}{result.show.duration_minutes} min{' · '}{result.show.performance_mode === 'versus' ? 'Versus' : 'Solo'}
            {' · '}{result.show.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
          </Text>
          {failed.length
            ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>The YouTube broadcast could not be created yet ({failed[0].last_error}). The show is booked; connect your channel and it will be created when you go live.</Text>
            : <Text style={text.supporting}>Your YouTube broadcast is created and waiting.</Text>}
        </Card>
        <Button kind="main" onPress={() => router.replace(`/artist/console/${result.show.id}`)}>Open the console</Button>
        <Button kind="quiet" onPress={() => router.replace('/profile')}>Back to profile</Button>
      </ScrollView>
    </Screen>
  );
}

const BackButton = () => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel="Back"
    onPress={() => router.back()}
    style={({ pressed }) => ({ width: size.touch, height: size.touch, borderRadius: size.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.quiet, opacity: pressed ? 0.85 : 1 })}
  >
    <Icon.Back size={22} color={color.ink} />
  </Pressable>
);

function ScheduleSkeleton() {
  return (
    <Screen>
      <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.xl }}>
        <Skeleton width={220} height={28} />
        <Skeleton width="100%" height={48} radius={24} />
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Skeleton width="60%" height={48} radius={12} />
          <Skeleton width={110} height={48} radius={12} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[70, 70, 70, 80].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
        </View>
        <Skeleton width="100%" height={48} radius={12} />
        <Skeleton width="100%" height={120} radius={16} />
        <Skeleton width="100%" height={68} radius={16} />
        <Skeleton width="100%" height={52} radius={26} />
      </View>
    </Screen>
  );
}
