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
// The microphone picker: the capturer reports no audio inputs, so there
// is no list to choose from, and the screen says that where the list
// would be. It is the only one left.
//
// The live input meter and the headphone delay check are both here now,
// and as of 8 November they work without a broadcast: they used to read
// the vocal chain, which is LiveKit's capture post-processor and sees
// frames only while a show is publishing, so on this screen the bar
// never moved and the delay check refused with "the audio chain is not
// running yet". native/.../LoudInputMeter.kt opens the microphone for
// this screen instead, and MicOwner.kt is the rule that keeps the two
// capture paths off each other — the broadcast always wins.
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
import { useAudioMeter } from '../../src/audioMeter';
import { runSyncCalibration, cancelSyncCalibration } from '../../src/syncCalibration';

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
  // Live, while this screen is in front. The chain measures the input
  // whether or not effects are on, which is the state an artist checking
  // their microphone is usually in.
  const meter = useAudioMeter(settings !== null);
  // The headphone delay check. `rep` counts the clicks as they play,
  // which is the only thing that tells an artist it is listening.
  const [sync, setSync] = useState({ phase: 'idle', rep: 0, of: 0, described: null, error: null });

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

  const startSync = useCallback(async () => {
    setSync({ phase: 'running', rep: 0, of: 0, described: null, error: null });
    const r = await runSyncCalibration({
      onRep: (rep, of) => setSync((s2) => (s2.phase === 'running' ? { ...s2, rep: rep + 1, of } : s2)),
    });
    if (!r.ok) { setSync({ phase: 'idle', rep: 0, of: 0, described: null, error: r.error }); return; }
    setSync({ phase: 'done', rep: 0, of: 0, described: r.described, error: null, result: r.result });
  }, []);

  const stopSync = useCallback(async () => {
    await cancelSyncCalibration();
    setSync({ phase: 'idle', rep: 0, of: 0, described: null, error: null });
  }, []);

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

            {/* The signal indicator. Measured on the raw input inside
                the chain, so it is the microphone's own level and not
                anything the settings above have done to it. */}
            <View style={{ gap: 6 }} testID="audio-meter">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Text style={[text.rowTitle, { flex: 1 }]}>Input level</Text>
                <Text
                  style={[text.supporting, { fontSize: 15 }]}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={meter.level.line}
                >
                  {meter.level.line}
                </Text>
              </View>
              <Meter level={meter.level} />
              {meter.level.action ? (
                <Text style={[text.supporting, { fontSize: 15 }]}>{meter.level.action}.</Text>
              ) : null}
              {/* This used to say the meter reads the microphone "once a
                  show or a kit check has started the camera" — true of
                  the build and useless to an artist standing here with
                  no show running, which is everyone who opens this
                  screen. The microphone is now opened for this screen
                  (native/.../LoudInputMeter.kt). So the only thing left
                  to say is when it could not be, and what to do. */}
              {meter.blocked ? (
                <Text style={[text.supporting, { fontSize: 15 }]} testID="audio-meter-blocked">
                  {meter.blocked.action ? `${meter.blocked.line} ${meter.blocked.action}.` : meter.blocked.line}
                </Text>
              ) : null}
            </View>

            {/* What the compressor is actually doing, which is the only
                honest way to show that it works: a threshold and a ratio
                tell an artist nothing about their own voice. */}
            {settings.effectsOn ? (
              <View style={{ gap: 6 }} testID="audio-reduction">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                  <Text style={[text.rowTitle, { flex: 1 }]}>Compression</Text>
                  <Text style={[text.supporting, { fontSize: 15 }]}>
                    {/* The compressor only runs in the broadcast path,
                        so outside a show there is nothing to report and
                        a bar at zero would read as a measurement that
                        found nothing. */}
                    {meter.source === 'broadcast' ? meter.reduction.line : 'Shows here while you are live.'}
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: 'rgba(1,22,39,0.12)', overflow: 'hidden' }}>
                  <View style={{ width: `${(meter.source === 'broadcast' ? meter.reduction.fraction : 0) * 100}%`, height: '100%', backgroundColor: color.orange }} />
                </View>
              </View>
            ) : null}

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
            <Text style={text.supporting}>
              Put your earphones in, then answer each click out loud — &ldquo;bah&rdquo; —
              right on the beat. It measures the whole round trip: the click
              reaching your ears and your voice coming back.
            </Text>

            {sync.phase === 'running' ? (
              <View style={{ gap: space.s }} testID="sync-running">
                <Text style={text.rowTitle}>
                  Answer each click{sync.of ? ` — ${sync.rep} of ${sync.of}` : ''}
                </Text>
                <Button kind="quiet" onPress={stopSync} testID="sync-stop">Stop</Button>
              </View>
            ) : (
              <View style={{ gap: space.s }} testID="sync-idle">
                {sync.described ? (
                  <>
                    <Text style={text.rowTitle}>{sync.described.line}</Text>
                    {sync.described.action ? (
                      <Text style={text.supporting}>{sync.described.action}.</Text>
                    ) : null}
                    {/* The floor the measurement cannot beat, said plainly,
                        so nobody re-runs it expecting perfection. */}
                    {sync.described.note ? (
                      <Text style={text.supporting}>{sync.described.note}</Text>
                    ) : null}
                  </>
                ) : null}
                {sync.error ? (
                  <Text style={text.supporting}>
                    The check could not start: {sync.error}. It needs the camera
                    running, so try it from kit check.
                  </Text>
                ) : null}
                <Button kind="quiet" onPress={startSync} testID="sync-start">
                  {sync.described ? 'Check again' : 'Start the check'}
                </Button>
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The level bar: filled to the average, with a notch at the peak.
 *
 * Two marks rather than one because they answer different questions. The
 * bar follows the average, which is readable; the notch is the loudest
 * recent frame, which is what actually clips. A bar that jumped to every
 * peak would be unreadable, and an average alone hides the one syllable
 * that distorts.
 *
 * Colour comes from the verdict, so the bar and the words cannot
 * disagree.
 */
function Meter({ level }) {
  const fill = level.band === 'clipping' || level.band === 'hot' ? color.red
    : level.band === 'good' ? color.teal
    : color.orange;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 10, borderRadius: radius.pill, backgroundColor: 'rgba(1,22,39,0.12)', overflow: 'hidden' }}
    >
      <View style={{ width: `${level.fraction * 100}%`, height: '100%', backgroundColor: fill }} />
      {level.peakFraction > 0 ? (
        <View style={{ position: 'absolute', left: `${Math.min(99, level.peakFraction * 100)}%`, top: 0, bottom: 0, width: 2, backgroundColor: color.ink }} />
      ) : null}
    </View>
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
