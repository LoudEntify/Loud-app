package app.loudentify.loudcamera

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

/**
 * The artist's backing track, decoded and ready to be mixed into what
 * goes out.
 *
 * ── WHY IT IS DECODED HERE RATHER THAN PLAYED ─────────────────
 * The track has to reach the BROADCAST, not just the artist's ears. On
 * the web the pilot joins a `backingTrack` source to `outputBus` and Web
 * Audio mixes it; a phone has no such graph, and the only place captured
 * audio passes through code we configure is LoudVocalChain's capture
 * post-processor.
 *
 * A system media player would play the file to the speaker or the
 * headphones and give us no access to its samples, so the track would be
 * audible to the artist and absent from the stream — or, worse, present
 * in the stream only as whatever the microphone picked up of it.
 *
 * So the file is decoded to PCM here, and the chain reads samples from
 * it per frame. That also makes the track sample-accurate against the
 * published audio, which is what a cue sheet needs: cues are times, and
 * they are only right if the track and the stream share a clock.
 *
 * ── THE RESAMPLER ─────────────────────────────────────────────
 * Capture runs at 48 kHz and a downloaded track is usually 44.1 kHz, so
 * something has to resample, and linear interpolation is what this does.
 * It is not the best resampler — it adds a little high-frequency
 * softness — and it is the right one here: the alternative is a windowed
 * sinc per sample inside an audio callback that is also running a vocal
 * chain and encoding video.
 *
 * What matters far more than the interpolation quality is the RATIO,
 * which comes from lib/audio/tracks.js and is tested there. Treating a
 * 44.1k file as 48k runs it 8.8% fast: four bars sound fine, and a
 * five-minute song finishes 24 seconds early with every cue wrong.
 *
 * ── WHAT THIS CLASS DOES NOT DECIDE ───────────────────────────
 * Whether it may play (headphones — lib/audio/tracks.js), what the
 * transport is doing, or either gain. It is handed numbers and reads
 * samples.
 */
class LoudBackingTrack {

  data class Config(
    val ratio: Float = 1f,        // track samples per captured sample
    val trackGain: Float = 0.8f,
    val playing: Boolean = false,
  )

  @Volatile private var cfg = Config()
  @Volatile private var loaded = false

  /** The whole decoded track, mono, -1..1. A five-minute song is about 13 MB at 44.1k, which is affordable and removes every seek from the audio thread. */
  private var pcm = FloatArray(0)
  private var sourceRate = 44100
  private var sourceChannels = 1

  /** The playhead, in SOURCE samples, fractional because of the resample ratio. */
  @Volatile private var position = 0.0

  fun setConfig(next: Config) { cfg = next }
  fun isLoaded(): Boolean = loaded
  fun durationSeconds(): Double = if (sourceRate > 0) pcm.size.toDouble() / sourceRate else 0.0
  fun positionSeconds(): Double = if (sourceRate > 0) position / sourceRate else 0.0

  fun seekSeconds(seconds: Double) {
    position = max(0.0, min(seconds, durationSeconds())) * sourceRate
  }

  fun unload() {
    loaded = false
    pcm = FloatArray(0)
    position = 0.0
  }

  /**
   * Decode a file to PCM. Blocking, so it is called off the audio thread
   * — the module runs it on its own executor and resolves when done.
   *
   * Returns what was decoded rather than just success, because the JS
   * side needs the duration and the file's own sample rate to compute
   * the ratio (lib/audio/tracks.js resampleRatio).
   */
  fun load(path: String): Map<String, Any?> {
    unload()
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(path)
      var trackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
          trackIndex = i; format = f; break
        }
      }
      if (trackIndex < 0 || format == null) {
        return mapOf("ok" to false, "error" to "that file has no audio in it")
      }

      extractor.selectTrack(trackIndex)
      sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      sourceChannels = max(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))

      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0)
      codec.start()

      // Grown rather than sized up front: a duration from the container
      // can be wrong, and trusting it would either truncate the track or
      // leave silence at the end of it.
      var out = FloatArray(sourceRate * 60)
      var written = 0
      val info = MediaCodec.BufferInfo()
      var sawInputEnd = false

      while (true) {
        if (!sawInputEnd) {
          val inIndex = codec.dequeueInputBuffer(10_000)
          if (inIndex >= 0) {
            val buf = codec.getInputBuffer(inIndex)!!
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) {
              codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              sawInputEnd = true
            } else {
              codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        if (outIndex >= 0) {
          val buf = codec.getOutputBuffer(outIndex)!!
          buf.order(ByteOrder.nativeOrder())
          val shorts = buf.asShortBuffer()
          val count = info.size / 2
          val frames = count / sourceChannels

          if (written + frames > out.size) {
            out = out.copyOf(max(out.size * 2, written + frames))
          }
          // Mixed to mono on the way in: a phone's published audio is
          // mono, and averaging here costs nothing while doing it per
          // frame in the audio callback would cost on every frame.
          for (f in 0 until frames) {
            var sum = 0f
            for (ch in 0 until sourceChannels) sum += shorts.get(f * sourceChannels + ch) / 32768f
            out[written + f] = sum / sourceChannels
          }
          written += frames
          codec.releaseOutputBuffer(outIndex, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          // The decoder's real output rate, which can differ from the
          // container's. Taking the decoder's is the whole point: it is
          // what the samples actually are.
          val f = codec.outputFormat
          sourceRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          sourceChannels = max(1, f.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
        } else if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER && sawInputEnd) {
          // Nothing more coming and nothing more to give.
          break
        }
      }

      pcm = out.copyOf(written)
      position = 0.0
      loaded = written > 0
      return mapOf(
        "ok" to loaded,
        "error" to if (loaded) null else "nothing could be decoded from that file",
        "sampleRate" to sourceRate,
        "durationSeconds" to durationSeconds(),
        "samples" to written,
      )
    } catch (e: Throwable) {
      unload()
      return mapOf("ok" to false, "error" to (e.message ?: e.toString()))
    } finally {
      try { codec?.stop(); codec?.release() } catch (_: Throwable) { }
      try { extractor.release() } catch (_: Throwable) { }
    }
  }

  /**
   * Add `count` samples of track into `into`, at the configured gain,
   * advancing the playhead. Returns true while there is still track.
   *
   * Called from the audio thread inside LoudVocalChain, so it is
   * arithmetic and two reads of volatile state.
   */
  fun mixInto(into: FloatArray, count: Int): Boolean {
    val c = cfg
    if (!loaded || !c.playing || pcm.isEmpty()) return false

    var p = position
    val ratio = c.ratio.toDouble()
    val last = pcm.size - 1

    for (i in 0 until count) {
      if (p >= last) { position = pcm.size.toDouble(); return false }
      // Linear interpolation between the two neighbouring source
      // samples. See the header: the ratio matters far more than this.
      val idx = p.toInt()
      val frac = (p - idx).toFloat()
      val s = pcm[idx] * (1f - frac) + pcm[idx + 1] * frac
      into[i] += s * c.trackGain
      p += ratio
    }
    position = p
    return true
  }
}
