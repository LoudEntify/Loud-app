// The backing track's transport, outside every component lifecycle.
//
// ── WHY THIS EXISTS, WHICH IS A BUG I SHIPPED ─────────────────
// #58 and #62 put the transport in React state inside
// useBackingTrack(). The samples live in the native module and survive
// anything, so unmounting the console left the track PLAYING into the
// broadcast while the screen's transport went back to "no track
// loaded". Opening the sheet again would then show a stopped transport
// over audible audio, and pressing play would have set `playing` on a
// mixer that was already playing.
//
// components/BackingTrackPanel.jsx had exactly this bug and its header
// records the fix: "It used to hold it in playerRef and stop() it on
// unmount, so any layout change that remounted this panel stopped the
// track and reset the playhead to zero. The player now lives in
// lib/audioHost.js, outside every component lifecycle; everything below
// is a VIEW of it."
//
// I read that comment while lifting the transport rules into
// lib/audio/tracks.js and still put the phone's copy inside a hook. So
// this is the same lesson, learned twice, and the shape here is
// deliberately the web's: one module-level object, a version counter, a
// listener set, and screens as views.
//
// ── WHAT LIVES HERE AND WHAT DOES NOT ─────────────────────────
// Here: which track is loaded, the transport, the file's own sample
// rate. Not here: the samples (the native module), the rules
// (lib/audio/tracks.js), or any UI.
//
// It imports NOTHING, deliberately. The transport starts as null and
// the hook supplies the empty one from lib/audio/tracks.js, so this
// file holds no second definition of what "no track" means AND can be
// tested in plain Node — the Metro alias for @loud/lib does not resolve
// outside a bundle, and a store that cannot be tested is a poor place
// to have just moved a bug to.
const host = {
  transport: null,
  trackId: null,
  fileRate: null,
  // Bumped on every change so a subscriber can re-render without
  // deep-comparing, exactly as lib/audioHost.js does.
  version: 0,
};

const listeners = new Set();

function emit() {
  host.version += 1;
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a bad subscriber must never break audio */ }
  });
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeBackingTrack(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The live host. `transport` is null until a view sets one, which the
 * hook reads as the empty transport.
 */
export const getBackingTrackHost = () => host;
export const getBackingTrackVersion = () => host.version;

/**
 * Replace the transport.
 *
 * Takes either a transport or a function of the current one, so a caller
 * can express "play from whatever is loaded now" without first reading
 * the host and racing another screen that is doing the same.
 */
export function setTransport(next) {
  const value = typeof next === 'function' ? next(host.transport) : next;
  if (!value || value === host.transport) return host.transport;
  host.transport = value;
  emit();
  return host.transport;
}

export function setLoadedTrack({ trackId = null, fileRate = null } = {}) {
  host.trackId = trackId;
  host.fileRate = fileRate;
  emit();
}

/** For tests, and for a sign-out: nothing should carry a track across accounts. */
export function resetBackingTrackHost() {
  host.transport = null;
  host.trackId = null;
  host.fileRate = null;
  emit();
}
