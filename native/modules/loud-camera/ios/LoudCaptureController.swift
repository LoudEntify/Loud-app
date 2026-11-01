import AVFoundation
import Foundation
import LiveKitWebRTC
import livekit_react_native_webrtc

/// Custom capturer for the LiveKit fork: WebRTCModule.createVideoTrack(withCaptureController:)
/// hands us the LKRTCVideoSource, we feed it frames from our own
/// AVCaptureSession, and the track becomes an ordinary local track.
///
/// Device zoom uses AVCaptureDevice.ramp(toVideoZoomFactor:withRate:) (the
/// phone's own smooth ramp, lens switching included on virtual devices);
/// digital zoom and pan are a crop rectangle on the pixel buffer
/// (LKRTCCVPixelBuffer adapted/cropped), scaled back to the full size.
///
/// NOT COMPILED in this repository (no macOS runner); see the podspec.
class LoudCaptureController: CaptureController, AVCaptureVideoDataOutputSampleBufferDelegate {
  struct Step { let atMs: Int64; let deviceZoom: Double?; let crop: [Float]? }
  final class Plan {
    let kind: String; let mode: String; let steps: [Step]; let requested: Double; let onDone: ([String: Any]) -> Void
    var startMs: Int64 = 0; var applied = -1; var lensBefore: String?; var droppedAtStart: Int64 = 0; var framesAtStart: Int64 = 0
    var refusedReason: String?; var rampStarted = false
    init(kind: String, mode: String, steps: [Step], requested: Double, onDone: @escaping ([String: Any]) -> Void) {
      self.kind = kind; self.mode = mode; self.steps = steps; self.requested = requested; self.onDone = onDone
    }
  }

