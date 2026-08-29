'use client';

// lib/audioHost.js
// ─────────────────────────────────────────────────────────────
// TASK 2 — the audio that must not stop.
//
// PRD: Director Experience / Live Show    S&I: Real-time media, Stateless hosting
//
// ── WHY A MODULE SINGLETON AND NOT REACT STATE ────────────────
// Because the whole defect is that React state dies. A module-level
// object is created once per page load and is not owned by any component,
// so nothing about mounting, unmounting, resizing, toggling a panel or
// pushing a route can destroy it. React can read it; React cannot kill
// it.
//
// ── SERVER STATE DOES NOT FIX THIS, AND MUST NOT BE TREATED AS IF IT DOES ──
// Stated plainly because it is the trap in this task. Task 1's row makes
// the SELECTION durable. It does nothing whatsoever for the SOUND: the
// thing actually producing audio is an AudioBufferSourceNode inside an
// AudioContext, and if the component owning that context unmounts and
// closes it, the music stops — no matter how perfectly the database
// remembers which track was playing. Two independent failures, two
// independent fixes.
//
// ── THE TWO REAL CAUSES, BOTH OF WHICH THIS ADDRESSES ─────────
//   1. components/KitCheck.jsx OWNED the AudioContext and called
//      `audioContext.close()` in its unmount cleanup. Navigating to
//      /live unmounts KitCheck, which closed the context. Closed is
//      terminal — an AudioContext cannot be reopened.
//   2. components/BackingTrackPanel.jsx held the player in a `useRef`
//      and stopped it on unmount. Any layout change that remounted the
//      panel therefore stopped the track and reset the playhead.
//
// Both now defer to this module, which does neither.
//
// ── IT IS NOT AN <audio> ELEMENT ──────────────────────────────
// Worth naming because the task described one. This codebase plays
// backing tracks through the Web Audio API — a decoded AudioBuffer
// routed into the same output bus as the vocal chain, so the two mix and
// the artist hears one thing (lib/audioProcessing.js). The hoisting
// requirement is identical; the object being hoisted is an AudioContext
// and a player handle rather than a DOM node. An <audio> element would
// not survive a remount any better AND could not be mixed into the
// broadcast bus, so it would be a step backwards.
//
// ── WHAT STILL CANNOT SURVIVE ─────────────────────────────────
// A hard page reload. The decoded buffer came from a local File; the
// browser will not reopen it without a fresh user gesture. Task 1's row
// then tells the artist what to re-select and where they were. That is
// the honest limit of what any amount of hoisting can do.
// ─────────────────────────────────────────────────────────────

import { logHealthEvent } from './healthLog';

// The one instance. Deliberately outside any component, any hook, and
// any React lifecycle.
const host = {
  audioContext: null,
  nodes: null,        // the vocal-chain node handles (lib/audioProcessing.js)
  rawStream: null,
  processedTrack: null,
  player: null,       // the decoded backing-track player
  trackHash: null,
  trackName: null,
  // Bumped on every mutation so React can subscribe without deep-comparing.
  version: 0,
};

const listeners = new Set();

function emit() {
  host.version += 1;
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a bad subscriber must not break audio */ }
  });
}

/** Subscribe to host changes. Returns an unsubscribe function. */
export function subscribeAudioHost(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAudioHost() {
  return host;
}

/** A stable snapshot for useSyncExternalStore. */
export function getAudioHostVersion() {
  return host.version;
}

/**
 * Adopt a live audio graph (mic chain + context) into the host.
 *
 * Called by whichever surface opened the microphone. Once adopted, that
 * surface must NOT close the context on unmount — releaseAudioHost() is
 * the only thing allowed to, and it is called on a deliberate end, never
 * on a navigation.
 */
export function adoptAudioGraph(handle) {
  if (!handle) return;
  // Adopting a second graph while one is live would leak the first and
  // leave two microphones open. Release explicitly first.
  if (host.audioContext && host.audioContext !== handle.audioContext) {
    logHealthEvent('audio_host_replaced', { hadContext: true });
    releaseAudioHost('replaced');
  }
  host.audioContext = handle.audioContext || null;
  host.nodes = handle.nodes || null;
  host.rawStream = handle.rawStream || null;
  host.processedTrack = handle.processedTrack || null;
  logHealthEvent('audio_host_adopted', { sampleRate: handle.audioContext?.sampleRate ?? null });
  emit();
}

/**
 * Hand the host a decoded backing track.
 *
 * Replaces any previous one — and stops it first, because two
 * AudioBufferSourceNodes on the same bus is two tracks playing at once,
 * which is the single most alarming thing that can happen mid-show.
 */
export function setBackingPlayer(player, trackHash, trackName) {
  if (host.player && host.player !== player) {
    try { host.player.stop(); host.player.disconnect?.(); } catch { /* already gone */ }
  }
  host.player = player || null;
  host.trackHash = trackHash || null;
  host.trackName = trackName || null;
  logHealthEvent('audio_host_track_loaded', { trackHash: trackHash || null, trackName: trackName || null });
  emit();
}

export function getBackingPlayer() {
  return host.player;
}

/**
 * Where the playhead is, in milliseconds, or null if nothing is loaded.
 * The one place that reads the player's clock, so every caller agrees.
 */
export function playerPositionMs() {
  const p = host.player;
  if (!p || typeof p.getElapsed !== 'function') return null;
  try { return Math.max(0, Math.round(p.getElapsed() * 1000)); } catch { return null; }
}

export function playerDurationMs() {
  const p = host.player;
  if (!p || typeof p.duration !== 'number') return null;
  return Math.round(p.duration * 1000);
}

/**
 * Release everything. The ONLY thing that closes the AudioContext.
 *
 * Called on: End Show, leaving a rehearsal deliberately, signing out.
 * NOT called on: unmount, navigation, resize, panel toggle. If you find
 * yourself wanting to call this from a cleanup function, that is the bug
 * this file was written to fix.
 */
export function releaseAudioHost(reason = 'unspecified') {
  try { host.player?.stop(); } catch { /* fine */ }
  try { host.rawStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* fine */ }
  try { host.processedTrack?.stop?.(); } catch { /* fine */ }
  try { host.audioContext?.close?.(); } catch { /* fine */ }
  logHealthEvent('audio_host_released', { reason });
  host.audioContext = null;
  host.nodes = null;
  host.rawStream = null;
  host.processedTrack = null;
  host.player = null;
  host.trackHash = null;
  host.trackName = null;
  emit();
}

/** Is a graph currently live? */
export function audioHostActive() {
  return !!host.audioContext && host.audioContext.state !== 'closed';
}
