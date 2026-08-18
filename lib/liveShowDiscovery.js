// Live show discovery -- "channel surfing" between other currently-live
// shows. Two future surfaces will consume this: a desktop rail
// (components/LiveShowRail.jsx, built this round) and a mobile swipe-
// left/right gesture (NOT built this round). Both are meant to share
// ONE data source and ONE switch action, so this module -- not either
// surface's own component -- is where that shared contract lives.
// This round: skeleton only. getAdjacentLiveShows always returns an
// empty list (no API route, no query, nothing live) and
// switchToLiveShow is a stub. Real implementations land in a future
// round with its own design pass (poster cards vs live thumbnails,
// leave/join-room sequencing, gesture vs. accidental-swipe handling).

// eslint-disable-next-line no-unused-vars
export async function getAdjacentLiveShows(currentShowId) {
  return [];
}

// eslint-disable-next-line no-unused-vars
export function switchToLiveShow(showId) {
  // TODO(live-show-discovery): wire this to the real leave-current-room
  // / join-target-room flow once the desktop rail and mobile swipe
  // gesture both need it. Stub for now -- no navigation, no room churn.
  console.log('[liveShowDiscovery] switchToLiveShow (stub):', showId);
}