  private let source: LKRTCVideoSource
  private let capturer: LKRTCVideoCapturer
  private let facing: String
  private let fps: Int
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "app.loudentify.loudcamera.frames")
  private var device: AVCaptureDevice?
  private var plan: Plan?
  private var crop: [Float] = [0, 0, 1, 1]
  private(set) var digitalFactor: Double = 1
  private(set) var frames: Int64 = 0
  private(set) var droppedFrames: Int64 = 0
  private var lastFrameMs: Int64 = 0
  private var sampleAtMs: Int64 = 0
  private var framesAtLastSample: Int64 = 0
  private(set) var measuredFps: Double = 0
  private(set) var outputWidth = 0
  private(set) var outputHeight = 0
  var moving: Bool { plan != nil }

  init(source: LKRTCVideoSource, facing: String, fps: Int) {
    self.source = source
    self.capturer = LKRTCVideoCapturer(delegate: source)
    self.facing = facing
    self.fps = fps
    super.init()
  }

  private func nowMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }

  override func startCapture() {
    queue.async { self.configureAndStart() }
  }

  override func stopCapture() {
    queue.async { self.session.stopRunning(); self.plan.map { self.finish($0, cancelled: "stopped") } }
  }

  override func getSettings() -> [AnyHashable: Any] {
    ["deviceId": device?.uniqueID ?? "", "groupId": "", "width": outputWidth, "height": outputHeight, "frameRate": fps]
  }

  private func configureAndStart() {
    let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
    let dev = (position == .back ? CameraSurvey.primaryBackDevice() : AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front))
      ?? AVCaptureDevice.default(for: .video)
    guard let dev = dev, let input = try? AVCaptureDeviceInput(device: dev) else { return }
    device = dev
    session.beginConfiguration()
    session.sessionPreset = .inputPriority
    if session.canAddInput(input) { session.addInput(input) }
    // Pick a 1080p 4:2:0 full-range format that can do `fps`.
    if let fmt = dev.formats.first(where: { f in
      let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
      let type = CMFormatDescriptionGetMediaSubType(f.formatDescription)
      return dim.width == 1920 && dim.height == 1080 && type == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= Double(fps) }
    }) {
      if (try? dev.lockForConfiguration()) != nil {
        dev.activeFormat = fmt
        dev.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
        dev.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
        dev.unlockForConfiguration()
      }
    }
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()
    session.startRunning()
  }

  // MARK: frames
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let t = nowMs()
    accountFrame(t)
    advancePlan(t)
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    outputWidth = w; outputHeight = h
    let rotation: LKRTCVideoRotation = facing == "front" ? ._270 : ._90
    let buffer: LKRTCCVPixelBuffer
    let c = crop
    if c[2] < 0.999 || c[3] < 0.999 {
      let r = toSensorRect(rotation, c)
      let cx = even(Int(r[0] * Float(w))), cy = even(Int(r[1] * Float(h)))
      let cw = min(even(max(2, Int(r[2] * Float(w)))), w - cx), ch = min(even(max(2, Int(r[3] * Float(h)))), h - cy)
      buffer = LKRTCCVPixelBuffer(pixelBuffer: pb, adaptedWidth: Int32(w), adaptedHeight: Int32(h), cropWidth: Int32(cw), cropHeight: Int32(ch), cropX: Int32(cx), cropY: Int32(cy))
    } else {
      buffer = LKRTCCVPixelBuffer(pixelBuffer: pb)
    }
    let ts = Int64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1_000_000_000)
    let frame = LKRTCVideoFrame(buffer: buffer, rotation: rotation, timeStampNs: ts)
    source.capturer(capturer, didCapture: frame)
  }

  private func accountFrame(_ t: Int64) {
    frames += 1
    let interval = 1000.0 / Double(fps)
    if lastFrameMs != 0 {
      let gap = Double(t - lastFrameMs)
      if gap > interval * 1.5 { droppedFrames += max(1, Int64((gap / interval).rounded()) - 1) }
    }
    lastFrameMs = t
    if sampleAtMs == 0 { sampleAtMs = t; framesAtLastSample = frames }
    else if t - sampleAtMs >= 1000 { measuredFps = Double(frames - framesAtLastSample) * 1000 / Double(t - sampleAtMs); sampleAtMs = t; framesAtLastSample = frames }
  }

  private func toSensorRect(_ rot: LKRTCVideoRotation, _ c: [Float]) -> [Float] {
    switch rot {
    case ._90: return [c[1], 1 - c[0] - c[2], c[3], c[2]]
    case ._180: return [1 - c[0] - c[2], 1 - c[1] - c[3], c[2], c[3]]
    case ._270: return [1 - c[1] - c[3], c[0], c[3], c[2]]
    default: return c
    }
  }
  private func even(_ v: Int) -> Int { v & ~1 }

  // MARK: move engine
  func startMove(_ p: Plan) -> Bool {
    var ok = false
    queue.sync {
      guard plan == nil else { return }
      p.lensBefore = activeLens(); p.droppedAtStart = droppedFrames; p.framesAtStart = frames
      plan = p; ok = true
    }
    return ok
  }

  func cancelMove(_ reason: String) { queue.async { if let p = self.plan { self.finish(p, cancelled: reason) } } }
  func resetCrop() { queue.async { self.crop = [0, 0, 1, 1]; self.digitalFactor = 1 } }

  private func advancePlan(_ t: Int64) {
    guard let p = plan else { return }
    if p.startMs == 0 { p.startMs = t }
    let elapsed = t - p.startMs
    // Device zoom on iOS is one ramp call, issued at the first frame of the
    // move with the rate that lands it on time; the steps then only carry
    // the crop windows (pan / digital).
    if !p.rampStarted {
      p.rampStarted = true
      if let target = p.steps.compactMap({ $0.deviceZoom }).last, let dev = device {
        let seconds = max(0.05, Double(p.steps.last?.atMs ?? 0) / 1000)
        let rate = Float(abs(log2(target / Double(dev.videoZoomFactor))) / seconds)
        do {
          try dev.lockForConfiguration()
          let clamped = min(max(target, Double(dev.minAvailableVideoZoomFactor)), Double(dev.maxAvailableVideoZoomFactor))
          if p.kind == "pan" { dev.videoZoomFactor = CGFloat(clamped) } else { dev.ramp(toVideoZoomFactor: CGFloat(clamped), withRate: max(rate, 0.01)) }
          dev.unlockForConfiguration()
        } catch { p.refusedReason = "lockForConfiguration failed: \(error.localizedDescription)" }
      }
    }
    var idx = p.applied
    while idx + 1 < p.steps.count && p.steps[idx + 1].atMs <= elapsed { idx += 1 }
    if idx > p.applied {
      if let c = p.steps[idx].crop { crop = c; digitalFactor = c[2] > 0 ? 1.0 / Double(c[2]) : 1 }
      p.applied = idx
    }
    let rampDone = !(device?.isRampingVideoZoom ?? false)
    if p.applied >= p.steps.count - 1 && rampDone { finish(p, cancelled: nil) }
  }

  private func activeLens() -> String? {
    if #available(iOS 15.0, *) { return device?.activePrimaryConstituent?.uniqueID ?? device?.uniqueID }
    return device?.uniqueID
  }

  private func finish(_ p: Plan, cancelled: String?) {
    plan = nil
    let dev = Double(device?.videoZoomFactor ?? 1)
    let achieved = p.mode == "digital" ? digitalFactor : dev
    let lens = activeLens()
    p.onDone([
      "kind": p.kind, "mode": p.mode, "requested": p.requested, "achieved": achieved,
      "deviceZoom": dev, "digitalFactor": digitalFactor, "effectiveZoom": dev * digitalFactor,
      "clamped": abs(achieved - p.requested) > 0.02,
      "reason": (cancelled ?? p.refusedReason) ?? NSNull(),
      "lens": lens ?? NSNull(), "lensBefore": p.lensBefore ?? NSNull(),
      "lensSwitch": p.lensBefore != nil && lens != nil && p.lensBefore != lens,
      "droppedFrames": droppedFrames - p.droppedAtStart, "framesDuring": frames - p.framesAtStart,
      "actualDurationMs": p.startMs == 0 ? 0 : nowMs() - p.startMs,
      "plannedDurationMs": p.steps.last?.atMs ?? 0,
      "stepsPlanned": p.steps.count, "stepsApplied": p.applied + 1, "cancelled": cancelled != nil
    ])
  }

  func state() -> [String: Any] {
    let dev = device
    let z = Double(dev?.videoZoomFactor ?? 1)
    return [
      "cameraId": dev?.uniqueID ?? NSNull(),
      "activePhysicalId": activeLens() ?? NSNull(),
      "deviceZoom": z,
      "deviceZoomMin": Double(dev?.minAvailableVideoZoomFactor ?? 1),
      "deviceZoomMax": Double(dev?.maxAvailableVideoZoomFactor ?? 1),
      "digitalFactor": digitalFactor,
      "effectiveZoom": z * digitalFactor,
      "crop": ["x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]],
      "iso": dev.map { Double($0.iso) } ?? NSNull(),
      "exposureNs": dev.map { Int64(CMTimeGetSeconds($0.exposureDuration) * 1_000_000_000) } ?? NSNull(),
      "focusDistance": dev.map { Double($0.lensPosition) } ?? NSNull(),
      "isRamping": dev?.isRampingVideoZoom ?? false,
      "width": outputWidth, "height": outputHeight,
      "fps": measuredFps, "frames": frames, "droppedFrames": droppedFrames,
      "moving": plan != nil, "moveKind": plan?.kind ?? NSNull()
    ]
  }
}
