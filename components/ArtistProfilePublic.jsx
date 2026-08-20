'use client';

import { useState, useEffect } from 'react';
import AvatarRing from './AvatarRing';
import ImagePlaceholder from './ImagePlaceholder';
import { getSupabase } from '../lib/supabaseClient';

const INK = '#011627';
const PORCELAIN = '#fdfffc';

// Accounts & Identity Day 2 -- real public artist profile, a new component
// rather than an adaptation of components/ArtistProfile.jsx: that file's
// followers/tokens/SIGNAL/engagement-bars/live-banner/shows-calendar are
// all fictional stats with no backing data anywhere in this app (no
// followers table, no tokens, no engagement metric) -- inventing numbers
// for a page that's now real would be actively misleading, worse than
// just not building those sections yet. This page renders only what's
// actually real: profiles' display fields (public-artist-read policy from
// Day 1) and this artist's public recordings (recordings' public-select
// policy from this round), with sensible empty states everywhere data is
// missing -- never an error page. app/artist/page.js (the old mock, single
// hardcoded artist) is untouched; re-wiring existing "view artist" links to
// this new per-id route is discover-page wiring, explicitly Day 3.
export default function ArtistProfilePublic({ artistId }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [playingUrl, setPlayingUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      const [{ data: p }, { data: recs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', artistId).eq('role', 'artist').maybeSingle(),
        supabase
          .from('recordings')
          .select('*')
          .eq('artist_id', artistId)
          .eq('visibility', 'public')
          .order('recorded_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setProfile(p || null);
      setRecordings(recs || []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  async function handlePlay(recording) {
    if (playingId === recording.id) {
      setPlayingId(null);
      setPlayingUrl(null);
      return;
    }
    const res = await fetch(`/api/recordings/${recording.id}/url`);
    if (!res.ok) return;
    const data = await res.json();
    setPlayingId(recording.id);
    setPlayingUrl(data.url);
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: 48 }}>Loading…</div>;
  }

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: 48 }}>
        <p style={{ fontSize: 14, color: 'rgba(1,22,39,0.6)' }}>Artist not found.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '40px 48px 80px' }}>
      <div style={{ display: 'flex', gap: 48, maxWidth: 1160, margin: '0 auto', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        <div style={{ width: 280, flexShrink: 0 }}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" style={{ width: 106, height: 106, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <AvatarRing name={profile.display_name} size={106} />
          )}

          <div style={{ marginTop: 18, fontSize: 25, fontWeight: 700, color: INK, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
            {profile.display_name}
          </div>

          {profile.genre && (
            <span style={{ display: 'inline-block', marginTop: 10, fontSize: 10.5, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.7)', border: '1px solid rgba(1,22,39,0.15)', clipPath: 'polygon(6px 0,100% 0,100% 100%,calc(100% - 6px) 100%,0 100%,0 6px)', padding: '7px 11px' }}>
              {profile.genre}
            </span>
          )}

          <p style={{ marginTop: 16, fontSize: 13.5, lineHeight: 1.6, color: profile.bio ? 'rgba(1,22,39,0.8)' : 'rgba(1,22,39,0.35)' }}>
            {profile.bio || 'No bio yet.'}
          </p>
        </div>

        <div style={{ flex: 1, minWidth: 280, maxWidth: 700, paddingTop: 6 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>RECORDINGS</span>
          {recordings.length === 0 ? (
            <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(1,22,39,0.4)' }}>No recordings yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {recordings.map((rec) => (
                <div key={rec.id}>
                  <div
                    onClick={() => handlePlay(rec)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '10px 14px', cursor: 'pointer' }}
                  >
                    <div style={{ width: 56, height: 40, flexShrink: 0, clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)', overflow: 'hidden' }}>
                      <ImagePlaceholder label={playingId === rec.id ? 'Stop' : 'Play'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title}</div>
                      <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 2 }}>{new Date(rec.recorded_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  {playingId === rec.id && playingUrl && (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video controls autoPlay src={playingUrl} style={{ width: '100%', marginTop: 6, borderRadius: 4 }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
