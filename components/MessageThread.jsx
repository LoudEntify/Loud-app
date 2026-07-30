'use client';

import { useState } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Mock data only -- a single hardcoded conversation with Neon Meridian.
// No inbox/thread list exists in the design source, so this is the app's
// only DM surface for the pilot; sending just appends locally, nothing
// persists or reaches a real recipient.
const INITIAL_MESSAGES = [
  { id: 1, text: 'hey! catch the versus set last night?', mine: false },
  { id: 2, text: "yes it was incredible, that camera switch on the drop", mine: true },
  { id: 3, text: 'appreciate that! new solo show friday', mine: false },
  { id: 4, text: "I'll be there, sending tokens either way", mine: true },
];

export default function MessageThread() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { id: m.length + 1, text, mine: true }]);
    setDraft('');
  };

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', alignItems: 'center', background: PORCELAIN, color: INK }}>
      <div style={{ width: '100%', maxWidth: 720, height: '100%', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px', flexShrink: 0 }}>
          <AvatarRing name="Neon Meridian" size={34} ringWidth={1.5} />
          <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>Neon Meridian</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '60%',
                  padding: '11px 15px',
                  background: m.mine ? TEAL : 'rgba(1,22,39,0.08)',
                  color: m.mine ? PORCELAIN : INK,
                  fontSize: 13.5,
                  lineHeight: 1.4,
                  clipPath: m.mine
                    ? 'polygon(0 0,calc(100% - 4px) 0,100% 20%,100% 80%,calc(100% - 4px) 100%,0 100%)'
                    : 'polygon(4px 0,100% 0,100% 100%,4px 100%,0 80%,0 20%)',
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, borderTop: '1px solid rgba(1,22,39,0.1)', flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(1,22,39,0.6)' }} />
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Message..."
            style={{ flex: 1, border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '11px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }}
          />
          <button
            type="button"
            onClick={send}
            style={{ width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: INK, clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)' }}
          >
            <PaperPlaneTilt size={16} color={PORCELAIN} />
          </button>
        </div>

      </div>
    </div>
  );
}
