// Case 2 audio path: vocal + one instrument, phone mic, no external rig.
// Replaces the browser's default voice-call processing (which is disabled
// at capture) with a music-appropriate chain: high-pass filter to remove
// handling rumble, and a gentle compressor to balance vocal vs instrument.
//
// Usage:
//   const { processedTrack, audioContext } = await createPilotAudioTrack();
//   // then publish processedTrack via LiveKit instead of the raw mic track
//   // call audioContext.close() when the performer leaves/stops streaming

// Generates a simple decaying-noise impulse response entirely in code --
// no external audio file needed. This is a standard lightweight technique
// for a basic room/plate-style reverb; good enough for a subtle "less dry
// phone mic" effect, not meant to emulate a specific real space precisely.
function createImpulseResponse(audioContext, duration = 1.4, decay = 2.8) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = audioContext.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export async function createPilotAudioTrack(options = {}) {
  const {
    highpassFrequency = 80,
    compressorThreshold = -24,
    compressorRatio = 3,
    makeupGainDb = 4, // brings level back up after compression reduces it
    reverbMix = 0.12, // 0 = fully dry, 1 = fully wet -- keep this subtle
    reverbDuration = 1.4,
    reverbDecay = 2.8,
  } = options;

  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(rawStream);

  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = highpassFrequency;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = compressorThreshold;
  compressor.ratio.value = compressorRatio;

  const makeupGain = audioContext.createGain();
  // Convert dB to a linear gain multiplier: 10^(dB/20)
  makeupGain.gain.value = Math.pow(10, makeupGainDb / 20);

  // Reverb is a parallel dry/wet split, not inserted directly in series --
  // this keeps the dry signal always fully intact and just blends in a
  // controlled amount of the reverberated copy alongside it.
  const convolver = audioContext.createConvolver();
  convolver.buffer = createImpulseResponse(audioContext, reverbDuration, reverbDecay);

  const dryGain = audioContext.createGain();
  dryGain.gain.value = 1 - reverbMix;

  const wetGain = audioContext.createGain();
  wetGain.gain.value = reverbMix;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(makeupGain);

  makeupGain.connect(dryGain);
  dryGain.connect(destination);

  makeupGain.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(destination);

  const processedTrack = destination.stream.getAudioTracks()[0];

  // Keep the raw stream's tracks referenced so they aren't garbage collected
  // and stopped prematurely by the browser. Also return the live node
  // references themselves -- Web Audio params (frequency, threshold,
  // ratio, gain) can be changed in real time on an already-running graph,
  // which is what makes a live soundcheck panel possible without tearing
  // down and recreating the whole audio chain.
  return {
    processedTrack,
    audioContext,
    rawStream,
    nodes: { highpass, compressor, makeupGain, dryGain, wetGain, convolver },
  };
}

// Live-tunable setters, meant to be called from a soundcheck UI while the
// graph created above is already running. Each one only touches its own
// AudioParam -- no reconnecting, no audio dropout.
export function tuneHighpass(nodes, frequency) {
  nodes.highpass.frequency.value = frequency;
}
export function tuneCompressor(nodes, { threshold, ratio }) {
  if (threshold !== undefined) nodes.compressor.threshold.value = threshold;
  if (ratio !== undefined) nodes.compressor.ratio.value = ratio;
}
export function tuneMakeupGainDb(nodes, db) {
  nodes.makeupGain.gain.value = Math.pow(10, db / 20);
}
export function tuneReverbMix(nodes, mix) {
  const clamped = Math.max(0, Math.min(1, mix));
  nodes.dryGain.gain.value = 1 - clamped;
  nodes.wetGain.gain.value = clamped;
}

export function stopPilotAudioTrack({ processedTrack, audioContext, rawStream }) {
  processedTrack?.stop();
  rawStream?.getTracks().forEach((t) => t.stop());
  audioContext?.close();
}
