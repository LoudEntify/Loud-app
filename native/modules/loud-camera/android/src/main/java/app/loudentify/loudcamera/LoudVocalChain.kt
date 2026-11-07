package app.loudentify.loudcamera

import com.livekit.reactnative.audio.processing.AudioProcessorInterface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The artist's vocal chain, on the phone.
 *
 * ── WHERE THIS SITS ───────────────────────────────────────────
 * LiveKit's own capture post-processor: every 10ms of microphone audio
 * passes through [processAudio] between the hardware and the encoder.
 * That is the one point where processed audio can be inserted into the
 * broadcast on a phone, and it is why the vocal chain could not be
 * written in JavaScript — React Native has no Web Audio, and the mic is
 * published from the native layer.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────
 * It computes nothing. Every coefficient is handed to it from
 * lib/audio/dsp.js, which derives them from lib/audio/chain.js, the one
 * definition shared with the web. This class runs the per-sample loop
 * and nothing else.
 *
 * That split is deliberate. The arithmetic is provable — a high-pass
 * either attenuates below its cutoff or it does not — and it is proved,
 * in tests/audio-dsp.test.mjs, by pushing real signals through the same
 * difference equation this file runs. What is here is a transcription
 * with a reference implementation beside it.
 *
 * ── THE TWO RULES ─────────────────────────────────────────────
 * From lib/audio/chain.js, and both are structural here rather than
 * matters of care:
 *
 *   1. Bypass is a crossfade. Both paths are computed every sample and
 *      summed by gain. There is no branch that skips the chain, so
 *      there is no click when it is toggled.
 *   2. The monitor cannot reach the broadcast. It is not in this file
 *      at all. A capture post-processor can only touch what is being
 *      sent, so an artist monitoring themselves can never feed back
 *      into the stream.
 *
 * ── AUDIO FORMAT ──────────────────────────────────────────────
 * WebRTC hands 16-bit signed PCM, native byte order, interleaved,
 * 10ms per call. `numBands` is 1 for everything we run at; the
 * interface allows more for its own internal split-band processing and
 * we refuse rather than mangle it.
 */
class LoudVocalChain : AudioProcessorInterface {

  // ── Coefficients, all set from JS ────────────────────────────
  //
  // `configured` is not the effects switch. It means a config computed
  // for THIS sample rate has arrived, and nothing else. The effects
  // switch is the crossfade: processedGain and bypassGain, one of which
  // is zero (rule 1 above). So the loop runs whenever a config exists,
  // even with effects off, and the only difference is which of the two
  // gains carries the signal.
  //
  // That is what lets the input meter work with effects off. A level the
  // artist can only see once they have switched processing on would be
  // useless for the thing a meter is for: knowing whether the microphone
  // is hearing you at all.
  @Volatile private var configured = false
  @Volatile private var cfg: Config = Config()

  // ── What the meter reads ─────────────────────────────────────
  // Written by the audio thread, read by JS. Floats, so a read can only
  // be stale by one 10ms frame, never torn.
  //
  // `level` is the INPUT, after the trim and before the chain: what the
  // microphone is hearing. `reduction` is how many dB the compressor is
  // taking off right now, which is the only honest way to show that
  // compression is working — a threshold and a ratio tell an artist
  // nothing about their own voice.
  @Volatile private var levelPeak = 0f
  @Volatile private var levelRms = 0f
  @Volatile private var reductionPeak = 0f

  // ── The headphone delay check ────────────────────────────────
  // When a calibration run is going, each frame is also offered to it.
  // It sits here rather than tapping the microphone itself because this
  // is already the one place on a phone where captured audio passes
  // through JavaScript-configured code — a second capture path would be
  // a second microphone consumer, which Android does not reliably give.
  //
  // The frame is offered UNPROCESSED, before the trim: the measurement
  // is of what the microphone heard, and an input trim the artist set
  // for a show must not change how loud their answer appears.
  @Volatile private var calibration: LoudSyncCalibration? = null
  private var calibrationBuffer = FloatArray(0)

  fun setCalibration(c: LoudSyncCalibration?) { calibration = c }

