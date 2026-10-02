'use client';
import { useState } from 'react';
import { searchArticles } from '../../lib/site/help';
import { Search, Chevron } from './SiteIcons';

export default function HelpSearch() {
  const [q, setQ] = useState('');
  const results = searchArticles(q);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <label className="w-search"><Search size={22} /><input type="search" placeholder="Search for an answer" aria-label="Search help" value={q} onChange={(e) => setQ(e.target.value)} data-testid="help-search" /></label>
      {q.trim() && (
        <div className="w-list" style={{ width: '100%', maxWidth: 720 }} data-testid="help-results">
          {results.length ? results.map((a) => <a key={a.slug} href={`/help/${a.slug}`}><span>{a.title}</span><Chevron size={20} /></a>)
            : <div className="w-list-row" data-testid="help-empty" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><strong>Nothing matches &ldquo;{q}&rdquo;.</strong><span className="w-note">Try a different word, or <a href="/contact" className="w-link">ask us directly</a>.</span></div>}
        </div>
      )}
    </div>
  );
}
