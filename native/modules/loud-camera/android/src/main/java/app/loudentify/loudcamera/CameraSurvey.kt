package app.loudentify.loudcamera

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.os.Build
import kotlin.math.atan
import kotlin.math.roundToInt

/**
 * The B2 capability profile, read from Camera2 characteristics alone: no
 * camera is opened, no permission is needed, so a device farm can run it
 * on a locked-down phone. Field names match native/src/spike/survey.js
 * PROFILE_SHAPE; survey.js normalises what comes back.
 *
 * "Device zoom" here is CONTROL_ZOOM_RATIO_RANGE (Android 11+): the range
 * the camera HAL applies itself, including the optical lens switch on a
 * logical multi-camera and the HAL's own crop beyond the longest lens.
 * The optical part is reported separately as opticalMaxZoom, so the
 * director can tell a 3x that is a lens from a 3x that is the ISP cropping.
 */
object CameraSurvey {
  fun profile(context: Context): Map<String, Any?> {
    val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val lenses = ArrayList<Map<String, Any?>>()
    var back: Map<String, Any?>? = null
    for (id in cm.cameraIdList) {
      val ch = try { cm.getCameraCharacteristics(id) } catch (e: Exception) { continue }
      val entry = describe(id, ch, cm)
      lenses.add(entry)
      if (back == null && ch.get(CameraCharacteristics.LENS_FACING) == CameraMetadata.LENS_FACING_BACK) back = entry
    }
    val primary = back ?: lenses.firstOrNull()
    @Suppress("UNCHECKED_CAST")
    val dz = (primary?.get("deviceZoom") as? Map<String, Any?>) ?: mapOf("available" to false, "min" to 1.0, "max" to 1.0, "reason" to "no camera")
    return mapOf(
      "make" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "os" to "android",
      "osVersion" to Build.VERSION.RELEASE,
      "sdkInt" to Build.VERSION.SDK_INT,
      "primaryCameraId" to primary?.get("id"),
      "lenses" to lenses,
      "deviceZoom" to dz,
      "maxResolution" to primary?.get("maxResolution"),
      "maxFrameRate" to primary?.get("maxFrameRate"),
      "stabilisation" to primary?.get("stabilisation"),
      "manualFocus" to primary?.get("manualFocus"),
      "manualExposure" to primary?.get("manualExposure"),
      "logicalMultiCamera" to primary?.get("logicalMultiCamera"),
      "physicalIds" to primary?.get("physicalIds")
    )
  }

  private fun describe(id: String, ch: CameraCharacteristics, cm: CameraManager): Map<String, Any?> {
    val facing = when (ch.get(CameraCharacteristics.LENS_FACING)) {
      CameraMetadata.LENS_FACING_BACK -> "back"; CameraMetadata.LENS_FACING_FRONT -> "front"; else -> "external"
    }
    val focals = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList() ?: emptyList()
    val physical = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
    val focal = focals.minOrNull()
    val fov = if (physical != null && focal != null && focal > 0f) Math.toDegrees(2.0 * atan((physical.width / (2.0 * focal)))) else null
    val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList() ?: emptyList()
    val logical = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA)
    val physicalIds = if (Build.VERSION.SDK_INT >= 28) ch.physicalCameraIds.toList() else emptyList()

