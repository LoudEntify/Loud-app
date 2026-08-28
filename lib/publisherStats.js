'use client';

// lib/publisherStats.js
// ─────────────────────────────────────────────────────────────
// TASK 5 — FREEZE INSTRUMENTATION. INSTRUMENT ONLY, FIX NOTHING.
//
// PRD: Live Show / reliability    S&I: Observability, Real-time media
//
// ── THE STANDING RULE THIS SERVES ─────────────────────────────
// Instrument before fixing. There are intermittent freezes on a 120Mbps
// connection and the cause is not known. A 120Mbps *downlink* says
// almost nothing about the *uplink*, and nothing at all about whether
// the encoder is keeping up — so the hypotheses worth distinguishing
// are:
//
//   A. UPLINK STARVATION — available outgoing bitrate collapses;
//      bytes actually sent fall with it.
//   B. ENCODER PRESSURE — the CPU cannot encode fast enough;
//      qualityLimitationReason goes to 'cpu' and framesEncoded stalls
//      while the capture keeps producing frames.
//   C. SEND-SIDE DROP — frames are encoded but not sent (framesEncoded
//      climbing, framesSent flat). A different fault from B entirely.
//   D. LAYER THRASH — simulcast flipping between layers, so a viewer
//      sees resolution lurch or stall at each switch.
//   E. TRACK-LEVEL — a mute, unmute or restart nobody noticed.
//
// Each leaves a different signature, and this file records all five
// without deciding between them. NOTHING HERE CHANGES ENCODER SETTINGS,
// SIMULCAST CONFIGURATION OR RESOLUTION — it only reads and reports.
//
// ── WHY RAW getStats() AND NOT LiveKit's WRAPPER ──────────────
// livekit-client's `getSenderStats()` surfaces `framesSent` and
// `qualityLimitationReason` but not `framesEncoded`, `qpSum`,
// `qualityLimitationDurations` or `availableOutgoingBitrate` (checked
// against the installed build). Hypotheses B and C are only separable
// with framesEncoded, and A needs availableOutgoingBitrate — so this
// reads the RTCStatsReport directly from the sender and picks fields out
// by `type`, defensively, because the exact set varies by browser.
//
// ── COST, STATED ──────────────────────────────────────────────
// One sample every 2s per publishing client. Each sample is one
// health_events row of a few hundred bytes. A 60-minute show is ~1,800
// rows per publisher. That is a lot for a permanent default and exactly
// right for a diagnostic, so it is OFF unless switched on — see
// FREEZE_INSTRUMENTATION_ENABLED below.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from './healthLog';

// 2 seconds. Fast enough to catch a freeze that lasts a few seconds
// (which is what is being reported), slow enough that the sampling is
// not itself a CPU cost on a device already suspected of being CPU-bound
// — an instrument that changes what it measures is worse than none.
export const SAMPLE_INTERVAL_MS = 2000;

// Deliberately a constant, not an env var: this is a diagnostic that
// should be turned on for a session and turned off again, and a
// deployment-wide flag makes "is it on right now?" a question nobody can
// answer from the code. Flip it, deploy, capture, flip it back.
export const FREEZE_INSTRUMENTATION_ENABLED = true;

