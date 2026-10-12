package app.loudentify.loudcamera

import android.content.Context
import android.hardware.camera2.CameraCaptureSession
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
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
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
import livekit.org.webrtc.YuvHelper
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * A WebRTC VideoCapturer fed by CameraX ImageAnalysis, with the zoom and
 * pan engine of the spike in the frame path:
 *
 *   - DEVICE zoom: CameraControl.setZoomRatio(), stepped once per frame
 *     along a schedule the JS side computed (native/src/spike/zoomPlan.js).
 *     On a logical multi-camera the HAL switches lens inside that call;
 *     LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID in the capture results
 *     tells us when it did.
 *   - DIGITAL zoom and PAN: a crop window on the I420 frame, scaled back
 *     to the full output size with libyuv (VideoFrame.Buffer.cropAndScale),
 *     never above DIGITAL_ZOOM_MAX (enforced upstream in zoomPlan.js;
 *     the engine applies whatever window it is given and reports it).
 *
 * Everything the director will later want to know about a move is
 * measured here and returned with the move's result.
 */
class LoudCameraXCapturer(
  private val context: Context,
  private val facing: String,
  private val fps: Int
) : VideoCapturer {
  companion object { private const val TAG = "LoudCamera" }

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
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private val lifecycle = SpikeLifecycle()
  private val main = Handler(Looper.getMainLooper())
  private val analyzerExecutor = Executors.newSingleThreadExecutor()

  @Volatile var cameraId: String? = null
  @Volatile private var plan: Plan? = null
  // Current digital crop window in display-frame fractions: x, y, w, h.
  @Volatile private var crop = floatArrayOf(0f, 0f, 1f, 1f)
  @Volatile private var digitalFactor = 1.0

  // Capture-result telemetry (updated on the camera thread).
  @Volatile var activePhysicalId: String? = null
  @Volatile var reportedZoomRatio: Double? = null
  @Volatile var focalLengthMm: Double? = null
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
  override fun initialize(helper: SurfaceTextureHelper?, ctx: Context?, obs: CapturerObserver?) { observer = obs }
  override fun isScreencast(): Boolean = false
  override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) { /* fixed for the spike */ }
  override fun dispose() { analyzerExecutor.shutdown() }

  override fun startCapture(width: Int, height: Int, framerate: Int) {
    main.post {
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        try {
          provider = future.get()
          bind(provider!!, width, height)
          observer?.onCapturerStarted(true)
        } catch (e: Exception) {
          Log.e(TAG, "bind failed", e)
          observer?.onCapturerStarted(false)
        }
      }, ContextCompat.getMainExecutor(context))
    }
  }

  override fun stopCapture() {
    val latch = CountDownLatch(1)
    main.post {
      try { provider?.unbindAll(); lifecycle.stop() } catch (e: Exception) { Log.w(TAG, "unbind", e) }
      camera = null
      observer?.onCapturerStopped()
      latch.countDown()
    }
    latch.await(2, TimeUnit.SECONDS)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun bind(provider: ProcessCameraProvider, width: Int, height: Int) {
    val selector = CameraSelector.Builder()
      .requireLensFacing(if (facing == "front") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK)
      .build()
    val landscape = Size(max(width, height), minOf(width, height))
    val builder = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
          .setResolutionStrategy(ResolutionStrategy(landscape, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
          .build()
      )
    Camera2Interop.Extender(builder)
      .setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fps, fps))
      .setSessionCaptureCallback(captureCallback)
    val analysis = builder.build()
    analysis.setAnalyzer(analyzerExecutor) { image -> onImage(image) }
    lifecycle.start()
    camera = provider.bindToLifecycle(lifecycle, selector, analysis)
    cameraId = try { Camera2CameraInfo.from(camera!!.cameraInfo).cameraId } catch (e: Exception) { null }
  }

  private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      if (Build.VERSION.SDK_INT >= 29) activePhysicalId = result.get(CaptureResult.LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID)
      if (Build.VERSION.SDK_INT >= 30) result.get(CaptureResult.CONTROL_ZOOM_RATIO)?.let { reportedZoomRatio = it.toDouble() }
      result.get(CaptureResult.LENS_FOCAL_LENGTH)?.let { focalLengthMm = it.toDouble() }
      iso = result.get(CaptureResult.SENSOR_SENSITIVITY)
      exposureNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
      result.get(CaptureResult.LENS_FOCUS_DISTANCE)?.let { focusDistance = it.toDouble() }
      aeState = result.get(CaptureResult.CONTROL_AE_STATE)
      afState = result.get(CaptureResult.CONTROL_AF_STATE)
    }
  }

  // ── frame path ───────────────────────────────────────────────
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
    s.deviceZoom?.let { z ->
      if (p.lastRequestedDeviceZoom == null || abs(p.lastRequestedDeviceZoom!! - z) > 0.0005) {
        p.lastRequestedDeviceZoom = z
        val cam = camera
        if (cam == null) p.refusedReason = "camera not bound"
        else try {
          val fut = cam.cameraControl.setZoomRatio(z.toFloat())
          fut.addListener({ try { fut.get() } catch (e: Exception) { p.refusedReason = "setZoomRatio($z) refused: ${e.cause?.message ?: e.message}" } }, Executor { it.run() })
        } catch (e: Exception) { p.refusedReason = "setZoomRatio($z) threw: ${e.message}" }
      }
    }
    s.crop?.let { c ->
      crop = c
      digitalFactor = if (c[2] > 0f) 1.0 / c[2] else 1.0
    }
  }

  fun resetCrop() { crop = floatArrayOf(0f, 0f, 1f, 1f); digitalFactor = 1.0 }

  private fun result(p: Plan, cancelled: String?, nowMs: Long): Map<String, Any?> {
    val zs = camera?.cameraInfo?.zoomState?.value
    val device = zs?.zoomRatio?.toDouble() ?: reportedZoomRatio ?: 1.0
    val achieved = if (p.mode == "digital") digitalFactor else device
    return mapOf(
      "kind" to p.kind,
      "mode" to p.mode,
      "requested" to p.requested,
      "achieved" to round3(achieved),
      "deviceZoom" to round3(device),
      "digitalFactor" to round3(digitalFactor),
      "effectiveZoom" to round3(device * digitalFactor),
      "clamped" to (abs(achieved - p.requested) > 0.02),
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
      "cancelled" to (cancelled != null)
    )
  }

  fun state(): Map<String, Any?> {
    val zs = camera?.cameraInfo?.zoomState?.value
    val device = zs?.zoomRatio?.toDouble() ?: reportedZoomRatio
    val c = crop
    return mapOf(
      "cameraId" to cameraId,
      "activePhysicalId" to activePhysicalId,
      "deviceZoom" to device?.let { round3(it) },
      "deviceZoomMin" to zs?.minZoomRatio?.toDouble(),
      "deviceZoomMax" to zs?.maxZoomRatio?.toDouble(),
      "digitalFactor" to round3(digitalFactor),
      "effectiveZoom" to round3((device ?: 1.0) * digitalFactor),
      "crop" to mapOf("x" to c[0], "y" to c[1], "w" to c[2], "h" to c[3]),
      "focalLengthMm" to focalLengthMm,
      "iso" to iso,
      "exposureNs" to exposureNs,
      "focusDistance" to focusDistance,
      "aeState" to aeState,
      "afState" to afState,
      "width" to outputWidth, "height" to outputHeight, "rotation" to rotation,
      "fps" to round3(measuredFps),
      "frames" to frames,
      "droppedFrames" to droppedFrames,
      "convertMsPerFrame" to (if (frames > 0) round3(convertMsTotal / frames) else null),
      "moving" to (plan != null),
      "moveKind" to plan?.kind
    )
  }

  private fun round3(v: Double): Double = (v * 1000).roundToInt() / 1000.0
}
