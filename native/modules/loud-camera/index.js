// native/modules/loud-camera/index.js — JS surface of the spike's native
// camera. `available` is false in Expo Go and in any build without the
// module, and every call then rejects with a plain message, so the rest
// of the app (which never imports this) is untouched.
import { requireNativeModule } from 'expo-modules-core';

let native = null;
try { native = requireNativeModule('LoudCamera'); } catch { native = null; }

export const available = Boolean(native);
const missing = () => Promise.reject(new Error('LoudCamera native module is not in this build: use the EAS development build (docs/NEEDS_KOREY.md).'));

/** B2 capability profile, raw (normalise with src/spike/survey.js). No camera is opened. */
export function survey() { return native ? native.survey() : missing(); }

/**
 * Start capturing and return a react-native-webrtc MediaStream whose video
 * track is fed by the native capturer. The track is published with
 * livekit-client's LocalVideoTrack (src/spike/runtime.js). `frameSource`
 * 'auto' | 'hardware' | 'gpu' | 'cpu' picks the frame path (see
 * LoudCameraXCapturer.kt); the one actually chosen is in every state
 * sample and move result as `frameSource`.
 */
export async function start({ facing = 'back', width = 1080, height = 1920, fps = 30, frameSource = 'auto' } = {}) {
  if (!native) return missing();
  const info = await native.start({ facing, width, height, fps, frameSource });
  const { MediaStream } = require('@livekit/react-native-webrtc');
  const stream = new MediaStream({ streamId: info.streamId, streamReactTag: info.streamId, tracks: info.tracks });
  return { stream, info };
}
export function stop() { return native ? native.stop() : missing(); }

/**
 * One move for zooms and pans alike. kind 'zoom' | 'pan'; mode from
 * zoomPlan.realise (region | device | device+crop | digital); steps
 * [{atMs, deviceZoom, crop:[x,y,w,h]}] from zoomPlan.movePlan; requested
 * is what the result's `achieved` is compared with. Resolves with the
 * move result once the last step has been applied (or the move was
 * cancelled: `cancelled: true`).
 */
export function move(kind, mode, steps, requested) { return native ? native.move(kind, mode, steps, requested) : missing(); }
/**
 * Pro mode (docs/SPIKE_PRO_MODE_PLAN.md): one manual-control change.
 * control 'iso' | 'shutter' | 'wb' | 'focus' | 'ev' | 'lock' | 'unlock' |
 * 'enable' | 'disable'; value ISO, ms, Kelvin, diopters, stops, or
 * 'ae' | 'awb' | 'af' for the locks. Resolves after the camera has
 * reported a few frames with { control, requested, achieved, clamped,
 * reason, supported, fpsExpected, readback }. Nothing per frame when off.
 */
export function setPro(control, value = null) { return native ? native.setPro(control, value) : missing(); }
/** The camera's current exposure and colour as the HAL reports them (for Match cameras): { iso, shutterMs, wbKelvin, colorGains, focusDiopters }. */
export function proRead() { return native ? native.proRead() : missing(); }
export function cancelMove() { return native ? native.cancelMove() : missing(); }
export function resetFraming() { return native ? native.resetFraming() : missing(); }
export function getState() { return native ? native.getState() : null; }
export function cost() { return native ? native.cost() : null; }
export function writeGzip(path, text) { return native ? native.writeGzip(path, text) : missing(); }
export function uploadFile(path, url, contentType, headers = {}) { return native ? native.uploadFile(path, url, contentType, headers) : missing(); }
export function addStateListener(fn) { return native ? native.addListener('onState', fn) : { remove() {} }; }
