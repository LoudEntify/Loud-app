'use client';

import { useEffect, useRef, useState } from 'react';
import Knob from './Knob';
import LevelMeterFader from './LevelMeterFader';
import BackingTrackPanel from './BackingTrackPanel';
import CalibrateSyncPanel from './CalibrateSyncPanel';
import CueEditorPanel from './CueEditorPanel';
import {
  tuneHighpass, tuneCompressor, tuneMakeupGainDb, tuneReverbMix,
  tuneInputGainDb, tuneOutputGainDb, tuneMonitorEnabled, tuneEffectsBypass,
} from '../lib/audioProcessing';
import { logHealthEvent } from '../lib/healthLog';
import { getAudioHost, subscribeAudioHost } from '../lib/audioHost';

const AUTO_DISABLED_NOTICE_MS = 4_000; // how long "Monitoring off -- you're live" stays visible

// The tested-good starting point every performer goes live with. Manual
// mix is off by default -- these values are already applied by
// createPilotAudioTrack()'s own defaults, this object just mirrors them so
// the knobs display correctly and so re-enabling "preset" can restore them.
const PRESET = {
  inputDb: 0,
  highpass: 80,
  threshold: -24,
  ratio: 3,
  gainDb: 4,
  reverbMix: 0.12,
  outputDb: 0,
};

