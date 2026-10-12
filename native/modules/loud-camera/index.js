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
 * livekit-client's LocalVideoTrack (src/spike/runtime.js).
 */
export async function start({ facing = 'back', width = 1080, height = 1920, fps = 30 } = {}) {
  if (!native) return missing();
  const info = await native.start({ facing, width, height, fps });
  const { MediaStream } = require('@livekit/react-native-webrtc');
  const stream = new MediaStream({ streamId: info.streamId, streamReactTag: info.streamId, tracks: info.tracks });
  return { stream, info };
}
export function stop() { return native ? native.stop() : missing(); }

/** steps: [{atMs, zoom}] from zoomPlan.rampSchedule; mode 'device' | 'digital'. Resolves with the move result. */
export function zoomTo(steps, mode, requested) { return native ? native.zoomTo(steps, mode, requested) : missing(); }
/** steps: panPlan().steps (each with its own deviceZoom or null); mode 'device+crop' | 'crop'. Resolves with the move result. */
export function pan(steps, mode, requested) { return native ? native.pan(steps, mode, requested) : missing(); }
export function cancelMove() { return native ? native.cancelMove() : missing(); }
export function resetFraming() { return native ? native.resetFraming() : missing(); }
export function getState() { return native ? native.getState() : null; }
export function cost() { return native ? native.cost() : null; }
export function writeGzip(path, text) { return native ? native.writeGzip(path, text) : missing(); }
export function uploadFile(path, url, contentType, headers = {}) { return native ? native.uploadFile(path, url, contentType, headers) : missing(); }
export function addStateListener(fn) { return native ? native.addListener('onState', fn) : { remove() {} }; }