  /** Everything the loop needs. Replaced wholesale, never edited in place, so a mid-frame change cannot tear. */
  data class Config(
    val inputGain: Float = 1f,
    val b0: Float = 1f, val b1: Float = 0f, val b2: Float = 0f,
    val a1: Float = 0f, val a2: Float = 0f,
    val thresholdDb: Float = -24f,
    val slope: Float = 0.667f,
    val kneeDb: Float = 30f,
    val attack: Float = 0f,
    val release: Float = 0.99f,
    val makeupGain: Float = 1f,
    val dryGain: Float = 0.88f,
    val wetGain: Float = 0.12f,
    val processedGain: Float = 0f,
    val bypassGain: Float = 1f,
    val outputGain: Float = 1f,
    val combDelays: IntArray = intArrayOf(1426, 1781, 1973, 2098),
    val combFeedback: FloatArray = floatArrayOf(0.84f, 0.81f, 0.79f, 0.78f),
    val allpassDelays: IntArray = intArrayOf(240, 82),
    val allpassFeedback: FloatArray = floatArrayOf(0.5f, 0.5f),
  )

  // ── Per-stream state ─────────────────────────────────────────
  private var rate = 48000
  private var channels = 1

  // Biquad history, per channel.
  private var x1 = FloatArray(2); private var x2 = FloatArray(2)
  private var y1 = FloatArray(2); private var y2 = FloatArray(2)

  // Compressor envelope, in dB, per channel. Starts at silence so the
  // first frame does not duck.
  private var envDb = FloatArray(2) { -100f }

  // Reverb lines. One set, fed from the mono sum: a phone microphone is
  // one capsule, and two independent tails on a mono source is twice the
  // cost for a difference nobody can hear.
  private var combBuf: Array<FloatArray> = arrayOf()
  private var combIdx = IntArray(0)
  private var apBuf: Array<FloatArray> = arrayOf()
  private var apIdx = IntArray(0)

  /**
   * The meter, as JS reads it: input level and compressor action over
   * the frames since the last read.
   *
   * Peak-since-read rather than an instantaneous sample, because a UI
   * polling at 10 Hz against 100 frames a second would otherwise show
   * whichever single frame it happened to land on, which for speech
   * means a meter that misses most of the words.
   */
  fun meter(): Map<String, Any?> {
    val out = mapOf(
      "configured" to configured,
      "peak" to levelPeak,
      "rms" to levelRms,
      "reductionDb" to reductionPeak,
      "sampleRate" to rate,
      "channels" to channels,
    )
    levelPeak = 0f
    reductionPeak = 0f
    return out
  }

  /** Called from JS whenever a knob moves. Cheap, and safe at any time. */
  fun setConfig(next: Config) {
    cfg = next
    configured = true
    // Delay lines are sized by the config, so a change that resizes them
    // rebuilds them. Everything else is read per sample.
    if (combBuf.size != next.combDelays.size || combBuf.indices.any { combBuf[it].size != next.combDelays[it] }) {
      buildReverb(next)
    }
  }

  private fun buildReverb(c: Config) {
    combBuf = Array(c.combDelays.size) { FloatArray(max(1, c.combDelays[it])) }
    combIdx = IntArray(c.combDelays.size)
    apBuf = Array(c.allpassDelays.size) { FloatArray(max(1, c.allpassDelays[it])) }
    apIdx = IntArray(c.allpassDelays.size)
  }

  override fun isEnabled(): Boolean = configured

  override fun getName(): String = "LoudVocalChain"