export default function AudioDeckPanel({
  nodes,
  audioContext,
  showEnded,
  showPhase,
  onBackingPlayerChange,
  // Cue-Sheet Director (CD-3) -- artistEmail is LiveDemo's own entry-gate
  // email (the closest thing to a stable performer identity this
  // codebase has, see docs/cue_sheets_migration_v2.sql). onCueSheetChange
  // fires whenever the currently-relevant SAVED sheet changes (on track
  // load and after a successful save) so LiveDemo can gate Cue mode and
  // feed cueDirector -- never for in-progress unsaved edits.
  artistEmail,
  // Accounts & Identity Day 2 -- app/api/cue-sheets/route.js now requires a
  // verified artist session (same verifyArtistAuth check claim-slot already
  // uses); this is LiveDemo's artistSession.access_token, threaded down the
  // same path as artistEmail.
  artistAccessToken,
  onCueSheetChange,
  // TASK 1's row. Passed down to BackingTrackPanel for the resume offer,
  // and read here for one thing only: when the row already names a bound
  // sheet for the track being adopted, that binding wins over this
  // panel's "most recently updated sheet for this track" default. Without
  // that, adopting a track on arrival would quietly rebind the row to a
  // different sheet than the artist chose.
  sessionState = null,
}) {
  const [manualMix, setManualMix] = useState(false);
  const [values, setValues] = useState(PRESET);
  // Matches createPilotAudioTrack's own default (bypassGain 1 / processedGain
  // 0) -- a pilot-only safety valve since the preset can't be tuned before
  // pilot, not a verdict that processing is wrong in concept. Available in
  // both soundcheck and live -- see toggleEffects.
  const [effectsOn, setEffectsOn] = useState(false);
  const [monitorOn, setMonitorOn] = useState(false);
  const [autoDisabledNotice, setAutoDisabledNotice] = useState(false);
  const noticeTimerRef = useRef(null);
  // Session-scoped only -- resets on remount, never persisted, never
  // inherited across artists/devices/shows. trackGain/delayNode are
  // recreated per backing-track load, so backingPlayerRef lets a fresh
  // load re-apply whatever's currently calibrated.
  const [syncDelayMs, setSyncDelayMs] = useState(0);
  const backingPlayerRef = useRef(null);

  // Cue-Sheet Director (CD-3) -- cue editing state. Owned here (not in
  // CueEditorPanel) because BackingTrackPanel (markers) and
  // CueEditorPanel (the editor) are siblings that both need the same
  // cues array. trackHash/loadedTrackHash are tracked separately so a
  // fast track swap can't let a slow, stale GET response overwrite a
  // newer one (guarded in loadCueSheet below).
  const [trackHash, setTrackHash] = useState(null);
  const [cues, setCues] = useState([]);
  const [activeCueId, setActiveCueId] = useState(null);
  const [fallbackBehaviour, setFallbackBehaviour] = useState('hold_last');
  // Product Ruling 2 -- named sheets. `cueSheets` is every sheet this
  // artist has for the LOADED TRACK; `sheetName` is which one the editor
  // is currently working on, and is what the save is keyed to.
  const [cueSheets, setCueSheets] = useState([]);
  const [sheetName, setSheetName] = useState('Default');
  const [cueSheetDirty, setCueSheetDirty] = useState(false);
  const [cueSheetSaving, setCueSheetSaving] = useState(false);
  const [cueSheetSaveError, setCueSheetSaveError] = useState(null);
  const loadedTrackHashRef = useRef(null); // most-recently-requested track hash, guards against a stale GET resolving late
  const lastTrackLabelRef = useRef(null); // original filename, used as track_label on Save
  const lookedUpHashRef = useRef(null); // hash whose sheet lookup actually COMPLETED -- distinct from loadedTrackHashRef, which is set the moment a track is adopted and says nothing about whether its sheets arrived
  const appliedSheetIdRef = useRef(null); // which sheet the editor is currently showing, so the reconcile effect below can tell "already correct" from "needs switching" without re-applying on every render

  // Soundcheck-only feature -- the instant the show leaves soundcheck
  // (goes live), force monitoring off regardless of what the artist left
  // it at. This is the latency-during-performance guard, not just a UI
  // default: monitoring delay that's fine while judging your own sound is
  // NOT fine once you're actually performing. Only surfaces the "you're
  // live" notice if monitoring was actually on -- no need to explain a
  // no-op.
  useEffect(() => {
    if (showPhase !== 'soundcheck' && nodes && monitorOn) {
      tuneMonitorEnabled(nodes, false);
      setMonitorOn(false);
      setAutoDisabledNotice(true);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setAutoDisabledNotice(false), AUTO_DISABLED_NOTICE_MS);
    }
  }, [showPhase, monitorOn, nodes]);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  // ── THE DECK ADOPTS WHAT THE HOST IS ALREADY PLAYING ──────────
  //
  // This panel used to learn about a backing track from exactly one
  // event: BackingTrackPanel calling onPlayerChange when the artist
  // picked a FILE. Everything downstream hung off that one callback, so
  // arriving at /live from Kit Check with a track already loaded and
  // audible left this component believing no track existed:
  //
  //   * trackHash null -> CueEditorPanel returns null outright
  //     (components/CueEditorPanel.jsx), so the editor is simply absent
  //     over audible audio.
  //   * cues [] -> no markers on BackingTrackPanel's waveform either.
  //   * onBackingPlayerChange never fires -> LiveDemo's
  //     backingTrackPlayerRef stays null and getBackingTrackState()
  //     reports {elapsedMs: 0, isPlaying: false}, so the cue director
  //     could not have fired a cue even with a sheet bound.
  //
  // The track survives the handover now (lib/audioHost.js); the deck's
  // knowledge of it did not. Same class of defect as the original one,
  // one layer up: state derived from a mount-time event rather than from
  // the thing that actually outlives mounts.
  //
  // So the host is the source of truth here too. Subscribing rather than
  // reading once also covers End Show and leave, which null the player —
  // the editor should disappear then, and via this path it does.
  //
  // Hooks live ABOVE the `if (!nodes)` early return below, deliberately.
  // A hook after a conditional return is the "Rendered fewer hooks than
  // expected" crash this codebase has already shipped once (see the same
  // note in CueEditorPanel).
  const adoptFromHostRef = useRef(null);
  // Re-pointed every render so the subscription below always calls the
  // CURRENT closure. A `[]`-dep effect capturing adoptTrack once would
  // freeze artistAccessToken at its mount-time value, and a cue-sheet
  // lookup with a stale token fails silently.
  useEffect(() => {
    adoptFromHostRef.current = () => {
      const host = getAudioHost();
      adoptTrack(host.player || null, host.trackHash || null, host.trackName || null);
    };
  });
  useEffect(() => {
    const run = () => adoptFromHostRef.current?.();
    run();
    return subscribeAudioHost(run);
  }, []);

  // The cue-sheet lookup needs a verified session, and this panel can
  // mount before LiveDemo has one. Without this, a track adopted during
  // that window would keep its hash but never load its sheet, and
  // nothing would retry — the editor would stay empty for the rest of
  // the show for a reason invisible on screen.
  useEffect(() => {
    if (!artistEmail || !artistAccessToken) return;
    const hash = loadedTrackHashRef.current;
    if (hash && lookedUpHashRef.current !== hash) loadCueSheet(hash);
  }, [artistEmail, artistAccessToken]);

  // ── RECONCILE WHEN THE ROW ARRIVES LATE ───────────────────────
  // The binding preference inside loadCueSheet only helps if the row is
  // already loaded when the lookup resolves, and on arrival at /live it
  // usually is not: useShowSession's query starts in RoomInner, and
  // React runs a child's effects BEFORE its parent's, so this panel has
  // adopted the track and fired its lookup before that query is even
  // issued. The two race, and without this the panel would settle on
  // `data.sheet` (most recently updated) and report it upward — writing
  // over the artist's actual binding.
  //
  // Not a fight with manual selection: choosing a named sheet persists
  // it, and useShowSession applies that optimistically, so cue_sheet_id
  // already matches the new choice by the time this runs.
  useEffect(() => {
    const boundId = sessionState?.cue_sheet_id ?? null;
    if (!boundId || !cueSheets.length) return;
    if (String(boundId) === String(appliedSheetIdRef.current)) return;
    // Unsaved edits outrank a late-arriving row. Switching sheets under
    // someone mid-edit to honour a binding they are in the middle of
    // changing would discard real work.
    if (cueSheetDirty) return;
    const bound = cueSheets.find((s) => String(s.id) === String(boundId));
    if (bound) applySheet(bound);
  }, [sessionState?.cue_sheet_id, cueSheets, cueSheetDirty]);

  if (!nodes) {
    return <p style={{ fontSize: 12, color: '#888780' }}>Connecting audio...</p>;
  }

  function toggleMonitor() {
    const next = !monitorOn;
    setMonitorOn(next);
    tuneMonitorEnabled(nodes, next);
  }

  // Live AND soundcheck -- this changes the actually-published signal, not
  // just local monitoring, so unlike toggleMonitor there's no showPhase
  // gate: an artist mid-show hearing the processing go wrong needs to be
  // able to kill it immediately.
  function toggleEffects() {
    const next = !effectsOn;
    setEffectsOn(next);
    tuneEffectsBypass(nodes, next);
  }

  function applyPreset() {
    setValues(PRESET);
    tuneInputGainDb(nodes, PRESET.inputDb);
    tuneHighpass(nodes, PRESET.highpass);
    tuneCompressor(nodes, { threshold: PRESET.threshold, ratio: PRESET.ratio });
    tuneMakeupGainDb(nodes, PRESET.gainDb);
    tuneReverbMix(nodes, PRESET.reverbMix);
    tuneOutputGainDb(nodes, PRESET.outputDb);
  }

  function toggleManualMix() {
    const next = !manualMix;
    setManualMix(next);
    if (!next) applyPreset(); // turning manual mix off snaps back to the known-good preset
  }

  function update(key, tuneFn) {
    return (v) => {
      setValues((prev) => ({ ...prev, [key]: v }));
      tuneFn(v);
    };
  }

  // Both routes into this panel's track state land here: the artist
  // picking a file (via BackingTrackPanel's onPlayerChange) and the host
  // subscription above. They overlap by design — BackingTrackPanel calls
  // setBackingPlayer() BEFORE onPlayerChange(), so a file pick fires the
  // host emit first and the prop callback immediately after. The identity
  // guard below is what makes that harmless instead of two resets and two
  // cue-sheet fetches per load.
  function adoptTrack(player, newTrackHash, trackLabel) {
    backingPlayerRef.current = player;
    player?.setSyncDelayMs(syncDelayMs);
    // Cue-Sheet Director (Phase 1) -- the player instance is otherwise
    // private to this component; this is the one seam that surfaces it
    // to LiveDemo, where cueDirector's poll loop can read it. Re-sent on
    // every sync, not just on change: a re-decode of the same file is a
    // NEW player object under an unchanged hash, and LiveDemo holding
    // the old one would read a playhead that never moves.
    onBackingPlayerChange?.(player);

    // Same track as we already hold -> nothing about the cue sheet's
    // identity has changed, so leave the editor alone. Resetting here
    // would wipe unsaved cue edits every time the host emitted.
    if (loadedTrackHashRef.current === newTrackHash) return;

    // A new track means a new cue sheet identity -- reset local editing
    // state before loading whatever's saved for it (if anything).
    loadedTrackHashRef.current = newTrackHash;
    lookedUpHashRef.current = null;
    appliedSheetIdRef.current = null;
    lastTrackLabelRef.current = trackLabel;
    setTrackHash(newTrackHash);
    setCues([]);
    setActiveCueId(null);
    setFallbackBehaviour('hold_last');
    setCueSheets([]);
    setSheetName('Default');
    setCueSheetDirty(false);
    setCueSheetSaveError(null);

    // ── NO EAGER onCueSheetChange(null) HERE ──────────────────────
    // It used to fire on this line, before the lookup below had
    // resolved. With TASK 1's persistence in place that transient null
    // is a WRITE: re-picking a track cleared cue_sheet_id in the row and
    // then restored it a network round trip later, and any failure in
    // between left it cleared. Fix C made re-picking a routine action
    // rather than a rare one, which turned a narrow window into a
    // regular one.
    //
    // loadCueSheet is now the single reporter of the outcome, and it
    // reports null ONLY when it has positively established there is no
    // sheet — never on a failure, where the honest answer is "unknown"
    // and the safe action is to leave the existing binding alone.
    if (newTrackHash) loadCueSheet(newTrackHash);
    else onCueSheetChange?.(null); // no track at all: genuinely nothing bound
  }

  // Kept as the named prop callback so BackingTrackPanel's seam reads the
  // same as it always did.
  function handleBackingPlayerChange(player, newTrackHash, trackLabel) {
    adoptTrack(player, newTrackHash, trackLabel);
  }

  // The one place a saved sheet becomes the editor's current state.
  // Every route in — the lookup, the named-sheet picker, the late-row
  // reconcile — goes through here so they cannot drift apart on what
  // "showing a sheet" means, and so appliedSheetIdRef is always right.
  function applySheet(sheet) {
    appliedSheetIdRef.current = sheet?.id ?? null;
    setSheetName(sheet.name || 'Default');
    setCues((sheet.cues || []).map((c) => ({ ...c, id: crypto.randomUUID() })));
    setFallbackBehaviour(sheet.fallback_behaviour);
    setActiveCueId(null);
    setCueSheetDirty(false);
    onCueSheetChange?.(sheet);
  }

  async function loadNamedSheet(name) {
    const sheet = (cueSheets || []).find((x) => x.name === name);
    if (!sheet) return;
    applySheet(sheet);
  }

  async function loadCueSheet(hash) {
    if (!artistEmail || !artistAccessToken) return; // no verified session yet -- editor still works locally, just can't load/save
    try {
      const res = await fetch(`/api/cue-sheets?track_hash=${hash}&artist_email=${encodeURIComponent(artistEmail)}`, {
        headers: { Authorization: `Bearer ${artistAccessToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      // Guard against a slower earlier fetch resolving after a faster
      // later track swap already changed what's "current."
      if (loadedTrackHashRef.current !== hash) return;
      // Product Ruling 2 -- the whole library for this track, not just
      // the most recent sheet. The route has returned `sheets` alongside
      // `sheet` since the scheduling round; nothing had ever read it, so
      // every save silently overwrote one sheet called "Default".
      setCueSheets(data.sheets || []);

      // ── THE ROW'S BINDING BEATS THIS PANEL'S DEFAULT ──────────
      // `data.sheet` is the most recently UPDATED sheet for this track,
      // which is a sensible default for a track being opened cold and
      // the wrong answer when show_session_state already records which
      // sheet the artist bound. Adopting a track on arrival would
      // otherwise rebind the row to whichever sheet was edited last —
      // undoing fix D by way of the sync that fix #2 adds.
      //
      // Only honoured when the bound sheet is actually in this track's
      // library: a cue_sheet_id belonging to a DIFFERENT track is a
      // stale binding, and following it would put another track's cues
      // on this waveform.
      const boundId = sessionState?.cue_sheet_id ?? null;
      const bound = boundId
        ? (data.sheets || []).find((s) => String(s.id) === String(boundId))
        : null;
      const sheet = bound || data.sheet;

      // Whatever happens from here, this lookup has completed for `hash`
      // — recorded so the credentials-arrived retry above does not fire
      // a second, identical request.
      lookedUpHashRef.current = hash;

      if (sheet) {
        applySheet(sheet);
      } else {
        // Positively established: this track has no saved sheet. This is
        // the ONLY path that reports null, and it is a real answer
        // rather than a placeholder — see the note in adoptTrack.
        appliedSheetIdRef.current = null;
        onCueSheetChange?.(null);
      }
    } catch (err) {
      // No onCueSheetChange call, deliberately. A failed lookup means we
      // do not know what is bound, and reporting null would let a
      // timeout erase a binding through LiveDemo's persist effect.
      console.warn('[cueEditor] failed to load cue sheet', err);
    }
  }

  function addCue(timestampMs) {
    const id = crypto.randomUUID();
    setCues((prev) => [...prev, { id, timestamp_ms: Math.round(timestampMs), shot_type: 'wide', slot_role: 'main' }]);
    setActiveCueId(id);
    setCueSheetDirty(true);
  }

  function updateCue(id, patch) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setCueSheetDirty(true);
  }

  function deleteCue(id) {
    setCues((prev) => prev.filter((c) => c.id !== id));
    setActiveCueId((prev) => (prev === id ? null : prev));
    setCueSheetDirty(true);
  }

  function changeFallbackBehaviour(value) {
    setFallbackBehaviour(value);
    setCueSheetDirty(true);
  }

  async function saveCueSheet() {
    if (!trackHash || !artistEmail || !artistAccessToken) {
      setCueSheetSaveError('Missing track or artist session');
      return;
    }
    setCueSheetSaving(true);
    setCueSheetSaveError(null);
    try {
      const res = await fetch('/api/cue-sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${artistAccessToken}`,
        },
        body: JSON.stringify({
          track_hash: trackHash,
          artist_email: artistEmail,
          track_label: lastTrackLabelRef.current || null,
          fallback_behaviour: fallbackBehaviour,
          // THE NAME. Without this every save upserted onto 'Default'
          // and the library could only ever hold one sheet per track.
          name: (sheetName || 'Default').trim() || 'Default',
          cues: cues.map(({ id, ...rest }) => rest),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCueSheetSaveError(Array.isArray(data.detail) ? data.detail.join('; ') : data.error || 'Save failed');
        return;
      }
      setCueSheetDirty(false);
      appliedSheetIdRef.current = data.sheet?.id ?? null;
      onCueSheetChange?.(data.sheet);
      // Keep the picker in step with what was just saved -- a "Save as"
      // that did not appear in the list until a reload would look like
      // it had not worked.
      setCueSheets((prev) => {
        const rest = (prev || []).filter((x) => x.id !== data.sheet.id);
        return [data.sheet, ...rest];
      });
      logHealthEvent('cue_sheet_saved', { trackHash, name: data.sheet.name, cueCount: data.sheet.cues.length });
    } catch (err) {
      setCueSheetSaveError(String(err?.message || err));
    } finally {
      setCueSheetSaving(false);
    }
  }

  function applySyncDelay(ms) {
    setSyncDelayMs(ms);
    backingPlayerRef.current?.setSyncDelayMs(ms);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          {manualMix ? 'Manual mix -- tuning live' : 'Preset sound (locked)'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
          Manual mix
          <span
            onClick={toggleManualMix}
            style={{
              width: 36, height: 20, borderRadius: 10,
              background: manualMix ? '#2ec4b6' : '#3a3a37',
              position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: manualMix ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
              transition: 'left 0.15s ease',
            }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          {effectsOn ? 'Effects on -- processed vocal' : 'Effects off -- raw vocal published'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
          Effects
          <span
            onClick={toggleEffects}
            style={{
              width: 36, height: 20, borderRadius: 10,
              background: effectsOn ? '#2ec4b6' : '#3a3a37',
              position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: effectsOn ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
              transition: 'left 0.15s ease',
            }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-around', padding: '4px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>INPUT</span>
          <LevelMeterFader
            label="Mic level"
            analyser={nodes.inputAnalyser}
            gainDb={values.inputDb}
            onChangeGainDb={manualMix ? update('inputDb', (v) => tuneInputGainDb(nodes, v)) : () => {}}
            minDb={-12}
            maxDb={24}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>FILTER</span>
          <Knob label="Rumble cut" value={values.highpass} min={40} max={160} step={5} unit="Hz"
            disabled={!manualMix || !effectsOn} onChange={update('highpass', (v) => tuneHighpass(nodes, v))} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>COMPRESSOR</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <Knob label="Threshold" value={values.threshold} min={-40} max={-10} step={1} unit="dB"
              disabled={!manualMix || !effectsOn} onChange={update('threshold', (v) => tuneCompressor(nodes, { threshold: v }))} />
            <Knob label="Ratio" value={values.ratio} min={1} max={8} step={0.5} unit=":1"
              disabled={!manualMix || !effectsOn} onChange={update('ratio', (v) => tuneCompressor(nodes, { ratio: v }))} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* This "Gain" knob is the makeup-gain stage -- it compensates for
              level lost during compression, applied BEFORE the reverb send.
              It is not the same as the OUTPUT fader on the right, which
              controls the final published level after everything else. */}
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>SEND</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <Knob label="Makeup gain" value={values.gainDb} min={0} max={12} step={0.5} unit="dB"
              disabled={!manualMix || !effectsOn} onChange={update('gainDb', (v) => tuneMakeupGainDb(nodes, v))} />
            <Knob label="Reverb" value={values.reverbMix} min={0} max={0.4} step={0.01} unit=""
              disabled={!manualMix || !effectsOn} onChange={update('reverbMix', (v) => tuneReverbMix(nodes, v))} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#55544f', letterSpacing: '0.1em' }}>OUTPUT</span>
          <LevelMeterFader
            label="Published level"
            analyser={nodes.outputAnalyser}
            gainDb={values.outputDb}
            onChangeGainDb={manualMix ? update('outputDb', (v) => tuneOutputGainDb(nodes, v)) : () => {}}
            minDb={-12}
            maxDb={12}
          />
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
        {manualMix
          ? 'Have someone play/sing at real volume and listen from a separate device while tuning. Input meter shows raw mic level; output meter shows what viewers actually hear.'
          : 'Going live uses this tested preset. Switch on Manual mix during soundcheck to adjust.'}
      </p>

      {showPhase === 'soundcheck' && (
        <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
              Monitor my voice
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fdfffc', cursor: 'pointer' }}>
              {monitorOn ? 'On' : 'Off'}
              <span
                onClick={toggleMonitor}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: monitorOn ? '#2ec4b6' : '#3a3a37',
                  position: 'relative', transition: 'background 0.15s ease', display: 'inline-block',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: monitorOn ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fdfffc',
                  transition: 'left 0.15s ease',
                }} />
              </span>
            </label>
          </div>

          <div style={{ border: '1px solid #ff9f1c', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#ff9f1c', lineHeight: 1.4 }}>
            ⚠ Use earphones only. Monitoring through speakers feeds your own processed voice back into the mic and causes feedback.
          </div>

          <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
            Hear your processed vocal (high-pass, compressor, reverb) live so you can judge it before going live. Off by
            default every soundcheck -- turns off automatically the moment you go live, since monitoring delay that's fine
            for judging your sound is not fine while actually performing.
          </p>
        </div>
      )}

      {autoDisabledNotice && (
        <div style={{ border: '1px solid #2ec4b6', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#2ec4b6', lineHeight: 1.4 }}>
          Monitoring off -- you're live
        </div>
      )}

      <CalibrateSyncPanel
        audioContext={audioContext}
        inputGain={nodes.inputGain}
        syncDelayMs={syncDelayMs}
        onApply={applySyncDelay}
      />

      <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4 }}>
        <BackingTrackPanel
          audioContext={audioContext}
          outputBus={nodes.outputBus}
          sessionState={sessionState}
          showEnded={showEnded}
          onPlayerChange={handleBackingPlayerChange}
          cues={cues}
          activeCueId={activeCueId}
          onSelectCue={setActiveCueId}
          onDropCue={addCue}
        />
        <CueEditorPanel
          trackReady={!!trackHash}
          cues={cues}
          activeCueId={activeCueId}
          fallbackBehaviour={fallbackBehaviour}
          dirty={cueSheetDirty}
          saving={cueSheetSaving}
          saveError={cueSheetSaveError}
          onSelectCue={setActiveCueId}
          onUpdateCue={updateCue}
          onDeleteCue={deleteCue}
          onChangeFallbackBehaviour={changeFallbackBehaviour}
          onSave={saveCueSheet}
          sheets={cueSheets}
          sheetName={sheetName}
          onLoadSheet={loadNamedSheet}
          onRenameSheet={setSheetName}
        />
      </div>
    </div>
  );
}
