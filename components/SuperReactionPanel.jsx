'use client';

import { useState } from 'react';

// SUPER_REACTIONS: each has its own icon and its own adaptive label text,
// but they all share one label slot underneath rather than three floating
// captions competing for space.
const SUPER_REACTIONS = [
  { key: 'riff', emoji: '\uD83C\uDFB8', label: 'nice riff' },
  { key: 'run', emoji: '\u2b06\ufe0f', label: 'nice run' },
  { key: 'rap', emoji: '\uD83C\uDFA4', label: "it's a rap" },
];

export default function SuperReactionPanel({ visible, onReact }) {
  const [label, setLabel] = useState('');

  if (!visible) return null;

  function handleClick(reaction) {
    setLabel(reaction.label);
    if (onReact) onReact(reaction.key);
    // Label clears itself after a moment so it doesn't linger past its beat.
    setTimeout(() => setLabel(''), 1200);
  }

  return (
    <div>
      <div className="super-panel">
        {SUPER_REACTIONS.map((r) => (
          <button
            key={r.key}
            className="reaction-btn"
            style={{ background: '#534AB7' }}
            aria-label={r.key}
            onClick={() => handleClick(r)}
          >
            {r.emoji}
          </button>
        ))}
      </div>
      <div className="super-label">{label}</div>
    </div>
  );
}
