// AudioSettings.dc.html — the microphone, the vocal preset, the balance.
//
// This screen used to be four honest notices saying that none of it was
// built. They were true when written and they were the wrong artefact:
// docs/ONE_JOURNEY.md §3 says so plainly. What they were waiting on now
// exists — lib/audio/chain.js holds the chain as data, lib/audio/dsp.js
// derives the coefficients, LoudVocalChain.kt runs the loop on every
// 10ms of microphone audio, and audio_settings stores the artist's own
// seven numbers — so the notices come out and the controls go in.
//
// ── WHAT THIS SCREEN IS ───────────────────────────────────────
// The artist's own vocal chain, tuned here and saved, so a preset set at
// home is the preset that goes to a venue. The same seven numbers drive
// the browser's Web Audio graph, because both read lib/audio/chain.js
// and neither holds a number of its own.
//
// ── WHY STEPPERS AND NOT SLIDERS ──────────────────────────────
// Every control in CONTROLS publishes its own `step` — 0.5 dB of input
// trim, 5 Hz of low cut, 1 dB of threshold. A slider on a phone cannot
// hit those reliably with a thumb, and a dragged slider sends a stream
// of values at a live DSP. Minus and plus hit the published step exactly,
// read out as the number the artist set, and work for someone wearing
// gloves in a cold venue. The filled track still shows where in the
// range the value sits, which is what a slider was for.
//
// A dependency would also have had to be chosen blind here: Expo's
// version service is unreachable from the build box, and taking npm's
// latest major instead of the SDK's pinned one is a mistake already made
// twice this week (docs/DECISIONS.md, expo-document-picker and
// expo-crypto). Core primitives cannot be mispinned.
//
// ── WHAT IS STILL NOT HERE, AND SAYS SO ───────────────────────
// The microphone picker (the capturer reports no audio inputs), the
// live input meter, and the headphone delay check. Each is named where
// it would be, as before — but these are now the only three.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, Row, ScreenHeader, Icon, Button, Toggle, ErrorPanel,
  color, space, text, radius,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import {
  CONTROLS, PRESET, normaliseChain, clampControl, isPreset, controlFor,
} from '@loud/lib/audio/chain.js';
import { applyVocalChain } from '../../src/vocalChain';

/** The controls grouped the way the board groups them, by what they do to a voice. */
const GROUPS = [
  { title: 'Input', note: 'How hot the microphone runs before anything touches it.', of: ['inputDb'] },
  { title: 'Clean-up', note: 'Cuts handling rumble and stage thump without thinning your voice.', of: ['highpass'] },
  { title: 'Compression', note: 'Holds your loudest and quietest words closer together, so a phrase sung softly still carries.', of: ['threshold', 'ratio', 'gainDb'] },
  { title: 'Space', note: 'A little room around the voice. Subtle: a phone microphone sounds dry, not like a hall.', of: ['reverbMix'] },
  { title: 'Output', note: 'The level that leaves for the broadcast.', of: ['outputDb'] },
];

/** The value as the artist should read it, in the unit the control publishes. */
function readOut(key, value) {
  const c = controlFor(key);
  if (!c) return String(value);
  if (key === 'reverbMix') return `${Math.round(value * 100)}%`;
  const n = c.step < 1 ? value.toFixed(1) : String(Math.round(value));
  return c.unit ? `${n}${c.unit.startsWith(':') ? '' : ' '}${c.unit}` : n;
}

