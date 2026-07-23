// Case 2 audio path: vocal + one instrument, phone mic, no external rig.
// Replaces the browser's default voice-call processing (which is disabled
// at capture) with a music-appropriate chain: high-pass filter to remove
// handling rumble, and a gentle compressor to balance vocal vs instrument.
//
// Usage:
//   const { processedTrack, audioContext } = await createPilotAudioTrack();
//   // then publish processedTrack via LiveKit instead of the raw mic track
//   // call audioContext.close() when the performer leaves/stops streaming

export async function createPilotAudioTrack(options = {}) {
  const {
    highpassFrequency = 80,
    compressorThreshold = -24,
    compressorRatio = 3,
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

  source.connect(highpass);
  highpass.connect(compressor);

  const destination = audioContext.createMediaStreamDestination();
  compressor.connect(destination);

  const processedTrack = destination.stream.getAudioTracks()[0];

  // Keep the raw stream's tracks referenced so they aren't garbage collected
  // and stopped prematurely by the browser.
  return { processedTrack, audioContext, rawStream };
}

export function stopPilotAudioTrack({ processedTrack, audioContext, rawStream }) {
  processedTrack?.stop();
  rawStream?.getTracks().forEach((t) => t.stop());
  audioContext?.close();
}
