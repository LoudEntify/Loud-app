package app.loudentify.loudcamera

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The headphone delay check, on the phone.
 *
 * ── WHAT IS MEASURED ──────────────────────────────────────────
 * Not a codec's advertised latency. The artist's real monitoring round
 * trip: a click leaves for their ears, they answer it out loud, and
 * their voice comes back through the microphone. That whole loop is what
 * makes a performer sing behind the track, and one measurement covers
 * every kind of gear — wired comes back near zero, Bluetooth comes back
 * as the real delay, with no separate path guessing at the device.
 *
 * ── WHAT THIS CLASS DOES NOT DECIDE ───────────────────────────
 * Anything. Every threshold, every gate and the verdict itself come from
 * lib/audio/sync.js, which is also what the web's measurement uses. This
 * runs the click train and the per-frame loop; JavaScript collects the
 * offsets and calls summariseCalibration on them. Same split as
 * LoudVocalChain, for the same reason: the rejection rules are the whole
 * safety of the feature and they are provable, so they are proved —
 * tests/audio-sync.test.mjs pushes synthetic frames through the same
 * state machine this file transcribes.
 *
 * ── WHY TWO BAND-PASSES AND NOT AN FFT ────────────────────────
 * The detector has to tell a sung "bah" from the click bleeding back
 * into a shared earbud microphone. The web asks an AnalyserNode for a
 * spectrum and sums two ranges of bins. There is no AnalyserNode here,
 * and an FFT per frame inside an audio callback that is also encoding
 * video is not affordable. The question is coarse — is there more energy
 * where vowels live than where the click lives — so two biquads answer
 * it for four multiply-accumulates per sample each. Their coefficients
 * come from bandpassCoefficients() in lib/audio/dsp.js.
 */
class LoudSyncCalibration {

  data class Config(
    val sampleRate: Int = 48000,
    val repCount: Int = 12,
    val clickIntervalMs: Float = 600f,
    val clickDurationMs: Float = 5f,
    val clickFrequencyHz: Float = 4000f,
    val leadInMs: Float = 300f,
    // Band-pass coefficients, normalised by a0, from lib/audio/dsp.js.
    val lowB0: Float = 0f, val lowB1: Float = 0f, val lowB2: Float = 0f,
    val lowA1: Float = 0f, val lowA2: Float = 0f,
    val highB0: Float = 0f, val highB1: Float = 0f, val highB2: Float = 0f,
    val highA1: Float = 0f, val highA2: Float = 0f,
    val ratioMin: Float = 1.5f,
    val sustainMs: Float = 40f,
    val blankingMs: Float = 18f,
    val marginDb: Float = 14f,
    val minRms: Float = 0.02f,
    val floorAlpha: Float = 0.05f,
  )

  @Volatile private var cfg = Config()
  @Volatile private var running = false

  /** Per-rep onsets in milliseconds after that rep's click, NaN where nothing was heard. */
  private var offsets = FloatArray(0)
  @Volatile private var rep = -1

  /** When the current rep's click was scheduled, on the same clock the capture frames are counted on. */
  @Volatile private var repStartMs = 0.0

  // ── Detector state, transcribed from onsetStep in lib/audio/sync.js ──
  private var phase = 0            // 0 idle, 1 pending, 2 confirmed
  private var floorRms = 0.02f
  private var candidateMs = 0f

  // Band-pass histories.
  private var lx1 = 0f; private var lx2 = 0f; private var ly1 = 0f; private var ly2 = 0f
  private var hx1 = 0f; private var hx2 = 0f; private var hy1 = 0f; private var hy2 = 0f

  // The capture clock: frames seen since the run started, which is a
  // better clock than System.nanoTime() here because it is the same one
  // the audio itself is on. A dropped buffer shows up as a gap in the
  // measurement rather than as a silently wrong offset.
  @Volatile private var framesSeen = 0L

  private var track: AudioTrack? = null

  fun setConfig(next: Config) { cfg = next }

  fun isRunning(): Boolean = running

  /**
   * Start a run. Returns immediately; JavaScript polls [state] and reads
   * [results] when the run has finished.
   */
  fun start(): Map<String, Any?> {
    if (running) return mapOf("ok" to false, "error" to "already running")
    val c = cfg
    offsets = FloatArray(c.repCount) { Float.NaN }
    rep = -1
    framesSeen = 0
    floorRms = c.minRms
    resetDetector()
    running = true

    return try {
      track = buildTrack(c)
      track?.play()
      mapOf("ok" to true, "repCount" to c.repCount)
    } catch (e: Throwable) {
      // A calibration that will not start must never stop a show, and
      // must never look like a measurement of zero.
      running = false
      mapOf("ok" to false, "error" to (e.message ?: e.toString()))
    }
  }

  fun cancel() {
    running = false
    try { track?.pause(); track?.flush(); track?.release() } catch (_: Throwable) { }
    track = null
  }

  fun state(): Map<String, Any?> = mapOf(
    "running" to running,
    "rep" to rep,
    "repCount" to cfg.repCount,
  )

  /**
   * The offsets, in rep order, with nulls where no answer was heard.
   *
   * JavaScript hands this straight to summariseCalibration, which drops
   * the lead-in reps, applies the rejection gates and decides. Nothing
   * here judges the run.
   */
  fun results(): List<Double?> = offsets.map { if (it.isNaN()) null else it.toDouble() }

