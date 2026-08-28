'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ImagePlaceholder from './ImagePlaceholder';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';

const INK = '#011627';
const TEAL = '#2ec4b6';

// Recordings grid, shared by both profile modes.
//
// `owner` is a RENDERING switch, not a security boundary. The security
// is in the database: the recordings RLS policies let an owner read all
// of their own rows and everyone else read only rows marked public. So a
// non-owner asking for this artist's recordings gets the public subset
// back from the API -- there is no owner data arriving and then being
// hidden. Sync, visibility toggles and private rows simply have nothing
// to act on for a visitor.
export default function RecordingsLibrary({ artistId, owner }) {
  const [session, setSession] = useState(null);
  const [recordings, setRecordings] = useState(null);
  const [posterUrls, setPosterUrls] = useState({});
  const [playingId, setPlayingId] = useState(null);
  const [playingUrl, setPlayingUrl] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  const loadPosters = useCallback(async (list, s) => {
    if (!s) return;
    for (const rec of list) {
      try {
        const res = await fetch(`/api/recordings/${rec.id}/url`, {
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
        if (!res.ok) continue;
        const { url } = await res.json();
        if (url) setPosterUrls((prev) => ({ ...prev, [rec.id]: url }));
      } catch {
        // a missing poster is cosmetic
      }
    }
  }, []);

  const fetchRecordings = useCallback(async (s) => {
    // No visibility filter here on purpose. RLS decides what comes back:
    // everything for the owner, public-only for anyone else.
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .eq('artist_id', artistId)
      .order('recorded_at', { ascending: false });
    const list = error ? [] : (data || []);
    setRecordings(list);
    loadPosters(list, s);
  }, [artistId, loadPosters]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      await fetchRecordings(s);
    })();
    return () => { cancelled = true; };
  }, [fetchRecordings]);

  async function toggleVisibility(recording) {
    const next = recording.visibility === 'public' ? 'private' : 'public';
    setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, visibility: next } : r)));
    const { error } = await getSupabase().from('recordings').update({ visibility: next }).eq('id', recording.id);
    if (error) {
      // Put it back -- an optimistic toggle that silently failed would
      // leave the artist believing a private recording is public.
      setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, visibility: recording.visibility } : r)));
    }
  }

  async function handlePlay(recording) {
    if (playingId === recording.id) { setPlayingId(null); setPlayingUrl(null); return; }
    if (!session) return;
    const res = await fetch(`/api/recordings/${recording.id}/url`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setPlayingId(recording.id);
    setPlayingUrl(data.url);
  }

  async function handleSync() {
    if (!session) return;
    setSyncing(true);
    setSyncNotice('');
    try {
      const res = await fetch('/api/recordings/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setSyncNotice(res.ok ? `Synced — ${data.inserted} new, ${data.skipped} already up to date.` : (data.error || 'Sync failed.'));
      if (res.ok) await fetchRecordings(session);
    } catch {
      setSyncNotice('Sync failed.');
    }
    setSyncing(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>
          {owner ? 'RECORDINGS' : 'PAST SHOWS'}
        </span>
        {owner && session && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700, color: TEAL, background: 'none', border: 'none', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}
          >
            {syncing ? 'SYNCING…' : 'SYNC RECORDINGS'}
          </button>
        )}
      </div>
      {syncNotice && <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.5)', marginTop: 6 }}>{syncNotice}</div>}

      <div style={{ marginTop: 12 }}>
        {recordings === null && <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>}

        {recordings !== null && recordings.length === 0 && (
          <EmptyState
            compact
            title={owner ? 'No recordings yet' : 'No public shows yet'}
            body={owner
              ? 'After a show, hit Sync recordings and your footage lands here.'
              : 'When this artist makes a recording public, it appears here.'}
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          {(recordings || []).map((rec) => {
            const on = rec.visibility === 'public';
            const poster = posterUrls[rec.id];
            return (
              <div key={rec.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', overflow: 'hidden' }}>
                <div onClick={() => handlePlay(rec)} style={{ position: 'relative', height: 116, background: 'rgba(1,22,39,0.06)', cursor: 'pointer', overflow: 'hidden' }}>
                  {poster ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={`${poster}#t=1`} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <ImagePlaceholder label="VOD" />
                  )}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: '#fdfffc', background: 'rgba(1,22,39,0.55)', padding: '4px 9px', borderRadius: 999 }}>
                      {playingId === rec.id ? 'STOP' : 'PLAY'}
                    </span>
                  </div>
                </div>

                <div style={{ padding: '10px 11px' }}>
                  <div style={{ fontSize: 12.5, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 2 }}>{new Date(rec.recorded_at).toLocaleDateString()}</div>

                  {owner && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
                      <div
                        onClick={() => toggleVisibility(rec)}
                        style={{ width: 38, height: 20, flexShrink: 0, cursor: 'pointer', position: 'relative', background: on ? 'rgba(46,196,182,0.15)' : 'rgba(1,22,39,0.06)', border: `1px solid ${on ? 'rgba(46,196,182,0.5)' : 'rgba(1,22,39,0.15)'}`, clipPath: 'polygon(4px 0,100% 0,100% 100%,0 100%,0 4px)' }}
                      >
                        <div style={{ position: 'absolute', top: 2, width: 14, height: 14, background: on ? TEAL : 'rgba(1,22,39,0.4)', left: on ? 20 : 2, transition: 'left 0.2s ease' }} />
                      </div>
                      <span style={{ fontSize: 8.5, letterSpacing: '0.06em', color: on ? TEAL : 'rgba(1,22,39,0.4)' }}>{on ? 'PUBLIC' : 'PRIVATE'}</span>
                      <Link href={`/share/${rec.id}`} style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, textDecoration: 'none' }}>SHARE</Link>
                    </div>
                  )}
                </div>

                {playingId === rec.id && playingUrl && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video controls autoPlay src={playingUrl} style={{ width: '100%' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
