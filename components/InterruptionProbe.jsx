'use client';

// components/InterruptionProbe.jsx
// ─────────────────────────────────────────────────────────────
// The interruption probe. Round-3 groundwork: it measures what a handset
// does to a live capture when the OS interrupts it, so the interruption
// spec can be designed against evidence instead of an assumption about
// iOS. See docs/INTERRUPTION_FEASIBILITY.md for what each result means.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Observability, Real-time media
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────
// It does not connect to LiveKit, join a room, need a show, or need an
// account. That is not laziness about realism — it is the measurement.
// Publishing puts a reconnect layer, a signalling channel and a server's
// own opinion between the interruption and the evidence, and every one of
// those has its own recovery behaviour that would have to be subtracted
// back out. The question here is narrower and prior to all of it: WHEN
// THE OS INTERRUPTS THIS PAGE, WHAT KEEPS RUNNING?
//
// The consequence, stated so nobody over-reads a run: this measures the
// DEVICE, not the room. What viewers actually saw is a different
// question, answered by health_events during a real show, and one does
// not substitute for the other.
//
// ── THE CAPTURE MATCHES THE SHOW'S ────────────────────────────
// Same audio constraints as lib/audioProcessing.js — echoCancellation,
// noiseSuppression and autoGainControl all off. Not cosmetic: those flags
// change which audio session category the browser asks the OS for, and
// the audio session category is precisely what an incoming call
// negotiates with. A probe that captured with processing on could be
// measuring a different OS-level object than the show uses.
//
// A screen wake lock is held for the same reason: the show holds one, so
// the accidental screen-dim path is suppressed here exactly as it is
// there, and the LOCK step measures a deliberate power-button lock rather
// than an idle timeout.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWakeLock } from '../lib/useWakeLock';
import {
  probeRecord,
  probePersist,
  probeRestore,
  probeRows,
  probeClear,
  probeCsv,
  probeSummary,
  probeStorageUsable,
  describeGap,
} from '../lib/interruptionProbe';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

const HEARTBEAT_MS = 500;

// The script. Ordered so the cheap, repeatable steps come first and the
// one that needs a second person is not the thing that fails last.
//
// Each step is a CAPABILITY question, and the label says which — the
// operator should be able to run this without having read the spec.
const STEPS = [
  { key: 'baseline', label: 'Baseline', instruction: 'Do nothing. Hold the phone as if performing. 30 seconds.' },
  { key: 'minimise', label: 'Minimise', instruction: 'Go to the home screen. Wait 30 seconds. Come back.' },
  { key: 'lock', label: 'Lock', instruction: 'Press the power button. Wait 30 seconds. Unlock and come back.' },
  { key: 'call_ring', label: 'Call — ringing', instruction: 'Have someone call you. Let it ring, then DECLINE. Stay on this page.' },
  { key: 'call_answer', label: 'Call — answered', instruction: 'Have someone call you. ANSWER, talk 10 seconds, hang up. Come back.' },
  { key: 'call_outgoing', label: 'Call — outgoing', instruction: 'Call someone. Talk 10 seconds. Hang up. Come back.' },
  { key: 'assistant', label: 'Assistant / alarm', instruction: 'Trigger the voice assistant or let an alarm fire. Dismiss it.' },
  { key: 'other_app_camera', label: 'Camera taken', instruction: 'Open the phone camera app. Wait 10 seconds. Come back.' },
];

function trackSummary(track) {
  if (!track) return 'none';
  return `${track.readyState}/${track.muted ? 'muted' : 'unmuted'}/${track.enabled ? 'enabled' : 'disabled'}`;
}

