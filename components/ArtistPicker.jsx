'use client';

// components/ArtistPicker.jsx
// ─────────────────────────────────────────────────────────────
// Search for an artist and select them. Used to invite a co-performer
// into a Versus show.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Database, Auth
//
// ── WHY THIS REPLACES A COPYABLE LINK ─────────────────────────
// The invite used to be a URL the artist copied and sent over WhatsApp.
// That took the invitation off the platform, made the other artist
// accept somewhere else, and left no record of who invited whom — the
// feature worked and felt like a workaround.
//
// ── THE LINK IS STILL HERE, AS THE EXCEPTION ──────────────────
// You cannot notify somebody who does not have an account, so inviting
// an artist who is not on Loudentify still produces a link. That is
// offered as a secondary action rather than deleted: it is the only path
// that works for someone who has not signed up, and it is the same token
// underneath either way.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

const INK = '#011627';
const TEAL = '#2ec4b6';

// Long enough that typing a name does not fire a query per keystroke,
// short enough that the list feels like it is following you.
const DEBOUNCE_MS = 250;

export default function ArtistPicker({ accessToken, onSelect, busy, disabled }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  // Guards against an older, slower query landing after a newer one and
  // replacing good results with stale ones.
  const seqRef = useRef(0);

  const search = useCallback(async (q) => {
    const seq = ++seqRef.current;
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    setError('');
    try {
      const res = await fetch(`/api/artists/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (seq !== seqRef.current) return; // a newer search has started
      if (!res.ok) { setError(body.error || 'Search failed.'); setResults([]); return; }
      setResults(body.artists || []);
    } catch {
      if (seq === seqRef.current) { setError('Search failed.'); setResults([]); }
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const t = setTimeout(() => search(term), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, search]);

  return (
    <div style={{ marginTop: 8 }}>
      <input
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search for the other artist"
        disabled={disabled}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          border: '1px solid rgba(1,22,39,0.18)', background: 'transparent', color: INK,
          clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)',
        }}
      />

      {error && <div style={{ fontSize: 11, color: '#e71d36', marginTop: 6 }}>{error}</div>}

      {/* Silence is ambiguous while a query is in flight: "nobody by
          that name" and "still looking" are different answers and the
          artist is about to act on one of them. */}
      {searching && (
        <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.45)', marginTop: 6 }}>Searching…</div>
      )}

      {!searching && term.trim().length >= 2 && results.length === 0 && !error && (
        <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.45)', marginTop: 6, lineHeight: 1.5 }}>
          No artist by that name. If they are not on Loudentify yet, use the invite link below.
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 6, border: '1px solid rgba(1,22,39,0.12)' }}>
          {results.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a)}
              disabled={!!busy}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 10px', background: 'transparent', border: 'none',
                borderBottom: '1px solid rgba(1,22,39,0.08)', cursor: busy ? 'default' : 'pointer',
                textAlign: 'left', opacity: busy ? 0.5 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: a.avatar_url ? `center/cover url(${a.avatar_url})` : 'rgba(1,22,39,0.12)',
                }}
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: INK }}>
                  {a.display_name || a.username}
                </span>
                {a.username && (
                  <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(1,22,39,0.5)' }}>
                    @{a.username}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: TEAL }}>
                {busy === a.id ? 'INVITING…' : 'INVITE'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
