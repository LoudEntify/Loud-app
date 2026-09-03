'use client';

// lib/showSessionState.js
// ─────────────────────────────────────────────────────────────
// TASK 1 — the show's deck state, server-side, subscribed to.
//
// PRD: Director Experience / Live Show    S&I: Database, Real-time media, Auth
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────
// The client never holds selection state as the only copy. Every change
// goes to `show_session_state` (docs/mvp1_01_show_session_state.sql), and
// the row is the source of truth. React state here is a CACHE of that
// row, kept in sync by Supabase Realtime.
//
// Why that matters concretely: backing-track selection, cue-sheet binding
// and playback position used to live in component state, so the Kit Check
// -> /live transition and any panel remount destroyed them.
//
// ── WHAT IS NOT ROUTED THROUGH HERE, AND MUST NEVER BE ────────
// Shot commands. They are ephemeral and sub-second and they stay on the
// LiveKit data channel (lib/shotCommands.js). Putting a database round
// trip between a director's tap and the cut would defeat the entire
// design. This file deals only with what must SURVIVE; the data channel
// deals with what must be FAST. Nothing belongs in both.
//
// ── THE HONEST LIMIT, AND HOW ROUND 2 NARROWED IT ─────────────
// This row stores a track's hash and filename, not its bytes. For a
// LOCALLY PICKED file that is still the end of the story: a client-side
// route change keeps the decoded audio alive (lib/audioHost.js) and
// everything resumes, but a hard reload does not, and no column can fix
// it — the browser cannot reopen a local file without a fresh user
// gesture. `needsRepick()` is how the UI says "re-select Track.mp3 to
// resume at 2:14" instead of silently starting over.
//
// For an UPLOADED track (docs/mvp2_01_backing_tracks.sql) the limit does
// not apply: track_hash resolves to a storage object via the unique
// (artist_id, sha256) index, so the app refetches and resumes on its
// own. The prompt is for the case the app genuinely cannot recover
// from, and round 2 shrank that case rather than removing the prompt.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';
import { logHealthEvent } from './healthLog';

export const PLAYBACK_STATES = ['stopped', 'playing', 'paused'];

// How often a PLAYING position is written back. Not every frame, not
// every second: the row exists so a remount can resume within a second or
// so of where it was, and 5s of drift is imperceptible against a
// re-decode. `position_updated_at` lets a reader extrapolate between
// writes, so the playhead stays smooth regardless of this number.
export const POSITION_WRITE_INTERVAL_MS = 5000;

function isMissingRelation(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache');
}

export function emptyState(showId = null, artistId = null) {
  return {
    show_id: showId,
    artist_id: artistId,
    track_hash: null,
    track_name: null,
    cue_sheet_id: null,
    position_ms: 0,
    playback_state: 'stopped',
    position_updated_at: null,
    broll_bindings: {},
    _missing: false, // true when the migration has not been run
  };
}

/**
 * Read the row for (show, artist). Never throws.
 *
 * Returns `_missing: true` when the table does not exist yet, so every
 * caller can degrade to the old in-memory behaviour rather than break —
 * the branch has to work before the migration is run, not after.
 */
export async function loadSessionState(showId, artistId) {
  if (!showId || !artistId) return emptyState(showId, artistId);
  try {
    const { data, error } = await getSupabase()
      .from('show_session_state')
      .select('*')
      .eq('show_id', showId)
      .eq('artist_id', artistId)
      .maybeSingle();

    if (error) {
      if (isMissingRelation(error)) return { ...emptyState(showId, artistId), _missing: true };
      console.warn('[session-state] read failed', error.message);
      return emptyState(showId, artistId);
    }
    return data ? { ...emptyState(showId, artistId), ...data } : emptyState(showId, artistId);
  } catch {
    return emptyState(showId, artistId);
  }
}

/**
 * Write a partial update. Upsert, because the first change an artist
 * makes is also the row's creation and asking callers to know which is
 * which would guarantee someone gets it wrong.
 *
 * onConflict names the PLAIN unique index from the migration. It must
 * stay exactly 'show_id,artist_id' — a partial index cannot be an ON
 * CONFLICT target, which is why that index is deliberately not partial.
 */
