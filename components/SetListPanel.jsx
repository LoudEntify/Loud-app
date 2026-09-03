'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listSetLists, createSetList, deleteSetList,
  addTrackToSetList, removeSetListItem, reorderSetList,
  orderedItems, currentItemIndex,
} from '../lib/setLists';
import { listUploadedTracks } from '../lib/uploadedTracks';
import { loadSessionState, patchSessionState } from '../lib/showSessionState';

// components/SetListPanel.jsx
// ─────────────────────────────────────────────────────────────
// Set lists: assembled on Kit Check, performed from on /live.
//
// PRD: Director Experience / Live Show (set lists)
// S&I: Database, Real-time media (show_session_state binding)
//
// ── ITS OWN SECTION, NEVER MERGED WITH B-ROLL ─────────────────
// Set lists live in the AUDIO deck beside the track library; b-roll
// lives in the VIDEO deck. They share a bucket and one 500MB allowance
// and nothing else. A b-roll clip is something you CUT TO mid-song; a
// set list is the running order of the songs themselves. Merging them
// would put two things with different verbs behind one browse-and-pick,
// and the artist reaching for one under pressure would have to filter
// past the other.
//
// ── LOAD AND WAIT ─────────────────────────────────────────────
// Tapping an item LOADS the song and binds its cue sheet. It does not
// start playing, and arriving on /live does not auto-load anything.
//
// That is a deliberate cost decision, not timidity. Loading a track puts
// the deck into an expensive steady state — waveform, a 60fps rAF loop,
// a ~106MB decoded buffer — and the round-2 CPU investigation
// (currently paused, unattributed) exists because Task 1 made that state
// arrive automatically. Making set lists auto-load on arrival would
// widen an unattributed performance problem to every show. One tap
// starts it when the artist chooses.
//
// A mid-show RELOAD still restores without a tap: show_session_state
// already holds track_hash, and BackingTrackPanel's existing auto-fetch
// resolves it. Only a fresh arrival needs the tap.
//
// ── WHICH SET IS ACTIVE SURVIVES THE HANDOVER ─────────────────
// Written to show_session_state.set_list_id (mvp2_04), which is the row
// that already survives both go-live triggers. POSITION is not written:
// the current item is whichever item holds the current track_hash.
// ─────────────────────────────────────────────────────────────

const TEAL = '#2ec4b6';
const RED = '#e71d36';

const rowBtn = {
  background: 'transparent', border: '1px solid #3a3a37', color: '#888780',
  borderRadius: 4, fontSize: 10, padding: '3px 7px', cursor: 'pointer',
};

