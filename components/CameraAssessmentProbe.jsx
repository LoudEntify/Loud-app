'use client';

import { useEffect, useRef } from 'react';
import { createVisualAssessmentService } from '../lib/visualAssessmentService';
import { sourceKey } from '../lib/trackSources';
import { logHealthEvent } from '../lib/healthLog';

const ENABLED = process.env.NEXT_PUBLIC_EXP_VD_001_ENABLED === 'true';

function ObservedCamera({ trackRef, service }) {
  const videoRef = useRef(null);
  const key = sourceKey(trackRef);
  useEffect(() => {
    const video = videoRef.current;
    const track = trackRef?.publication?.track;
    if (!video || !track || !key) return undefined;
    try { track.attach(video); video.muted = true; video.play().catch(() => {}); service.observe(key, video); } catch { /* unavailable is reported by service */ }
    return () => { service.unobserve(key); try { track.detach(video); } catch { /* already detached */ } };
  }, [trackRef, key, service]);
  return <video ref={videoRef} muted playsInline aria-hidden="true" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -10, top: -10 }} />;
}

export default function CameraAssessmentProbe({ trackRefs = [] }) {
  const serviceRef = useRef(null);
  if (ENABLED && !serviceRef.current && typeof window !== 'undefined') {
    serviceRef.current = createVisualAssessmentService({ onFeature(feature) { logHealthEvent('visual_camera_assessment', feature); window.dispatchEvent(new CustomEvent('loudentify:camera-feature', { detail: feature })); } });
  }
  useEffect(() => () => serviceRef.current?.stop(), []);
  if (!ENABLED || !serviceRef.current) return null;
  return <>{trackRefs.map(trackRef => <ObservedCamera key={sourceKey(trackRef)} trackRef={trackRef} service={serviceRef.current} />)}</>;
}
