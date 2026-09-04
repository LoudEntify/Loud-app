'use client';

// components/EgressPage.jsx
// ─────────────────────────────────────────────────────────────
// Stage 4 -- headless template for LiveKit Room Composite Egress
// (customBaseUrl), replacing the stock grid layout. Renders the SAME
// directed view a real viewer sees -- solo's single directed shot, or
// versus's spotlight layout -- with NO UI chrome (no menu, deck,
// comments, badges), so the recorded file is a clean capture of just
// the performance.
//
// Stage 6 (MULTI_PERFORMER_SPEC.md) -- versus now routes through
// SpotlightStage (built already-generalized, deliberately, so this
// stage wouldn't need to be rewritten two-slot-shaped and then
// corrected again): egress joins like any other viewer, reads
// shows.active_performer_slot the same way LiveDemo.jsx's RoomInner
// does, and reconciles on the same ACTIVE_PERFORMER_SWITCH poke --
// never trusting the raw data-channel payload directly, same security
// model as everywhere else this exists. Solo stays on VersusSplit,
// untouched, exactly as before.
//
// Reuses the live app's own rendering almost entirely, deliberately:
// ShotVideo/ShotFadeLayer/ShotTransformFrame (components/
// ShotRendering.jsx), VersusSplit, and now SpotlightStage are the EXACT
// same components a real viewer's screen renders through -- same
// crop/cut/reveal logic, same portrait-crop-aware output, same "no
// active shot yet -> fall back to the performer's own untransformed
// camera" default (confirmed directly in ShotTransformFrame:
// command=null/undefined short-circuits before any transform is ever
// applied, so a fresh render with nothing chosen yet already shows the
// raw feed, not black -- no special-casing needed here for that).
//
// LiveKit's Egress service launches a headless Chrome and navigates it
// to `${customBaseUrl}?url=...&token=...&layout=...` -- `url`/`token`
// are an auto-generated participant token LiveKit mints itself (no
// token-minting route needed on our side; confirmed from the installed
// livekit-server-sdk's own RoomCompositeOptions type, which has no token
// field at all -- customBaseUrl is the only egress-side lever, the
// SERVICE supplies its own credentials). `layout` is whatever string we
// pass to startRoomCompositeEgress's own `layout` option server-side
// (app/api/egress/start/route.js) -- reused here as this show's
// performanceMode ('solo' | 'versus') rather than inventing a parallel
// query param.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiveKitRoom, RoomAudioRenderer, useTracks, useDataChannel, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import './reactions.css';
import VersusSplit from './VersusSplit';
import { useMicState } from '../lib/micState';
import SpotlightStage from './SpotlightStage';
import { ShotVideo } from './ShotRendering';
import { initHealthLog, logHealthEvent } from '../lib/healthLog';
import { useIneligibleTracks, filterEligible } from '../lib/trackLiveness';
import {
  STAGE_TRACK_SOURCES,
  belongsToSlot,
  cameraTracksOnly,
  isPerformerCameraTrack,
  matchesTarget,
} from '../lib/trackSources';

// Plain Ink fill, no text -- the live viewer's own placeholder shows
// "waiting for performer..."/the "be right back" card, which is exactly
// the kind of UI chrome this recording is meant to exclude. A brief,
// genuinely-blank moment before the first real frame paints is fine
// (matches how any recording naturally starts); readable status text
// baked into the footage is not.
const CLEAN_PLACEHOLDER = <div style={{ width: '100%', height: '100%', background: '#011627' }} />;

// LiveKit's headless capture waits for an explicit "ready" signal before
// it starts recording rather than assuming the page is ready on load
// (confirmed: WebOptions' awaitStartSignal is documented against exactly
// this "await START_RECORDING chrome log" behavior in the installed
// SDK's own type definitions) -- but the EXACT contract for Room
// Composite specifically (console log vs. a DOM CustomEvent, which is
// the newer convention LiveKit's own template docs describe) isn't
// independently verifiable from the local SDK alone. Firing both is
// defensive, not a guess dressed up as certainty -- whichever one this
// deployed Egress version actually honors, this satisfies it; the other
// is simply unused. Confirm against a real recording once tested; drop
// whichever one turns out unnecessary.
function signalRecordingReady() {
  console.log('START_RECORDING');
  try {
    document.dispatchEvent(new CustomEvent('LK_START_RECORDING'));
  } catch {
    // CustomEvent should always exist in a real browser context (this
    // page only ever runs inside LiveKit's own headless Chrome) -- a
    // failure here isn't worth taking the recording down over.
  }
}

