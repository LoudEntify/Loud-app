package app.loudentify.loudcamera

import com.oney.WebRTCModule.AbstractVideoCaptureController
import livekit.org.webrtc.VideoCapturer

/**
 * The bridge between our CameraX capturer and the LiveKit fork of
 * react-native-webrtc: WebRTCModule.createVideoTrack() takes one of these,
 * calls initializeVideoCapturer() (which asks us for the VideoCapturer),
 * wires it to a VideoSource and starts it. From then on the track is an
 * ordinary local track the JS side can wrap and publish.
 */
class LoudCaptureController(
  width: Int, height: Int, fps: Int,
  private val capturer: LoudCameraXCapturer
) : AbstractVideoCaptureController(width, height, fps) {
  override fun createVideoCapturer(): VideoCapturer = capturer
  override fun getDeviceId(): String? = capturer.cameraId
}
