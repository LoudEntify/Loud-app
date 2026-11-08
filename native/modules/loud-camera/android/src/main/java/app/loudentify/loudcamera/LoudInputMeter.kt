package app.loudentify.loudcamera

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * The microphone, measured when nothing is broadcasting.
 *
 * ── WHY ───────────────────────────────────────────────────────
 * Korey, 5 Nov: "There is no audio signal indicator." The phone half of
 * that was built on LoudVocalChain's frames, which was the right place
 * for the broadcast — it measures the audio that actually leaves — and
 * the wrong place for everything else, because the chain is LiveKit's
 * capture post-processor and LiveKit captures only while publishing.
 *
 * So the meter read silence in Settings → Audio and in Kit Check: the
 * two screens where an artist checks a microphone, neither of which is
 * broadcasting. The headphone delay check had the same floor under it
 * and failed with "the audio chain is not running yet", which is a
 * statement about the build, not a result or an action — the thing
 * docs/ONE_JOURNEY.md §6 says a row must never end in.
 *
 * This is a capture of its own, for those screens. It publishes nowhere
 * and joins no room: there is no path from here to a broadcast, which is
 * also what makes it safe to open in a room full of the artist's own
 * speakers.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────
 * Android does not reliably give two consumers the same microphone, so
 * exactly one capture path may run. MicOwner is the arbitration and the
 * broadcast always wins: this refuses to start while the broadcast holds
 * the microphone, and the loop below stops itself mid-run if the
 * broadcast takes it. A show must never lose its audio to a meter.
 *
 * ── WHAT THIS DOES NOT DECIDE ─────────────────────────────────
 * What a level means. lib/audio/meter.js decides that, for this, for the
 * chain's meter and for the browser, so one voice reads the same
 * everywhere. This reports peak and rms and nothing else.
 */
class LoudInputMeter {

  companion object {
    const val SAMPLE_RATE = 48000          // what the chain runs at, so one set of thresholds fits both
    const val FRAME_SAMPLES = 480          // 10ms, the frame size WebRTC delivers
    private const val BUFFER_FRAMES = 8    // 80ms of slack against scheduling, well under the 10Hz poll
  }

  /**
   * The capture source, in order of preference.
   *
   * VOICE_RECOGNITION first: on Android it is the documented source with
   * automatic gain control and noise suppression off, which is what a
   * meter has to have. A meter fed through AGC shows a healthy level for
   * a voice that is actually too quiet, because the AGC has already
   * fixed it — and then the artist turns their gain down and goes out
   * thin. MIC is the fallback, and the reported source says which was
   * used, because the two are not the same measurement.
   */
  private val sources = intArrayOf(
    MediaRecorder.AudioSource.VOICE_RECOGNITION,
    MediaRecorder.AudioSource.MIC,
  )

  private var record: AudioRecord? = null
  private var thread: Thread? = null
  @Volatile private var running = false
  @Volatile private var sourceUsed = 0
  @Volatile private var stoppedBecause: String? = null

  // Written by the capture thread, read by JS. Peak is held until read,
  // for the reason LoudVocalChain.meter() gives: a UI polling at 10Hz
  // against 100 frames a second otherwise shows whichever frame it
  // happened to land on, which for speech misses most of the words.
  @Volatile private var levelPeak = 0f
  @Volatile private var levelRms = 0f

  // A delay check in progress is offered the same frames, unprocessed.
  // Nothing processes them here at all, so "unprocessed" is the only
  // thing they can be.
  @Volatile private var calibration: LoudSyncCalibration? = null

  fun setCalibration(c: LoudSyncCalibration?) { calibration = c }

  fun isRunning(): Boolean = running

