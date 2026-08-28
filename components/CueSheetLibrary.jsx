'use client';

import { useCallback, useEffect, useState } from 'react';
import { PencilSimple, Trash } from '@phosphor-icons/react';
import EmptyState from './EmptyState';
import { getSession } from '../lib/supabaseAuth';

const INK = '#011627';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

// The artist's saved cut settings, across every track.
//
// ── WHY THIS SURFACE EXISTS ─────────────────────────────────────
// Named cue sheets were half-built: the table has a `name` column, the
// route upserts on (track, artist, name) and has always returned the
// whole list — and nothing in the app ever set a name or read the list.
// So every save landed on one sheet called "Default", and an artist who
// wanted a slow version and a festival cut of the same song had nowhere
// to put the second one.
//
// The cue editor now names sheets and loads them by name. This is the
// other half: seeing everything you have saved, in one place, without
// having to load the track it belongs to first. Rename and delete live
// here rather than in the editor for the same reason — they are
// housekeeping, not authoring, and putting a Delete next to a Save while
// somebody is mid-edit is asking for a bad afternoon.
//
// OWNER-ONLY, server-verified: every request goes through
// app/api/cue-sheets with `verifyArtistAuth`, and rename/delete re-check
// the row against the caller. This component's job is to render, not to
// decide who may.

function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CueSheetLibrary() {
  const [session, setSession] = useState(undefined);
  const [sheets, setSheets] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = useCallback(async (accessToken) => {
    try {
      const res = await fetch('/api/cue-sheets?all=1', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) { setSheets([]); return; }
      const body = await res.json();
      setSheets(body.sheets || []);
    } catch {
      setSheets([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s ?? null);
      if (s?.access_token) await load(s.access_token);
      else setSheets([]);
    })();
    return () => { cancelled = true; };
  }, [load]);

  async function rename(sheet) {
    const name = renameValue.trim();
    if (!name || name === sheet.name) { setRenamingId(null); return; }
    setError('');
    setBusyId(sheet.id);
    try {
      const res = await fetch('/api/cue-sheets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: sheet.id, name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not rename that sheet.'); return; }
      setSheets((prev) => (prev || []).map((x) => (x.id === sheet.id ? { ...x, name: body.sheet.name } : x)));
      setRenamingId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(sheet) {
    setError('');
    setBusyId(sheet.id);
    try {
      const res = await fetch(`/api/cue-sheets?id=${encodeURIComponent(sheet.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not delete that sheet.'); return; }
      setSheets((prev) => (prev || []).filter((x) => x.id !== sheet.id));
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  }

  if (session === undefined) return null;
  if (!session) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>CUE SHEETS</span>
        {sheets !== null && sheets.length > 0 && (
          <span style={{ fontSize: 10, color: 'rgba(1,22,39,0.45)' }}>
            {sheets.length} saved
          </span>
        )}
      </div>

      {error && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{error}</div>}

      {sheets === null && <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)', marginTop: 12 }}>Loading…</div>}

      {sheets !== null && sheets.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <EmptyState
            compact
            title="No cue sheets yet"
            body="Load a backing track in Kit Check or on stage, mark your cuts, give the sheet a name and save it. It'll be here for every show after that."
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {(sheets || []).map((sheet) => {
          const isRenaming = renamingId === sheet.id;
          const isConfirming = confirmDeleteId === sheet.id;
          return (
            <div key={sheet.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenaming ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(sheet);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      autoFocus
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(1,22,39,0.2)', background: 'transparent', padding: '7px 9px', fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit' }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sheet.name || 'Default'}
                    </div>
                  )}
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {/* The track label is what the artist recognises. The
                        hash is what the sheet is actually keyed to, and
                        is shown short so a sheet whose track was never
                        labelled is still identifiable rather than blank. */}
                    {sheet.track_label || `track ${String(sheet.track_hash || '').slice(0, 8)}`}
                    {' · '}{(sheet.cues || []).length} cue{(sheet.cues || []).length === 1 ? '' : 's'}
                    {sheet.updated_at ? ` · ${whenLabel(sheet.updated_at)}` : ''}
                  </div>
                </div>

                {isRenaming ? (
                  <>
                    <button type="button" onClick={() => rename(sheet)} disabled={busyId === sheet.id} style={smallBtn(TEAL)}>SAVE</button>
                    <button type="button" onClick={() => setRenamingId(null)} style={smallBtn('rgba(1,22,39,0.5)')}>CANCEL</button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setRenamingId(sheet.id); setRenameValue(sheet.name || 'Default'); }}
                      aria-label={`Rename ${sheet.name}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(1,22,39,0.5)', padding: 3 }}
                    >
                      <PencilSimple size={14} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(sheet.id)}
                      aria-label={`Delete ${sheet.name}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: RED, padding: 3 }}
                    >
                      <Trash size={14} weight="bold" />
                    </button>
                  </>
                )}
              </div>

              {/* Deleting a sheet throws away work that took a whole song
                  to author, so it asks -- inline, where the thing being
                  deleted is still visible and named. */}
              {isConfirming && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.65)' }}>
                    Delete “{sheet.name}”? The cuts in it are gone for good.
                  </span>
                  <button type="button" onClick={() => remove(sheet)} disabled={busyId === sheet.id} style={{ ...smallBtn('#fdfffc'), background: RED, border: 'none' }}>
                    {busyId === sheet.id ? 'DELETING…' : 'DELETE'}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} style={smallBtn('rgba(1,22,39,0.5)')}>KEEP</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function smallBtn(color) {
  return {
    padding: '6px 10px',
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color,
    background: 'transparent',
    border: '1px solid rgba(1,22,39,0.18)',
    borderRadius: 0,
    cursor: 'pointer',
    flexShrink: 0,
  };
}
