'use client';
import { useState } from 'react';
import { track } from '../../lib/telemetry';

export default function ShareBox({ url, showId, title }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); track('share_page.copy', {}, { showId }); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link', url); }
  }
  const enc = encodeURIComponent(url); const text = encodeURIComponent(`${title} on Loudentify`);
  const nets = [['X', `https://twitter.com/intent/tweet?url=${enc}&text=${text}`], ['WA', `https://wa.me/?text=${text}%20${enc}`], ['IG', null], ['TT', null]];
  return (
    <div className="w-card" data-testid="share-box">
      <h2 className="w-h3" style={{ fontSize: 22 }}>Share this show</h2>
      <div className="w-share-url"><span data-testid="share-url">{url.replace(/^https?:\/\//, '')}</span><button className="w-pill w-pill-white" style={{ height: 44 }} onClick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy'}</button></div>
      <div className="w-social" style={{ justifyContent: 'space-between' }}>
        {nets.map(([n, href]) => href ? <a key={n} href={href} target="_blank" rel="noreferrer" aria-label={`Share on ${n}`} style={{ flex: 1, borderRadius: 22 }}>{n}</a> : <button key={n} onClick={copy} aria-label={`Copy link for ${n}`} style={{ flex: 1, borderRadius: 22, height: 40, background: 'rgba(1,22,39,.07)', fontWeight: 700, fontSize: 13 }}>{n}</button>)}
      </div>
    </div>
  );
}
