'use client';

import { useState, useRef } from 'react';
import { GENRES } from '../lib/genres';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Tag-style multi-select, no free-typing outside GENRES (lib/genres.js) --
// deliberately restrictive this round, see that file's own comment.
// Typing filters the dropdown; a tag is only ever added by clicking (or
// Enter-ing) an actual suggestion, so a partial or misspelled string can
// never end up stored -- there's no code path that writes `input` itself
// into `value`.
export default function GenreSelect({ value = [], onChange }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const suggestions = (input.trim()
    ? GENRES.filter((g) => g.toLowerCase().includes(input.trim().toLowerCase()))
    : GENRES
  ).filter((g) => !value.includes(g));

  function addGenre(g) {
    if (!value.includes(g)) onChange([...value, g]);
    setInput('');
    inputRef.current?.focus();
  }

  function removeGenre(g) {
    onChange(value.filter((v) => v !== g));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) addGenre(suggestions[0]);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeGenre(value[value.length - 1]);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          border: '1px solid rgba(1,22,39,0.15)',
          padding: '8px 10px',
          clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
        }}
      >
        {value.map((g) => (
          <span
            key={g}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: TEAL, background: 'rgba(46,196,182,0.12)', padding: '4px 8px', borderRadius: 999 }}
          >
            {g}
            <span onClick={() => removeGenre(g)} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 13, lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Add a genre…' : ''}
          style={{ flex: 1, minWidth: 100, border: 'none', outline: 'none', fontSize: 13, color: INK, background: 'transparent', fontFamily: 'inherit' }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: PORCELAIN,
            border: '1px solid rgba(1,22,39,0.15)',
            maxHeight: 180,
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(1,22,39,0.15)',
          }}
        >
          {suggestions.map((g) => (
            // onMouseDown (not onClick) + preventDefault -- the input's
            // own onBlur fires on mousedown too and would close this
            // dropdown before a click event ever landed, standard
            // autocomplete-dropdown pattern.
            <div
              key={g}
              onMouseDown={(e) => {
                e.preventDefault();
                addGenre(g);
              }}
              style={{ padding: '8px 12px', fontSize: 13, color: INK, cursor: 'pointer' }}
            >
              {g}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