// Mirrors renderSlot's own tracksForSlot (LiveDemo.jsx) -- same filter,
// same reasoning (a muted participant is unavailable the same as one
// who never published, per SHOW_LIFECYCLE_SPEC.md L6-1).
// Deliberately NOT filtered by liveness (Test 4 ruling) -- this is the
// RENDERING pool, and a dead camera has to stay in it so an explicit cut
// to it can be honoured rather than silently re-picked. renderSlot below
// derives the live subset for every automatic fallback.
// B-roll is IN this pool, exactly as it is in LiveDemo's own version.
// The recorder composes the same directed view a viewer sees, so if a
// clip can be cut to live it has to be a candidate here or the recording
// would show the artist's camera at the moment the show showed a clip --
// a file that quietly disagrees with the performance that happened.
function tracksForSlot(tracks, letter) {
  return tracks.filter((t) => belongsToSlot(t, letter) && !t.publication?.isMuted);
}

// Connected-room view -- mirrors RoomInner's own renderSlot/ShotVideo
// call pattern (LiveDemo.jsx) as closely as possible, minus everything
// that isn't the video layer itself.
function EgressStage({ layout }) {
  const room = useRoomContext();
  // Same source list as the live stage -- ScreenShare is here only
  // because that is how b-roll clips are published (lib/trackSources.js).
  const tracks = useTracks(STAGE_TRACK_SOURCES);
  // The recorder listens and never announces: it has no microphone and
  // must never claim a slot.
  const liveSlots = useMicState(room, { localSlot: null, enabled: true });
  // Finding 1 -- liveness registry with revival probation. See
  // lib/trackLiveness.js for why reappearing in the list is not enough
  // to become selectable again.
  const ineligibleTracks = useIneligibleTracks(room, tracks);
  const [activeShot, setActiveShot] = useState({});
  const signaledRef = useRef(false);

  // Stage 6 -- same shows-row read LiveDemo.jsx's RoomInner does (anon
  // client, RLS already allows open read on `shows`), keyed off the
  // room egress actually connected to (room.name) rather than a second
  // hardcoded ROOM_NAME constant that could drift from LiveDemo.jsx's
  // own. Fetched once on mount and again on every ACTIVE_PERFORMER_
  // SWITCH poke below -- never on a timer, egress has no lifecycle
  // banners/lifecycle machinery to justify LiveDemo.jsx's own 15s poll.
  const [show, setShow] = useState(null);
  const fetchShow = useCallback(async () => {
    if (!room?.name) return;
    try {
      const { getSupabase } = await import('../lib/supabaseClient');
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('shows')
        .select('*')
        .eq('room_name', room.name)
        .maybeSingle();
      if (!error) setShow(data);
    } catch (e) {
      console.warn('[egress] show fetch failed', e);
    }
  }, [room?.name]);

  useEffect(() => {
    fetchShow();
  }, [fetchShow]);

  // The one data-channel message type this page needs -- the artist
  // device already broadcasts SHOT_COMMANDs to every participant in the
  // room in real time (lib/shotCommands.js's broadcastShotCommand); this
  // headless browser just needs to be another listener, same as any
  // real viewer, for the recording to follow the exact same directed
  // cuts in sync. ACTIVE_PERFORMER_SWITCH (Stage 6) is handled exactly
  // as LiveDemo.jsx's RoomInner does: never applied directly, only a
  // signal to re-fetch shows.active_performer_slot, the actual source
  // of truth (MULTI_PERFORMER_SPEC.md section 5).
  useDataChannel((msg) => {
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(msg.payload));
    } catch {
      return;
    }
    if (payload.type === 'SHOT_COMMAND') {
      setActiveShot((prev) => ({ ...prev, [payload.slot]: payload }));
    }
    if (payload.type === 'ACTIVE_PERFORMER_SWITCH') {
      fetchShow();
    }
  });

  // Signals recording-ready the first time ANY video element in this
  // page has genuinely painted a frame -- deliberately independent of
  // ShotVideo's own internal reveal-gate (which isn't exposed as a
  // callback prop, by design; adding one just for this would mean
  // touching shared, already-proven code for a need that's specific to
  // this page). Polls document.querySelectorAll('video') directly
  // instead -- readyState/videoWidth are the same underlying signal
  // waitForFirstFrame (ShotRendering.jsx) already trusts, just checked
  // from outside rather than via that internal helper. querySelectorAll
  // (not querySelector) since persistent layers can keep multiple
  // candidate <video> elements mounted at once -- any one of them
  // having real content is enough to start recording.
  useEffect(() => {
    let raf;
    function check() {
      if (signaledRef.current) return;
      const videos = document.querySelectorAll('video');
      const anyPainting = Array.from(videos).some((v) => v.readyState >= 2 && v.videoWidth > 0);
      if (anyPainting) {
        signaledRef.current = true;
        signalRecordingReady();
        return;
      }
      raf = requestAnimationFrame(check);
    }
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Fix (a3): recorder-side telemetry ──────────────────────────
  // Until now the egress browser logged nothing: when a recording came
  // back wrong there was no record of what the RECORDER saw, only what
  // the performer's device saw. Same fail-silent logger the app uses, and
  // /api/health-events takes unauthenticated posts (service-role behind
  // the route), so the headless browser can write directly. Keyed on
  // room.name, matching the showId the performer devices log under, so
  // both sides of a show land on one timeline.
  useEffect(() => {
    if (!room?.name) return;
    initHealthLog({
      showId: room.name,
      participantIdentity: room.localParticipant?.identity || 'egress',
      role: 'egress',
    });
  }, [room?.name, room?.localParticipant?.identity]);

  // ─── Fix (a1/a3): the track pool is DYNAMIC ─────────────────────
  // Cameras join and die mid-show, and a publish-recovery replaces the
  // performer's participant wholesale (new identity, new SIDs). useTracks
  // is already reactive to publish/unpublish/subscribe, so the pool is
  // correct -- what was missing is that nothing observed it changing.
  const poolSignature = useMemo(
    () => tracks.map((t) => `${t.participant.identity}:${t.publication?.trackSid || ''}`).sort().join('|'),
    [tracks]
  );
  useEffect(() => {
    logHealthEvent('egress_track_pool_changed', {
      trackCount: tracks.length,
      identities: Array.from(new Set(tracks.map((t) => t.participant.identity))),
    });
    // poolSignature is the real dependency -- `tracks` is a fresh array
    // every render, so depending on it would log on every render rather
    // than on every real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSignature]);

  // ─── Fix (a2): drop shot commands whose target has vanished ─────
  // A SHOT_COMMAND carries a targetIdentity AND a framing transform. When
  // that participant disappears, the fallback chain below correctly picks
  // a different track -- but the stale `cmd` was still applied to it,
  // cropping a NEW camera to a shot composed for the OLD one. Pruning
  // means the replacement renders untransformed until the next real cut,
  // which is the same "wide, not a wrong crop" default a fresh show gets.
  useEffect(() => {
    setActiveShot((prev) => {
      const liveIdentities = new Set(tracks.map((t) => t.participant.identity));
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([slot, cmd]) => {
        if (cmd?.targetIdentity && !liveIdentities.has(cmd.targetIdentity)) {
          logHealthEvent('egress_stale_command_dropped', { slot, targetIdentity: cmd.targetIdentity });
          changed = true;
          return; // drop it
        }
        next[slot] = cmd;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSignature]);

  // One stable handler per slot. Stable matters: ShotVideo's orphan-rescue
  // effect lists onReselect as a dependency, and a fresh closure every
  // render would re-run that effect on every unrelated render.
  const reselectHandlers = useMemo(
    () => ({
      a: (detail) => logHealthEvent('egress_reselect', { ...detail, slot: 'a' }),
      b: (detail) => logHealthEvent('egress_reselect', { ...detail, slot: 'b' }),
    }),
    []
  );

  const renderSlot = (letter) => () => {
    // Test 4 ruling -- the recorder must reach the SAME resolution the
    // artist and viewers see, so it uses the identical split: the full
    // pool for honouring an explicit cut, the live subset for every
    // automatic fallback. A recording that quietly substituted a live
    // camera for the one the director actually cut to would no longer be
    // a record of the performance that happened.
    const candidates = tracksForSlot(tracks, letter);
    const eligible = filterEligible(candidates, ineligibleTracks);
    const cmd = activeShot[letter];
    // Same fallback chain as RoomInner's own renderSlot: an explicit
    // targetIdentity match first, then the slot's own performer, then
    // whatever else is available. No SHOT_COMMAND yet (the show just
    // went live, nothing's been cut to) means `cmd` is undefined here
    // too -- `chosen` still resolves to the performer's own track via
    // the second branch, and ShotTransformFrame renders it untransformed
    // (confirmed above) -- the "wide/first available shot, not black"
    // requirement is satisfied by this SAME existing fallback, not a
    // new rule written for egress specifically.
    // matchesTarget, not an identity comparison -- identical to
    // LiveDemo's renderSlot and for the identical reason: a b-roll clip
    // carries the artist's own participant identity, so identity alone
    // would resolve a "cut to the clip" command to the artist's camera
    // and bake their face into the recording where the clip should be.
    const matched = cmd?.targetIdentity
      ? candidates.find((t) => matchesTarget(t, cmd))
      : undefined;
    // Fallbacks resolve against CAMERAS only, same as live: a shot whose
    // target has gone must never land on a playing clip by accident.
    const eligibleCameras = cameraTracksOnly(eligible);
    const chosen =
      matched ||
      eligibleCameras.find((t) => isPerformerCameraTrack(t)) ||
      eligibleCameras[0] ||
      cameraTracksOnly(candidates)[0] ||
      candidates[0];
    const activeImpaired = !!chosen && !eligible.includes(chosen);

    return (
      <ShotVideo
        candidates={candidates}
        activeTrackRef={chosen}
        command={cmd ?? null}
        placeholder={CLEAN_PLACEHOLDER}
        onReselect={reselectHandlers[letter]}
        // No lostOverlay: the recorder holds the frozen frame with no
        // status text, same rule as CLEAN_PLACEHOLDER.
        activeImpaired={activeImpaired}
      />
    );
  };

  // Stage 6 -- same live-track derivation as LiveDemo.jsx's presentSlots
  // (not filtered on isMuted, same reasoning: muting isn't a disconnect).
  // Duplicated rather than imported -- presentSlots lives inside
  // RoomInner's closure in LiveDemo.jsx, not exported, and this is a
  // handful of lines, not worth restructuring that file to share.
  const presentSlots = useMemo(() => {
    const set = new Set();
    tracks.forEach((t) => {
      // isPerformerCameraTrack, not a bare identity prefix: a b-roll clip
      // is published by the artist's own participant, and a clip playing
      // must never make a slot read as occupied by a person.
      if (!isPerformerCameraTrack(t)) return;
      const slot = t.participant.identity.split('-')[1];
      if (slot) set.add(slot);
    });
    return Array.from(set).sort();
  }, [tracks]);

  const activePerformerSlot = show?.active_performer_slot || 'a';

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: '#011627', overflow: 'hidden' }}>
      {/* ── THE RECORDING IS AN EVEN SPLIT, DELIBERATELY ──────
          Not inherited: chosen. Until round 3 the recorder laid the
          stage out by ACTIVE PERFORMER, which put one artist full-bleed
          and the other in a thumbnail — and a battle recorded with one
          performer larger reads as a verdict. The file is the artefact
          that outlives the show and gets watched by people who were not
          there, so it does not get to editorialise.

          Fixed 50/50, and fixedSplit also removes the drag handle: a
          recorder has no viewer to adjust it, and a replay viewer would
          be dragging a ratio already baked into the pixels.

          The teal live-border IS kept here, and that is also a decision
          rather than an inheritance. Neutrality is about SIZE — whose
          turn it was is a record, not a judgement, and it is otherwise
          unrecoverable from the footage. The treatment is IDENTICAL to
          the live stage and must never be amplified for the recording;
          the moment it is heavier here, prominence starts doing the job
          size was forbidden from doing. */}
      {layout === 'versus' ? (
        <VersusSplit
          mode="versus"
          forceOrientation="portrait"
          fixedSplit={50}
          liveSlots={liveSlots}
            room={room}
          renderA={renderSlot('a')}
          renderB={renderSlot('b')}
        />
      ) : (
        <VersusSplit
          mode="solo"
          forceOrientation="portrait"
          renderA={renderSlot('a')}
          renderB={renderSlot('b')}
        />
      )}
    </div>
  );
}

export default function EgressPage() {
  const searchParams = useSearchParams();
  const url = searchParams.get('url');
  const token = searchParams.get('token');
  const layout = searchParams.get('layout');

  // Real usage always has url/token (LiveKit's own Egress service
  // appends them) -- this only ever shows if the page is opened directly
  // without those params, e.g. while testing the route itself.
  if (!url || !token) {
    return <div style={{ position: 'fixed', inset: 0, background: '#011627' }} />;
  }

  return (
    <LiveKitRoom serverUrl={url} token={token} connect video={false} audio={false}>
      <RoomAudioRenderer />
      <EgressStage layout={layout} />
    </LiveKitRoom>
  );
}
