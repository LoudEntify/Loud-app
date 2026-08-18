'use client';

import { useEffect, useRef } from 'react';

// Desktop portrait stage -- ambient blur-fill for the space either side
// of the centred 9:16 stage (see reactions.css's .blur-fill-background
// rules and the .stage-root override next to it). Display-only: this
// component never touches capture, publishing, or anything in the
// egress path -- it only ever READS an already-subscribed track's
// existing MediaStreamTrack and hands it to a second, muted <video>
// element purely for local rendering.
//
// Attaching one MediaStreamTrack to a second <video> element is free in
// WebRTC -- no new subscription, no extra bandwidth, confirmed against
// how VideoTrack (@livekit/components-react, used by every other video
// element in this app) does the same thing internally: it's just
// `videoEl.srcObject = stream`, and a stream can back as many <video>
// elements as you want simultaneously. Built as a plain MediaStream
// wrapper here (not the library's VideoTrack) since this element is
// intentionally NOT one of the tracked/attached elements the shot-cut
// timing system (ShotRendering.jsx) manages -- it has no reveal-gate, no
// crop/transform, nothing to coordinate with a cut; it only ever needs
// to show *something* representative, blurred past the point where
// timing precision matters.
export default function BlurFillBackground({ trackRef }) {
  const videoElRef = useRef(null);

  const mediaStreamTrack = trackRef?.publication?.track?.mediaStreamTrack ?? null;
  // Keying the effect on the underlying MediaStreamTrack's own id (not
  // trackRef itself, a fresh object reference every render) so this only
  // re-attaches when the ACTUAL track backing the centre stage changes
  // (a real camera/shot switch), not on every unrelated re-render.
  const mediaStreamTrackId = mediaStreamTrack?.id ?? null;

  useEffect(() => {
    const videoEl = videoElRef.current;
    if (!videoEl || !mediaStreamTrack) return undefined;
    const stream = new MediaStream([mediaStreamTrack]);
    videoEl.srcObject = stream;
    videoEl.play?.().catch(() => {
      // Autoplay can be blocked before a user gesture on some browsers --
      // this is a silent, muted, purely decorative background, so a
      // blocked play() is a no-op (still shows the placeholder fill
      // color), never worth surfacing.
    });
    return () => {
      videoEl.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaStreamTrackId]);

  return (
    <div className="blur-fill-background" aria-hidden="true">
      <video ref={videoElRef} muted autoPlay playsInline />
    </div>
  );
}
