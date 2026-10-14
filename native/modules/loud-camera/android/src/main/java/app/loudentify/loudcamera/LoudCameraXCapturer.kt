package app.loudentify.loudcamera

import android.content.Context
import android.graphics.Rect
import android.hardware.camera2.params.ColorSpaceTransform
import android.hardware.camera2.params.RggbChannelVector
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import livekit.org.webrtc.CapturerObserver
import livekit.org.webrtc.JavaI420Buffer
import livekit.org.webrtc.SurfaceTextureHelper
import livekit.org.webrtc.VideoCapturer
import livekit.org.webrtc.VideoFrame
import livekit.org.webrtc.VideoSink
import livekit.org.webrtc.YuvHelper
import java.nio.ByteBuffer
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A WebRTC VideoCapturer fed by CameraX, with the zoom and pan engine of
 * the spike in the frame path. Three FRAME SOURCES, chosen at start()
 * and reported in every state sample and move result (`frameSource`):
 *
 *   hardware  CameraX Preview straight into WebRTC's SurfaceTextureHelper
 *             (no copy), and BOTH zoom and pan done by the camera HAL
 *             through SCALER_CROP_REGION with CONTROL_ZOOM_RATIO held at
 *             1.0. Costs no CPU and no GPU. Needs SCALER_CROPPING_TYPE
 *             FREEFORM (an off-centre region on a CENTER_ONLY device is
 *             silently re-centred by the HAL). The crop-region API does
 *             not switch lenses the way zoomRatio does, so on a logical
 *             multi-camera `auto` prefers the GPU path to keep optical
 *             zoom; `hardware` forces it anyway.
 *   gpu       the same no-copy texture path; zoom via CameraControl
 *             .setZoomRatio() (CONTROL_ZOOM_RATIO: optical lens switches
 *             on multi-camera phones), pan as a crop of the OES texture
 *             (VideoFrame.TextureBuffer.cropAndScale, a matrix change the
 *             encoder's GL pass applies; no pixels are touched on the CPU).
 *   cpu       the original path, kept behind the flag for comparison:
 *             ImageAnalysis YUV frames copied to I420 and cropped/scaled
 *             with libyuv. On the Moto G35 this costs 21–30 ms per frame
 *             and the phone fell to 23 fps after 15 minutes.
 *
 * Why the hardware path holds zoomRatio at 1.0: the Camera2 reference for
 * CONTROL_ZOOM_RATIO says a crop region with zoomRatio other than 1.0 may
 * only letterbox or pillarbox, and a windowboxing region is overridden to
 * the whole active array by the framework. So a hardware pan has to carry
 * the zoom too, pre-API-30 style, within [1, SCALER_AVAILABLE_MAX_DIGITAL_ZOOM].
 *
 * The move engine is the same for all three: steps from zoomPlan.js, each
 * with an optional device zoom and an optional crop window (display-frame
 * fractions), applied once per frame. Everything the director will later
 * want to know about a move is measured here and returned with its result.
 */
class LoudCameraXCapturer(
  private val context: Context,
  private val facing: String,
  private val fps: Int,
  private val frameSourceWanted: String = "auto"
) : VideoCapturer {
  companion object {
    private const val TAG = "LoudCamera"
    val FRAME_SOURCES = listOf("auto", "hardware", "gpu", "cpu")
  }

  /** One step of a planned move. Fractions are in the DISPLAY frame (0..1). */
  class Step(val atMs: Long, val deviceZoom: Double?, val crop: FloatArray?)

  class Plan(val kind: String, val mode: String, val steps: List<Step>, val requested: Double, val onDone: (Map<String, Any?>) -> Unit) {
    var startMs = 0L
    var applied = -1
    var lensBefore: String? = null
    var droppedAtStart = 0L
    var framesAtStart = 0L
    var refusedReason: String? = null
    var lastRequestedDeviceZoom: Double? = null
  }

  private var observer: CapturerObserver? = null
  private var helper: SurfaceTextureHelper? = null
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private val lifecycle = SpikeLifecycle()
  private val main = Handler(Looper.getMainLooper())
  private val analyzerExecutor = Executors.newSingleThreadExecutor()

  @Volatile var cameraId: String? = null
  @Volatile var frameSource: String = "cpu"
  @Volatile var frameSourceReason: String? = null
  // Fallback: the paths still to try, in order, when one fails to bind or
  // delivers no frames (docs/DECISIONS.md 2026-10-14). `frameSourceFellBack`
  // is reported in every state sample so the record says a path was skipped.
  private var fallbackQueue = ArrayDeque<String>()
  @Volatile var frameSourceFellBack = false
  private var fallbackLog = ArrayList<String>()
  private var startWidth = 0
  private var startHeight = 0
  private var noFrameWatchdog: Runnable? = null
  @Volatile private var plan: Plan? = null
  // Current digital crop window in display-frame fractions: x, y, w, h.
  @Volatile private var crop = floatArrayOf(0f, 0f, 1f, 1f)
  @Volatile private var digitalFactor = 1.0

  // Hardware path: the HAL does zoom and crop in one region. `crop` then
  // IS the shot window (zoomPlan.realise sends deviceZoom 1 and the
  // window of the wide frame); digitalFactor stays 1 because nothing is
  // cropped after the sensor.
  private var activeArray: Rect? = null
  private var maxDigitalZoom = 1.0
  private var croppingFreeform = false
  private var logicalMultiCamera = false
  @Volatile private var hwRegion: Rect? = null
  @Volatile private var appliedRegion: Rect? = null
  @Volatile private var hwPushes = 0L
  @Volatile private var hwClamped = false

  // Pro mode (docs/SPIKE_PRO_MODE_PLAN.md): a map of capture-request
  // options sent only when a pro command arrives. Off by default; while
  // off, nothing below is read or written per frame (the `proEnabled`
  // flag gates the extra capture-result reads).
  @Volatile private var proEnabled = false
  private val proOptions = LinkedHashMap<CaptureRequest.Key<*>, Any>()
  @Volatile private var proColorGains: RggbChannelVector? = null
  @Volatile private var proColorTransform: ColorSpaceTransform? = null
  @Volatile private var proFrameDurationNs: Long? = null
  @Volatile private var proAeLock: Boolean? = null
  @Volatile private var proAwbLock: Boolean? = null
  @Volatile private var proAeMode: Int? = null
  @Volatile private var proAwbMode: Int? = null
  @Volatile private var proAfMode: Int? = null
  @Volatile private var proEvIndex: Int? = null
  private var isoRange: Range<Int>? = null
  private var exposureRange: Range<Long>? = null
  private var minFocusDiopters = 0f
  private var evRange: Range<Int>? = null
  private var evStep = 0.0
  private var manualSensor = false
  private var manualPost = false
  private var aeLockAvailable = false
  private var awbLockAvailable = false

  // Capture-result telemetry (updated on the camera thread).
  @Volatile var activePhysicalId: String? = null
  @Volatile var reportedZoomRatio: Double? = null
  @Volatile var focalLengthMm: Double? = null
  @Volatile var aperture: Double? = null
  @Volatile var iso: Int? = null
  @Volatile var exposureNs: Long? = null
  @Volatile var focusDistance: Double? = null
  @Volatile var aeState: Int? = null
  @Volatile var afState: Int? = null

  // Frame accounting.
  @Volatile var frames = 0L
  @Volatile var droppedFrames = 0L
  @Volatile var outputWidth = 0
  @Volatile var outputHeight = 0
  @Volatile var rotation = 0
  @Volatile var convertMsTotal = 0.0
  private var lastFrameMs = 0L
  private var framesAtLastSample = 0L
  private var sampleAtMs = 0L
  @Volatile var measuredFps = 0.0

  val moving: Boolean get() = plan != null

  // ── VideoCapturer ────────────────────────────────────────────
  override fun initialize(helper: SurfaceTextureHelper?, ctx: Context?, obs: CapturerObserver?) { observer = obs; this.helper = helper }
  override fun isScreencast(): Boolean = false
  override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) { /* fixed for the spike */ }
  override fun dispose() { analyzerExecutor.shutdown() }

  override fun startCapture(width: Int, height: Int, framerate: Int) {
    startWidth = width; startHeight = height
    // The order the paths are tried: the one asked for first, then the
    // simpler ones. `cpu` is the floor; it has run every soak so far.
    fallbackQueue = ArrayDeque(when (frameSourceWanted) {
      "cpu" -> listOf("cpu")
      "gpu" -> listOf("gpu", "cpu")
      else -> listOf(frameSourceWanted.let { if (it == "hardware") "hardware" else "auto" }, "gpu", "cpu")
    })
    main.post {
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        try {
          provider = future.get()
          bindWithFallback()
          observer?.onCapturerStarted(true)
        } catch (e: Exception) {
          Log.e(TAG, "bind failed on every frame path", e)
          frameSourceReason = "every frame path failed to start: ${e.message}"
          observer?.onCapturerStarted(false)
        }
      }, ContextCompat.getMainExecutor(context))
    }
  }

  /**
   * Bind the next frame path in the queue; a path that throws is logged
   * and the next one is tried, so a HAL that rejects the texture surface
   * or the crop region costs a fallback, never the app. A path that binds
   * but delivers no frame within 3 s is treated the same way (the
   * watchdog), as long as another path is left.
   */
  private fun bindWithFallback() {
    val p = provider ?: throw IllegalStateException("no camera provider")
    var last: Exception? = null
    while (fallbackQueue.isNotEmpty()) {
      val attempt = fallbackQueue.removeFirst()
      // `auto` may already have resolved to gpu and failed; do not try gpu twice.
      if (attempt == "gpu" && frameSource == "gpu" && frameSourceFellBack) continue
      try {
        try { p.unbindAll() } catch (e: Exception) { /* nothing bound yet */ }
        try { helper?.stopListening() } catch (e: Exception) { /* not listening yet */ }
        frames = 0; lastFrameMs = 0L; sampleAtMs = 0L; framesAtLastSample = 0L
        bind(p, startWidth, startHeight, attempt)
        armNoFrameWatchdog()
        return
      } catch (e: Exception) {
        last = e
        val why = "$attempt failed to start: ${e.message ?: e.javaClass.simpleName}"
        Log.w(TAG, why, e)
        fallbackLog.add(why)
        frameSourceFellBack = true
      }
    }
    throw last ?: IllegalStateException("no frame path to try")
  }

  private fun armNoFrameWatchdog() {
    noFrameWatchdog?.let { main.removeCallbacks(it) }
    if (fallbackQueue.isEmpty()) return
    val expected = frameSource
    val r = Runnable {
      if (frames == 0L && frameSource == expected && camera != null) {
        val why = "$expected delivered no frame in 3 s"
        Log.w(TAG, "$why: falling back")
        fallbackLog.add(why)
        frameSourceFellBack = true
        try { bindWithFallback() } catch (e: Exception) { Log.e(TAG, "fallback after no frames failed", e); frameSourceReason = "every frame path failed: ${e.message}" }
      }
    }
    noFrameWatchdog = r
    main.postDelayed(r, 3000)
  }

  override fun stopCapture() {
    val latch = CountDownLatch(1)
    main.post {
      noFrameWatchdog?.let { main.removeCallbacks(it) }; noFrameWatchdog = null
      fallbackQueue.clear()
      try { helper?.stopListening() } catch (e: Exception) { Log.w(TAG, "stopListening", e) }
      try { provider?.unbindAll(); lifecycle.stop() } catch (e: Exception) { Log.w(TAG, "unbind", e) }
      camera = null
      observer?.onCapturerStopped()
      latch.countDown()
    }
    latch.await(2, TimeUnit.SECONDS)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun bind(provider: ProcessCameraProvider, width: Int, height: Int, attempt: String = frameSourceWanted) {
    val selector = CameraSelector.Builder()
      .requireLensFacing(if (facing == "front") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK)
      .build()
    val landscape = Size(max(width, height), minOf(width, height))
    val resolution = ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
      .setResolutionStrategy(ResolutionStrategy(landscape, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
      .build()
    val wantTexture = attempt != "cpu" && helper != null
    if (attempt != "cpu" && helper == null) frameSourceReason = "no SurfaceTextureHelper from WebRTC: CPU path"

    val useCase: UseCase = if (wantTexture) {
      val builder = Preview.Builder().setResolutionSelector(resolution)
      Camera2Interop.Extender(builder)
        .setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fps, fps))
        .setSessionCaptureCallback(captureCallback)
      val preview = builder.build()
      val h = helper!!
      preview.setSurfaceProvider(ContextCompat.getMainExecutor(context)) { request ->
        val size = request.resolution
        outputWidth = size.width; outputHeight = size.height
        val st = h.surfaceTexture
        st.setDefaultBufferSize(size.width, size.height)
        h.setTextureSize(size.width, size.height)
        request.provideSurface(Surface(st), ContextCompat.getMainExecutor(context)) { result ->
          // A surface the camera will not use (resolution or format refused) is a path that failed: let the watchdog fall back.
          if (result.resultCode != androidx.camera.core.SurfaceRequest.Result.RESULT_SURFACE_USED_SUCCESSFULLY && result.resultCode != androidx.camera.core.SurfaceRequest.Result.RESULT_REQUEST_CANCELLED) {
            Log.w(TAG, "preview surface not used: code ${result.resultCode}")
            fallbackLog.add("$frameSource: preview surface refused (code ${result.resultCode})")
          }
        }
      }
      preview
    } else {
      val builder = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        .setResolutionSelector(resolution)
      Camera2Interop.Extender(builder)
        .setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fps, fps))
        .setSessionCaptureCallback(captureCallback)
      val analysis = builder.build()
      analysis.setAnalyzer(analyzerExecutor) { image -> onImage(image) }
      analysis
    }

    lifecycle.start()
    val cam = provider.bindToLifecycle(lifecycle, selector, useCase)
    camera = cam
    val info = try { Camera2CameraInfo.from(cam.cameraInfo) } catch (e: Exception) { null }
    cameraId = info?.cameraId
    readCharacteristics(info)
    frameSource = chooseFrameSource(wantTexture, attempt)
    if (fallbackLog.isNotEmpty()) frameSourceReason = "${fallbackLog.joinToString("; ")}; now $frameSource (${frameSourceReason ?: "chosen"})"
    rotation = try { cam.cameraInfo.getSensorRotationDegrees(Surface.ROTATION_0) } catch (e: Exception) { 90 }
    if (wantTexture) {
      val h = helper!!
      h.setFrameRotation(rotation)
      h.startListening(VideoSink { frame -> onTextureFrame(frame) })
      if (frameSource == "hardware") pushRegion(null)
    }
    Log.i(TAG, "bound camera $cameraId frameSource=$frameSource (${frameSourceReason ?: "chosen"}) rotation=$rotation")
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun readCharacteristics(info: Camera2CameraInfo?) {
    if (info == null) return
    try {
      activeArray = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
      maxDigitalZoom = (info.getCameraCharacteristic(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f).toDouble()
      croppingFreeform = info.getCameraCharacteristic(CameraCharacteristics.SCALER_CROPPING_TYPE) == CameraMetadata.SCALER_CROPPING_TYPE_FREEFORM
      val caps = info.getCameraCharacteristic(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList() ?: emptyList()
      logicalMultiCamera = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA)
      if (aperture == null) aperture = info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.firstOrNull()?.toDouble()
      manualSensor = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
      manualPost = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING)
      isoRange = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
      exposureRange = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
      minFocusDiopters = info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
      evRange = info.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)
      evStep = info.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.toDouble() ?: 0.0
      aeLockAvailable = info.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_LOCK_AVAILABLE) == true
      awbLockAvailable = info.getCameraCharacteristic(CameraCharacteristics.CONTROL_AWB_LOCK_AVAILABLE) == true
    } catch (e: Exception) { Log.w(TAG, "characteristics", e) }
  }

  /** The rule, so it can be read back from the result records: see the class comment. */
  private fun chooseFrameSource(texture: Boolean, attempt: String = frameSourceWanted): String {
    if (!texture) { if (frameSourceReason == null) frameSourceReason = "cpu requested"; return "cpu" }
    if (attempt == "gpu") { frameSourceReason = if (frameSourceWanted == "gpu") "gpu requested" else "gpu after fallback"; return "gpu" }
    if (activeArray == null) { frameSourceReason = "no active array size: GPU path"; return "gpu" }
    if (!croppingFreeform) { frameSourceReason = "SCALER_CROPPING_TYPE is CENTER_ONLY: the HAL would re-centre a pan; GPU path"; return "gpu" }
    if (maxDigitalZoom < 1.2) { frameSourceReason = "SCALER_AVAILABLE_MAX_DIGITAL_ZOOM $maxDigitalZoom leaves no room to crop; GPU path"; return "gpu" }
    if (logicalMultiCamera && attempt != "hardware") { frameSourceReason = "logical multi-camera: zoomRatio keeps the optical lens switch, so GPU path (force with frameSource=hardware)"; return "gpu" }
    frameSourceReason = if (attempt == "hardware") "hardware requested (FREEFORM crop, max digital zoom $maxDigitalZoom)" else "FREEFORM crop region, max digital zoom $maxDigitalZoom"
    return "hardware"
  }

  private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      if (Build.VERSION.SDK_INT >= 29) activePhysicalId = result.get(CaptureResult.LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID)
      if (Build.VERSION.SDK_INT >= 30) result.get(CaptureResult.CONTROL_ZOOM_RATIO)?.let { reportedZoomRatio = it.toDouble() }
      result.get(CaptureResult.LENS_FOCAL_LENGTH)?.let { focalLengthMm = it.toDouble() }
      result.get(CaptureResult.LENS_APERTURE)?.let { aperture = it.toDouble() }
      iso = result.get(CaptureResult.SENSOR_SENSITIVITY)
      exposureNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
      result.get(CaptureResult.LENS_FOCUS_DISTANCE)?.let { focusDistance = it.toDouble() }
      aeState = result.get(CaptureResult.CONTROL_AE_STATE)
      afState = result.get(CaptureResult.CONTROL_AF_STATE)
      appliedRegion = result.get(CaptureResult.SCALER_CROP_REGION)
      if (proEnabled) {
        // Pro mode on: the colour and lock state the HAL actually applied
        // (nothing here runs while pro mode is off).
        proColorGains = result.get(CaptureResult.COLOR_CORRECTION_GAINS)
        result.get(CaptureResult.COLOR_CORRECTION_TRANSFORM)?.let { if (!proOptions.containsKey(CaptureRequest.COLOR_CORRECTION_TRANSFORM)) proColorTransform = it }
        proFrameDurationNs = result.get(CaptureResult.SENSOR_FRAME_DURATION)
        proAeLock = result.get(CaptureResult.CONTROL_AE_LOCK)
        proAwbLock = result.get(CaptureResult.CONTROL_AWB_LOCK)
        proAeMode = result.get(CaptureResult.CONTROL_AE_MODE)
        proAwbMode = result.get(CaptureResult.CONTROL_AWB_MODE)
        proAfMode = result.get(CaptureResult.CONTROL_AF_MODE)
        proEvIndex = result.get(CaptureResult.CONTROL_AE_EXPOSURE_COMPENSATION)
      }
    }
  }

  // ── pro mode ──────────────────────────────────────────────────
  /**
   * One manual-control change (docs/SPIKE_PRO_MODE_PLAN.md section 2).
   * Builds the capture-request options for `control`, pushes the merged
   * set once through CameraX's Camera2 interop, waits for the HAL to
   * report three frames, then answers with what it actually applied.
   * Values on the wire: ISO, shutter ms, Kelvin, diopters, EV stops, or
   * 'ae' | 'awb' | 'af' for lock/unlock.
   */
  @OptIn(ExperimentalCamera2Interop::class)
  fun setPro(control: String, value: Any?, done: (Map<String, Any?>) -> Unit) {
    val cam = camera
    if (cam == null) { done(proResult(control, value, null, false, "camera not bound", supported = false)); return }
    val num = (value as? Number)?.toDouble()
    val name = value as? String
    var requested: Any? = value
    var achievedPlanned: Double? = null
    var clamped = false
    var reason: String? = null
    var fpsExpected: Double? = null
    fun clampD(v: Double, lo: Double, hi: Double): Double { val c = v.coerceIn(lo, hi); if (c != v) { clamped = true; reason = "$control $v is outside $lo–$hi; using $c" }; return c }
    try {
      when (control) {
        "enable" -> { proEnabled = true }
        "disable" -> {
          proOptions.clear(); proEnabled = false
          proColorGains = null; proFrameDurationNs = null; proAeLock = null; proAwbLock = null; proAeMode = null; proAwbMode = null; proAfMode = null; proEvIndex = null
          Camera2CameraControl.from(cam.cameraControl).clearCaptureRequestOptions()
          cam.cameraControl.setExposureCompensationIndex(0)
          done(proResult(control, value, null, false, null, supported = true)); return
        }
        "iso", "shutter" -> {
          if (!manualSensor) { done(proResult(control, value, null, false, "no MANUAL_SENSOR capability on this camera", supported = false)); return }
          if (num == null) { done(proResult(control, value, null, false, "$control needs a number", supported = true)); return }
          proEnabled = true
          val ir = isoRange; val er = exposureRange
          val isoNow = (proOptions[CaptureRequest.SENSOR_SENSITIVITY] as? Int) ?: iso ?: ir?.lower ?: 100
          val expNow = (proOptions[CaptureRequest.SENSOR_EXPOSURE_TIME] as? Long) ?: exposureNs ?: (1_000_000_000L / fps)
          var isoNew = isoNow; var expNew = expNow
          if (control == "iso") {
            isoNew = clampD(num, (ir?.lower ?: 1).toDouble(), (ir?.upper ?: 12800).toDouble()).roundToInt(); achievedPlanned = isoNew.toDouble()
          } else {
            expNew = clampD(num * 1e6, (er?.lower ?: 1000L).toDouble(), (er?.upper ?: 1_000_000_000L).toDouble()).toLong(); achievedPlanned = expNew / 1e6
          }
          val frameNs = max(1_000_000_000L / fps, expNew)
          fpsExpected = round3(1e9 / frameNs)
          proOptions[CaptureRequest.CONTROL_AE_MODE] = CameraMetadata.CONTROL_AE_MODE_OFF
          proOptions[CaptureRequest.SENSOR_SENSITIVITY] = isoNew
          proOptions[CaptureRequest.SENSOR_EXPOSURE_TIME] = expNew
          proOptions[CaptureRequest.SENSOR_FRAME_DURATION] = frameNs
        }
        "wb" -> {
          if (!manualPost) { done(proResult(control, value, null, false, "no MANUAL_POST_PROCESSING capability on this camera: the HAL will not take colour gains", supported = false)); return }
          if (num == null) { done(proResult(control, value, null, false, "wb needs a Kelvin number", supported = true)); return }
          proEnabled = true
          val k = clampD(num, 2000.0, 10000.0)
          val g = kelvinToGains(k)
          achievedPlanned = k
          proOptions[CaptureRequest.CONTROL_AWB_MODE] = CameraMetadata.CONTROL_AWB_MODE_OFF
          proOptions[CaptureRequest.COLOR_CORRECTION_MODE] = CameraMetadata.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX
          proOptions[CaptureRequest.COLOR_CORRECTION_GAINS] = g
          // The matrix the HAL last used while AWB was auto keeps the
          // sensor's colour science; without one, identity.
          proOptions[CaptureRequest.COLOR_CORRECTION_TRANSFORM] = proColorTransform ?: ColorSpaceTransform(intArrayOf(1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1))
        }
        "focus" -> {
          if (minFocusDiopters <= 0f) { done(proResult(control, value, null, false, "fixed-focus lens", supported = false)); return }
          if (num == null) { done(proResult(control, value, null, false, "focus needs a diopter number (0 = infinity)", supported = true)); return }
          proEnabled = true
          val d = clampD(num, 0.0, minFocusDiopters.toDouble())
          achievedPlanned = d
          proOptions[CaptureRequest.CONTROL_AF_MODE] = CameraMetadata.CONTROL_AF_MODE_OFF
          proOptions[CaptureRequest.LENS_FOCUS_DISTANCE] = d.toFloat()
        }
        "ev" -> {
          val r = evRange
          if (r == null || (r.lower == 0 && r.upper == 0) || evStep <= 0) { done(proResult(control, value, null, false, "exposure compensation range is empty", supported = false)); return }
          if (num == null) { done(proResult(control, value, null, false, "ev needs a number of stops", supported = true)); return }
          if (proOptions[CaptureRequest.CONTROL_AE_MODE] == CameraMetadata.CONTROL_AE_MODE_OFF) { done(proResult(control, value, null, false, "exposure compensation does nothing while ISO or shutter are set by hand (AE is off); unlock them first", supported = true)); return }
          proEnabled = true
          val idx = clampD((num / evStep), r.lower.toDouble(), r.upper.toDouble()).roundToInt()
          achievedPlanned = round3(idx * evStep)
          val fut = cam.cameraControl.setExposureCompensationIndex(idx)
          fut.addListener({ try { fut.get() } catch (e: Exception) { if (!isCancellation(e)) Log.w(TAG, "ev", e) } }, Executor { it.run() })
          val planned = achievedPlanned; val why = reason; val cl = clamped
          main.postDelayed({ done(proResult(control, value, planned, cl, why, supported = true)) }, 150)
          return
        }
        "lock", "unlock" -> {
          val on = control == "lock"
          when (name) {
            "ae" -> { if (!aeLockAvailable) { done(proResult(control, value, null, false, "AE lock is not available on this camera", supported = false)); return }; proEnabled = true; if (on) proOptions[CaptureRequest.CONTROL_AE_LOCK] = true else proOptions.remove(CaptureRequest.CONTROL_AE_LOCK) }
            "awb" -> { if (!awbLockAvailable) { done(proResult(control, value, null, false, "AWB lock is not available on this camera", supported = false)); return }; proEnabled = true; if (on) proOptions[CaptureRequest.CONTROL_AWB_LOCK] = true else proOptions.remove(CaptureRequest.CONTROL_AWB_LOCK) }
            "af" -> {
              if (minFocusDiopters <= 0f) { done(proResult(control, value, null, false, "AF lock needs manual focus, which this fixed-focus lens does not offer", supported = false)); return }
              proEnabled = true
              if (on) {
                // Camera2 has no "lock here" for AF outside a trigger sequence: hold the distance the HAL last reported.
                val d = (focusDistance ?: 0.0).toFloat().coerceIn(0f, minFocusDiopters)
                proOptions[CaptureRequest.CONTROL_AF_MODE] = CameraMetadata.CONTROL_AF_MODE_OFF
                proOptions[CaptureRequest.LENS_FOCUS_DISTANCE] = d
                achievedPlanned = d.toDouble(); reason = "locked at the current focus distance ($d diopters) via manual focus"
              } else { proOptions.remove(CaptureRequest.CONTROL_AF_MODE); proOptions.remove(CaptureRequest.LENS_FOCUS_DISTANCE) }
            }
            else -> { done(proResult(control, value, null, false, "unknown lock $name; one of ae, awb, af", supported = false)); return }
          }
          if (control == "unlock" && name != "af" && (name == "ae")) {
            // Unlocking AE also releases a manual ISO/shutter, which is what a director means by it.
            proOptions.remove(CaptureRequest.CONTROL_AE_MODE); proOptions.remove(CaptureRequest.SENSOR_SENSITIVITY); proOptions.remove(CaptureRequest.SENSOR_EXPOSURE_TIME); proOptions.remove(CaptureRequest.SENSOR_FRAME_DURATION)
          }
          if (control == "unlock" && name == "awb") { proOptions.remove(CaptureRequest.CONTROL_AWB_MODE); proOptions.remove(CaptureRequest.COLOR_CORRECTION_MODE); proOptions.remove(CaptureRequest.COLOR_CORRECTION_GAINS); proOptions.remove(CaptureRequest.COLOR_CORRECTION_TRANSFORM) }
        }
        else -> { done(proResult(control, value, null, false, "unknown control $control", supported = false)); return }
      }
      pushPro(cam)
    } catch (e: Exception) {
      done(proResult(control, value, null, false, "pro $control threw: ${e.message}", supported = true)); return
    }
    // Let the HAL report a few frames with the new request before reading back.
    val planned = achievedPlanned; val why = reason; val cl = clamped; val fpsEx = fpsExpected
    main.postDelayed({ done(proResult(control, value, planned, cl, why, supported = true, fpsExpected = fpsEx)) }, 150)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun pushPro(cam: Camera) {
    val b = CaptureRequestOptions.Builder()
    for ((k, v) in proOptions) {
      @Suppress("UNCHECKED_CAST")
      b.setCaptureRequestOption(k as CaptureRequest.Key<Any>, v)
    }
    val fut = Camera2CameraControl.from(cam.cameraControl).setCaptureRequestOptions(b.build())
    fut.addListener({ try { fut.get() } catch (e: Exception) { if (!isCancellation(e)) Log.w(TAG, "pro options", e) } }, Executor { it.run() })
  }

  /** The current exposure and colour as the HAL reports them (Match cameras, phase read). Turns the extra reads on. */
  fun proRead(): Map<String, Any?> {
    proEnabled = true
    return proReadback()
  }

  private fun proReadback(): Map<String, Any?> {
    val g = proColorGains
    return mapOf(
      "iso" to iso,
      "shutterMs" to exposureNs?.let { round3(it / 1e6) },
      "colorGains" to g?.let { mapOf("r" to round3(it.red.toDouble()), "gEven" to round3(it.greenEven.toDouble()), "gOdd" to round3(it.greenOdd.toDouble()), "b" to round3(it.blue.toDouble())) },
      "wbKelvin" to g?.let { gainsToKelvin(it.red.toDouble(), it.blue.toDouble()) },
      "focusDiopters" to focusDistance,
      "evIndex" to proEvIndex,
      "evStops" to proEvIndex?.let { round3(it * evStep) },
      "aeLock" to proAeLock, "awbLock" to proAwbLock,
      "aeMode" to proAeMode?.let { aeModeName(it) }, "awbMode" to proAwbMode?.let { awbModeName(it) }, "afMode" to proAfMode?.let { afModeName(it) },
      "frameDurationMs" to proFrameDurationNs?.let { round3(it / 1e6) },
      "fps" to round3(measuredFps)
    )
  }

  private fun proResult(control: String, requested: Any?, achieved: Double?, clamped: Boolean, reason: String?, supported: Boolean, fpsExpected: Double? = null): Map<String, Any?> {
    val rb = if (proEnabled) proReadback() else null
    // What the HAL reports for the control just set, when it reports it; else what was planned.
    val reported: Double? = when (control) {
      "iso" -> rb?.get("iso")?.let { (it as Number).toDouble() }
      "shutter" -> rb?.get("shutterMs") as? Double
      "wb" -> (rb?.get("wbKelvin") as? Number)?.toDouble()
      "focus" -> rb?.get("focusDiopters") as? Double
      "ev" -> rb?.get("evStops") as? Double
      else -> null
    }
    return mapOf(
      "control" to control, "requested" to requested, "achieved" to (reported ?: achieved), "planned" to achieved,
      "clamped" to clamped, "reason" to reason, "supported" to supported, "fpsExpected" to fpsExpected,
      "proEnabled" to proEnabled, "readback" to rb
    )
  }

  /** Kelvin → RGGB gains (Tanner Helland's black-body fit, green = 1; same maths as proMode.js kelvinToGains). */
  private fun kelvinToGains(kelvin: Double): RggbChannelVector {
    val t = kelvin.coerceIn(1000.0, 40000.0) / 100.0
    fun clamp(v: Double) = v.coerceIn(0.0, 255.0)
    val red = if (t <= 66) 255.0 else clamp(329.698727446 * Math.pow(t - 60, -0.1332047592))
    val green = if (t <= 66) clamp(99.4708025861 * ln(t) - 161.1195681661) else clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492))
    val blue = if (t >= 66) 255.0 else if (t <= 19) 0.0 else clamp(138.5177312231 * ln(t - 10) - 305.0447927307)
    val g = if (green > 0) green else 1.0
    return RggbChannelVector((g / max(red, 1.0)).toFloat(), 1f, 1f, (g / max(blue, 1.0)).toFloat())
  }

  /** The Kelvin whose gains best match the HAL's red/blue ratio (25 K steps, same search as proMode.js gainsToKelvin). */
  private fun gainsToKelvin(r: Double, b: Double): Int? {
    if (r <= 0 || b <= 0) return null
    val want = ln(r / b)
    var best = 0; var bestErr = Double.MAX_VALUE
    var k = 2000
    while (k <= 10000) {
      val g = kelvinToGains(k.toDouble())
      val err = abs(ln(g.red.toDouble() / g.blue.toDouble()) - want)
      if (err < bestErr) { bestErr = err; best = k }
      k += 25
    }
    return best
  }

  private fun aeModeName(m: Int) = when (m) { CameraMetadata.CONTROL_AE_MODE_OFF -> "off"; CameraMetadata.CONTROL_AE_MODE_ON -> "on"; else -> "mode-$m" }
  private fun awbModeName(m: Int) = when (m) { CameraMetadata.CONTROL_AWB_MODE_OFF -> "off"; CameraMetadata.CONTROL_AWB_MODE_AUTO -> "auto"; else -> "mode-$m" }
  private fun afModeName(m: Int) = when (m) { CameraMetadata.CONTROL_AF_MODE_OFF -> "off"; CameraMetadata.CONTROL_AF_MODE_AUTO -> "auto"; CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO -> "continuous-video"; CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE -> "continuous-picture"; else -> "mode-$m" }

  // ── frame path: texture (hardware / gpu) ─────────────────────
  private fun onTextureFrame(frame: VideoFrame) {
    val obs = observer ?: return
    val t0 = SystemClock.elapsedRealtimeNanos()
    val nowMs = SystemClock.elapsedRealtime()
    accountFrame(nowMs)
    advancePlan(nowMs)
    val c = crop
    if (frameSource == "gpu" && (c[2] < 0.999f || c[3] < 0.999f)) {
      val buffer = frame.buffer
      val w = buffer.width; val h = buffer.height
      val r = toSensorRect(frame.rotation, c)
      val cx = (r[0] * w).roundToInt().coerceIn(0, w - 2); val cy = (r[1] * h).roundToInt().coerceIn(0, h - 2)
      val cw = max(2, (r[2] * w).roundToInt()).coerceAtMost(w - cx); val ch = max(2, (r[3] * h).roundToInt()).coerceAtMost(h - cy)
      // A TextureBuffer crop is a change to the texture transform matrix,
      // applied when the encoder draws the texture: no pixels move here.
      val cropped = buffer.cropAndScale(cx, cy, cw, ch, w, h)
      val out = VideoFrame(cropped, frame.rotation, frame.timestampNs)
      obs.onFrameCaptured(out)
      cropped.release()
    } else {
      obs.onFrameCaptured(frame)
    }
    convertMsTotal += (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000.0
  }

  // ── frame path: cpu ──────────────────────────────────────────
  private fun onImage(image: ImageProxy) {
    val obs = observer
    if (obs == null) { image.close(); return }
    val t0 = SystemClock.elapsedRealtimeNanos()
    val nowMs = SystemClock.elapsedRealtime()
    accountFrame(nowMs)
    advancePlan(nowMs)

    val w = image.width; val h = image.height
    rotation = image.imageInfo.rotationDegrees
    outputWidth = w; outputHeight = h
    val i420 = JavaI420Buffer.allocate(w, h)
    try {
      copyToI420(image, i420)
    } finally {
      image.close()
    }

    var buffer: VideoFrame.Buffer = i420
    val c = crop
    if (c[2] < 0.999f || c[3] < 0.999f) {
      val r = toSensorRect(rotation, c)
      val cx = even((r[0] * w).roundToInt()); val cy = even((r[1] * h).roundToInt())
      val cw = even(max(2, (r[2] * w).roundToInt())).coerceAtMost(w - cx); val ch = even(max(2, (r[3] * h).roundToInt())).coerceAtMost(h - cy)
      buffer = i420.cropAndScale(cx, cy, cw, ch, w, h)
      i420.release()
    }
    val frame = VideoFrame(buffer, rotation, SystemClock.elapsedRealtimeNanos())
    obs.onFrameCaptured(frame)
    frame.release()
    convertMsTotal += (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000.0
  }

  private fun accountFrame(nowMs: Long) {
    frames += 1
    val interval = 1000.0 / fps
    if (lastFrameMs != 0L) {
      val gap = nowMs - lastFrameMs
      if (gap > interval * 1.5) droppedFrames += ((gap / interval).roundToInt() - 1).coerceAtLeast(1)
    }
    lastFrameMs = nowMs
    if (sampleAtMs == 0L) { sampleAtMs = nowMs; framesAtLastSample = frames }
    else if (nowMs - sampleAtMs >= 1000) {
      measuredFps = (frames - framesAtLastSample) * 1000.0 / (nowMs - sampleAtMs)
      sampleAtMs = nowMs; framesAtLastSample = frames
    }
  }

  private fun copyToI420(image: ImageProxy, dst: JavaI420Buffer) {
    val w = image.width; val h = image.height
    val y = image.planes[0]; val u = image.planes[1]; val v = image.planes[2]
    YuvHelper.copyPlane(y.buffer, y.rowStride, dst.dataY, dst.strideY, w, h)
    val cw = (w + 1) / 2; val ch = (h + 1) / 2
    if (u.pixelStride == 1 && v.pixelStride == 1) {
      YuvHelper.copyPlane(u.buffer, u.rowStride, dst.dataU, dst.strideU, cw, ch)
      YuvHelper.copyPlane(v.buffer, v.rowStride, dst.dataV, dst.strideV, cw, ch)
    } else {
      // Semi-planar chroma (NV12/NV21 under the YUV_420_888 contract):
      // de-interleave by hand. ~1M byte reads per 1080p frame; measured
      // as part of convertMsTotal so the spike can report it.
      deinterleave(u.buffer, u.rowStride, u.pixelStride, dst.dataU, dst.strideU, cw, ch)
      deinterleave(v.buffer, v.rowStride, v.pixelStride, dst.dataV, dst.strideV, cw, ch)
    }
  }

  private fun deinterleave(src: ByteBuffer, srcStride: Int, pixelStride: Int, dst: ByteBuffer, dstStride: Int, w: Int, h: Int) {
    val limit = src.limit()
    for (row in 0 until h) {
      val s = row * srcStride; val d = row * dstStride
      for (col in 0 until w) {
        val si = s + col * pixelStride
        if (si >= limit) return
        dst.put(d + col, src.get(si))
      }
    }
  }

  /** Display-frame crop (x,y,w,h fractions) → sensor-frame fractions for this rotation. */
  private fun toSensorRect(rot: Int, c: FloatArray): FloatArray = when (rot) {
    90 -> floatArrayOf(c[1], 1f - c[0] - c[2], c[3], c[2])
    180 -> floatArrayOf(1f - c[0] - c[2], 1f - c[1] - c[3], c[2], c[3])
    270 -> floatArrayOf(1f - c[1] - c[3], c[0], c[3], c[2])
    else -> c
  }
  private fun even(v: Int): Int = v and 1.inv()

  // ── hardware path: one crop region carries zoom and pan ──────
  /**
   * The output stream is the 16:9 band centred in the active array (the
   * HAL letterboxes the region to the stream's aspect); the crop window
   * (display-frame fractions of the wide frame) picks a sub-rectangle of
   * that band. The region can not be smaller than
   * activeArray / SCALER_AVAILABLE_MAX_DIGITAL_ZOOM; beyond that the HAL
   * rounds up, so it is clamped here and reported (`clamped`).
   */
  private fun regionFor(c: FloatArray): Pair<Rect, Boolean> {
    val a = activeArray!!
    val aw = a.width().toDouble(); val ah = a.height().toDouble()
    var bandW = aw; var bandH = aw * 9.0 / 16.0
    if (bandH > ah) { bandH = ah; bandW = ah * 16.0 / 9.0 }
    val bandL = a.left + (aw - bandW) / 2.0; val bandT = a.top + (ah - bandH) / 2.0
    val s = toSensorRect(rotation, c)
    var fx = s[0].toDouble(); var fy = s[1].toDouble()
    var fw = s[2].toDouble(); var fh = s[3].toDouble()
    val minW = aw / maxDigitalZoom / bandW; val minH = ah / maxDigitalZoom / bandH
    var clamped = false
    if (fw < minW || fh < minH) {
      val k = max(minW / fw, minH / fh)
      val cx = fx + fw / 2; val cy = fy + fh / 2
      fw *= k; fh *= k; fx = cx - fw / 2; fy = cy - fh / 2; clamped = true
    }
    fx = fx.coerceIn(0.0, 1.0 - fw); fy = fy.coerceIn(0.0, 1.0 - fh)
    val l = (bandL + fx * bandW).roundToInt(); val t = (bandT + fy * bandH).roundToInt()
    val r = (bandL + (fx + fw) * bandW).roundToInt(); val b = (bandT + (fy + fh) * bandH).roundToInt()
    return Rect(max(a.left, l), max(a.top, t), min(a.right, r), min(a.bottom, b)) to clamped
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun pushRegion(p: Plan?) {
    val cam = camera ?: return
    if (activeArray == null) return
    val (rect, clamped) = regionFor(crop)
    hwClamped = clamped
    val last = hwRegion
    if (last != null && last == rect) return
    hwRegion = rect
    hwPushes += 1
    try {
      val opts = CaptureRequestOptions.Builder().setCaptureRequestOption(CaptureRequest.SCALER_CROP_REGION, rect).build()
      val fut = Camera2CameraControl.from(cam.cameraControl).setCaptureRequestOptions(opts)
      fut.addListener({ try { fut.get() } catch (e: Exception) { if (!isCancellation(e) && p != null) p.refusedReason = "crop region $rect refused: ${e.cause?.message ?: e.message}" } }, Executor { it.run() })
    } catch (e: Exception) { if (p != null) p.refusedReason = "crop region threw: ${e.message}" }
  }

  /** CameraX cancels the previous setZoomRatio / options future whenever a newer value lands: at 30 steps a second that is expected, not a refusal. */
  private fun isCancellation(e: Throwable): Boolean {
    var t: Throwable? = e
    while (t != null) {
      if (t is CancellationException) return true
      val m = t.message ?: ""
      if (m.contains("Cancelled", ignoreCase = true) || m.contains("Canceled", ignoreCase = true)) return true
      t = t.cause
    }
    return false
  }

  // ── move engine ──────────────────────────────────────────────
  /** Start a move. `steps` come from zoomPlan.js; the promise behind onDone resolves when the last step has been applied. */
  fun startMove(p: Plan): Boolean {
    if (plan != null) return false
    p.lensBefore = activePhysicalId
    p.droppedAtStart = droppedFrames
    p.framesAtStart = frames
    plan = p
    return true
  }

  fun cancelMove(reason: String) {
    val p = plan ?: return
    plan = null
    p.onDone(result(p, reason, SystemClock.elapsedRealtime()))
  }

  private fun advancePlan(nowMs: Long) {
    val p = plan ?: return
    if (p.startMs == 0L) p.startMs = nowMs
    val elapsed = nowMs - p.startMs
    var idx = p.applied
    while (idx + 1 < p.steps.size && p.steps[idx + 1].atMs <= elapsed) idx += 1
    if (idx > p.applied) {
      applyStep(p, p.steps[idx])
      p.applied = idx
    }
    if (p.applied >= p.steps.size - 1) {
      plan = null
      p.onDone(result(p, null, nowMs))
    }
  }

  private fun applyStep(p: Plan, s: Step) {
    if (frameSource == "hardware") {
      // The step's deviceZoom is 1 by construction (zoomPlan.realise): the
      // window carries the zoom, the HAL applies it, nothing is digital.
      s.crop?.let { c -> crop = c; pushRegion(p) }
      return
    }
    s.deviceZoom?.let { z ->
      if (p.lastRequestedDeviceZoom == null || abs(p.lastRequestedDeviceZoom!! - z) > 0.0005) {
        p.lastRequestedDeviceZoom = z
        val cam = camera
        if (cam == null) p.refusedReason = "camera not bound"
        else try {
          val fut = cam.cameraControl.setZoomRatio(z.toFloat())
          fut.addListener({ try { fut.get() } catch (e: Exception) { if (!isCancellation(e)) p.refusedReason = "setZoomRatio($z) refused: ${e.cause?.message ?: e.message}" } }, Executor { it.run() })
        } catch (e: Exception) { p.refusedReason = "setZoomRatio($z) threw: ${e.message}" }
      }
    }
    s.crop?.let { c ->
      crop = c
      digitalFactor = if (c[2] > 0f) 1.0 / c[2] else 1.0
    }
  }

  fun resetCrop() {
    crop = floatArrayOf(0f, 0f, 1f, 1f); digitalFactor = 1.0
    if (frameSource == "hardware") pushRegion(null)
  }

  /** Hardware: the zoom the HAL's last applied region implies (planned window until the first result lands); otherwise CameraX's zoom ratio. */
  private fun currentDeviceZoom(): Double? {
    if (frameSource == "hardware") {
      val applied = appliedCropMap()?.get("zoom") as? Double
      return applied ?: (if (crop[2] > 0f) 1.0 / crop[2] else 1.0)
    }
    val zs = camera?.cameraInfo?.zoomState?.value
    return zs?.zoomRatio?.toDouble() ?: reportedZoomRatio
  }

  private fun zoomRange(): Pair<Double?, Double?> {
    if (frameSource == "hardware") return 1.0 to maxDigitalZoom
    val zs = camera?.cameraInfo?.zoomState?.value
    return zs?.minZoomRatio?.toDouble() to zs?.maxZoomRatio?.toDouble()
  }

  /** The HAL's own answer to the last region request, as fractions of the 16:9 band, plus the zoom it implies. */
  private fun appliedCropMap(): Map<String, Any?>? {
    val a = activeArray ?: return null
    val r = appliedRegion ?: return null
    val aw = a.width().toDouble(); val ah = a.height().toDouble()
    var bandW = aw; var bandH = aw * 9.0 / 16.0
    if (bandH > ah) { bandH = ah; bandW = ah * 16.0 / 9.0 }
    val bandL = a.left + (aw - bandW) / 2.0; val bandT = a.top + (ah - bandH) / 2.0
    return mapOf(
      "x" to round3((r.left - bandL) / bandW), "y" to round3((r.top - bandT) / bandH),
      "w" to round3(r.width() / bandW), "h" to round3(r.height() / bandH),
      "zoom" to round3(bandW / r.width().toDouble()),
      "px" to mapOf("left" to r.left, "top" to r.top, "right" to r.right, "bottom" to r.bottom)
    )
  }

  /** Scene brightness as an exposure value at ISO 100 (higher = brighter); null until the lens aperture is known. */
  private fun sceneEv(): Double? {
    val f = aperture ?: return null
    val t = (exposureNs ?: return null) / 1e9
    val s = iso ?: return null
    if (f <= 0 || t <= 0 || s <= 0) return null
    val log2 = { v: Double -> ln(v) / ln(2.0) }
    return round3(log2(f * f / t) - log2(s / 100.0))
  }

  /**
   * The move's result. `achieved` is the effective zoom (device x crop)
   * for every kind; for a pan the JS side replaces requested/achieved/
   * clamped with the travel it asked for and got (zoomPlan.panPlan), so
   * `clamped` here is only judged for a zoom.
   */
  private fun result(p: Plan, cancelled: String?, nowMs: Long): Map<String, Any?> {
    val device = currentDeviceZoom() ?: 1.0
    val achieved = device * digitalFactor
    return mapOf(
      "kind" to p.kind,
      "mode" to p.mode,
      "frameSource" to frameSource,
      "requested" to p.requested,
      "achieved" to round3(achieved),
      "deviceZoom" to round3(device),
      "digitalFactor" to round3(digitalFactor),
      "effectiveZoom" to round3(device * digitalFactor),
      "clamped" to ((p.kind == "zoom" && abs(achieved - p.requested) > 0.02) || (frameSource == "hardware" && hwClamped)),
      "regionClamped" to (frameSource == "hardware" && hwClamped),
      "reason" to (cancelled ?: p.refusedReason),
      "lens" to activePhysicalId,
      "lensBefore" to p.lensBefore,
      "lensSwitch" to (p.lensBefore != null && activePhysicalId != null && p.lensBefore != activePhysicalId),
      "droppedFrames" to (droppedFrames - p.droppedAtStart),
      "framesDuring" to (frames - p.framesAtStart),
      "actualDurationMs" to (if (p.startMs == 0L) 0L else nowMs - p.startMs),
      "plannedDurationMs" to (p.steps.lastOrNull()?.atMs ?: 0L),
      "stepsPlanned" to p.steps.size,
      "stepsApplied" to (p.applied + 1),
      "cancelled" to (cancelled != null),
      "appliedCrop" to appliedCropMap()
    )
  }

  fun state(): Map<String, Any?> {
    val device = currentDeviceZoom()
    val (zMin, zMax) = zoomRange()
    val c = crop
    return mapOf(
      "cameraId" to cameraId,
      "frameSource" to frameSource,
      "frameSourceReason" to frameSourceReason,
      "frameSourceFellBack" to frameSourceFellBack,
      "frameSourceAttempts" to fallbackLog.toList(),
      "activePhysicalId" to activePhysicalId,
      "deviceZoom" to device?.let { round3(it) },
      "deviceZoomMin" to zMin,
      "deviceZoomMax" to zMax,
      "digitalFactor" to round3(digitalFactor),
      "effectiveZoom" to round3((device ?: 1.0) * digitalFactor),
      "crop" to mapOf("x" to c[0], "y" to c[1], "w" to c[2], "h" to c[3]),
      "appliedCrop" to appliedCropMap(),
      "regionPushes" to hwPushes,
      "focalLengthMm" to focalLengthMm,
      "aperture" to aperture,
      "iso" to iso,
      "exposureNs" to exposureNs,
      "exposureMs" to exposureNs?.let { round3(it / 1e6) },
      "sceneEv" to sceneEv(),
      "focusDistance" to focusDistance,
      "aeState" to aeState,
      "afState" to afState,
      "width" to outputWidth, "height" to outputHeight, "rotation" to rotation,
      "fps" to round3(measuredFps),
      "frames" to frames,
      "droppedFrames" to droppedFrames,
      "convertMsPerFrame" to (if (frames > 0) round3(convertMsTotal / frames) else null),
      "moving" to (plan != null),
      "moveKind" to plan?.kind,
      // Pro mode: the applied exposure/colour/lock state while on; one flag while off (no extra reads).
      "pro" to (if (proEnabled) proReadback() + mapOf("enabled" to true) else mapOf("enabled" to false))
    )
  }

  private fun round3(v: Double): Double = (v * 1000).roundToInt() / 1000.0
}
