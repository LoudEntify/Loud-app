import Foundation
import UIKit

/// Raw cost counters; the JS side differences two samples.
enum CostMeter {
  static func sample() -> [String: Any] {
    UIDevice.current.isBatteryMonitoringEnabled = true
    let thermal = ProcessInfo.processInfo.thermalState
    let label: String
    switch thermal { case .nominal: label = "none"; case .fair: label = "light"; case .serious: label = "severe"; case .critical: label = "critical"; @unknown default: label = "unknown" }
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let kr = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: 1) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) } }
    let resident = kr == KERN_SUCCESS ? Int(info.resident_size) : -1
    return [
      "wallMs": Int64(ProcessInfo.processInfo.systemUptime * 1000),
      "cpuMs": Int64(Double(clock()) / Double(CLOCKS_PER_SEC) * 1000),
      "thermalStatus": thermal.rawValue,
      "thermalLabel": label,
      "batteryPct": UIDevice.current.batteryLevel >= 0 ? Int(UIDevice.current.batteryLevel * 100) : NSNull(),
      "batteryCharging": UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full,
      "residentBytes": resident,
      "txBytes": NSNull(), "rxBytes": NSNull()
    ]
  }
}