    // Zoom range as the HAL will apply it.
    var zMin = 1.0; var zMax = 1.0; var reason: String? = null
    if (Build.VERSION.SDK_INT >= 30) {
      val r = ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
      if (r != null) { zMin = r.lower.toDouble(); zMax = r.upper.toDouble() } else reason = "CONTROL_ZOOM_RATIO_RANGE missing"
    } else {
      val d = ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)
      if (d != null) zMax = d.toDouble()
      reason = "Android ${Build.VERSION.RELEASE}: SCALER_AVAILABLE_MAX_DIGITAL_ZOOM only (crop region API)"
    }
    val available = zMax > zMin && zMax > 1.0001
    if (!available && reason == null) reason = "zoom range is $zMin to $zMax"

    // Optical reach and switch-over factors from the physical lenses, and
    // each lens's sensor (survey.js turns these into the zoom ranges and
    // the 1080p quality ceiling). A camera with no physical ids is its
    // own one lens.
    val physicalLenses = ArrayList<Map<String, Any?>>()
    val physicalFocals = ArrayList<Double>()
    for (pid in physicalIds) {
      val pch = try { cm.getCameraCharacteristics(pid) } catch (e: Exception) { null } ?: continue
      val pf = pch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull()?.toDouble()
      if (pf != null) physicalFocals.add(pf)
      physicalLenses.add(mapOf("id" to pid, "focalLengthMm" to pf, "sensor" to sensorOf(pch)))
    }
    if (physicalLenses.isEmpty()) physicalLenses.add(mapOf("id" to id, "focalLengthMm" to focal?.toDouble(), "sensor" to sensorOf(ch)))
    val shortest = physicalFocals.minOrNull()
    val switchOver = if (shortest != null && shortest > 0) physicalFocals.map { round2(it / shortest) }.filter { it > 1.01 }.distinct().sorted() else emptyList()
    val opticalMax = if (switchOver.isNotEmpty()) switchOver.last() else 1.0

    // Which frame path LoudCameraXCapturer.chooseFrameSource would pick
    // for this camera (same rule, so the survey can say it without
    // opening the camera).
    val sensor = sensorOf(ch)
    val freeform = sensor["croppingType"] == "freeform"
    val maxDigital = sensor["maxDigitalZoom"] as Double
    val frameSource = when {
      !freeform -> mapOf("eligible" to "gpu", "reason" to "SCALER_CROPPING_TYPE is CENTER_ONLY: the HAL would re-centre a pan")
      maxDigital < 1.2 -> mapOf("eligible" to "gpu", "reason" to "SCALER_AVAILABLE_MAX_DIGITAL_ZOOM $maxDigital leaves no room to crop")
      logical -> mapOf("eligible" to "gpu", "reason" to "logical multi-camera: zoomRatio keeps the optical lens switch (hardware can be forced)")
      else -> mapOf("eligible" to "hardware", "reason" to "FREEFORM crop region, max digital zoom $maxDigital")
    }

    val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    val sizes = map?.getOutputSizes(ImageFormat.YUV_420_888)?.toList() ?: emptyList()
    val biggest = sizes.maxByOrNull { it.width.toLong() * it.height.toLong() }
    val fpsRanges = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.toList() ?: emptyList()
    val maxFps = fpsRanges.maxOfOrNull { it.upper } ?: 30

    val stab = ArrayList<String>()
    ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)?.forEach {
      when (it) {
        CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON -> stab.add("eis")
        2 -> stab.add("eis-preview") // CONTROL_VIDEO_STABILIZATION_MODE_PREVIEW_STABILIZATION (API 33)
      }
    }
    ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)?.forEach { if (it == CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON) stab.add("ois") }

    val afModes = ch.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toList() ?: emptyList()
    val minFocus = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
    val manualFocus = minFocus > 0f && afModes.contains(CameraMetadata.CONTROL_AF_MODE_OFF)
    val manualExposure = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)

    return mapOf(
      "id" to id,
      "facing" to facing,
      "focalLengthMm" to focal?.toDouble(),
      "focalLengthsMm" to focals.map { it.toDouble() },
      "sensorMm" to if (physical != null) mapOf("width" to physical.width.toDouble(), "height" to physical.height.toDouble()) else null,
      "sensor" to sensor,
      "physicalLenses" to physicalLenses,
      "frameSource" to frameSource,
      "fieldOfViewDeg" to fov?.let { round2(it) },
      "maxZoomOnThisLens" to zMax,
      "deviceZoom" to mapOf(
        "available" to available, "min" to zMin, "max" to zMax, "reason" to reason,
        "smoothRamp" to false, // Android has no ramp API: the spike steps the ratio once per frame
        "switchOverFactors" to switchOver, "opticalMaxZoom" to opticalMax,
        "ispDigitalBeyondOptical" to (zMax > opticalMax + 0.01)
      ),
      "logicalMultiCamera" to logical,
      "physicalIds" to physicalIds,
      "maxResolution" to if (biggest != null) mapOf("width" to biggest.width, "height" to biggest.height) else null,
      "maxFrameRate" to maxFps,
      "stabilisation" to stab,
      "manualFocus" to manualFocus,
      "manualExposure" to manualExposure,
      "hardwareLevel" to ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
    )
  }

  /**
   * The sensor behind one camera id: the active array (what a frame can
   * come from), the pixel array, how the HAL crops (FREEFORM lets a crop
   * region sit off-centre; CENTER_ONLY re-centres it), the most it will
   * crop, and the lens apertures (for the low-light measure in B4).
   */
  private fun sensorOf(ch: CameraCharacteristics): Map<String, Any?> {
    val active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
    val pixels = ch.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
    val cropping = when (ch.get(CameraCharacteristics.SCALER_CROPPING_TYPE)) {
      CameraMetadata.SCALER_CROPPING_TYPE_FREEFORM -> "freeform"
      CameraMetadata.SCALER_CROPPING_TYPE_CENTER_ONLY -> "center-only"
      else -> null
    }
    return mapOf(
      "activeArray" to if (active != null) mapOf("width" to active.width(), "height" to active.height(), "left" to active.left, "top" to active.top) else null,
      "pixelArray" to if (pixels != null) mapOf("width" to pixels.width, "height" to pixels.height) else null,
      "croppingType" to cropping,
      "maxDigitalZoom" to (ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)?.toDouble() ?: 1.0),
      "apertures" to (ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.map { it.toDouble() } ?: emptyList<Double>())
    )
  }

  private fun round2(v: Double): Double = (v * 100).roundToInt() / 100.0
}
