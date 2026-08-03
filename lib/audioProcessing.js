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

  // Input gain -- this is new. Everything before this point is raw mic
  // hardware level, completely unadjusted. This is the first real "input
  // trim" control in the chain.
  const inputGain = audioContext.createGain();
  inputGain.gain.value = 1; // unity (0dB) by default

  const inputAnalyser = audioContext.createAnalyser();
  inputAnalyser.fftSize = 512;

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

  // Vocal-only summing point -- dry + reverb-wet converge here, BEFORE
  // the backing track joins at outputBus (loadBackingTrack connects its
  // trackGain directly into outputBus). Soundcheck monitoring taps HERE,
  // not outputBus, specifically so it stays vocal-only: the backing track
  // already has its own always-on local monitor path in loadBackingTrack,
  // so tapping outputBus would let the artist hear the beat twice
  // (soundcheck monitor tap + the beat's own monitor) whenever one is
  // loaded and playing. vocalBus is a pure pass-through into outputBus --
  // same total signal reaches outputBus/destination either way, so the
  // published track is unaffected by this node existing.
  const vocalBus = audioContext.createGain();
  vocalBus.gain.value = 1;

  // A pure summing node -- everything converges here before the final
  // output. This is what actually gets published, and what the output
  // meter reads from (the true final level, not any intermediate stage).
  const outputBus = audioContext.createGain();
  outputBus.gain.value = 1;

  const outputAnalyser = audioContext.createAnalyser();
  outputAnalyser.fftSize = 512;

  const destination = audioContext.createMediaStreamDestination();

  // Soundcheck-only monitor tap -- off (0 gain) by default and every
  // session, never persisted on. Toggled via tuneMonitorEnabled, forced
  // back off the instant the show leaves soundcheck (see AudioDeckPanel).
  // Feeds the artist's own speakers/headphones ONLY -- never connected to
  // `destination`, so it can never affect what's published regardless of
  // its on/off state.
  const monitorGain = audioContext.createGain();
  monitorGain.gain.value = 0;

  source.connect(inputGain);
  inputGain.connect(inputAnalyser); // metering tap, doesn't affect the signal path
  inputGain.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(makeupGain);

  makeupGain.connect(dryGain);
  makeupGain.connect(convolver);
  convolver.connect(wetGain);

  dryGain.connect(vocalBus);
  wetGain.connect(vocalBus);
  vocalBus.connect(outputBus);
  vocalBus.connect(monitorGain);
  monitorGain.connect(audioContext.destination);

  outputBus.connect(outputAnalyser); // metering tap, doesn't affect the signal path
  outputBus.connect(destination);

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
    nodes: {
      inputGain, inputAnalyser, highpass, compressor, makeupGain,
      dryGain, wetGain, convolver, vocalBus, outputBus, outputAnalyser,
      monitorGain,
    },
  };
}

export function tuneInputGainDb(nodes, db) {
  nodes.inputGain.gain.value = Math.pow(10, db / 20);
}

// Soundcheck-only vocal monitoring -- toggles the artist's own
// headphones/speakers tap on/off. Never touches outputBus/destination, so
// the published track is identical regardless of this setting.
export function tuneMonitorEnabled(nodes, enabled) {
  nodes.monitorGain.gain.value = enabled ? 1 : 0;
}
export function tuneOutputGainDb(nodes, db) {
  nodes.outputBus.gain.value = Math.pow(10, db / 20);
}

// --- Case 3: backing track, played from the artist's own device --------
// No upload, no server, no database -- the file never leaves this
// browser. It's decoded locally and mixed directly into outputBus,
// bypassing the vocal chain (highpass/compressor/reverb are tuned for a
// mic signal, not a pre-mixed track). The artist must use headphones --
// this plays out loud on their device so they can perform along with it,
// which means their own mic would pick it back up a second time without
// headphones. That's a physical constraint, not something code can fix.

export async function loadBackingTrack(audioContext, outputBus, file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const trackGain = audioContext.createGain();
  trackGain.gain.value = 0.8; // default level, tunable via the returned controller

  // Feeds both the published output (merged with vocal) and the artist's
  // own ears (context.destination -- their device's normal audio output,
  // which is why headphones matter).
  trackGain.connect(outputBus);
  trackGain.connect(audioContext.destination);

  let sourceNode = null;
  let startedAt = 0;
  let pausedAt = 0;
  let playing = false;

  function makeSource() {
    const node = audioContext.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(trackGain);
    return node;
  }

  function play() {
    if (playing) return;
    sourceNode = makeSource();
    const offset = pausedAt;
    sourceNode.start(0, offset);
    startedAt = audioContext.currentTime - offset;
    playing = true;
    sourceNode.onended = () => {
      if (playing && audioContext.currentTime - startedAt >= audioBuffer.duration - 0.05) {
        playing = false;
        pausedAt = 0; // reached the natural end, reset rather than "paused at end"
      }
    };
  }

  function pause() {
    if (!playing) return;
    pausedAt = audioContext.currentTime - startedAt;
    sourceNode?.stop();
    playing = false;
  }

  function stop() {
    sourceNode?.stop();
    playing = false;
    pausedAt = 0;
  }

  function seek(timeSeconds) {
    const wasPlaying = playing;
    if (playing) sourceNode?.stop();
    pausedAt = Math.max(0, Math.min(audioBuffer.duration, timeSeconds));
    playing = false;
    if (wasPlaying) play();
  }

  function setVolume(v) {
    trackGain.gain.value = Math.max(0, Math.min(1, v));
  }

  function getElapsed() {
    return playing ? audioContext.currentTime - startedAt : pausedAt;
  }

  return {
    audioBuffer,
    duration: audioBuffer.duration,
    play,
    pause,
    stop,
    seek,
    setVolume,
    getElapsed,
    isPlaying: () => playing,
    disconnect: () => {
      stop();
      trackGain.disconnect();
    },
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