/** Pull one flat snapshot out of an RTCStatsReport. */
function readReport(report) {
  const snap = {
    // outbound video
    bytesSent: null, framesEncoded: null, framesSent: null, framesPerSecond: null,
    qualityLimitationReason: null, qualityLimitationDurations: null,
    targetBitrate: null, qpSum: null, rid: null, scalabilityMode: null,
    frameWidth: null, frameHeight: null, encoderImplementation: null,
    keyFramesEncoded: null, retransmittedBytesSent: null, nackCount: null, pliCount: null, firCount: null,
    // transport
    availableOutgoingBitrate: null, currentRoundTripTime: null,
    // remote's view of us
    packetsLost: null, jitter: null,
    // capture source
    sourceFramesPerSecond: null, sourceWidth: null, sourceHeight: null,
    // every simulcast layer seen this sample, so a switch is visible
    layers: [],
  };

  report.forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      snap.layers.push({
        rid: s.rid ?? null,
        bytesSent: s.bytesSent ?? null,
        framesEncoded: s.framesEncoded ?? null,
        framesSent: s.framesSent ?? null,
        fps: s.framesPerSecond ?? null,
        w: s.frameWidth ?? null,
        h: s.frameHeight ?? null,
        active: s.active ?? null,
        qpSum: s.qpSum ?? null,
      });
      // The highest-bytes layer is the one carrying the picture; report
      // it as the headline so a CSV column means one thing.
      if (snap.bytesSent === null || (s.bytesSent ?? 0) > snap.bytesSent) {
        snap.bytesSent = s.bytesSent ?? null;
        snap.framesEncoded = s.framesEncoded ?? null;
        snap.framesSent = s.framesSent ?? null;
        snap.framesPerSecond = s.framesPerSecond ?? null;
        snap.qualityLimitationReason = s.qualityLimitationReason ?? null;
        snap.qualityLimitationDurations = s.qualityLimitationDurations ?? null;
        snap.targetBitrate = s.targetBitrate ?? null;
        snap.qpSum = s.qpSum ?? null;
        snap.rid = s.rid ?? null;
        snap.scalabilityMode = s.scalabilityMode ?? null;
        snap.frameWidth = s.frameWidth ?? null;
        snap.frameHeight = s.frameHeight ?? null;
        snap.encoderImplementation = s.encoderImplementation ?? null;
        snap.keyFramesEncoded = s.keyFramesEncoded ?? null;
        snap.retransmittedBytesSent = s.retransmittedBytesSent ?? null;
        snap.nackCount = s.nackCount ?? null;
        snap.pliCount = s.pliCount ?? null;
        snap.firCount = s.firCount ?? null;
      }
    } else if (s.type === 'candidate-pair' && (s.state === 'succeeded' || s.nominated)) {
      // HYPOTHESIS A lives or dies on this number.
      if (s.availableOutgoingBitrate != null) snap.availableOutgoingBitrate = s.availableOutgoingBitrate;
      if (s.currentRoundTripTime != null) snap.currentRoundTripTime = s.currentRoundTripTime;
    } else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
      snap.packetsLost = s.packetsLost ?? null;
      snap.jitter = s.jitter ?? null;
    } else if (s.type === 'media-source' && s.kind === 'video') {
      // What the CAMERA is producing, versus what the encoder managed.
      // The gap between these two is hypothesis B, stated numerically.
      snap.sourceFramesPerSecond = s.framesPerSecond ?? null;
      snap.sourceWidth = s.width ?? null;
      snap.sourceHeight = s.height ?? null;
    }
  });

  return snap;
}

/** Which simulcast layers are actually carrying bytes right now. */
function activeLayerKey(layers, prevByRid) {
  const active = layers
    .filter((l) => {
      const prev = prevByRid?.[l.rid ?? '_'];
      // "Active" means bytes moved since the last sample. `active` alone
      // is unreliable across browsers, and a layer can be marked active
      // while sending nothing.
      return prev != null && (l.bytesSent ?? 0) > prev;
    })
    .map((l) => l.rid ?? '_')
    .sort();
  return active.join('+');
}

/**
 * Sample the publisher's send-side stats into health_events.
 *
 * Read-only. Never throws into the show path: every failure is swallowed
 * and the next sample tries again, because a diagnostic that can break a
 * broadcast is not a diagnostic anyone will leave switched on.
 */
