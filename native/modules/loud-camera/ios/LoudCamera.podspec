# native/modules/loud-camera — local Expo module for the device-zoom spike.
# iOS side is written against the same hooks the Android side uses
# (WebRTCModule createVideoTrackWithCaptureController: / createMediaStream:)
# but has NOT been compiled: this repository has no macOS runner and the
# spike's build route is Android (docs/NEEDS_KOREY.md).
Pod::Spec.new do |s|
  s.name           = 'LoudCamera'
  s.version        = '0.1.0'
  s.summary        = 'Device zoom and pan capturer for the Loudentify spike'
  s.description    = 'Custom AVCaptureSession capturer feeding LiveKit, with device zoom ramps, crop-window pan and a capability survey.'
  s.license        = 'UNLICENSED'
  s.author         = 'Loudentify'
  s.homepage       = 'https://loudentify.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'livekit-react-native-webrtc'
  s.dependency 'LiveKitWebRTC', '= 144.7559.15'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