export default function AudioSettings() {
  const { accessToken, loading } = useSession();
  const [settings, setSettings] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    const r = await api('/api/artist/audio', { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setSettings(normaliseChain(r.data?.settings));
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  // Every change reaches the capturer as well as the row. The chain is
  // configured even when effects are off, because bypass is a crossfade
  // rather than a disconnect (lib/audio/chain.js rule 1): both paths are
  // computed and one gain is zero, so turning effects on mid-song does
  // not click.
  useEffect(() => {
    if (!settings) return;
    applyVocalChain(settings).catch(() => { /* the chain reports its own failure; it never stops a show */ });
  }, [settings]);

  const save = useCallback(async (change) => {
    const before = settings;
    if (!before) return;
    const next = normaliseChain(change(before));
    setSettings(next);
    setSaveError(null);
    const r = await api('/api/artist/audio', { method: 'PUT', accessToken, body: { settings: next } });
    if (!r.ok) {
      setSettings(before);                       // put it back: nothing was saved
      setSaveError('That did not save, so it has gone back to what it was. Try again.');
      return;
    }
    setSettings(normaliseChain(r.data?.settings));
  }, [settings, accessToken]);

  const step = useCallback((key, direction) => {
    const c = controlFor(key);
    if (!c) return;
    save((s) => ({ ...s, [key]: clampControl(key, Number((s[key] + direction * c.step).toFixed(4))) }));
  }, [save]);

  if (loading || (settings === null && !failed)) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
          <ScreenHeader title="Audio" onBack={() => router.push('/settings')} />
        </ScrollView>
      </Screen>
    );
  }

  if (failed) {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 52, gap: space.l }}>
          <ScreenHeader title="Audio" onBack={() => router.push('/settings')} />
          <ErrorPanel
            title="We could not read your audio settings"
            body="Your saved preset is safe. This is the reading of it that failed."
            onRetry={load}
            testID="audio-load-failed"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Audio" onBack={() => router.push('/settings')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {saveError ? (
            <ErrorPanel title="Not saved" body={saveError} onRetry={undefined} testID="audio-save-failed" />
          ) : null}

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Your vocal chain</Text>
            <Text style={text.supporting}>
              Set here and saved, so the preset you tune at home is the one that
              goes to the venue. The same settings run in your browser.
            </Text>
            <Toggle
              value={settings.effectsOn}
              onValueChange={(v) => save((s) => ({ ...s, effectsOn: v }))}
              label={settings.effectsOn ? 'Effects on' : 'Effects off — your voice goes out as the microphone hears it'}
            />
            <Text style={text.supporting}>
              {isPreset(settings) ? 'Using the tested preset.' : 'Tuned by you.'}
            </Text>
            {!isPreset(settings) ? (
              <Button kind="quiet" onPress={() => save((s) => ({ ...s, ...PRESET }))} testID="audio-reset">
                Back to the preset
              </Button>
            ) : null}
          </Card>

          {GROUPS.map((g) => (
            <Card key={g.title} style={{ gap: space.m }}>
              <Text style={text.sectionHeading}>{g.title}</Text>
              <Text style={text.supporting}>{g.note}</Text>
              {g.of.map((key) => {
                const c = CONTROLS.find((x) => x.key === key);
                const value = settings[key];
                const at = Math.max(0, Math.min(1, (value - c.min) / (c.max - c.min)));
                return (
                  <View key={key} style={{ gap: 6 }} testID={`audio-control-${key}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                      <Text style={[text.rowTitle, { flex: 1 }]}>{c.label}</Text>
                      <StepButton
                        label={`Less ${c.label.toLowerCase()}`}
                        glyph="−"
                        disabled={value <= c.min}
                        onPress={() => step(key, -1)}
                        testID={`audio-${key}-down`}
                      />
                      <Text
                        style={[text.rowTitle, { minWidth: 72, textAlign: 'center' }]}
                        accessibilityLabel={`${c.label} ${readOut(key, value)}`}
                      >
                        {readOut(key, value)}
                      </Text>
                      <StepButton
                        label={`More ${c.label.toLowerCase()}`}
                        glyph="+"
                        disabled={value >= c.max}
                        onPress={() => step(key, 1)}
                        testID={`audio-${key}-up`}
                      />
                    </View>
                    {/* Where the value sits in its own range: what the
                        slider was for, without the drag. */}
                    <View
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={{ height: 6, borderRadius: radius.pill, backgroundColor: 'rgba(1,22,39,0.12)', overflow: 'hidden' }}
                    >
                      <View style={{ width: `${at * 100}%`, height: '100%', backgroundColor: color.teal }} />
                    </View>
                  </View>
                );
              })}
            </Card>
          ))}

          <Card style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Microphone</Text>
            <NotStored>
              The camera module does not report this phone&apos;s audio inputs, so
              there is no list to choose from. Your show uses whichever
              microphone the phone is using when it starts.
            </NotStored>
            <Row
              icon={<Icon.Mic size={22} color={color.ink} />}
              title="Mic health"
              subtitle="Checked on the raw input at kit check, not here."
            />
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>Backing track balance</Text>
            <Text style={text.supporting}>More track, or more voice.</Text>
            <NotStored>
              The balance between your voice and the backing track is set on the
              console during the show. It cannot be set ahead of time yet.
            </NotStored>
          </Card>

          <Card style={{ gap: space.s }}>
            <Text style={text.rowTitle}>Headphone delay check</Text>
            <Text style={text.supporting}>For Bluetooth earphones. Wired is best for singing.</Text>
            <NotStored>
              There is no delay check in this build. The advice above still
              holds: wire your earphones in if you are singing to a track.
            </NotStored>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** One step of a control. 44px, as every touch target on this build is. */
function StepButton({ label, glyph, onPress, disabled, testID }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(1,22,39,0.06)',
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 24, color: color.ink }}>{glyph}</Text>
    </Pressable>
  );
}
