// The artist's vocal chain, from the shared definition to the phone.
//
// lib/audio/chain.js holds the numbers, shared with the web.
// lib/audio/dsp.js turns them into coefficients, and proves the
// arithmetic in tests/audio-dsp.test.mjs by pushing real signals
// through the same difference equation the native loop runs.
// This module is the delivery: it computes nothing of its own.
//
// Why it exists at all: React Native has no Web Audio API, and LiveKit
// publishes the microphone from the native layer, so there is no point
// in JavaScript where processed audio can be inserted between the mic
// and the broadcast. LiveKit's capture post-processor is that point,
// and it is in Kotlin.
import { nativeChainConfig } from '@loud/lib/audio/dsp.js';
import { normaliseChain } from '@loud/lib/audio/chain.js';
import * as LoudCamera from '../modules/loud-camera';

// What WebRTC runs at on Android. The native side reports the real rate
// when it initialises and JS re-sends for that rate if it differs, so
// this is a starting point rather than an assumption.
export const DEFAULT_RATE = 48000;

/**
 * Apply settings to the phone's chain.
 *
 * @param settings  whatever the deck holds; normalised before use, so a
 *                  stored object from an older build cannot put the
 *                  phone and the browser into different states.
 * @param sampleRate the rate the coefficients are computed for.
 */
export async function applyVocalChain(settings, sampleRate = DEFAULT_RATE) {
  const s = normaliseChain(settings);
  const config = nativeChainConfig(s, sampleRate);
  // `effectsOn` is what the artist toggled; the crossfade gains inside
  // `config` already express it, and the native side needs the flag
  // too so it can skip the loop entirely when the chain is off.
  const r = await LoudCamera.setVocalChain({ ...config, enabled: s.effectsOn });
  return { ...r, settings: s };
}

export function vocalChainState() {
  return LoudCamera.vocalChainState();
}
