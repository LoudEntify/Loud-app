package app.loudentify.loudcamera

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.ReactContext
import com.oney.WebRTCModule.WebRTCModule
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.zip.GZIPOutputStream

/**
 * JS surface of the spike's camera (native/modules/loud-camera/index.js).
 *
 *   survey()                      B2 capability profile, no camera opened
 *   start({facing,width,height,fps,frameSource}) → {streamId, trackId, tracks}
 *   stop()
 *   move(kind, mode, steps, requested) → move result (resolves when the last step has been applied)
 *   setPro(control, value) → pro-mode result; proRead() → current exposure/colour
 *   cancelMove(), resetFraming()
 *   getState()                    → camera state (B4)
 *   cost()                        → CostMeter sample
 *   writeGzip(path, text), uploadFile(path, url, contentType, headers)
 *   event "onState" every 500 ms while capturing
 */
class LoudCameraModule : Module() {
  private var capturer: LoudCameraXCapturer? = null
  private var controller: LoudCaptureController? = null
  private val main = Handler(Looper.getMainLooper())
  private var ticking = false
  private val tick = object : Runnable {
    override fun run() {
      val c = capturer
      if (c != null && ticking) {
        sendEvent("onState", c.state() + mapOf("tMs" to SystemClock.elapsedRealtime()))
        main.postDelayed(this, 500)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LoudCamera")
    Events("onState")

    AsyncFunction("survey") { -> CameraSurvey.profile(appContext.reactContext!!) }

    AsyncFunction("start") { opts: Map<String, Any?>, promise: Promise ->
      if (capturer != null) { promise.reject(CodedException("ERR_BUSY", "capture already running", null)); return@AsyncFunction }
      // appContext.reactContext is typed as a plain android Context; the
      // native-module registry lives on ReactContext.
      val react = appContext.reactContext as? ReactContext
        ?: run { promise.reject(CodedException("ERR_NO_CONTEXT", "no React context", null)); return@AsyncFunction }
      val webrtc = react.getNativeModule(WebRTCModule::class.java)
        ?: run { promise.reject(CodedException("ERR_NO_WEBRTC", "WebRTCModule is not loaded: is @livekit/react-native-webrtc in this build?", null)); return@AsyncFunction }
      val facing = (opts["facing"] as? String) ?: "back"
      val width = (opts["width"] as? Number)?.toInt() ?: 1080
      val height = (opts["height"] as? Number)?.toInt() ?: 1920
      val fps = (opts["fps"] as? Number)?.toInt() ?: 30
      val frameSource = ((opts["frameSource"] as? String) ?: "auto").let { if (it in LoudCameraXCapturer.FRAME_SOURCES) it else "auto" }
      val cap = LoudCameraXCapturer(react, facing, fps, frameSource)
      val ctl = LoudCaptureController(width, height, fps, cap)
      // WebRTCModule keeps its track table and PeerConnectionFactory on one
      // private single-thread executor (its ThreadUtils is package-private,
      // and GetUserMediaImpl, whose BiConsumer createStream() takes, is
      // too). enumerateDevices() is the one public method that runs a
      // caller-supplied callback on that executor, so it is how this code
      // gets onto it without touching anything non-public. The device
      // listing it does first is a cheap camera-id query, no camera opens.
      webrtc.enumerateDevices(Callback { _ ->
        try {
          val track = webrtc.createVideoTrack(ctl)
          if (track == null) { promise.reject(CodedException("ERR_TRACK", "createVideoTrack returned null", null)); return@Callback }
          val trackId = track.id()
          // The same two calls the JS MediaStream constructor makes for a
          // local stream. Both queue onto the executor behind this callback,
          // so they run in order once it returns.
          val streamId = UUID.randomUUID().toString()
          webrtc.mediaStreamCreate(streamId)
          webrtc.mediaStreamAddTrack(streamId, -1, trackId)
          // What JS's MediaStreamTrack(info) reads: id, kind, enabled,
          // readyState, remote, settings (createStream() builds the same map).
          val trackInfo = mapOf(
            "id" to trackId,
            "kind" to track.kind(),
            "enabled" to track.enabled(),
            "readyState" to "live",
            "remote" to false,
            "settings" to ctl.settings.toHashMap(),
          )
          capturer = cap; controller = ctl
          ticking = true; main.post(tick)
          promise.resolve(mapOf("streamId" to streamId, "trackId" to trackId, "tracks" to listOf(trackInfo), "frameSourceWanted" to frameSource))
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_START", e.message ?: "start failed", e))
        }
      })
    }

    AsyncFunction("stop") { ->
      ticking = false
      capturer?.cancelMove("stopped")
      // The track itself is released from JS (track.stop()), which makes
      // WebRTCModule stop and dispose the capturer; here we only drop refs.
      capturer = null; controller = null
      null
    }

    // One move for zooms and pans alike. steps: [{atMs, deviceZoom|null,
    // crop:[x,y,w,h]|null}] from zoomPlan.js (zoomSchedule / panPlan): a step
    // carries the device zoom and/or the crop window for THAT frame; null
    // leaves the value where it is. kind 'zoom' | 'pan'; mode 'device' |
    // 'digital' | 'device+crop' | 'crop'; requested is what the result's
    // `achieved` is compared with.
    AsyncFunction("move") { kind: String, mode: String, steps: List<Map<String, Any?>>, requested: Double, promise: Promise ->
      val cap = capturer ?: run { promise.reject(CodedException("ERR_NOT_RUNNING", "start() first", null)); return@AsyncFunction }
      val plan = LoudCameraXCapturer.Plan(kind, mode, steps.map { s ->
        @Suppress("UNCHECKED_CAST")
        val c = s["crop"] as? List<Number>
        LoudCameraXCapturer.Step(
          (s["atMs"] as Number).toLong(),
          (s["deviceZoom"] as? Number)?.toDouble(),
          if (c != null && c.size == 4) floatArrayOf(c[0].toFloat(), c[1].toFloat(), c[2].toFloat(), c[3].toFloat()) else null
        )
      }, requested) { r -> promise.resolve(r) }
      if (!cap.startMove(plan)) promise.reject(CodedException("ERR_MOVING", "a move is already in progress", null))
    }

    // Pro mode (docs/SPIKE_PRO_MODE_PLAN.md): one manual-control change,
    // answered with the value the HAL applied. Nothing runs per frame
    // until the first call; "disable" clears everything.
    AsyncFunction("setPro") { control: String, value: Any?, promise: Promise ->
      val cap = capturer ?: run { promise.reject(CodedException("ERR_NOT_RUNNING", "start() first", null)); return@AsyncFunction }
      main.post { cap.setPro(control, value) { r -> promise.resolve(r) } }
    }
    AsyncFunction("proRead") { -> capturer?.proRead() }

    // Orientation (docs/DECISIONS.md 2026-10-14): portrait | landscape,
    // fixed for the show; the JS side refuses it while live.
    AsyncFunction("setOrientation") { orientation: String, promise: Promise ->
      val cap = capturer ?: run { promise.reject(CodedException("ERR_NOT_RUNNING", "start() first", null)); return@AsyncFunction }
      main.post { promise.resolve(cap.setOrientation(orientation)) }
    }
    // One gravity reading for the setup mismatch warning (blocks up to 700 ms off the main thread).
    AsyncFunction("gravityCheck") { ->
      capturer?.gravityCheck() ?: mapOf("available" to false, "reason" to "camera not running")
    }

    AsyncFunction("cancelMove") { -> capturer?.cancelMove("cancelled"); null }
    AsyncFunction("resetFraming") { -> capturer?.resetCrop(); null }
    Function("getState") { -> capturer?.state() }
    Function("cost") { -> CostMeter.sample(appContext.reactContext!!) }

    AsyncFunction("writeGzip") { path: String, text: String ->
      val f = File(path.removePrefix("file://"))
      f.parentFile?.mkdirs()
      GZIPOutputStream(FileOutputStream(f)).use { it.write(text.toByteArray(Charsets.UTF_8)) }
      mapOf("path" to f.absolutePath, "bytes" to f.length())
    }

    AsyncFunction("uploadFile") { path: String, url: String, contentType: String, headers: Map<String, String> ->
      val f = File(path.removePrefix("file://"))
      val conn = URL(url).openConnection() as HttpURLConnection
      conn.requestMethod = "PUT"
      conn.doOutput = true
      conn.connectTimeout = 15000; conn.readTimeout = 60000
      conn.setRequestProperty("Content-Type", contentType)
      for ((k, v) in headers) conn.setRequestProperty(k, v)
      conn.setFixedLengthStreamingMode(f.length())
      FileInputStream(f).use { input -> conn.outputStream.use { out -> input.copyTo(out, 64 * 1024) } }
      val status = conn.responseCode
      val body = try { (if (status >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.readText()?.take(500) } catch (e: Exception) { null }
      conn.disconnect()
      mapOf("status" to status, "bytes" to f.length(), "body" to body)
    }
  }
}