  override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) {
    rate = sampleRateHz
    channels = max(1, numChannels)
    x1 = FloatArray(channels); x2 = FloatArray(channels)
    y1 = FloatArray(channels); y2 = FloatArray(channels)
    envDb = FloatArray(channels) { -100f }
    buildReverb(cfg)
  }

  override fun resetAudioProcessing(newRate: Int) {
    // The rate changed, so every coefficient computed for the old one is
    // wrong. The loop is left bypassed until JS sends a config for the
    // new rate: a chain running yesterday's coefficients is worse than
    // no chain, because it is wrong in a way nobody can hear until the
    // recording is played back.
    rate = newRate
    configured = false
    levelPeak = 0f; levelRms = 0f; reductionPeak = 0f
    initializeAudioProcessing(newRate, channels)
  }

  override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
    val c = cfg
    if (!configured || numBands != 1) return

    buffer.order(ByteOrder.nativeOrder())
    val pcm = buffer.asShortBuffer()
    val total = numFrames * channels
    if (pcm.capacity() < total) return

    // Meter accumulators for this frame. Kept local and written once at
    // the end: a volatile write per sample would cost more than the
    // chain does.
    var framePeak = 0f
    var sumSquares = 0f
    var frameReduction = 0f

    // A calibration run wants this frame as it arrived. Copied out first
    // because the loop below writes its results back into the same
    // buffer, and the measurement must not see processed audio.
    val cal = calibration
    if (cal != null && cal.isRunning()) {
      if (calibrationBuffer.size < total) calibrationBuffer = FloatArray(total)
      for (i in 0 until total) calibrationBuffer[i] = pcm.get(i) / 32768f
      cal.offer(calibrationBuffer, total)
    }

    for (i in 0 until total) {
      val ch = if (channels > 1) i % channels else 0
      val input = pcm.get(i) / 32768f

      // Input trim. Everything before this is raw hardware level.
      val trimmed = input * c.inputGain

      // The meter reads here: after the trim, before the chain. This is
      // "what the microphone is hearing", which is the question a level
      // meter answers, and it is the same number whether effects are on
      // or off.
      val mag = abs(trimmed)
      if (mag > framePeak) framePeak = mag
      sumSquares += trimmed * trimmed

      // ── The processed path ───────────────────────────────────
      // High-pass: the same difference equation tests/audio-dsp.test.mjs
      // pushes sine waves through.
      val hp = c.b0 * trimmed + c.b1 * x1[ch] + c.b2 * x2[ch] - c.a1 * y1[ch] - c.a2 * y2[ch]
      x2[ch] = x1[ch]; x1[ch] = trimmed
      y2[ch] = y1[ch]; y1[ch] = hp

      // Compressor. The envelope follows the signal in dB, fast up and
      // slow down, and the reduction curve is the soft knee from
      // lib/audio/dsp.js.
      val levelDb = 20f * log10(max(abs(hp), 1e-7f))
      val coef = if (levelDb > envDb[ch]) c.attack else c.release
      envDb[ch] = levelDb + coef * (envDb[ch] - levelDb)
      val reduction = gainReductionDb(envDb[ch], c)
      if (reduction > frameReduction) frameReduction = reduction
      val compressed = hp * 10f.pow(-reduction / 20f) * c.makeupGain

      // Reverb, mono-fed and parallel: the dry signal is never reduced
      // away, it is joined by a controlled amount of a wet copy.
      val wet = if (c.wetGain > 0f && ch == 0) reverb(compressed, c) else 0f
      val processed = compressed * c.dryGain + wet * c.wetGain

      // ── The crossfade ────────────────────────────────────────
      // Both paths, every sample, summed by gain. One of the two gains
      // is zero; neither is a branch.
      val out = (processed * c.processedGain + trimmed * c.bypassGain) * c.outputGain

      pcm.put(i, (max(-1f, min(1f, out)) * 32767f).toInt().toShort())
    }

    // Published once per frame. The peaks hold until JS reads them, so a
    // meter polling slower than 100 Hz still sees every syllable; the
    // RMS is this frame's, which is what a steady bar should follow.
    if (framePeak > levelPeak) levelPeak = framePeak
    if (frameReduction > reductionPeak) reductionPeak = frameReduction
    levelRms = if (total > 0) kotlin.math.sqrt(sumSquares / total) else 0f
  }

  /** The soft knee, transcribed from gainReductionDb in lib/audio/dsp.js. */
  private fun gainReductionDb(levelDb: Float, c: Config): Float {
    val over = levelDb - c.thresholdDb
    val half = c.kneeDb / 2f
    if (over <= -half) return 0f
    if (over >= half) return c.slope * over
    val x = over + half
    return (c.slope * x * x) / (2f * c.kneeDb)
  }

  /**
   * Four combs in parallel into two all-passes in series: Schroeder's
   * arrangement, about six multiply-accumulates per sample.
   *
   * NOT a convolution. The web generates a 1.4-second impulse and
   * convolves it, which is tens of thousands of operations per sample.
   * That is fine in a browser on a laptop and impossible inside a 10ms
   * callback on a phone that is also encoding video.
   */
  private fun reverb(input: Float, c: Config): Float {
    if (combBuf.isEmpty()) return 0f
    var sum = 0f
    for (i in combBuf.indices) {
      val buf = combBuf[i]
      val idx = combIdx[i]
      val delayed = buf[idx]
      buf[idx] = input + delayed * c.combFeedback[i]
      combIdx[i] = (idx + 1) % buf.size
      sum += delayed
    }
    sum /= combBuf.size

    for (i in apBuf.indices) {
      val buf = apBuf[i]
      val idx = apIdx[i]
      val delayed = buf[idx]
      val g = c.allpassFeedback[i]
      buf[idx] = sum + delayed * g
      sum = delayed - g * buf[idx]
      apIdx[i] = (idx + 1) % buf.size
    }
    return sum
  }
}
