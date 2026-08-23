'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, GearSix } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';
import { getSession, getProfile } from '../lib/supabaseAuth';
import EmptyState from './EmptyState';
import ScheduleShow from './ScheduleShow';
import BRollLibrary from './BRollLibrary';
import { getSupabase } from '../lib/supabaseClient';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// The artist studio home. The five invented supporters with invented
// paid/free tiers and invented token amounts that used to sit here are
// gone -- inventing revenue is the single fastest way to make an artist
// distrust every other number on this page.

export default function ArtistDashboard() {
  // Accounts & Identity Day 2 -- real recordings library, replacing the old
  // CLIP_DEFS mock (same toggle-switch visual it already had, now backed by
  // the `recordings` table instead of local-only state).
  const [session, setSession] = useState(null);
  const [profileName, setProfileName] = useState('Your studio');
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [playingId, setPlayingId] = useState(null);
  // Signed URLs used purely as poster frames. Fetched once per recording
  // after the list loads -- signing is cheap and these expire on their
  // own, so there is nothing to invalidate.
  const [posterUrls, setPosterUrls] = useState({});
  const [playingUrl, setPlayingUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { profile } = await getProfile(s.user.id);
        if (!cancelled && profile) setProfileName(profile.display_name || profile.username || 'Your studio');
        await fetchRecordings(s.user.id);
      }
      setRecordingsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchRecordings(artistId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('recordings')
      .select('*')
      .eq('artist_id', artistId)
      .order('recorded_at', { ascending: false });
    if (!error) {
      setRecordings(data || []);
      loadPosters(data || []);
    }
  }

  async function loadPosters(list) {
    const s = await getSession();
    if (!s) return;
    // Sequential on purpose: a handful of recordings, and firing N
    // signing requests at once buys nothing on a page that has already
    // rendered its layout.
    for (const rec of list) {
      try {
        const res = await fetch(`/api/recordings/${rec.id}/url`, {
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
        if (!res.ok) continue;
        const { url } = await res.json();
        if (url) setPosterUrls((prev) => ({ ...prev, [rec.id]: url }));
      } catch {
        // a missing poster is cosmetic -- the card still works
      }
    }
  }

  async function toggleVisibility(recording) {
    const nextVisibility = recording.visibility === 'public' ? 'private' : 'public';
    // Optimistic -- this is a single-owner toggle on a row already scoped
    // to `artist_id = auth.uid()` by RLS, low risk to update local state
    // before the round trip resolves.
    setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, visibility: nextVisibility } : r)));
    const supabase = getSupabase();
    const { error } = await supabase
      .from('recordings')
      .update({ visibility: nextVisibility })
      .eq('id', recording.id);
    if (error) {
      // Revert on failure.
      setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, visibility: recording.visibility } : r)));
    }
  }

  async function handlePlay(recording) {
    if (playingId === recording.id) {
      setPlayingId(null);
      setPlayingUrl(null);
      return;
    }
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
      if (res.ok) {
        setSyncNotice(`Synced -- ${data.inserted} new, ${data.skipped} already up to date.`);
        await fetchRecordings(session.user.id);
      } else {
        setSyncNotice(data.error || 'Sync failed.');
      }
    } catch {
      setSyncNotice('Sync failed.');
    }
    setSyncing(false);
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.5)' }}>STUDIO</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4 }}>{profileName}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/notifications" style={{ width: 38, height: 38, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <Bell size={16} color={INK} />
              <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
            </Link>
            <Link href="/settings" style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <GearSix size={16} color={INK} />
            </Link>
          </div>
        </div>

        {/* Fake stats removed: FOLLOWERS 84.2K / TOKENS EARNED 312K /
            SIGNAL 8,420 were invented. Nothing counts followers, tokens
            or "signal" yet, so there is nothing honest to put here --
            and inventing an artist's reach is the one number they would
            most reasonably act on. */}

        <div style={{ marginTop: 26 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>SHOWS</span>
          <div style={{ marginTop: 12 }}>
            <ScheduleShow />
          </div>
        </div>

        <div style={{ marginTop: 30 }}>
          <BRollLibrary />
        </div>

        <div style={{ display: 'flex', gap: 32, marginTop: 30, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>RECORDINGS</span>
              {session && (
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
            {/* Thumbnail grid, not a list. A recording is a visual
                thing -- a row of filenames makes an artist open three of
                them to find the one they meant. Poster frames come from
                the real file (a muted <video> seeked ~1s in via a media
                fragment), so there is no separate thumbnail pipeline to
                build or keep in sync. */}
            <div style={{ marginTop: 12 }}>
              {!session && (
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Sign in as an artist to view your recordings.</div>
              )}
              {session && recordingsLoading && (
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>
              )}
              {session && !recordingsLoading && recordings.length === 0 && (
                <EmptyState
                  compact
                  title="No recordings yet"
                  body="After a show, hit Sync recordings and your footage lands here."
                />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
                {recordings.map((rec) => {
                  const on = rec.visibility === 'public';
                  const poster = posterUrls[rec.id];
                  return (
                    <div key={rec.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', overflow: 'hidden' }}>
                      <div
                        onClick={() => handlePlay(rec)}
                        style={{ position: 'relative', height: 116, background: 'rgba(1,22,39,0.06)', cursor: 'pointer', overflow: 'hidden' }}
                      >
                        {poster ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video
                            src={`${poster}#t=1`}
                            preload="metadata"
                            muted
                            playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
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

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
                          <div
                            onClick={() => toggleVisibility(rec)}
                            style={{ width: 38, height: 20, flexShrink: 0, cursor: 'pointer', position: 'relative', background: on ? 'rgba(46,196,182,0.15)' : 'rgba(1,22,39,0.06)', border: `1px solid ${on ? 'rgba(46,196,182,0.5)' : 'rgba(1,22,39,0.15)'}`, clipPath: 'polygon(4px 0,100% 0,100% 100%,0 100%,0 4px)' }}
                          >
                            <div style={{ position: 'absolute', top: 2, width: 14, height: 14, background: on ? TEAL : 'rgba(1,22,39,0.4)', left: on ? 20 : 2, transition: 'left 0.2s ease', boxShadow: on ? '0 0 8px rgba(46,196,182,0.6)' : 'none' }} />
                          </div>
                          <span style={{ fontSize: 8.5, letterSpacing: '0.06em', color: on ? TEAL : 'rgba(1,22,39,0.4)' }}>{on ? 'PUBLIC' : 'PRIVATE'}</span>
                          <Link
                            href={`/share/${rec.id}`}
                            style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, textDecoration: 'none' }}
                          >
                            SHARE
                          </Link>
                        </div>
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

          <div style={{ flex: '1 1 320px' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>TOP SUPPORTERS</span>
            <div style={{ marginTop: 12 }}>
              <EmptyState
                compact
                title="No supporters yet"
                body="Once fans send tokens during your shows, your top supporters appear here."
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
