'use client';
// components/viewer/SearchScreen.jsx — Search (Search, SearchResults,
// SearchNoResults boards). Recent searches live on the device and can be
// removed one at a time or cleared; guests get search without history.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/viewerApi';
import { useSession } from '../../lib/useSession';
import { Skeleton, Empty } from './States';
import { Back, Search as SearchIcon, Clock, Close, Person } from './Icons';

const KEY = 'loudentify.recentSearches';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ } };

export default function SearchScreen({ initialQuery = '' }) {
  const { session } = useSession();
  const [q, setQ] = useState(initialQuery);
  const [recent, setRecent] = useState([]);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('top');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => { if (session) setRecent(load()); }, [session]);
  useEffect(() => { api('/api/viewer/search?q=').then((r) => { if (r.ok) setData((d) => d || r.data); }); }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      const r = await api(`/api/viewer/search?q=${encodeURIComponent(q)}`);
      setBusy(false);
      if (r.ok) setData(r.data);
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);
  function commit(term) {
    if (!session || !term.trim()) return;
    const next = [term.trim(), ...recent.filter((r) => r !== term.trim())];
    setRecent(next); save(next);
  }
  const results = data?.results;
  const typing = q.trim().length > 0;
  const nothing = typing && results && !results.artists.length && !results.shows.length && !results.genres.length;
  const tabs = [['top', 'Top'], ['artists', 'Artists'], ['live', 'Live and upcoming'], ['genres', 'Genres']];
  return (
    <div className="v-screen" data-testid="search-screen">
      <form className="v-row" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); commit(q); }}>
        <a href="/discover" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a>
        <label className="v-row" style={{ flex: 1, height: 48, padding: '0 14px', borderRadius: 24, background: 'rgba(255,255,255,0.72)', gap: 8 }}>
          <SearchIcon size={20} /><input aria-label="Search" placeholder="Artists, shows, genres" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 17, outline: 'none', color: 'var(--ink)' }} />
          {q && <button type="button" aria-label="Clear" onClick={() => setQ('')} className="v-icon-btn" style={{ width: 36, height: 36 }}><Close size={18} /></button>}
        </label>
      </form>
      {!typing && session && recent.length > 0 && (
        <section className="v-col" style={{ gap: 6 }}>
          <div className="v-row" style={{ justifyContent: 'space-between' }}><h2 className="v-h2" style={{ fontSize: 20 }}>Recent</h2><button className="v-link" style={{ padding: '4px 8px' }} onClick={() => { setRecent([]); save([]); }}>Clear all</button></div>
          {recent.map((r) => <div key={r} className="v-row" style={{ height: 44, gap: 12 }}><Clock size={20} /><button style={{ flex: 1, textAlign: 'left', fontSize: 17 }} onClick={() => setQ(r)}>{r}</button><button aria-label={`Remove ${r}`} className="v-icon-btn" style={{ width: 36, height: 36 }} onClick={() => { const n = recent.filter((x) => x !== r); setRecent(n); save(n); }}><Close size={18} /></button></div>)}
        </section>
      )}
      {!typing && (
        <>
          <section className="v-col" style={{ gap: 10 }}>
            <h2 className="v-h2" style={{ fontSize: 20 }}>Browse genres</h2>
            <div className="v-row" style={{ flexWrap: 'wrap', gap: 8 }}>{(results?.genres || []).map((g, i) => <button key={g} className="v-chip" style={{ height: 40, fontSize: 17, fontWeight: 700, background: ['linear-gradient(135deg, rgba(46,196,182,.32), rgba(255,255,255,.7))', 'linear-gradient(135deg, rgba(255,159,28,.3), rgba(255,255,255,.7))', 'linear-gradient(135deg, rgba(231,29,54,.2), rgba(255,255,255,.7))'][i % 3], color: 'var(--ink)' }} onClick={() => setQ(g)}>{g}</button>)}</div>
          </section>
          <section className="v-col" style={{ gap: 10 }}>
            <h2 className="v-h2" style={{ fontSize: 20 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--red)' }} />Live now</h2>
            {!results ? <Skeleton h={72} /> : results.liveNow.length ? results.liveNow.map((s) => <ShowRow key={s.id} s={s} />) : <span className="v-muted">Nothing live right now.</span>}
          </section>
        </>
      )}
      {typing && (
        <>
          <div className="v-row" style={{ gap: 8, overflowX: 'auto' }} role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className="v-chip v-chip-light" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
          {busy && !results && <Skeleton h={60} />}
          {nothing && (
            <Empty title={`No results for “${q}”`} body={data.suggestions?.spellings?.length ? `Did you mean ${data.suggestions.spellings.join(', ')}?` : data.suggestions?.nearestGenre ? `Closest genre: ${data.suggestions.nearestGenre}.` : 'Try an artist, a show or a genre.'} action={data.suggestions?.spellings?.[0] || data.suggestions?.nearestGenre ? `Search ${data.suggestions.spellings?.[0] || data.suggestions.nearestGenre}` : null} onAction={() => setQ(data.suggestions.spellings?.[0] || data.suggestions.nearestGenre)} />
          )}
          {results && !nothing && (tab === 'top' || tab === 'artists') && results.artists.length > 0 && (
            <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 20 }}>Artists</h2>{results.artists.map((a) => <a key={a.id} href={a.username ? `/@${a.username}` : `/artist/${a.id}`} className="v-row" style={{ gap: 12, height: 56 }}><span className="v-avatar" style={{ width: 44, height: 44 }}>{a.avatar_url ? <img src={a.avatar_url} alt="" /> : <Person />}</span><span className="v-col" style={{ gap: 2 }}><span style={{ fontSize: 18, fontWeight: 700 }}>{a.display_name}</span><span className="v-muted" style={{ fontSize: 14 }}>{a.username ? `@${a.username}` : ''}{a.genres?.length ? ` · ${a.genres.slice(0, 2).join(', ')}` : ''}</span></span></a>)}</section>
          )}
          {results && !nothing && (tab === 'top' || tab === 'live') && results.shows.length > 0 && (
            <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 20 }}>Live and upcoming</h2>{results.shows.map((s) => <ShowRow key={s.id} s={s} />)}</section>
          )}
          {results && !nothing && (tab === 'top' || tab === 'genres') && results.genres.length > 0 && (
            <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 20 }}>Genres</h2><div className="v-row" style={{ flexWrap: 'wrap', gap: 8 }}>{results.genres.map((g) => <a key={g} href={`/live?genre=${encodeURIComponent(g)}`} className="v-chip v-chip-light" style={{ height: 40, fontSize: 17, fontWeight: 700 }}>{g}</a>)}</div></section>
          )}
        </>
      )}
    </div>
  );
}

function ShowRow({ s }) {
  const live = s.derived_state === 'live';
  const name = s.performance_mode === 'versus' ? `${s.artist?.display_name || 'A'} vs ${s.artist_b?.display_name || 'B'}` : s.artist?.display_name || s.artist_name;
  return (
    <a href={`/show/${s.id}`} className="v-row" style={{ gap: 12 }}>
      <span className="v-poster" style={{ width: 56, height: 72, borderRadius: 10, flexShrink: 0 }} />
      <span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 18, fontWeight: 700 }}>{name}</span><span className="v-muted" style={{ fontSize: 15 }}>{s.title}{live ? '' : ` · ${new Date(s.slated_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}</span></span>
      {live ? <span className="v-badge v-badge-live">LIVE</span> : <span className="v-badge v-badge-soon">SOON</span>}
    </a>
  );
}