export async function patchSessionState(showId, artistId, patch) {
  if (!showId || !artistId) return { ok: false, reason: 'no_key' };
  try {
    const { error } = await getSupabase()
      .from('show_session_state')
      .upsert(
        { show_id: showId, artist_id: artistId, ...patch },
        { onConflict: 'show_id,artist_id' }
      );
    if (error) {
      if (isMissingRelation(error)) return { ok: false, reason: 'not_yet_migrated' };
      console.warn('[session-state] write failed', error.message);
      logHealthEvent('session_state_write_failed', { detail: error.message, keys: Object.keys(patch) });
      return { ok: false, reason: 'write_failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

// ─────────────────────────────────────────────────────────────
// TASK 3 — THE WRITE THAT HAS TO OUTLIVE THE PAGE
//
// ── WHAT WAS WRONG WITH THE OLD ONE ───────────────────────────
// The pagehide handler called the same patchSessionState above. That is
// a supabase-js upsert, which is a plain fetch, and a plain fetch issued
// from a document that is going away is cancelled with it. The handler
// ran, the row did not change, and nothing anywhere said so. It was a
// write in appearance only — which is worse than not having one, because
// the resume path was built trusting it.
//
// ── WHY NOT navigator.sendBeacon ──────────────────────────────
// Because sendBeacon cannot set request headers, and this table is
// RLS-scoped to `auth.uid() = artist_id` (docs/mvp1_01_show_session_state.sql).
// Reaching it requires an `apikey` and an `Authorization: Bearer` the
// beacon API has no way to attach. The alternative shape — beacon to our
// own API route, carrying the JWT in the body, writing with the service
// role — means a new unauthenticated-by-default endpoint that
// re-implements an ownership check RLS already performs, and a bearer
// token moved out of a header and into a request body. That is more
// surface for no benefit.
//
// `fetch(..., { keepalive: true })` sends the same request the normal
// path sends, with the same credentials and under the same policies, and
// asks the browser to let it outlive the document. That is precisely the
// guarantee this needs. lib/healthLog.js already reaches for keepalive
// for the same reason; the difference is only that its endpoint is ours
// and can therefore also take a beacon.
//
// Browsers without keepalive support ignore the unknown init property
// and issue an ordinary fetch — exactly today's behaviour, so there is
// nothing to feature-detect and no worse case than the one being fixed.
//
// ── WHY THE TOKEN IS CACHED AHEAD OF TIME ─────────────────────
// supabase.auth.getSession() is async. Awaiting it inside a pagehide
// handler yields to the microtask queue, and a document being torn down
// is not obliged to still be running when that continuation is scheduled
// — so the fetch might never be issued at all, which is the bug again
// wearing a different hat. The token is therefore kept current in a
// module variable by the auth subscription below, and the teardown path
// only ever reads it.
// ─────────────────────────────────────────────────────────────

let cachedAccessToken = null;
let tokenWatchStarted = false;

/**
 * Start keeping the access token current. Idempotent; call it from
 * anywhere that might later need a teardown write. Safe before sign-in
 * (the token is simply null until there is one) and on the server (no-op).
 */
export function primeSessionToken() {
  if (tokenWatchStarted || typeof window === 'undefined') return;
  tokenWatchStarted = true;
  try {
    const supabase = getSupabase();
    // Fires on sign-in, sign-out and TOKEN_REFRESHED, which is what keeps
    // a long show from ending with an expired token in hand.
    supabase.auth.onAuthStateChange((_event, session) => {
      cachedAccessToken = session?.access_token || null;
    });
    // Seeds the case where the session was restored from storage before
    // anything subscribed. Only fills a gap — never overwrites a token
    // the subscription has already delivered.
    supabase.auth.getSession().then(({ data }) => {
      if (!cachedAccessToken) cachedAccessToken = data?.session?.access_token || null;
    }).catch(() => { /* no session is a legitimate state */ });
  } catch {
    // A missing/misconfigured client must not break the page. The
    // teardown write degrades to reporting 'no_credentials'.
  }
}

/**
 * The same upsert as patchSessionState, issued so it can survive the
 * document that issued it. Synchronous by design — it hands the request
 * to the browser and returns; there is no result to wait for and nowhere
 * to report one to.
 *
 * Returns whether the request was ISSUED, which is the only thing this
 * side can know. Whether it landed is a question for the row.
 */
export function patchSessionStateBeacon(showId, artistId, patch) {
  if (!showId || !artistId) return { ok: false, reason: 'no_key' };
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No token means no write, not an anonymous one: an unauthenticated
  // request would be refused by RLS anyway, and issuing it would only
  // turn a clear "we could not write" into a silent rejection.
  if (!baseUrl || !anonKey || !cachedAccessToken) return { ok: false, reason: 'no_credentials' };
  try {
    // Hand-built rather than routed through supabase-js because the
    // client offers no way to pass per-request fetch options, and
    // keepalive is the entire point of this function. The URL, the
    // Prefer header and the conflict target are exactly what the client
    // sends for .upsert({...}, { onConflict: 'show_id,artist_id' }) — if
    // that call ever changes shape, this must change with it.
    fetch(`${baseUrl}/rest/v1/show_session_state?on_conflict=show_id,artist_id`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${cachedAccessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ show_id: showId, artist_id: artistId, ...patch }),
    }).catch(() => { /* fire and forget: the page is going away */ });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Subscribe to changes on this row.
 *
 * Filtered server-side to one show, then narrowed to this artist on
 * arrival — PostgREST's realtime filter takes a single `eq`, and a
 * versus show has two artists with their own rows, so the second check
 * is what stops one performer's deck reacting to the other's.
 *
 * Returns an unsubscribe function. Always call it: an orphaned channel
 * holds a websocket open for the life of the tab.
 */
export function subscribeSessionState(showId, artistId, onChange) {
  if (!showId || !artistId) return () => {};
  let channel;
  try {
    channel = getSupabase()
      .channel(`show_session_state:${showId}:${artistId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'show_session_state', filter: `show_id=eq.${showId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.artist_id !== artistId) return;
          // DELETE carries only the old row; treat it as a reset rather
          // than pushing a stale selection back into the UI.
          onChange(payload.eventType === 'DELETE' ? emptyState(showId, artistId) : row, payload.eventType);
        }
      )
      .subscribe((status) => {
        // Logged because a Realtime subscription that silently fails to
        // establish looks exactly like "nothing has changed yet", and
        // that ambiguity is expensive to diagnose during a show.
        if (status === 'SUBSCRIBED') logHealthEvent('session_state_subscribed', { showId });
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logHealthEvent('session_state_subscribe_failed', { showId, status });
        }
      });
  } catch (e) {
    console.warn('[session-state] subscribe failed', e?.message || e);
    return () => {};
  }
  return () => {
    try { getSupabase().removeChannel(channel); } catch { /* already gone */ }
  };
}

// How far past `position_updated_at` extrapolation is allowed to run.
// See the reasoning in currentPositionMs below. Two write intervals, not
// one: at exactly one interval a healthy deck is only just due for its
// next write, and clipping a live playhead every five seconds would be a
// worse artefact than the one this bound exists to prevent.
const MAX_EXTRAPOLATION_MS = POSITION_WRITE_INTERVAL_MS * 2;

/**
 * Where the playhead is NOW, extrapolated.
 *
 * Position is written every few seconds, so a reader that trusts
 * `position_ms` literally shows a playhead that jumps in steps. If the
 * row says PLAYING, the true position is that value plus however long ago
 * it was written.
 *
 * ── WHY THE EXTRAPOLATION IS BOUNDED ──────────────────────────
 * That reasoning holds only while something is actually maintaining the
 * row, and a row can say 'playing' long after nothing is. The case that
 * forced this: an artist hard-reloads mid-song and comes back four
 * minutes later. The row still reads playing, `position_updated_at` is
 * four minutes stale, and unbounded extrapolation offers to resume them
 * four minutes further into a track they were 30 seconds into — a
 * confidently wrong number, which is worse than an obviously stale one.
 *
 * A live deck writes every POSITION_WRITE_INTERVAL_MS. So a row that has
 * not been written within a small multiple of that interval is not being
 * maintained, by construction, and the honest answer is the last
 * position actually recorded rather than a guess about what happened
 * after the writer stopped.
 */
export function currentPositionMs(state, now = Date.now()) {
  const base = Number(state?.position_ms) || 0;
  if (state?.playback_state !== 'playing' || !state?.position_updated_at) return base;
  const writtenAt = new Date(state.position_updated_at).getTime();
  if (Number.isNaN(writtenAt)) return base;
  const elapsed = Math.max(0, now - writtenAt);
  if (elapsed > MAX_EXTRAPOLATION_MS) return base;
  return base + elapsed;
}

/**
 * Does the server think a track is loaded that this device is not
 * holding?
 *
 * True exactly when the row names a track and the audio host is not
 * holding that same track's decoded buffer — after a hard reload, or on
 * a second device.
 *
 * ── WHAT THIS DOES *NOT* DECIDE, SINCE ROUND 2 ────────────────
 * Whether to ASK the artist for the file. That used to be the same
 * question and no longer is: an uploaded track in the same situation is
 * refetched silently. This stays a pure function of the row and the
 * host — it cannot know whether an uploaded copy exists, because that
 * is a network lookup — so the caller pairs it with
 * findUploadedTrackByHash() and only prompts when there is no copy to
 * fetch. See components/BackingTrackPanel.jsx.
 */
export function needsRepick(state, loadedTrackHash) {
  if (!state?.track_hash) return false;
  return state.track_hash !== loadedTrackHash;
}
