'use client';

// lib/setLists.js
// ─────────────────────────────────────────────────────────────
// The browser half of set lists.
//
// PRD: Director Experience / Live Show (set lists)
// S&I: Database
//
// Mirrors lib/uploadedTracks.js deliberately: same never-throw-on-read
// posture, same "an unreachable API degrades to empty rather than to an
// error screen". A set list failing to load must not take the deck down
// with it — the artist can still pick a track from the library.
// ─────────────────────────────────────────────────────────────

export async function listSetLists(accessToken) {
  if (!accessToken) return { setLists: [], notMigrated: false };
  try {
    const res = await fetch('/api/set-lists', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { setLists: [], notMigrated: false };
    const data = await res.json().catch(() => ({}));
    return { setLists: data.setLists || [], notMigrated: !!data.notMigrated };
  } catch {
    return { setLists: [], notMigrated: false };
  }
}

async function send(path, method, accessToken, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function createSetList(name, accessToken) {
  return send('/api/set-lists', 'POST', accessToken, { name });
}

export function renameSetList(id, name, accessToken) {
  return send('/api/set-lists', 'PATCH', accessToken, { id, name });
}

export function deleteSetList(id, accessToken) {
  return send(`/api/set-lists?id=${encodeURIComponent(id)}`, 'DELETE', accessToken);
}

export function addTrackToSetList(setListId, backingTrackId, accessToken) {
  return send('/api/set-lists/items', 'POST', accessToken, { setListId, backingTrackId });
}

export function removeSetListItem(setListId, itemId, accessToken) {
  return send(
    `/api/set-lists/items?id=${encodeURIComponent(itemId)}&setListId=${encodeURIComponent(setListId)}`,
    'DELETE', accessToken
  );
}

/**
 * Reorder by sending the FULL destination order.
 *
 * Idempotent by construction, so a lost response is safe to retry and a
 * half-applied write is merely a different valid order rather than a
 * broken set — see the note on the route.
 */
export function reorderSetList(setListId, orderedItemIds, accessToken) {
  return send('/api/set-lists/items', 'PATCH', accessToken, { setListId, orderedItemIds });
}

/**
 * Which item is the set currently on?
 *
 * Derived from the loaded track's hash, never stored. show_session_state
 * deliberately has no position column: the current item IS whichever
 * item holds the current track_hash, and a stored index would be a
 * second copy of that fact — the one that drifts the moment a track is
 * loaded from outside the set or the set is reordered mid-show.
 *
 * Returns the index, or -1 when the loaded track is not in this set
 * (which is a real and legitimate state, not an error: an artist can
 * always play something off-set).
 */
export function currentItemIndex(setList, trackHash) {
  if (!setList || !trackHash) return -1;
  const items = orderedItems(setList);
  return items.findIndex((it) => it.backing_tracks?.sha256 === trackHash);
}

/** Items in performance order. The server sorts too; this is the guard
 *  against a caller that built a set list object by hand. */
export function orderedItems(setList) {
  const items = [...(setList?.set_list_items || [])];
  items.sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
  return items;
}
