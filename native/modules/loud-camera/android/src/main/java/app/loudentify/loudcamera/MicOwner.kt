package app.loudentify.loudcamera

/**
 * Who owns the microphone right now.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────
 * LoudVocalChain's own header states the constraint: "a second capture
 * path would be a second microphone consumer, which Android does not
 * reliably give." That is true and it is the reason the meter and the
 * headphone delay check were both built on the chain's frames.
 *
 * It also means neither of them works unless a broadcast is running,
 * because the chain is LiveKit's capture post-processor and LiveKit only
 * captures while publishing. An artist opening Settings → Audio or Kit
 * Check — the two places a person actually checks their microphone —
 * saw a meter that read silence no matter how loud they sang. The chain
 * being *installed* is not the same as frames arriving, and after one
 * show it stays installed for the life of the process, so the meter read
 * "installed" and showed nothing.
 *
 * So there are two capture paths after all, and exactly one of them may
 * run at a time. This object is how they agree, in code rather than in a
 * comment: the broadcast path stamps every frame it receives, and the
 * standalone path refuses to start, and stops itself, whenever that
 * stamp is fresh. The broadcast always wins the microphone. A show must
 * never lose its audio to a meter.
 */
object MicOwner {

  /**
   * How recently the broadcast path must have seen a frame for it to
   * count as holding the microphone.
   *
   * WebRTC delivers 10ms frames, so 100 a second. Half a second is five
   * frames of slack — long enough that a scheduling hiccup on a busy
   * phone does not read as "the broadcast stopped", short enough that
   * leaving a show hands the microphone back before an artist has
   * finished walking to the settings screen.
   */
  const val BROADCAST_HOLD_MS = 500L

  /** Set by LoudVocalChain on every frame LiveKit hands it. */
  @Volatile var broadcastFrameAt: Long = 0L

  fun stampBroadcastFrame() { broadcastFrameAt = System.currentTimeMillis() }

  /** Is the broadcast path capturing right now? */
  fun broadcastHasMic(): Boolean =
    broadcastFrameAt != 0L && System.currentTimeMillis() - broadcastFrameAt < BROADCAST_HOLD_MS
}