export default function InterruptionProbe() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [rowCount, setRowCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const [storageOk, setStorageOk] = useState(true);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const bufRef = useRef(null);
  // The current step, read by the heartbeat. A ref because the heartbeat
  // must not be torn down and rebuilt every time the step advances --
  // restarting the interval would reset the very gap measurement the
  // step is there to bracket.
  const stepRef = useRef('');
  const lastTickRef = useRef(0);

  // Held for the whole run, released when the page is left. Same label
  // convention as every other holder so a health capture taken alongside
  // can tell probe rows from show rows.
  const wakeLock = useWakeLock(running, 'interruption_probe');

  // ── READING THE HARDWARE ──────────────────────────────────────
  // One function, called by the heartbeat and by every event listener, so
  // a row written on a visibility change carries exactly the same fields
  // as a row written by a tick. Two shapes of row would mean two ways to
  // read a timeline.
  const sample = useCallback(() => {
    const ctx = audioCtxRef.current;
    const stream = streamRef.current;
    const videoEl = videoRef.current;
    const audioTrack = stream?.getAudioTracks?.()[0] ?? null;
    const videoTrack = stream?.getVideoTracks?.()[0] ?? null;

    let rms = '';
    const analyser = analyserRef.current;
    if (analyser && bufRef.current) {
      analyser.getFloatTimeDomainData(bufRef.current);
      let sum = 0;
      for (let i = 0; i < bufRef.current.length; i++) sum += bufRef.current[i] * bufRef.current[i];
      rms = Math.sqrt(sum / bufRef.current.length).toFixed(6);
    }

    // Cumulative delivered frames. getVideoPlaybackQuality is the
    // standard; webkitDecodedFrameCount is the older name still worth
    // asking for, since an iPhone is the device this probe exists to
    // survive and being unable to count frames there would be the one
    // failure that matters.
    let videoFrames = '';
    if (videoEl) {
      const q = videoEl.getVideoPlaybackQuality?.();
      const n = q?.totalVideoFrames ?? videoEl.webkitDecodedFrameCount;
      if (typeof n === 'number') videoFrames = n;
    }

    return {
      step: stepRef.current,
      audioCtxState: ctx?.state ?? '',
      // Recorded to six decimals: the whole audio verdict is a ratio of
      // this against the wall clock, and rounding it to whole seconds
      // would quantise away short interruptions.
      audioCtxTime: ctx ? ctx.currentTime.toFixed(6) : '',
      audioTrack: trackSummary(audioTrack),
      videoTrack: trackSummary(videoTrack),
      videoFrames,
      rms,
      wakeLock: wakeLock.held ? 'held' : wakeLock.supported ? 'released' : 'unsupported',
    };
  }, [wakeLock.held, wakeLock.supported]);

  const record = useCallback((eventType, detail) => {
    probeRecord(eventType, { ...sample(), ...(detail ? { detail } : {}) });
    setRowCount(probeRows().length);
  }, [sample]);

  // ── START ─────────────────────────────────────────────────────
  // One user gesture, because both getUserMedia and an AudioContext that
  // is allowed to run need one. Everything after this point is passive.
  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Identical to createPilotAudioTrack's — see the header note on
        // why the constraints have to match rather than merely resemble.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: { facingMode: 'user' },
      });
      streamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      // Deliberately NOT connected to ctx.destination: monitoring the mic
      // out of the phone's own speaker during a probe would feed back,
      // and on some platforms an audible output changes how the OS
      // treats the session — which would be the probe altering the thing
      // it is measuring.
      bufRef.current = new Float32Array(analyser.fftSize);
      analyserRef.current = analyser;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // muted + playsInline: an unmuted autoplaying video is refused on
        // mobile, and a video that will not play delivers no frames,
        // which would zero the video measurement for a reason that has
        // nothing to do with any interruption.
        await videoRef.current.play().catch(() => {});
      }

      setStorageOk(probeStorageUsable());
      setRunning(true);
      lastTickRef.current = Date.now();

      // The device fingerprint, recorded once. The existing show captures
      // do not carry one, and working out afterwards that every run so
      // far had been on a MacBook rather than a phone took an inference
      // from a microphone label. Never again.
      probeRecord('probe_started', {
        ...sample(),
        detail: {
          userAgent: navigator.userAgent,
          platform: navigator.platform ?? null,
          screen: typeof window !== 'undefined' ? `${window.screen?.width}x${window.screen?.height}` : null,
          dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null,
          audioSampleRate: ctx.sampleRate,
          videoSettings: stream.getVideoTracks()[0]?.getSettings?.() ?? null,
          storageUsable: probeStorageUsable(),
        },
      });
      setRowCount(probeRows().length);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [sample]);

  const stop = useCallback(() => {
    record('probe_stopped');
    probePersist();
    setRunning(false);
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close?.().catch?.(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setSummary(probeSummary());
  }, [record]);

  // ── THE HEARTBEAT ─────────────────────────────────────────────
  // 2Hz. Its rows are not interesting individually; the GAPS BETWEEN THEM
  // are the measurement. A missing run of ticks is the only direct
  // evidence that the OS suspended this page's JavaScript, and the two
  // counters carried on the rows either side of the gap are what say
  // whether the hardware kept going while it did.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      const gapMs = now - lastTickRef.current;
      lastTickRef.current = now;
      probeRecord('tick', { ...sample(), gapMs });
      setRowCount(probeRows().length);
      // A gap means the page has just come back from somewhere. Persist
      // immediately rather than waiting for the throttle: whatever
      // interrupted it may be about to do so again.
      if (gapMs > 1500) probePersist();
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [running, sample]);

  // ── EVENT CAPTURE ─────────────────────────────────────────────
  useEffect(() => {
    if (!running) return undefined;

    const onVisibility = () => {
      record(document.visibilityState === 'hidden' ? 'visibility_hidden' : 'visibility_visible');
      // Synchronous write-through. On the hidden edge this may be the
      // last line of JavaScript this page gets to run.
      probePersist();
    };
    const onPageHide = () => { record('pagehide'); probePersist(); };
    const onPageShow = () => record('pageshow');
    // Page Lifecycle API — Chromium only today. Where it exists it is the
    // unambiguous answer to "was this page frozen", which everywhere else
    // has to be inferred from a gap in the heartbeat.
    const onFreeze = () => { record('page_freeze'); probePersist(); };
    const onResume = () => record('page_resume');
    const onFocus = () => record('window_focus');
    const onBlur = () => record('window_blur');

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    const ctx = audioCtxRef.current;
    // 'interrupted' is a WebKit-only state and the single most valuable
    // string this probe can capture on an iPhone: it is the platform
    // saying, in its own words, that something took the audio session.
    if (ctx) ctx.onstatechange = () => record('audiocontext_statechange', { state: ctx.state });

    const stream = streamRef.current;
    const listeners = [];
    stream?.getTracks?.().forEach((track) => {
      const kind = track.kind;
      const onMute = () => record(`${kind}_track_mute`);
      const onUnmute = () => record(`${kind}_track_unmute`);
      const onEnded = () => record(`${kind}_track_ended`);
      track.addEventListener('mute', onMute);
      track.addEventListener('unmute', onUnmute);
      track.addEventListener('ended', onEnded);
      listeners.push(() => {
        track.removeEventListener('mute', onMute);
        track.removeEventListener('unmute', onUnmute);
        track.removeEventListener('ended', onEnded);
      });
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      if (ctx) ctx.onstatechange = null;
      listeners.forEach((off) => off());
    };
  }, [running, record]);

  // Restore any earlier run on mount, so closing the tab between steps
  // does not lose the ones already done.
  useEffect(() => {
    const restored = probeRestore();
    if (restored > 0) { setRowCount(restored); setSummary(probeSummary()); }
  }, []);

  const advanceStep = useCallback(() => {
    const next = stepIndex + 1;
    if (next >= STEPS.length) return;
    stepRef.current = STEPS[next].key;
    setStepIndex(next);
    record('step_begin', { step: STEPS[next].key, label: STEPS[next].label });
    probePersist();
  }, [stepIndex, record]);

  const exportCsv = useCallback(() => {
    const blob = new Blob([probeCsv()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interruption-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const copyCsv = useCallback(async () => {
    // The fallback that matters on a phone: a download can land somewhere
    // the operator cannot easily reach, and pasting into a message to
    // themselves always works.
    try { await navigator.clipboard.writeText(probeCsv()); } catch { setError('Clipboard refused — use Download.'); }
  }, []);

  const current = stepIndex >= 0 ? STEPS[stepIndex] : null;
  const next = STEPS[stepIndex + 1] ?? null;

  const btn = (bg, color = INK) => ({
    padding: '14px 16px', borderRadius: 10, border: 'none', background: bg, color,
    fontWeight: 700, fontSize: 15, width: '100%',
  });

  return (
    <div style={{ minHeight: '100vh', background: INK, color: PORCELAIN, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: TEAL, textTransform: 'uppercase' }}>Instrument</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>Interruption probe</h1>
        <p style={{ fontSize: 13, color: 'rgba(253,255,252,0.6)', margin: '6px 0 0', lineHeight: 1.5 }}>
          Measures what this handset does to a live capture when the OS interrupts it.
          Nothing is published and nothing is sent anywhere — the log stays on this device
          until you export it.
        </p>
      </div>

      {/* Kept on screen and non-trivially sized on purpose: a video
          element that is hidden or zero-area may stop being decoded,
          which would zero the frame counter for a reason that has
          nothing to do with an interruption. */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ width: '100%', maxWidth: 240, aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 10, background: '#000', alignSelf: 'center' }}
      />

      {error && (
        <div style={{ background: 'rgba(231,29,54,0.15)', border: `1px solid ${RED}`, borderRadius: 8, padding: 10, fontSize: 13 }}>{error}</div>
      )}

      {!storageOk && running && (
        <div style={{ background: 'rgba(231,29,54,0.15)', border: `1px solid ${RED}`, borderRadius: 8, padding: 10, fontSize: 13 }}>
          This browser will not let the page save to local storage. The run is still being
          recorded in memory, but if the OS discards the tab it will be lost. Export before
          the last step rather than after it.
        </div>
      )}

      {!running ? (
        <button type="button" onClick={start} style={btn(TEAL)}>
          {rowCount > 0 ? 'Start a new capture' : 'Start — allow camera and mic'}
        </button>
      ) : (
        <>
          <div style={{ background: 'rgba(253,255,252,0.06)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: 'rgba(253,255,252,0.5)', textTransform: 'uppercase' }}>
              {current ? `Step ${stepIndex + 1} of ${STEPS.length}` : 'Not started'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{current ? current.label : 'Tap below to begin the script'}</div>
            <div style={{ fontSize: 14, color: 'rgba(253,255,252,0.75)', marginTop: 6, lineHeight: 1.5 }}>
              {current ? current.instruction : 'Each step is bracketed in the log, so the steps can be read apart afterwards.'}
            </div>
          </div>

          <button type="button" onClick={advanceStep} disabled={!next} style={{ ...btn(next ? TEAL : 'rgba(253,255,252,0.15)', next ? INK : PORCELAIN), opacity: next ? 1 : 0.6 }}>
            {next ? `Begin: ${next.label}` : 'Script complete'}
          </button>

          <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'rgba(253,255,252,0.6)' }}>
            <span>{rowCount} rows</span>
            <span>·</span>
            <span>wake lock {wakeLock.held ? 'held' : wakeLock.supported ? 'released' : 'unsupported'}</span>
          </div>

          <button type="button" onClick={stop} style={btn('rgba(253,255,252,0.15)', PORCELAIN)}>Stop and summarise</button>
        </>
      )}

      {summary && summary.gaps.length > 0 && (
        <div style={{ background: 'rgba(253,255,252,0.06)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', color: TEAL, textTransform: 'uppercase' }}>What the gaps showed</div>
          <div style={{ fontSize: 12, color: 'rgba(253,255,252,0.55)', margin: '6px 0 10px', lineHeight: 1.5 }}>
            Each line is a window where this page stopped running. What matters is whether the
            audio clock and the camera kept going while it was away.
          </div>
          {summary.gaps.map((g, i) => (
            <div key={i} style={{ fontSize: 13, padding: '8px 0', borderTop: i ? '1px solid rgba(253,255,252,0.1)' : 'none' }}>
              <div style={{ fontWeight: 700 }}>{g.step || '(no step marked)'}</div>
              <div style={{ color: 'rgba(253,255,252,0.75)' }}>{describeGap(g)}</div>
              <div style={{ color: 'rgba(253,255,252,0.5)', fontSize: 12 }}>
                on return: context {g.resumedAudioCtxState || '?'} · audio {g.resumedAudioTrack} · video {g.resumedVideoTrack}
              </div>
            </div>
          ))}
        </div>
      )}

      {rowCount > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" onClick={exportCsv} style={btn(TEAL)}>Download CSV ({rowCount} rows)</button>
          <button type="button" onClick={copyCsv} style={btn('rgba(253,255,252,0.15)', PORCELAIN)}>Copy CSV to clipboard</button>
          <button
            type="button"
            onClick={() => { probeClear(); setRowCount(0); setSummary(null); setStepIndex(-1); stepRef.current = ''; }}
            style={{ ...btn('transparent', 'rgba(253,255,252,0.6)'), border: '1px solid rgba(253,255,252,0.2)' }}
          >
            Clear this capture
          </button>
        </div>
      )}
    </div>
  );
}
