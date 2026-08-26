'use client';

// components/ShotRendering.jsx
// ─────────────────────────────────────────────────────────────
// The shot-director rendering pipeline -- extracted verbatim from
// LiveDemo.jsx (Stage 4, directed portrait egress) so it can be shared
// by BOTH the live app (LiveDemo.jsx's renderSlot, unchanged behavior)
// and the new headless egress template (app/egress/page.js), which
// needs to render the exact same directed cuts a real viewer sees, with
// no UI chrome around it. Pure move -- no logic changed, only the
// module boundary. This is the accumulated result of a long debugging
// history (the punch-in-flash / persistent-layer work); the comments
// below are preserved exactly as they were, since they're the actual
// record of why this code is shaped the way it is.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoTrack } from '@livekit/components-react';
import { useTrackAspect } from '../lib/useSourceDimensions';
import { SHOT_TYPES, CAMERA_CHANGE_FADE_MS } from '../lib/shotTypes';
import { isBrollTrack } from '../lib/trackSources';

// DEBUG -- investigating a reported "punch-in flash" on camera-to-camera
// cuts: the shot briefly zooms/magnifies before settling into the
// correct framing. Suspected cause: ShotTransformFrame's isPortrait
// (from useTrackAspect) starts false on every fresh mount (a new layer
// per camera change) and only resolves to its real value a render cycle
// later, via a SEPARATE effect than the one that applies the crop
// transform -- so a freshly-mounted layer can apply the LANDSCAPE
// variant's (larger, per Stage 2's design) scale first, then correct to
// the smaller portrait scale once detection catches up. Whether that's
// actually visible depends on whether ShotFadeLayer's frame-ready reveal
// (an independent, async, browser-driven event) happens to land before
// or after that correction -- this logs both timelines so the real
// ordering is visible instead of inferred. Module-level (not React
// state) so ShotFadeLayer/ShotTransformFrame don't need a logger prop
// threaded through them -- keeps shot-director internals untouched
// beyond the log call itself. ?debug=1 gated, same convention as /cam's
// panel; safe to delete once the real ordering is confirmed and fixed.
//
// Second round (reveal-gating fix shipped, flash reportedly persisted):
// ShotFadeLayer now also logs every attemptReveal call, including BLOCKED
// ones (proves the gate is genuinely being consulted, not bypassed), and
// on the REVEALED line reads live DOM state -- the transform actually
// sitting on the node and the <video> element's own decoded
// videoWidth/videoHeight -- instead of only React's believed state. That
// distinguishes a timing bug (gate opened before ShotTransformFrame's
// correction committed -- domTransform lags what shot+isPortrait implies)
// from a correctness bug (detected dimensions disagree with the video
// element's actual ones -- useTrackAspect settled on the wrong answer,
// not just a late one).
//
// Third round (synchronous-init fix shipped, confirmed correct via the
// overlay -- detected values now match reality, no wrong-then-corrected
// scale happens at all -- yet the flash STILL persists): new working
// theory is this was never an aspect-detection bug. Two feeds can
// legitimately have very different aspect ratios and therefore very
// different crop scales (a 1080x1920 portrait contestant vs a 1728x1080
// landscape camfeed) -- cutting between them is a real, correct jump in
// framing, not a bug to gate away. This round adds outgoing-layer
// visibility: ShotVideo now logs exactly when a new layer is APPENDED
// (which demotes the previous top layer) and exactly when the old
// layer(s) are actually REMOVED from the DOM, and ShotFadeLayer logs the
// moment it's DEMOTED (command -> null) with its own visible/opacity
// state and current transform at that instant, plus any time `visible`
// itself changes after the fact. Together these show whether the
// outgoing layer stays fully opaque and frozen the whole time (as
// designed) or whether something briefly exposes both layers, or drops
// the outgoing layer's opacity, around the cut boundary.
//
// Fourth round (hard-cut default shipped, aspect mismatch confirmed
// fixed -- yet the overlay still showed "attemptReveal BLOCKED:
// frameReady=false" ~45ms before every REVEALED, even on a SAME-camera
// shot change): root cause was ShotVideo mounting a fresh keyed
// ShotFadeLayer -- and therefore a fresh <video> element -- on every
// cut, which must paint its own first frame from scratch regardless of
// how long the underlying track had already been decoding elsewhere.
// Fixed by making layers PERSISTENT: one ShotFadeLayer per candidate
// track (not per cut), kept mounted for the track's whole candidacy, its
// frame-paint+aspect gate resolving once, early, off-screen -- a cut now
// only flips which already-painting layer is displayed. ShotFadeLayer's
// `ready` (was `visible`) is a one-time latch fed by the SAME gate as
// before; `displayed` is new, owned by ShotVideo, and is what opacity
// now keys on -- kept deliberately separate from `isActive`
// (command !== null) because collapsing them (outgoing layer fading its
// OWN opacity down while incoming fades up) reintroduces a dark-midpoint
// artifact on any `fade` transition, the exact class of bug the
// old-stays-fully-opaque design was built to avoid. Look for
// `[ShotVideo] DISPLAYED -> <key>` -- on a cut to an already-live
// candidate this should land within a frame or two of the cut, not the
// ~45ms this round measured.
export const CUT_DEBUG_ENABLED = typeof window !== 'undefined' && window.location.search.includes('debug=1');
let cutDebugLog = [];
const cutDebugListeners = new Set();
export function logCutDebug(label) {
  if (!CUT_DEBUG_ENABLED) return;
  const entry = `+${performance.now().toFixed(1)}ms ${label}`;
  cutDebugLog = [...cutDebugLog.slice(-79), entry];
  cutDebugListeners.forEach((fn) => fn(cutDebugLog));
}
function useCutDebugLog() {
  const [log, setLog] = useState(cutDebugLog);
  useEffect(() => {
    if (!CUT_DEBUG_ENABLED) return undefined;
    cutDebugListeners.add(setLog);
    return () => cutDebugListeners.delete(setLog);
  }, []);
  return log;
}
// Short per-layer tag so entries from different slots/cuts happening
// close together in the shared log stay distinguishable.
function shortLayerTag(trackRef) {
  const id = trackRef?.participant?.identity || 'none';
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

// DEBUG -- on-screen readout for the cut-timing investigation above.
// Mounted once from RoomInner, always subscribed (cheap) but only
// rendered non-empty when CUT_DEBUG_ENABLED. Read top-to-bottom per
// layer tag: "aspect effect" and "transform effect APPLIED" lines show
// what ShotTransformFrame did and when; "REVEALED" (from ShotFadeLayer)
// shows when the viewer could actually see it -- if REVEALED lands
// between two differing "transform effect APPLIED" lines for the same
// tag, that's the flash, confirmed with real timestamps.
export function CutTimingDebugOverlay() {
  const log = useCutDebugLog();
  if (!CUT_DEBUG_ENABLED) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        right: 8,
        maxHeight: '40vh',
        overflowY: 'auto',
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(1, 22, 39, 0.85)',
        color: '#fdfffc',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.5,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 700 }}>CUT TIMING DEBUG ({log.length} entries)</div>
      {log.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

const trackKey = (t) => t ? `${t.participant.identity}:${t.publication?.trackSid || ''}` : null;

// Pan direction -> start/end translate offsets (percent of overscan
// slack). Ported from ShotRenderer.jsx.
const PAN_VECTORS = {
  left: { from: [8, 0], to: [-8, 0] },
  right: { from: [-8, 0], to: [8, 0] },
  up: { from: [0, 8], to: [0, -8] },
  down: { from: [0, -8], to: [0, 8] },
};

// How long to wait for an incoming video to genuinely paint a decoded
// frame before revealing it regardless. A real stall (bad network, a
// track stuck subscribed-but-not-flowing) should never leave a slot
// permanently blank -- this bounds the wait and falls back to the old
// reveal-anyway behavior after it, rather than waiting forever.
const FRAME_READY_TIMEOUT_MS = 600;

// Resolves once `videoEl` has genuinely painted a frame -- not just
// mounted or attached. requestVideoFrameCallback fires exactly on frame
// presentation (supported on iOS Safari 15.4+ and Android Chrome, both
// in scope for this app); loadeddata is the fallback for anything
// without it, checking readyState first in case the frame already
// arrived before this listener attached. Always resolves -- the timeout
// guarantees a caller never waits indefinitely. Returns a cleanup fn.
function waitForFirstFrame(videoEl, timeoutMs, onReady) {
  let done = false;
  let rvfcHandle = null;
  // Declared before cleanup() closes over it. It was assigned below the
  // two functions that read it -- safe only because neither could run
  // before the assignment, which is exactly the kind of "safe for now"
  // that became a crashed live page elsewhere in this codebase
  // (DECISIONS.md 17).
  let timer = null;
  const hasRVFC = typeof videoEl.requestVideoFrameCallback === 'function';

  function finish() {
    if (done) return;
    done = true;
    cleanup();
    onReady();
  }

  function cleanup() {
    clearTimeout(timer);
    videoEl.removeEventListener('loadeddata', finish);
    if (hasRVFC && rvfcHandle != null && typeof videoEl.cancelVideoFrameCallback === 'function') {
      videoEl.cancelVideoFrameCallback(rvfcHandle);
    }
  }

  timer = setTimeout(finish, timeoutMs);

  if (hasRVFC) {
    rvfcHandle = videoEl.requestVideoFrameCallback(finish);
  } else if (videoEl.readyState >= 2) {
    // HAVE_CURRENT_DATA or better -- a frame is already there.
    finish();
  } else {
    videoEl.addEventListener('loadeddata', finish);
  }

  return cleanup;
}

// Portrait work, Stage 2 -- SHOT_TYPES.transform for mediumCU/closeUp/
// bRoll/zoomIn/zoomOut/dolly is now aspect-ratio-keyed ({ landscape,
// portrait }); wide/follow stay `null` (no crop at all, correct as-is
// regardless of aspect ratio); pan/staccato stay flat objects (Stage 3
// territory, unchanged here). This picks the right shape out of
// whichever of those three a shot actually has.
function resolveTransform(transform, isPortrait) {
  if (!transform) return null;
  if (transform.landscape || transform.portrait) {
    return isPortrait ? transform.portrait : transform.landscape;
  }
  return transform;
}

// Computes the crop/animatedZoom/animatedPan CSS transform for the active
// shot and applies it to a wrapper div around the video. Ported from
// ShotRenderer.jsx's transform effect -- the track attach/detach and
// opacity-fade parts of that file don't apply here: VideoTrack handles
// attach/detach itself, and fades are handled a layer up, by
// ShotFadeLayer's opacity, not by this wrapper.
function ShotTransformFrame({ trackRef, command, placeholder, videoRef, aspect, transformElRef }) {
  const [style, setStyle] = useState({});
  const rafRef = useRef(null);
  // `aspect` is now a prop, owned by ShotFadeLayer (see its own comment)
  // -- ShotFadeLayer needs the same aspect state to gate the reveal on,
  // so it's the single source of truth rather than each component
  // running its own separate useTrackAspect subscription. Still reacts
  // live to isPortrait changing (a source rotating mid-show).
  const isPortrait = aspect?.isPortraitSource ?? false;

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const shot = command && SHOT_TYPES[command.shot];
    if (!shot) {
      // No live command for this layer -- either a fresh mount (style
      // starts at {}, so it renders untransformed) or an outgoing fade
      // layer that ShotVideo demoted to command=null. The latter must
      // freeze at whatever transform it last had, not snap to scale(1)
      // mid-fade, so leave `style` exactly as it is.
      return undefined;
    }

    const t = resolveTransform(shot.transform, isPortrait);

    if (!t || (t.optional && !command.params?.vertigo)) {
      logCutDebug(`[${shortLayerTag(trackRef)}] transform effect: no-op scale(1) (isPortrait=${isPortrait})`);
      setStyle({ transform: 'scale(1)', transition: 'none' });
      return undefined;
    }

    if (t.kind === 'crop') {
      logCutDebug(`[${shortLayerTag(trackRef)}] transform effect APPLIED: scale=${t.scale} shot=${command.shot} isPortrait=${isPortrait} variant=${isPortrait ? 'portrait' : 'landscape'}`);
      setStyle({
        transform: `scale(${t.scale})`,
        transformOrigin: `${t.originX}% ${t.originY}%`,
        transition: 'none', // static crops snap -- they are framings, not moves
      });
      return undefined;
    }

    if (t.kind === 'animatedZoom') {
      setStyle({
        transform: `scale(${t.from})`,
        transformOrigin: `${t.originX}% ${t.originY}%`,
        transition: 'none',
      });
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setStyle({
            transform: `scale(${t.to})`,
            transformOrigin: `${t.originX}% ${t.originY}%`,
            transition: `transform ${t.durationMs}ms ${t.easing}`,
          });
        });
      });
      return undefined;
    }

    if (t.kind === 'animatedPan') {
      const dir = command.params?.direction || t.direction;
      const vec = PAN_VECTORS[dir] || PAN_VECTORS.left;
      setStyle({
        transform: `scale(${t.overscan}) translate(${vec.from[0]}%, ${vec.from[1]}%)`,
        transition: 'none',
      });
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setStyle({
            transform: `scale(${t.overscan}) translate(${vec.to[0]}%, ${vec.to[1]}%)`,
            transition: `transform ${t.durationMs}ms ${t.easing}`,
          });
        });
      });
      return undefined;
    }

    // hardCutSequence never reaches here -- the sequencer emits concrete
    // static-shot commands, so viewers only ever see wide/closeUp/bRoll cuts.
    return undefined;
    // isPortrait in deps: a source rotating mid-show (Stage 1 detection
    // flipping live) re-resolves and re-applies the transform for
    // whatever command is currently active, without needing a new
    // SHOT_COMMAND to fire.
  }, [command, isPortrait]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#011627' }}>
      <div ref={transformElRef} style={{ width: '100%', height: '100%', willChange: 'transform', ...style }}>
        {trackRef ? (
          <VideoTrack ref={videoRef} trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : placeholder}
      </div>
    </div>
  );
}

