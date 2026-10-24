package app.loudentify.loudcamera

import android.content.Context
import android.net.TrafficStats
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock

/**
 * Raw counters for the "cost of collection" question (DIRECTOR_DATA_SPEC
 * Part C). Absolute values only; the JS side differences two samples, so
 * the same sampler serves "collection on" and "collection off" runs.
 */
object CostMeter {
  fun sample(context: Context): Map<String, Any?> {
    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val uid = Process.myUid()
    val thermal = if (Build.VERSION.SDK_INT >= 29) pm?.currentThermalStatus else null
    val rt = Runtime.getRuntime()
    return mapOf(
      "wallMs" to SystemClock.elapsedRealtime(),
      "cpuMs" to Process.getElapsedCpuTime(),
      "thermalStatus" to thermal,          // 0 none … 6 shutdown (PowerManager.THERMAL_STATUS_*)
      "thermalLabel" to thermalLabel(thermal),
      "batteryPct" to bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY),
      "batteryCharging" to (bm?.isCharging ?: false),
      "batteryMicroAmp" to bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
      "javaHeapBytes" to (rt.totalMemory() - rt.freeMemory()),
      "nativeHeapBytes" to Debug.getNativeHeapAllocatedSize(),
      "txBytes" to TrafficStats.getUidTxBytes(uid),
      "rxBytes" to TrafficStats.getUidRxBytes(uid)
    )
  }

  private fun thermalLabel(status: Int?): String? = when (status) {
    null -> null
    PowerManager.THERMAL_STATUS_NONE -> "none"
    PowerManager.THERMAL_STATUS_LIGHT -> "light"
    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
    else -> "unknown"
  }
}
