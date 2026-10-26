package app.loudentify.loudcamera

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry

/**
 * A lifecycle the capturer owns outright, so CameraX follows start/stop
 * calls from WebRTC instead of the Activity's foreground state. Must be
 * driven on the main thread.
 */
class SpikeLifecycle : LifecycleOwner {
  private val registry = LifecycleRegistry(this)
  override val lifecycle: Lifecycle get() = registry
  fun start() { registry.currentState = Lifecycle.State.RESUMED }
  fun stop() { registry.currentState = Lifecycle.State.DESTROYED }
}
