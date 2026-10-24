import ExpoModulesCore
import Foundation
import LiveKitWebRTC
import livekit_react_native_webrtc
import zlib

/// Same JS surface as the Android module (see LoudCameraModule.kt).
/// NOT COMPILED in this repository; see LoudCamera.podspec.
public class LoudCameraModule: Module {
  private var controller: LoudCaptureController?
  private var timer: Timer?

  public func definition() -> ModuleDefinition {
    Name("LoudCamera")
    Events("onState")

    AsyncFunction("survey") { () -> [String: Any] in CameraSurvey.profile() }

    AsyncFunction("start") { (opts: [String: Any], promise: Promise) in
      guard self.controller == nil else { promise.reject("ERR_BUSY", "capture already running"); return }
      // Legacy (bridge) module lookup. Under the new architecture the
      // interop layer still answers this for react-native-webrtc.
      guard let bridge = self.appContext?.reactBridge, let webrtc = bridge.module(for: WebRTCModule.self) as? WebRTCModule else {
        promise.reject("ERR_NO_WEBRTC", "WebRTCModule is not loaded: is @livekit/react-native-webrtc in this build?"); return
      }
      let facing = (opts["facing"] as? String) ?? "back"
      let fps = (opts["fps"] as? Int) ?? 30
      webrtc.workerQueue.async {
        var made: LoudCaptureController?
        guard let track = webrtc.createVideoTrack(withCaptureController: { source in
          let c = LoudCaptureController(source: source, facing: facing, fps: fps)
          made = c
          return c
        }) else { promise.reject("ERR_TRACK", "createVideoTrack returned nil"); return }
        let info = webrtc.createMediaStream([track])
        guard let streamId = info.first as? String, info.count > 1 else { promise.reject("ERR_STREAM", "createMediaStream returned nothing"); return }
        self.controller = made
        DispatchQueue.main.async {
          self.timer?.invalidate()
          self.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let c = self.controller else { return }
            var s = c.state(); s["tMs"] = Int64(ProcessInfo.processInfo.systemUptime * 1000)
            self.sendEvent("onState", s)
          }
        }
        promise.resolve(["streamId": streamId, "trackId": track.trackId, "tracks": info[1]])
      }
    }

    AsyncFunction("stop") { () -> Void in
      self.timer?.invalidate(); self.timer = nil
      self.controller?.cancelMove("stopped")
      self.controller = nil
    }

    AsyncFunction("zoomTo") { (steps: [[String: Any]], mode: String, requested: Double, promise: Promise) in
      guard let c = self.controller else { promise.reject("ERR_NOT_RUNNING", "start() first"); return }
      let plan = LoudCaptureController.Plan(kind: "zoom", mode: mode, steps: steps.map { s in
        let at = Int64((s["atMs"] as? Double) ?? 0)
        let z = (s["zoom"] as? Double) ?? 1
        if mode == "digital" {
          let w = Float(min(max(1 / z, 0.1), 1))
          return LoudCaptureController.Step(atMs: at, deviceZoom: nil, crop: [(1 - w) / 2, (1 - w) / 2, w, w])
        }
        return LoudCaptureController.Step(atMs: at, deviceZoom: z, crop: nil)
      }, requested: requested) { r in promise.resolve(r) }
      if !c.startMove(plan) { promise.reject("ERR_MOVING", "a move is already in progress") }
    }

    AsyncFunction("pan") { (deviceZoom: Double?, steps: [[String: Any]], requested: Double, promise: Promise) in
      guard let c = self.controller else { promise.reject("ERR_NOT_RUNNING", "start() first"); return }
      let plan = LoudCaptureController.Plan(kind: "pan", mode: deviceZoom != nil ? "device" : "digital", steps: steps.enumerated().map { i, s in
        LoudCaptureController.Step(
          atMs: Int64((s["atMs"] as? Double) ?? 0),
          deviceZoom: i == 0 ? deviceZoom : nil,
          crop: [Float((s["x"] as? Double) ?? 0), Float((s["y"] as? Double) ?? 0), Float((s["w"] as? Double) ?? 1), Float((s["h"] as? Double) ?? 1)]
        )
      }, requested: requested) { r in promise.resolve(r) }
      if !c.startMove(plan) { promise.reject("ERR_MOVING", "a move is already in progress") }
    }

    AsyncFunction("cancelMove") { () -> Void in self.controller?.cancelMove("cancelled") }
    AsyncFunction("resetFraming") { () -> Void in self.controller?.resetCrop() }
    Function("getState") { () -> [String: Any]? in self.controller?.state() }
    Function("cost") { () -> [String: Any] in CostMeter.sample() }

    AsyncFunction("writeGzip") { (path: String, text: String) -> [String: Any] in
      let url = URL(fileURLWithPath: path.replacingOccurrences(of: "file://", with: ""))
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      let data = try Gzip.compress(Data(text.utf8))
      try data.write(to: url)
      return ["path": url.path, "bytes": data.count]
    }

    AsyncFunction("uploadFile") { (path: String, urlString: String, contentType: String, headers: [String: String], promise: Promise) in
      guard let url = URL(string: urlString) else { promise.reject("ERR_URL", "bad url"); return }
      let file = URL(fileURLWithPath: path.replacingOccurrences(of: "file://", with: ""))
      var req = URLRequest(url: url)
      req.httpMethod = "PUT"
      req.setValue(contentType, forHTTPHeaderField: "Content-Type")
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
      let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
      URLSession.shared.uploadTask(with: req, fromFile: file) { data, resp, err in
        if let err = err { promise.reject("ERR_UPLOAD", err.localizedDescription); return }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let body = data.flatMap { String(data: $0.prefix(500), encoding: .utf8) }
        promise.resolve(["status": status, "bytes": size, "body": body ?? NSNull()])
      }.resume()
    }
  }
}

/// gzip via zlib (windowBits 31 = gzip wrapper), since Foundation's
/// .zlib compression is raw deflate without the gzip header.
enum Gzip {
  static func compress(_ input: Data) throws -> Data {
    var stream = z_stream()
    var status = deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
    guard status == Z_OK else { throw NSError(domain: "gzip", code: Int(status)) }
    var out = Data()
    let chunk = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: chunk)
    try input.withUnsafeBytes { (src: UnsafeRawBufferPointer) in
      stream.next_in = UnsafeMutablePointer<Bytef>(mutating: src.bindMemory(to: Bytef.self).baseAddress)
      stream.avail_in = uInt(input.count)
      repeat {
        try buffer.withUnsafeMutableBufferPointer { dst in
          stream.next_out = dst.baseAddress
          stream.avail_out = uInt(chunk)
          status = deflate(&stream, Z_FINISH)
          guard status == Z_OK || status == Z_STREAM_END || status == Z_BUF_ERROR else { throw NSError(domain: "gzip", code: Int(status)) }
          out.append(dst.baseAddress!, count: chunk - Int(stream.avail_out))
        }
      } while status != Z_STREAM_END
    }
    deflateEnd(&stream)
    return out
  }
}
