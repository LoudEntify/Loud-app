import AVFoundation
import UIKit

/// B2 capability profile from AVCaptureDevice alone (no session started, no
/// permission prompt). Field names follow native/src/spike/survey.js.
enum CameraSurvey {
  static let backTypes: [AVCaptureDevice.DeviceType] = [
    .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera,
    .builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTelephotoCamera
  ]

  static func primaryBackDevice() -> AVCaptureDevice? {
    for t in [AVCaptureDevice.DeviceType.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera] {
      if let d = AVCaptureDevice.default(t, for: .video, position: .back) { return d }
    }
    return nil
  }

  static func profile() -> [String: Any] {
    let session = AVCaptureDevice.DiscoverySession(deviceTypes: backTypes + [.builtInWideAngleCamera], mediaType: .video, position: .unspecified)
    var lenses: [[String: Any]] = []
    for d in session.devices { lenses.append(describe(d)) }
    let primary = primaryBackDevice()
    let primaryDesc = primary.map(describe)
    var modelId = ""
    var sys = utsname(); uname(&sys)
    withUnsafePointer(to: &sys.machine) { p in p.withMemoryRebound(to: CChar.self, capacity: 1) { modelId = String(cString: $0) } }
    return [
      "make": "Apple",
      "model": modelId,
      "os": "ios",
      "osVersion": UIDevice.current.systemVersion,
      "primaryCameraId": primary?.uniqueID ?? NSNull(),
      "lenses": lenses,
      "deviceZoom": primaryDesc?["deviceZoom"] ?? ["available": false, "min": 1.0, "max": 1.0, "reason": "no back camera"],
      "maxResolution": primaryDesc?["maxResolution"] ?? NSNull(),
      "maxFrameRate": primaryDesc?["maxFrameRate"] ?? NSNull(),
      "stabilisation": primaryDesc?["stabilisation"] ?? [],
      "manualFocus": primaryDesc?["manualFocus"] ?? false,
      "manualExposure": primaryDesc?["manualExposure"] ?? false,
      "logicalMultiCamera": primaryDesc?["logicalMultiCamera"] ?? false,
      "physicalIds": primaryDesc?["physicalIds"] ?? []
    ]
  }

  static func describe(_ d: AVCaptureDevice) -> [String: Any] {
    let minZ = Double(d.minAvailableVideoZoomFactor)
    let maxZ = Double(d.maxAvailableVideoZoomFactor)
    let available = maxZ > minZ && maxZ > 1.0001
    let switchOver = d.virtualDeviceSwitchOverVideoZoomFactors.map { Double(truncating: $0) }
    var maxW = 0, maxH = 0, maxFps = 0.0
    var stab = Set<String>()
    for f in d.formats {
      let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
      if Int(dim.width) * Int(dim.height) > maxW * maxH { maxW = Int(dim.width); maxH = Int(dim.height) }
      for r in f.videoSupportedFrameRateRanges where r.maxFrameRate > maxFps { maxFps = r.maxFrameRate }
      if f.isVideoStabilizationModeSupported(.standard) { stab.insert("standard") }
      if f.isVideoStabilizationModeSupported(.cinematic) { stab.insert("cinematic") }
      if f.isVideoStabilizationModeSupported(.cinematicExtended) { stab.insert("cinematicExtended") }
    }
    let facing: String = d.position == .back ? "back" : d.position == .front ? "front" : "external"
    // The optical reach of a virtual device is its last switch-over factor;
    // everything beyond is the ISP cropping the longest lens.
    let opticalMax = switchOver.last ?? 1.0
    return [
      "id": d.uniqueID,
      "type": d.deviceType.rawValue,
      "name": d.localizedName,
      "facing": facing,
      "fieldOfViewDeg": Double(d.activeFormat.videoFieldOfView),
      "maxZoomOnThisLens": maxZ,
      "deviceZoom": [
        "available": available, "min": minZ, "max": maxZ,
        "reason": available ? NSNull() : "zoom range is \(minZ) to \(maxZ)",
        "smoothRamp": true, // AVCaptureDevice.ramp(toVideoZoomFactor:withRate:)
        "switchOverFactors": switchOver,
        "opticalMaxZoom": opticalMax,
        "ispDigitalBeyondOptical": maxZ > opticalMax + 0.01
      ] as [String: Any],
      "logicalMultiCamera": d.isVirtualDevice,
      "physicalIds": d.constituentDevices.map { $0.uniqueID },
      "maxResolution": ["width": maxW, "height": maxH],
      "maxFrameRate": maxFps,
      "stabilisation": Array(stab).sorted(),
      "manualFocus": d.isLockingFocusWithCustomLensPositionSupported,
      "manualExposure": d.isExposureModeSupported(.custom)
    ]
  }
}