  /**
   * Open the microphone and start measuring.
   *
   * Returns a map rather than throwing: not being able to measure a
   * microphone is a thing to say on screen, never a crash. `ok` false
   * always carries a `reason` an artist can act on.
   */
  fun start(): Map<String, Any?> {
    if (running) return mapOf("ok" to true, "already" to true, "source" to sourceName(sourceUsed))
    if (MicOwner.broadcastHasMic()) {
      return mapOf("ok" to false, "reason" to "your show is using the microphone", "broadcasting" to true)
    }
    stoppedBecause = null

    val minBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBytes <= 0) return mapOf("ok" to false, "reason" to "this phone will not record at 48 kHz")
    val bufferBytes = maxOf(minBytes, FRAME_SAMPLES * 2 * BUFFER_FRAMES)

    var opened: AudioRecord? = null
    for (source in sources) {
      val candidate = try {
        AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferBytes)
      } catch (e: Throwable) {
        // A SecurityException here is the RECORD_AUDIO permission, which
        // the screen asks for. Any other throwable is this source not
        // being available, so the next one is tried.
        null
      }
      if (candidate != null && candidate.state == AudioRecord.STATE_INITIALIZED) { opened = candidate; sourceUsed = source; break }
      candidate?.release()
    }
    if (opened == null) return mapOf("ok" to false, "reason" to "the microphone could not be opened; check the app's microphone permission")

    record = opened
    levelPeak = 0f; levelRms = 0f
    running = true
    try {
      opened.startRecording()
    } catch (e: Throwable) {
      running = false
      opened.release(); record = null
      return mapOf("ok" to false, "reason" to (e.message ?: "the microphone could not be started"))
    }

    thread = Thread({ loop(opened) }, "loud-input-meter").also { it.priority = Thread.NORM_PRIORITY + 1; it.start() }
    return mapOf("ok" to true, "source" to sourceName(sourceUsed), "sampleRate" to SAMPLE_RATE)
  }

  fun stop(): Map<String, Any?> {
    running = false
    val t = thread; thread = null
    try { t?.join(500) } catch (e: InterruptedException) { Thread.currentThread().interrupt() }
    val r = record; record = null
    try { r?.stop() } catch (e: Throwable) { /* already stopped */ }
    r?.release()
    levelPeak = 0f; levelRms = 0f
    return mapOf("ok" to true, "stoppedBecause" to stoppedBecause)
  }

  /** Peak and rms since the last read, cleared on read. Same shape as the chain's meter. */
  fun meter(): Map<String, Any?> {
    val out = mapOf(
      "running" to running,
      "peak" to levelPeak,
      "rms" to levelRms,
      "source" to sourceName(sourceUsed),
      "sampleRate" to SAMPLE_RATE,
      "stoppedBecause" to stoppedBecause,
    )
    levelPeak = 0f
    return out
  }

  private fun loop(r: AudioRecord) {
    val frame = ShortArray(FRAME_SAMPLES)
    val floats = FloatArray(FRAME_SAMPLES)
    while (running) {
      // The broadcast taking the microphone ends this run, mid-frame if
      // need be. Checked every frame rather than at start only, because
      // a show can begin while a settings screen is still open behind it.
      if (MicOwner.broadcastHasMic()) { stoppedBecause = "your show took the microphone"; break }

      val read = try { r.read(frame, 0, FRAME_SAMPLES) } catch (e: Throwable) { -1 }
      if (read <= 0) {
        // ERROR_INVALID_OPERATION means the record was stopped under us.
        if (read < 0) { stoppedBecause = "the microphone stopped sending"; break }
        continue
      }

      var peak = 0f
      var sumSquares = 0f
      for (i in 0 until read) {
        val v = frame[i] / 32768f
        floats[i] = v
        val m = abs(v)
        if (m > peak) peak = m
        sumSquares += v * v
      }
      if (peak > levelPeak) levelPeak = peak
      levelRms = sqrt(sumSquares / read)

      val cal = calibration
      if (cal != null && cal.isRunning()) cal.offer(floats, read)
    }
    running = false
    try { r.stop() } catch (e: Throwable) { /* closing */ }
  }

  private fun sourceName(source: Int): String = when (source) {
    MediaRecorder.AudioSource.VOICE_RECOGNITION -> "voice_recognition"
    MediaRecorder.AudioSource.MIC -> "mic"
    else -> "none"
  }
}