export function usePublisherStats(room, { enabled = true, label = 'publisher' } = {}) {
  const prevRef = useRef({ at: 0, bytesSent: null, framesEncoded: null, framesSent: null, qpSum: null, byRid: {}, layerKey: null, limitation: null });

  useEffect(() => {
    if (!room || !enabled || !FREEZE_INSTRUMENTATION_ENABLED) return undefined;

    let cancelled = false;
    let sampling = false;

    // ── E: track-level events ────────────────────────────────────
    // Cheap, discrete, and the first thing to rule in or out. A freeze
    // that lines up exactly with a mute is not a network problem.
    const onLocalMuted = (pub) => logHealthEvent('pub_track_muted', { source: pub?.source ?? null, sid: pub?.trackSid ?? null });
    const onLocalUnmuted = (pub) => logHealthEvent('pub_track_unmuted', { source: pub?.source ?? null, sid: pub?.trackSid ?? null });
    const onPublished = (pub) => logHealthEvent('pub_track_published', { source: pub?.source ?? null, sid: pub?.trackSid ?? null });
    const onUnpublished = (pub) => logHealthEvent('pub_track_unpublished', { source: pub?.source ?? null, sid: pub?.trackSid ?? null });
    const onQuality = (q) => logHealthEvent('pub_connection_quality', { quality: String(q ?? '') });
    const onReconnecting = () => logHealthEvent('pub_reconnecting', {});
    const onReconnected = () => logHealthEvent('pub_reconnected', {});

    room.localParticipant?.on?.('trackMuted', onLocalMuted);
    room.localParticipant?.on?.('trackUnmuted', onLocalUnmuted);
    room.localParticipant?.on?.('localTrackPublished', onPublished);
    room.localParticipant?.on?.('localTrackUnpublished', onUnpublished);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    const onQualityChanged = (quality, participant) => {
      if (participant?.isLocal) onQuality(quality);
    };
    room.on(RoomEvent.ConnectionQualityChanged, onQualityChanged);

    async function sample() {
      if (sampling || cancelled) return;
      sampling = true;
      try {
        const pub = Array.from(room.localParticipant?.videoTrackPublications?.values?.() || [])
          .find((p) => p.track?.sender);
        const sender = pub?.track?.sender;
        if (!sender?.getStats) return;

        const report = await sender.getStats();
        if (cancelled) return;
        const snap = readReport(report);

        const now = Date.now();
        const prev = prevRef.current;
        const dtSec = prev.at ? (now - prev.at) / 1000 : null;

        // ── A: what we ACTUALLY sent, versus what we were allowed to ──
        const uplinkBps =
          dtSec && prev.bytesSent != null && snap.bytesSent != null && snap.bytesSent >= prev.bytesSent
            ? Math.round(((snap.bytesSent - prev.bytesSent) * 8) / dtSec)
            : null;

        // ── B vs C: encoded and sent are counted separately on purpose ──
        const encodedDelta =
          prev.framesEncoded != null && snap.framesEncoded != null && snap.framesEncoded >= prev.framesEncoded
            ? snap.framesEncoded - prev.framesEncoded : null;
        const sentDelta =
          prev.framesSent != null && snap.framesSent != null && snap.framesSent >= prev.framesSent
            ? snap.framesSent - prev.framesSent : null;

        // Average QP over the interval — the encoder's own account of how
        // hard it is working. Rising QP with flat bitrate is pressure;
        // rising QP with falling bitrate is starvation.
        const qpDelta =
          prev.qpSum != null && snap.qpSum != null && snap.qpSum >= prev.qpSum ? snap.qpSum - prev.qpSum : null;
        const avgQp = qpDelta != null && encodedDelta ? +(qpDelta / encodedDelta).toFixed(2) : null;

        // ── D: layer switches, with the reason attached ──────────────
        const byRid = {};
        snap.layers.forEach((l) => { byRid[l.rid ?? '_'] = l.bytesSent ?? 0; });
        const layerKey = activeLayerKey(snap.layers, prev.byRid);
        if (prev.layerKey !== null && layerKey && layerKey !== prev.layerKey) {
          logHealthEvent('pub_simulcast_switch', {
            from: prev.layerKey,
            to: layerKey,
            // The reason is the encoder's own, not our guess. 'cpu',
            // 'bandwidth', 'none' or 'other'.
            reason: snap.qualityLimitationReason ?? 'unknown',
            availableOutgoingBitrate: snap.availableOutgoingBitrate,
            uplinkBps,
          });
        }
        // A limitation reason CHANGING is worth its own row even without
        // a layer switch — it is the earliest warning of B.
        if (prev.limitation !== null && snap.qualityLimitationReason && snap.qualityLimitationReason !== prev.limitation) {
          logHealthEvent('pub_quality_limitation_changed', {
            from: prev.limitation,
            to: snap.qualityLimitationReason,
            durations: snap.qualityLimitationDurations ?? null,
            avgQp,
          });
        }

        logHealthEvent('pub_stats', {
          uplinkBps,
          availableOutgoingBitrate: snap.availableOutgoingBitrate,
          targetBitrate: snap.targetBitrate,
          framesEncodedDelta: encodedDelta,
          framesSentDelta: sentDelta,
          // The headline number for hypothesis C: encoded but never sent.
          framesNotSent: encodedDelta != null && sentDelta != null ? encodedDelta - sentDelta : null,
          fps: snap.framesPerSecond,
          sourceFps: snap.sourceFramesPerSecond,
          avgQp,
          qualityLimitationReason: snap.qualityLimitationReason,
          qualityLimitationDurations: snap.qualityLimitationDurations,
          rid: snap.rid,
          activeLayers: layerKey,
          layerCount: snap.layers.length,
          width: snap.frameWidth,
          height: snap.frameHeight,
          sourceWidth: snap.sourceWidth,
          sourceHeight: snap.sourceHeight,
          encoder: snap.encoderImplementation,
          keyFramesEncoded: snap.keyFramesEncoded,
          nackCount: snap.nackCount,
          pliCount: snap.pliCount,
          firCount: snap.firCount,
          packetsLost: snap.packetsLost,
          jitter: snap.jitter,
          rttSec: snap.currentRoundTripTime,
          retransmittedBytesSent: snap.retransmittedBytesSent,
          label,
        });

        prevRef.current = {
          at: now,
          bytesSent: snap.bytesSent,
          framesEncoded: snap.framesEncoded,
          framesSent: snap.framesSent,
          qpSum: snap.qpSum,
          byRid,
          layerKey: layerKey || prev.layerKey,
          limitation: snap.qualityLimitationReason ?? prev.limitation,
        };
      } catch {
        // Stats unavailable this tick. Not evidence of anything, and not
        // a reason to stop sampling.
      } finally {
        sampling = false;
      }
    }

    sample();
    const timer = setInterval(sample, SAMPLE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      room.localParticipant?.off?.('trackMuted', onLocalMuted);
      room.localParticipant?.off?.('trackUnmuted', onLocalUnmuted);
      room.localParticipant?.off?.('localTrackPublished', onPublished);
      room.localParticipant?.off?.('localTrackUnpublished', onUnpublished);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionQualityChanged, onQualityChanged);
    };
  }, [room, enabled, label]);
}
