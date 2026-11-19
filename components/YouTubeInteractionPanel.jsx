'use client';
import { useEffect, useState } from 'react';
import { interactionToken } from '../lib/interactionClient';

export default function YouTubeInteractionPanel({ showId, roomName, playbackPositionMs }) {
  const [prompt, setPrompt] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!roomName) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(`/api/show-prompts/list?room=${encodeURIComponent(roomName)}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) setPrompt((data.prompts || []).filter(item => item.kind === 'choice').at(-1) || null);
      } catch { /* video remains independent of interactions */ }
    };
    read(); const timer = setInterval(read, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [roomName]);
  if (!prompt) return null;
  const vote = async (choiceIndex) => {
    setBusy(true); setMessage('');
    try {
      const token = await interactionToken(showId);
      if (!token) throw new Error('Could not start a secure voting session.');
      const response = await fetch('/api/prompt-responses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Interaction-Token': token }, body: JSON.stringify({ promptId: prompt.id, choiceIndex, playbackPositionMs: playbackPositionMs?.() ?? null }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your vote did not send.');
      setChosen(choiceIndex); setMessage('Vote received. You can change it while voting remains open.');
    } catch (error) { setMessage(error.message || 'Your vote did not send.'); }
    finally { setBusy(false); }
  };
  return (
    <aside aria-labelledby="youtube-vote-title" style={{ marginTop: 18, padding: 18, borderRadius: 14, background: '#0b2530', border: '1px solid rgba(46,196,182,.28)' }}>
      <div id="youtube-vote-title" style={{ fontSize: 16, fontWeight: 750, marginBottom: 12 }}>{prompt.body}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(prompt.options || []).map((option, index) => <button key={option} type="button" disabled={busy} onClick={() => vote(index)} aria-pressed={chosen === index} style={{ minHeight: 44, padding: '10px 16px', borderRadius: 8, border: chosen === index ? '1px solid #2ec4b6' : '1px solid rgba(255,255,255,.2)', background: chosen === index ? '#2ec4b6' : '#102f3b', color: chosen === index ? '#011627' : '#fdfffc', fontSize: 16, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{option}</button>)}
      </div>
      {message && <p role="status" aria-live="polite" style={{ margin: '10px 0 0', color: '#b8ccd3', fontSize: 14 }}>{message}</p>}
    </aside>
  );
}