  private fun resetDetector() {
    phase = 0
    candidateMs = 0f
    lx1 = 0f; lx2 = 0f; ly1 = 0f; ly2 = 0f
    hx1 = 0f; hx2 = 0f; hy1 = 0f; hy2 = 0f
  }

  /**
   * The click train, written once into a static buffer and played.
   *
   * Written rather than scheduled per click because AudioTrack gives no
   * scheduler: the buffer IS the schedule, and a click's position in it
   * is its time to the sample. That is what makes the measurement worth
   * anything — a click played "about now" would put its own jitter into
   * every reading.
   */
  private fun buildTrack(c: Config): AudioTrack {
    val rate = c.sampleRate
    val totalMs = c.leadInMs + c.repCount * c.clickIntervalMs
    val total = ((totalMs / 1000f) * rate).toInt()
    val pcm = ShortArray(total)

    val clickSamples = ((c.clickDurationMs / 1000f) * rate).toInt().coerceAtLeast(1)
    for (i in 0 until c.repCount) {
      val startMs = c.leadInMs + i * c.clickIntervalMs
      val start = ((startMs / 1000f) * rate).toInt()
      for (n in 0 until clickSamples) {
        val at = start + n
        if (at >= total) break
        // A short burst with a smooth envelope: a hard edge would ring
        // the band-passes and read as energy in both bands at once.
        val envelope = sin(PI * n / clickSamples).toFloat()
        val v = sin(2.0 * PI * c.clickFrequencyHz * n / rate).toFloat() * envelope * 0.8f
        pcm[at] = (v * 32767f).toInt().toShort()
      }
    }

    val t = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(rate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setBufferSizeInBytes(pcm.size * 2)
      .build()
    t.write(pcm, 0, pcm.size)
    return t
  }

  /**
   * One frame of captured microphone audio, from the vocal chain's own
   * callback. Measures both bands and steps the detector.
   *
   * `samples` is the frame as floats on the -1..1 scale; it is not
   * modified. Called on the audio thread, so everything here is
   * arithmetic over the frame and two volatile writes.
   */
  fun offer(samples: FloatArray, count: Int) {
    if (!running) return
    val c = cfg

    val startFrame = framesSeen
    framesSeen += count
    val frameMs = (startFrame.toDouble() / c.sampleRate) * 1000.0

    // Which rep this frame belongs to, and how far into it we are.
    val sinceLeadIn = frameMs - c.leadInMs
    if (sinceLeadIn < 0) { runBands(samples, count); return }
    val thisRep = (sinceLeadIn / c.clickIntervalMs).toInt()
    if (thisRep >= c.repCount) { finish(); return }

    if (thisRep != rep) {
      // A new click. Whatever the last rep heard is already recorded;
      // the detector starts clean so one long note cannot answer two
      // clicks.
      rep = thisRep
      repStartMs = c.leadInMs + thisRep * c.clickIntervalMs.toDouble()
      resetDetector()
    }

    val sinceClickMs = (frameMs - repStartMs).toFloat()
    val m = runBands(samples, count)

    if (phase == 2) return                       // already answered this rep
    if (sinceClickMs < c.blankingMs) return      // the click's own moment

    val threshold = max(c.minRms, floorRms * 10f.pow(c.marginDb / 20f))
    val loud = m.rms >= threshold
    val voice = m.low >= m.high * c.ratioMin

    if (phase == 0) {
      // The floor learns only from quiet frames: a candidate window
      // would teach it that the artist's voice is the room.
      if (!loud) { floorRms += (m.rms - floorRms) * c.floorAlpha; return }
      if (!voice) return
      phase = 1
      candidateMs = sinceClickMs
      return
    }

    // Pending: it has to hold. An impulse drops out here, which is what
    // the sustain gate is for.
    if (!loud || !voice) { phase = 0; return }
    if (sinceClickMs - candidateMs >= c.sustainMs) {
      phase = 2
      // The measurement is where the voice STARTED, not where it was
      // confirmed. Otherwise every reading would be one sustain gate too
      // long and the correction would overshoot by 40ms.
      offsets[rep] = candidateMs
    }
  }

  private fun finish() {
    running = false
    try { track?.pause(); track?.flush(); track?.release() } catch (_: Throwable) { }
    track = null
  }

  private class Measured(val rms: Float, val low: Float, val high: Float)

  /** Both bands and the overall level for one frame. */
  private fun runBands(samples: FloatArray, count: Int): Measured {
    val c = cfg
    var sumSq = 0f
    var lowSq = 0f
    var highSq = 0f
    for (i in 0 until count) {
      val x = samples[i]
      sumSq += x * x

      val l = c.lowB0 * x + c.lowB1 * lx1 + c.lowB2 * lx2 - c.lowA1 * ly1 - c.lowA2 * ly2
      lx2 = lx1; lx1 = x; ly2 = ly1; ly1 = l
      lowSq += l * l

      val h = c.highB0 * x + c.highB1 * hx1 + c.highB2 * hx2 - c.highA1 * hy1 - c.highA2 * hy2
      hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = h
      highSq += h * h
    }
    val n = max(1, count)
    return Measured(sqrt(sumSq / n), sqrt(lowSq / n), sqrt(highSq / n))
  }
}