export default function SetListPanel({
  artistAccessToken,
  // The row this set list binds to. Kit Check supplies the UPCOMING
  // show; /live supplies the running one. Null on a surface with no
  // show at all, where the panel still assembles but binds nothing.
  showId = null,
  artistId = null,
  // What the deck is currently holding, for the "playing now" marker.
  loadedHash = null,
  // Loads a track and binds its cue sheet — BackingTrackPanel's
  // existing uploaded-track path, reused unchanged. No new decode path.
  onPickTrack,
  // True on Kit Check: show the assembly controls. On /live the panel is
  // for choosing what to play next, not for rebuilding the running order
  // mid-performance.
  canEdit = false,
}) {
  const [setLists, setSetLists] = useState([]);
  const [notMigrated, setNotMigrated] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!artistAccessToken) return;
    const r = await listSetLists(artistAccessToken);
    if (cancelledRef.current) return;
    setSetLists(r.setLists);
    setNotMigrated(r.notMigrated);
  }, [artistAccessToken]);

  // The library, so a set can be assembled from it. Re-read whenever the
  // panel refreshes, which is what makes a song uploaded WHILE LIVE
  // appear here without a reload.
  const refreshTracks = useCallback(async () => {
    if (!artistAccessToken) return;
    const r = await listUploadedTracks(artistAccessToken);
    if (cancelledRef.current) return;
    setTracks(r.tracks);
  }, [artistAccessToken]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    refreshTracks();
    return () => { cancelledRef.current = true; };
  }, [refresh, refreshTracks]);

  // Which set this show is performing, read back from the row so it
  // survives the handover and a reload alike.
  useEffect(() => {
    if (!showId || !artistId) return;
    let cancelled = false;
    (async () => {
      const row = await loadSessionState(showId, artistId);
      if (cancelled) return;
      if (row?.set_list_id) setActiveId(row.set_list_id);
    })();
    return () => { cancelled = true; };
  }, [showId, artistId]);

  const bind = useCallback(async (setListId) => {
    setActiveId(setListId);
    // Optimistic locally, persisted through the same upsert every other
    // writer of this row uses. Nothing here needs to wait for it: a
    // failed write means the binding does not survive the handover, not
    // that the artist cannot perform from the set right now.
    if (showId && artistId) await patchSessionState(showId, artistId, { set_list_id: setListId });
  }, [showId, artistId]);

  const active = setLists.find((s) => s.id === activeId) || null;
  const items = orderedItems(active);
  const currentIndex = currentItemIndex(active, loadedHash);

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (err) { setError(String(err?.message || err)); }
    finally { setBusy(''); }
  }

  if (!artistAccessToken) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
        Set list
      </span>

      {notMigrated ? (
        <span style={{ fontSize: 11, color: '#888780' }}>
          Set lists need docs/mvp2_02_set_lists.sql and mvp2_03_set_list_items.sql to be
          run first. Everything else on this deck works as before.
        </span>
      ) : (
        <>
          {/* Which set. A select rather than a list of buttons: on /live
              this is a one-off choice made before the show, and the
              running order below is what the artist actually reads. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={activeId || ''}
              onChange={(e) => bind(e.target.value || null)}
              disabled={!!busy}
              style={{
                flex: 1, background: '#1a1a19', color: '#fdfffc',
                border: '1px solid #3a3a37', borderRadius: 6, padding: '4px 8px', fontSize: 12,
              }}
            >
              <option value="">No set list</option>
              {setLists.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {canEdit && (
              <button
                type="button" style={rowBtn} disabled={!!busy}
                onClick={() => run('new', async () => {
                  const { setList } = await createSetList(`Set ${setLists.length + 1}`, artistAccessToken);
                  await refresh();
                  await bind(setList.id);
                })}
              >
                {busy === 'new' ? '…' : 'NEW'}
              </button>
            )}
          </div>

          {active && items.length === 0 && (
            <span style={{ fontSize: 11, color: '#888780' }}>
              Nothing in this set yet.{canEdit ? ' Add songs from your uploaded tracks below.' : ''}
            </span>
          )}

          {/* The running order. */}
          {items.map((item, i) => {
            const track = item.backing_tracks;
            const isCurrent = i === currentIndex;
            const isNext = currentIndex >= 0 && i === currentIndex + 1;
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10.5, color: '#888780', minWidth: 16 }}>{i + 1}</span>
                <button
                  type="button"
                  className="control-btn"
                  disabled={!!busy || !track}
                  onClick={() => track && onPickTrack?.(track)}
                  style={{
                    flex: 1, textAlign: 'left',
                    borderColor: isCurrent ? TEAL : undefined,
                    color: isCurrent ? TEAL : undefined,
                  }}
                >
                  {track?.title || 'Missing track'}
                </button>
                <span style={{ fontSize: 10, color: isCurrent ? TEAL : '#888780', minWidth: 44, textAlign: 'right' }}>
                  {isCurrent ? 'loaded' : isNext ? 'next' : ''}
                </span>
                {canEdit && (
                  <>
                    <button
                      type="button" style={rowBtn} disabled={!!busy || i === 0}
                      onClick={() => run(`up:${item.id}`, async () => {
                        const ids = items.map((x) => x.id);
                        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                        await reorderSetList(active.id, ids, artistAccessToken);
                        await refresh();
                      })}
                    >↑</button>
                    <button
                      type="button" style={rowBtn} disabled={!!busy || i === items.length - 1}
                      onClick={() => run(`down:${item.id}`, async () => {
                        const ids = items.map((x) => x.id);
                        [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                        await reorderSetList(active.id, ids, artistAccessToken);
                        await refresh();
                      })}
                    >↓</button>
                    <button
                      type="button" style={rowBtn} disabled={!!busy}
                      onClick={() => run(`rm:${item.id}`, async () => {
                        await removeSetListItem(active.id, item.id, artistAccessToken);
                        await refresh();
                      })}
                    >✕</button>
                  </>
                )}
              </div>
            );
          })}

          {/* Assembly. Kit Check only. */}
          {canEdit && active && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button" className="control-btn" disabled={!!busy}
                onClick={() => { setAdding((v) => !v); refreshTracks(); }}
                style={{ alignSelf: 'flex-start' }}
              >
                {adding ? 'Done adding' : 'Add a song'}
              </button>
              {adding && tracks.length === 0 && (
                <span style={{ fontSize: 11, color: '#888780' }}>
                  No uploaded tracks yet. Upload one below and it appears here.
                </span>
              )}
              {adding && tracks.map((t) => (
                <button
                  key={t.id} type="button" style={{ ...rowBtn, textAlign: 'left' }}
                  disabled={!!busy}
                  onClick={() => run(`add:${t.id}`, async () => {
                    await addTrackToSetList(active.id, t.id, artistAccessToken);
                    await refresh();
                  })}
                >
                  + {t.title}
                </button>
              ))}
            </div>
          )}

          {canEdit && active && (
            <button
              type="button" style={{ ...rowBtn, alignSelf: 'flex-start', color: RED, borderColor: RED }}
              disabled={!!busy}
              onClick={() => run('delset', async () => {
                await deleteSetList(active.id, artistAccessToken);
                // Unbinding first would leave the row pointing at a set
                // that is about to vanish; the column is ON DELETE SET
                // NULL so the database would clear it anyway, but doing
                // it here keeps this device's view honest immediately.
                await bind(null);
                await refresh();
              })}
            >
              {busy === 'delset' ? '…' : 'DELETE THIS SET'}
            </button>
          )}
        </>
      )}

      {error && <span style={{ fontSize: 11, color: RED }}>{error}</span>}
    </div>
  );
}
