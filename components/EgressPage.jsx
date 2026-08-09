'use client';

// components/EgressPage.jsx
// ─────────────────────────────────────────────────────────────
// Stage 4 -- headless template for LiveKit Room Composite Egress
// (customBaseUrl), replacing the stock grid layout. Renders the SAME
// directed view a real viewer sees -- solo's single directed shot, or
// versus's even split -- with NO UI chrome (no menu, deck, comments,
// badges), so the recorded file is a clean capture of just the
// performance.
//
// Reuses the live app's own rendering almost entirely, deliberately:
// ShotVideo/ShotFadeLayer/ShotTransformFrame (components/
// ShotRendering.jsx) and VersusSplit are the EXACT same components a
// real viewer's screen renders through -- same crop/cut/reveal logic,
// same portrait-crop-aware output, same "no active shot yet -> fall
// back to the performer's own untransformed camera" default (confirmed
// directly in ShotTransformFrame: command=null/undefined short-circuits
// before any transform is ever applied, so a fresh render with nothing
// chosen yet already shows the raw feed, not black -- no special-casing
// needed here for that). What's new is small: this page shell, and a
// minimal SHOT_COMMAND replay (the one data-channel message type that
// matters here; none of the mic/lifecycle/audio-processing machinery
// RoomInner also owns).
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

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiveKitRoom, RoomAudioRenderer, useTracks, useDataChannel } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import VersusSplit from './VersusSplit';
import { ShotVideo } from './ShotRendering';

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
function tracksForSlot(tracks, letter) {
  return tracks.filter(
    (t) =>
      (t.participant.identity.startsWith(`contestant-${letter}-`) ||
        t.participant.identity.startsWith(`camfeed-${letter}-`)) &&
      !t.publication?.isMuted
  );
}

// Connected-room view -- mirrors RoomInner's own renderSlot/ShotVideo
// call pattern (LiveDemo.jsx) as closely as possible, minus everything
// that isn't the video layer itself.
function EgressStage({ layout }) {
  const tracks = useTracks([Track.Source.Camera]);
  const [activeShot, setActiveShot] = useState({});
  const signaledRef = useRef(false);

  // The one data-channel message type this page needs -- the artist
  // device already broadcasts SHOT_COMMANDs to every participant in the
  // room in real time (lib/shotCommands.js's broadcastShotCommand); this
  // headless browser just needs to be another listener, same as any
  // real viewer, for the recording to follow the exact same directed
  // cuts in sync.
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

  const renderSlot = (letter) => () => {
    const candidates = tracksForSlot(tracks, letter);
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
    const matched = cmd?.targetIdentity
      ? candidates.find((t) => t.participant.identity === cmd.targetIdentity)
      : undefined;
    const chosen =
      matched ||
      candidates.find((t) => t.participant.identity.startsWith(`contestant-${letter}-`)) ||
      candidates[0];

    return (
      <ShotVideo
        candidates={candidates}
        activeTrackRef={chosen}
        command={cmd ?? null}
        placeholder={CLEAN_PLACEHOLDER}
      />
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: '#011627', overflow: 'hidden' }}>
      <VersusSplit
        mode={layout === 'versus' ? 'versus' : 'solo'}
        renderA={renderSlot('a')}
        renderB={renderSlot('b')}
      />
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