// Persistent per-candidate video layer -- one instance per track that's
// EVER been a candidate for this slot, mounted once and kept mounted for
// that track's whole candidacy (see ShotVideo's own comment). Three
// separate pieces of state, deliberately not collapsed into one:
//   - isActive (command !== null): is this the director's CURRENTLY
//     CHOSEN track. Drives the crop transform via ShotTransformFrame,
//     unchanged from before.
//   - ready: a ONE-TIME latch -- has this track's video ever painted a
//     real frame with a settled aspect. Fed by the exact same
//     frame-paint + aspect-settled gate that fixed the punch-in flash;
//     the only change is WHEN it runs -- once per this layer's whole
//     lifetime (trackRef is now stable, never remounted per cut), not
//     once per cut. For an already-established candidate this has
//     almost always already resolved, off-screen, before any cut ever
//     targets it.
//   - displayed (prop, owned by ShotVideo): is this layer CURRENTLY at
//     opacity 1. NOT derived from isActive directly -- see ShotVideo's
//     handleActiveReady for why collapsing "chosen" and "opacity" into
//     one signal would let BOTH the outgoing and incoming layers animate
//     opacity simultaneously on a `fade`, producing a dark-midpoint dip
//     against the black background underneath. Keeping them separate
//     means the outgoing layer holds fully opaque, showing its own
//     last-correct frame, until ShotVideo confirms the incoming one is
//     ready and flips `displayed` -- same math the old
//     append-then-remove-after-delay design relied on, just applied to a
//     toggle instead of a mount/unmount.
// isActive && ready is reported up via onActiveReady(layerKey) --
// ShotVideo starts its swap timer from there. For an already-painting
// candidate both are already true when a cut lands, so this fires (and
// the timer starts) essentially the same tick as the cut -- no waiting
// on a fresh element's first paint, which is the whole fix this round.
function ShotFadeLayer({ trackRef, command, placeholder, instant, displayed, zIndex, onActiveReady, layerKey }) {
  const isActive = command !== null;
  const [ready, setReady] = useState(false);
  const videoRef = useRef(null);
  const transformElRef = useRef(null);
  const readyFiredRef = useRef(false);
  const frameReadyRef = useRef(false);
  const aspect = useTrackAspect(trackRef);
  const aspectSettled = aspect.status !== 'detecting';
  const aspectSettledRef = useRef(aspectSettled);
  aspectSettledRef.current = aspectSettled;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const tryRevealRef = useRef(null);

  // DEBUG -- see the module-level comment above CUT_DEBUG_ENABLED.
  const layerTrackSid = trackRef?.publication?.trackSid;
  useEffect(() => {
    logCutDebug(`[${shortLayerTag(trackRef)}] aspect effect: status=${aspect.status} isPortrait=${aspect.isPortraitSource} (${aspect.width ? `${aspect.width}x${aspect.height}` : 'no dims yet'})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerTrackSid, aspect.status, aspect.isPortraitSource, aspect.width, aspect.height]);

  // DEBUG (fourth round, see module comment) -- fires whenever isActive
  // toggles: this layer becomes/stops being the director's chosen track,
  // independent of whether it's actually displayed (opacity) yet.
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (wasActiveRef.current !== isActive) {
      logCutDebug(`[${shortLayerTag(trackRef)}] isActive: ${wasActiveRef.current} -> ${isActive} (ready=${ready})`);
      wasActiveRef.current = isActive;
    }
  }, [isActive, ready, trackRef]);

  // Frame-paint + aspect-settle gate -- unchanged logic from the
  // punch-in-flash fix, now running once per this layer's whole
  // candidacy (trackRef is stable for that entire lifetime) instead of
  // once per cut.
  useEffect(() => {
    readyFiredRef.current = false;
    frameReadyRef.current = false;

    function attemptReady() {
      if (readyFiredRef.current) return;
      if (!frameReadyRef.current || !aspectSettledRef.current) {
        // DEBUG -- proves the gate is actually being consulted (not
        // bypassed). Now that this only runs once per candidacy, seeing
        // this line near a CUT (rather than near when the track first
        // became a candidate) is itself the signature of the ~45ms
        // freeze this round fixed -- it should no longer appear there.
        logCutDebug(`[${shortLayerTag(trackRef)}] attemptReveal BLOCKED: frameReady=${frameReadyRef.current} aspectSettled=${aspectSettledRef.current} (status=${aspectRef.current.status})`);
        return;
      }
      readyFiredRef.current = true;
      // DEBUG -- same direct-proof line as before: DOM transform + the
      // <video> element's own decoded dimensions at the instant this
      // layer first becomes capable of being shown.
      const videoEl = videoRef.current;
      const domTransform = transformElRef.current?.style?.transform || '(none)';
      // DEBUG (aspect-squeeze diagnostic) -- raw getSettings() straight
      // off the MediaStreamTrack (bypassing useTrackAspect's processor
      // preference, so this is what the source itself delivered), plus
      // the actual rendered <video> box + its computed object-fit.
      // Comparing all four numbers on this one line answers "CSS or
      // pipeline": if rawSettings is already squeezed (doesn't match
      // decodedFrame's aspect... they're always equal, so really: if
      // rawSettings/decodedFrame show a narrower-than-16:9 shape for a
      // known-16:9 source), the distortion is baked in before this
      // component ever runs -- no object-fit change downstream can fix
      // it. If rawSettings/decodedFrame look correct but renderBox's
      // aspect or objectFit is off, it's a CSS/layout bug here instead.
      const rawMst = trackRef?.publication?.track?.mediaStreamTrack;
      const rawSettings = rawMst?.getSettings?.();
      const renderRect = videoEl?.getBoundingClientRect?.();
      const computedObjectFit = videoEl ? getComputedStyle(videoEl).objectFit : null;
      logCutDebug(`[${shortLayerTag(trackRef)}] READY: detectedIsPortrait=${aspectRef.current.isPortraitSource} detected=${aspectRef.current.width || '?'}x${aspectRef.current.height || '?'} actualVideoWxH=${videoEl?.videoWidth || '?'}x${videoEl?.videoHeight || '?'} rawSettings=${rawSettings?.width || '?'}x${rawSettings?.height || '?'} renderBox=${renderRect ? `${Math.round(renderRect.width)}x${Math.round(renderRect.height)}` : '?'} objectFit=${computedObjectFit || '?'} domTransform=${domTransform}`);
      setReady(true);
    }
    tryRevealRef.current = attemptReady;

    function onFramePainted() {
      frameReadyRef.current = true;
      attemptReady();
    }

    // videoRef.current may not exist yet on the very first pass of this
    // effect (the underlying <video> needs to mount and VideoTrack's own
    // ref-forwarding needs to run first) -- wait a frame and retry
    // rather than assuming it's already there.
    let cleanupFrameWait;
    let raf = null;
    function start() {
      if (videoRef.current) {
        cleanupFrameWait = waitForFirstFrame(videoRef.current, FRAME_READY_TIMEOUT_MS, onFramePainted);
      } else {
        raf = requestAnimationFrame(start);
      }
    }
    start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      cleanupFrameWait?.();
    };
  }, [trackRef]);

  // Whenever aspect SETTLES (detecting -> ready/failed), re-check
  // whether the gate can resolve now -- doesn't restart the frame-wait
  // above, just re-runs the SAME pending check with the new answer.
  useEffect(() => {
    if (aspectSettled) tryRevealRef.current?.();
  }, [aspectSettled]);

  // The actual handoff signal to ShotVideo. For an already-live
  // candidate cut to now, both isActive and ready are already true, so
  // this fires (and ShotVideo's swap timer starts) in essentially the
  // same tick as the cut. For a genuinely new candidate cut to before it
  // has ever painted, this only fires once the gate above resolves --
  // same dark-flash protection as before, just retargeted from "on
  // mount" to "on isActive".
  useEffect(() => {
    if (isActive && ready) {
      onActiveReady?.(layerKey);
    }
  }, [isActive, ready, onActiveReady, layerKey]);

  // DEBUG (fourth round) -- catches every change to `displayed`, the
  // actual opacity toggle ShotVideo owns. This is the one to diff
  // against a cut's own timestamp for the latency verification -- for an
  // already-ready layer it should land within a frame or two of isActive
  // flipping true, not ~45ms later. A true -> false transition happening
  // for reasons OTHER than a newer layer becoming displayed would be a
  // real bug (the outgoing layer un-revealing itself).
  const prevDisplayedRef = useRef(displayed);
  useEffect(() => {
    if (prevDisplayedRef.current !== displayed) {
      logCutDebug(`[${shortLayerTag(trackRef)}] displayed: ${prevDisplayedRef.current} -> ${displayed}`);
      prevDisplayedRef.current = displayed;
    }
  }, [displayed, trackRef]);

  return (
    <div
      // Fix (a2) -- how ShotVideo's freeze-frame snapshot finds the
      // currently-displayed layer's <video> element without threading a
      // second ref out of every layer.
      data-layer-key={layerKey}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        opacity: displayed ? 1 : 0,
        transition: instant ? 'none' : `opacity ${CAMERA_CHANGE_FADE_MS}ms ease`,
      }}
    >
      <ShotTransformFrame trackRef={trackRef} command={command} placeholder={placeholder} videoRef={videoRef} aspect={aspect} transformElRef={transformElRef} />
    </div>
  );
}

// Renders whichever track is "active" for a slot, from a POOL of
// persistent layers -- one per candidate track (fourth round, see module
// comment), not one per cut. `candidates` is the full set of tracks
// currently eligible for this slot (contestant's own camera + whichever
// camfeed devices are publishing); `activeTrackRef` is which one the
// director has chosen right now. A layer is created when a track becomes
// a candidate and removed only when it stops being one (participant
// disconnects/unpublishes) -- a cut never touches this pool, it only
// changes which existing, already-painting layer is active/displayed.
// `displayedKey` is deliberately separate state from `activeKey`: the
// swap is timed off the newly-active layer's own onActiveReady signal
// (see ShotFadeLayer), not immediate, so the outgoing layer keeps
// showing its last-correct frame at full opacity until the incoming one
// has confirmed it's ready to take over -- same reasoning the old
// append-then-remove-after-delay design relied on, just applied to a
// toggle instead of a mount/unmount. Only the active layer ever receives
// the live `command` -- an inactive layer is frozen at whatever
// transform it last had (or untransformed, if it's never been active).
// `onReselect` (fix a3) is optional and observation-only -- EgressPage
// passes it so a recording's timeline shows what the RECORDER saw at the
// moment a track changed under it. Live viewers don't pass it.
// `activeImpaired` (Test 4 ruling) -- the caller has deliberately
// selected a feed that is currently dead. The answer is ONE stable
// resolution: hold the frozen frame with the lost treatment until the
// artist cuts away or the camera revives. Explicitly NOT a re-pick --
// silently substituting a live camera is the oscillation this replaces.
export function ShotVideo({ candidates, activeTrackRef, command, placeholder, onReselect, lostOverlay, activeImpaired, showEnded }) {
  const candidateKeysSignature = candidates.map(trackKey).join('|');

  const [layerTracks, setLayerTracks] = useState(() => {
    const m = new Map();
    candidates.forEach((t) => m.set(trackKey(t), t));
    return m;
  });

  // Which layer keys are b-roll. Recorded WHILE the track is present,
  // because the orphan rescue below runs at the moment a track has left
  // the pool -- by then the trackRef is gone and there is nothing to ask.
  //
  // A Set of strings, bounded by the tracks one show ever sees (a
  // handful), and pruned to the live pool whenever it outgrows it.
  const brollLayerKeysRef = useRef(new Set());

  useEffect(() => {
    setLayerTracks((prev) => {
      let changed = prev.size !== candidates.length;
      const next = new Map();
      candidates.forEach((t) => {
        const k = trackKey(t);
        next.set(k, t);
        if (isBrollTrack(t)) brollLayerKeysRef.current.add(k);
        if (!prev.has(k)) changed = true;
      });
      if (brollLayerKeysRef.current.size > 32) {
        brollLayerKeysRef.current = new Set(
          [...brollLayerKeysRef.current].filter((k) => next.has(k))
        );
      }
      // REMOVED (Finding 1/2): the previous round kept the outgoing layer
      // mounted when the pool would go empty, as a best-effort way to
      // hold its last frame. Two things were wrong with it. It FAILED its
      // device test -- a torn-down track clears the element, so the
      // result was a dark blank, not a held frame (Finding 2). And it
      // kept dead tracks in the pool indefinitely, which fed the
      // promotion flapping (Finding 1) by leaving a corpse permanently
      // eligible. The real freeze-frame below replaces it: the last frame
      // is captured to a canvas WHILE the track is alive, so nothing
      // needs to stay mounted after it dies.
      if (changed) {
        logCutDebug(`[ShotVideo] candidate pool -> ${next.size} track(s): ${Array.from(next.keys()).join(', ') || '(none)'}`);
      }
      return changed ? next : prev;
    });
    // candidateKeysSignature (not `candidates` itself) is the real
    // dependency -- tracksForSlot() returns a fresh array every render,
    // so depending on the array reference would re-run this every
    // render; the joined-keys string only changes when the candidate SET
    // actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKeysSignature]);

  const activeKey = trackKey(activeTrackRef);
  const instant = command?.transition === 'cut';
  const instantRef = useRef(instant);
  instantRef.current = instant;

  // Which layer is CURRENTLY at opacity 1 -- starts at null (not
  // activeKey) so even the very first-ever reveal for this slot goes
  // through the same gated handoff below, rather than an ungated initial
  // value that could show opacity 1 before anything has actually
  // painted.
  const [displayedKey, setDisplayedKey] = useState(null);
  const pendingSwapTimerRef = useRef(null);

  useEffect(() => () => {
    if (pendingSwapTimerRef.current) clearTimeout(pendingSwapTimerRef.current);
  }, []);

  // Stable across renders (uses instantRef, not `instant`, directly) so
  // it's safe to pass the SAME function reference to every layer --
  // ShotFadeLayer's own effect depends on this prop, and a fresh
  // reference every render would re-fire that effect (and re-schedule
  // this timer) on every unrelated parent re-render, not just real
  // isActive/ready transitions.
  const handleActiveReady = useCallback((key) => {
    if (pendingSwapTimerRef.current) clearTimeout(pendingSwapTimerRef.current);
    const delay = instantRef.current ? 0 : CAMERA_CHANGE_FADE_MS;
    logCutDebug(`[ShotVideo] ${key} ready, displaying in ${delay}ms`);
    pendingSwapTimerRef.current = setTimeout(() => {
      pendingSwapTimerRef.current = null;
      logCutDebug(`[ShotVideo] DISPLAYED -> ${key}`);
      setDisplayedKey(key);
    }, delay);
  }, []);

  // ─── Fix (a1): rescue an ORPHANED displayedKey ──────────────────
  // THE blank-render bug. Every layer renders at opacity 0 unless its key
  // === displayedKey, so if the displayed track leaves the pool -- a
  // republish after a publish-recovery, a camera being unplugged, or a
  // whole participant being replaced with a new identity -- displayedKey
  // points at a layer that no longer exists and NOTHING is at opacity 1.
  // Healthy tracks stay mounted and painting, invisibly, behind a blank
  // frame. That is what put the recovery hole inside the recordings.
  //
  // Promote immediately rather than waiting for the normal gated handoff:
  // the handoff exists to avoid cutting to a layer before it has painted,
  // but there is nothing to protect here -- the alternative is not a
  // slightly-early picture, it is no picture at all.
  //
  // Promoting to `activeKey` first inherits the CALLER's preference order
  // (renderSlot resolves targetIdentity -> the slot's own performer ->
  // first available), so "performer main > any live camfeed" lives in one
  // place and is not duplicated into this generic component.
  useEffect(() => {
    // Test 4 ruling -- do NOT rescue away from a deliberately-selected
    // dead feed. The orphan rescue exists for a displayed track that
    // vanished on its own; promoting here would re-introduce exactly the
    // dead-frame/live-camera oscillation this ruling outlaws.
    if (activeImpaired) return;
    if (displayedKey === null || layerTracks.has(displayedKey)) return;
    const fallbackKey = layerTracks.has(activeKey)
      ? activeKey
      : layerTracks.keys().next().value ?? null;
    if (fallbackKey == null) return; // pool is empty; the hold-last-frame guard above owns this case
    if (pendingSwapTimerRef.current) {
      clearTimeout(pendingSwapTimerRef.current);
      pendingSwapTimerRef.current = null;
    }

    // ── AN ENDING CLIP IS NOT AN ORPHANED TRACK ──────────────────
    // The promotion below still happens -- something has to be shown --
    // but it is NOT reported through onReselect.
    //
    // onReselect means "a track vanished underneath the shot that was
    // pointing at it", and the recorder logs every one as
    // `egress_reselect` precisely so an unexplained substitution in a
    // recording can be traced. A b-roll clip reaching its end is the
    // opposite of unexplained: it is the entire expected outcome of
    // playing one, and the director's return cut is already on its way.
    // Reporting it would put a line that means "something went wrong"
    // into the timeline of something going exactly right.
    //
    // This ALSO makes the behaviour deterministic rather than
    // timing-dependent. LiveDemo cuts away 500ms before unpublishing, so
    // in the normal case this effect never fires for b-roll at all --
    // the displayed layer has already moved. This covers the case where
    // a client applies the cut late, which is exactly when a spurious
    // reselect would have been logged and believed.
    const wasBroll = brollLayerKeysRef.current.has(displayedKey);
    logCutDebug(`[ShotVideo] displayed layer ${displayedKey} left the pool -> promoting ${fallbackKey}${wasBroll ? ' (b-roll clip ended -- expected)' : ''}`);
    if (!wasBroll) {
      onReselect?.({ reason: 'displayed_track_gone', from: displayedKey, to: fallbackKey });
    }
    setDisplayedKey(fallbackKey);
  }, [displayedKey, layerTracks, activeKey, onReselect, activeImpaired]);

  // ─── Fix (a2): real freeze-frame ────────────────────────────────
  // Snapshot the displayed layer to a canvas on a slow interval WHILE it
  // is alive. This has to be continuous: at the moment a track dies the
  // element has already been cleared, so there is nothing left to read
  // then -- which is exactly why the previous best-effort hold rendered
  // a dark blank instead of a held frame.
  //
  // 1Hz at full capture resolution is cheap (one drawImage per second)
  // and keeps the frozen frame sharp enough to sit in a recording.
  const containerRef = useRef(null);
  const frozenCanvasRef = useRef(null);
  const hasFrozenFrameRef = useRef(false);
  const [showFrozen, setShowFrozen] = useState(false);

  useEffect(() => {
    if (displayedKey === null || showEnded) return undefined;
    const id = setInterval(() => {
      const container = containerRef.current;
      const canvas = frozenCanvasRef.current;
      if (!container || !canvas) return;
      const layerEl = container.querySelector(`[data-layer-key="${CSS.escape(displayedKey)}"] video`);
      if (!layerEl || layerEl.readyState < 2 || !layerEl.videoWidth) return;
      if (canvas.width !== layerEl.videoWidth || canvas.height !== layerEl.videoHeight) {
        canvas.width = layerEl.videoWidth;
        canvas.height = layerEl.videoHeight;
      }
      try {
        canvas.getContext('2d')?.drawImage(layerEl, 0, 0, canvas.width, canvas.height);
        hasFrozenFrameRef.current = true;
      } catch {
        // drawImage can throw on a torn-down element mid-teardown --
        // never let a snapshot attempt break rendering.
      }
    }, 1000);
    return () => clearInterval(id);
  }, [displayedKey, showEnded]);

  // Show the frozen frame exactly when there is nothing live left to
  // show. With a fallback available the orphan-rescue above promotes it
  // instead -- freeze is the documented last resort, after "performer
  // main > any live camfeed".
  useEffect(() => {
    // Two ways to end up on the frozen frame, and they are different
    // situations: nothing live is left to show at all, OR the caller has
    // deliberately selected a feed that is currently dead (Test 4).
    //
    // Round C -- but NEVER once the show has ended. A frozen last frame
    // of a performer is a live-show affordance ("this feed dropped, hold
    // the picture"); after End Show it is just the performance still
    // sitting on screen when the ended state should own it.
    setShowFrozen(
      !showEnded && hasFrozenFrameRef.current && (layerTracks.size === 0 || !!activeImpaired)
    );
  }, [layerTracks, activeImpaired, showEnded]);

  // Nothing has ever painted for this slot -- a genuinely blank start,
  // where the placeholder is the right answer.
  if (layerTracks.size === 0 && !hasFrozenFrameRef.current) return placeholder;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Always mounted so the snapshot target exists before it is
          needed; only visible once every live layer is gone. */}
      <canvas
        ref={frozenCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: showFrozen ? 2 : -1,
          opacity: showFrozen ? 1 : 0,
        }}
      />
      {/* lostOverlay is passed by LIVE surfaces only. The egress template
          passes nothing and gets the bare frozen frame: readable status
          text baked into the footage is precisely what that template
          exists to exclude (see CLEAN_PLACEHOLDER in EgressPage.jsx). */}
      {showFrozen && lostOverlay ? (
        <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>{lostOverlay}</div>
      ) : null}
      {Array.from(layerTracks.entries()).map(([key, tRef]) => (
        <ShotFadeLayer
          key={key}
          layerKey={key}
          trackRef={tRef}
          command={key === activeKey ? command : null}
          placeholder={placeholder}
          instant={instant}
          displayed={key === displayedKey}
          zIndex={key === activeKey ? 1 : 0}
          onActiveReady={handleActiveReady}
        />
      ))}
    </div>
  );
}
