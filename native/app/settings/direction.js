// DirectionSettings.dc.html — what the artist lets the director do.
//
// The one settings screen that is wired end to end: GET and PUT
// /api/artist/direction, with the vocabulary coming from
// lib/direction.js so the phone, the website and the director itself
// read the same list of moves rather than three copies of it.
//
// Saving is per change, not behind a Save button, because the board has
// no Save button. A tap answers immediately and the write follows; if
// the write fails the control goes back to what it was and the error
// says so, which is the only honest way to run an optimistic toggle.
//
// PUT REPLACES the whole settings object, so every save sends the
// settings we loaded with the one field changed. Transitions and the
// look are not on this board (they were added on 23 Oct and live on the
// console) — they ride along untouched for exactly that reason.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Button, Chip, Toggle, Row, Section, ScreenHeader, ErrorPanel, Skeleton, Icon,
  color, space, text, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { TECHNIQUES, PACES, normaliseDirection } from '@loud/lib/direction.js';

const PACE_LABEL = { calm: 'Calm', balanced: 'Balanced', lively: 'Lively' };

export default function DirectionSettings() {
  const { accessToken, loading } = useSession();
  const [settings, setSettings] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const phase = useLoadingPhase(settings === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    const r = await api('/api/artist/direction', { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setSettings(normaliseDirection(r.data?.settings));
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  /**
   * One change, applied to the screen and then written. `change` is
   * handed the current settings and returns the whole next object, so a
   * nested field (a technique, an operator permission) is expressed in
   * one place instead of spread across the callers.
   */
  const save = useCallback(async (change) => {
    const before = settings;
    if (!before) return;
    const next = normaliseDirection(change(before));
    setSettings(next);
    setSaveError(null);
    const r = await api('/api/artist/direction', { method: 'PUT', accessToken, body: { settings: next } });
    if (!r.ok) {
      setSettings(before);                       // put it back: nothing was saved
      setSaveError('That did not save, so it has gone back to what it was. Try again.');
      return;
    }
    // The route normalises too, and its answer is the record of what is
    // stored — taking it back stops the screen and the row disagreeing.
    setSettings(normaliseDirection(r.data?.settings));
  }, [settings, accessToken]);

  if (phase === 'loading') return <DirectionSkeleton />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Direction" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {failed || (!settings && phase === 'slow') ? (
            <ErrorPanel
              title="We could not load your direction settings"
              body="It may be the connection. Try again."
              onRetry={load}
              backLabel="Back to Settings"
              onBack={() => router.push('/settings')}
            />
          ) : null}

          {saveError ? <ErrorPanel title="That did not save" body={saveError} onRetry={load} /> : null}

          {settings ? (
            <>
              <Row
                icon={<Icon.Sparkle size={22} color={color.ink} />}
                title="Auto director"
                subtitle="Cuts between your cameras for you"
                right={(
                  <Toggle
                    label="Auto director"
                    value={settings.autoDirector}
                    onValueChange={(v) => save((s) => ({ ...s, autoDirector: v }))}
                  />
                )}
              />

              <Card style={{ gap: space.sm }}>
                <Text style={text.rowTitle}>Pace of cuts</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Pace of cuts" style={{ flexDirection: 'row', gap: space.xs }}>
                  {PACES.map((p) => (
                    <Chip
                      key={p}
                      selected={settings.pace === p}
                      onPress={() => save((s) => ({ ...s, pace: p }))}
                      style={{ flex: 1 }}
                      testID={`pace-${p}`}
                    >
                      {PACE_LABEL[p]}
                    </Chip>
                  ))}
                </View>
              </Card>

              <Row
                icon={<Icon.Wrench size={22} color={color.ink} />}
                title="Show manual cuts"
                subtitle="Open the cut panel when a show starts"
                right={(
                  <Toggle
                    label="Show manual cuts"
                    value={settings.showManualCuts}
                    onValueChange={(v) => save((s) => ({ ...s, showManualCuts: v }))}
                  />
                )}
              />

              {/* The board's "Default cue sheet" row links to the studio
                  library and shows a sheet name. There is no default-cue-sheet
                  field in direction_settings, so this goes to the library it
                  points at and says plainly that no sheet is set by default. */}
              <Row
                icon={<Icon.Note size={22} color={color.ink} />}
                title="Default cue sheet"
                subtitle="Not set. Cue sheets are chosen per track in the studio library."
                onPress={() => router.push('/settings/studio')}
              />

              <Section title="Moves the director can use">
                <Text style={[text.supporting, { marginTop: -space.xs }]}>
                  Turn off anything that does not suit your act. The director only uses what is on here.
                </Text>
                {/* Straight from lib/direction.js, including Bop, which the
                    board does not draw. It is a real stored technique and
                    the director obeys it, so leaving it off this screen
                    would make it unreachable. */}
                {TECHNIQUES.map((t) => (
                  <Row
                    key={t.key}
                    title={t.label}
                    subtitle={t.hint}
                    right={(
                      <Toggle
                        label={t.label}
                        value={settings.techniques[t.key]}
                        onValueChange={(v) => save((s) => ({ ...s, techniques: { ...s.techniques, [t.key]: v } }))}
                      />
                    )}
                  />
                ))}
              </Section>

              <Card style={{ gap: space.sm }}>
                <Text style={text.rowTitle}>Versus: who picks the featured artist</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Versus: who picks the featured artist" style={{ flexDirection: 'row', gap: space.xs }}>
                  <Chip
                    selected={settings.versusPicker === 'artist_a'}
                    onPress={() => save((s) => ({ ...s, versusPicker: 'artist_a' }))}
                    style={{ flex: 1 }}
                    testID="versus-artist-a"
                  >
                    Artist A switches
                  </Chip>
                  {/* The board greys this one and labels it "(later)". The
                      column would accept it; automatic switching does not
                      exist, so choosing it would store a promise. Drawn
                      disabled instead of selectable. */}
                  <Button kind="quiet" size="chip" disabled style={{ flex: 1 }}>Automatic (later)</Button>
                </View>
              </Card>

              <Section title="What an operator can do">
                <Text style={[text.supporting, { marginTop: -space.xs }]}>
                  For a second person running your show from a laptop
                </Text>
                <Row
                  icon={<Icon.Camera size={22} color={color.ink} />}
                  title="Cut cameras"
                  right={(
                    <Toggle
                      label="Operator can cut cameras"
                      value={settings.operator.cut}
                      onValueChange={(v) => save((s) => ({ ...s, operator: { ...s.operator, cut: v } }))}
                    />
                  )}
                />
                <Row
                  icon={<Icon.Chat size={22} color={color.ink} />}
                  title="Push prompts and votes"
                  right={(
                    <Toggle
                      label="Operator can push prompts and votes"
                      value={settings.operator.prompts}
                      onValueChange={(v) => save((s) => ({ ...s, operator: { ...s.operator, prompts: v } }))}
                    />
                  )}
                />
                <Row
                  icon={<Icon.Stop size={22} color={color.ink} />}
                  title="End the show"
                  right={(
                    <Toggle
                      label="Operator can end the show"
                      value={settings.operator.end}
                      onValueChange={(v) => save((s) => ({ ...s, operator: { ...s.operator, end: v } }))}
                    />
                  )}
                />
              </Section>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function DirectionSkeleton() {
  return (
    <Screen>
      <View style={{ paddingTop: 52, paddingHorizontal: space.screenEdge, gap: space.l }}>
        <Skeleton width={44} height={44} radius={22} />
        <Skeleton width={160} height={34} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={88} radius={16} />
        <Skeleton width={240} height={21} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={64} radius={16} />
        <Skeleton width="100%" height={64} radius={16} />
      </View>
    </Screen>
  );
}
