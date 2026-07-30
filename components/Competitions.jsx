'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Mock data only -- no competitions backend exists yet for this pilot.
// Entering a competition just flips local state (no persistence).
const COMPETITIONS = [
  { id: 'c1', genre: 'RAP', title: 'Summer Cypher Open', deadline: 'Aug 5', entrants: '312' },
  { id: 'c2', genre: 'R&B', title: 'Velvet Sessions', deadline: 'Aug 9', entrants: '184' },
  { id: 'c3', genre: 'AFROBEATS', title: 'Lagos to the World', deadline: 'Aug 14', entrants: '267' },
  { id: 'c4', genre: 'GOSPEL', title: 'Rise Up Showcase', deadline: 'Aug 20', entrants: '96' },
  { id: 'c5', genre: 'POP', title: 'Bright Lights Round 3', deadline: 'Aug 28', entrants: '429' },
];

export default function Competitions() {
  const [entered, setEntered] = useState({});

  const toggleEnter = (id) => setEntered((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/discover" style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
            <ArrowLeft size={15} color={INK} />
          </Link>
          <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Competitions</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 22 }}>
          {COMPETITIONS.map((comp) => {
            const isIn = !!entered[comp.id];
            return (
              <div key={comp.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)', padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: TEAL, background: 'rgba(46,196,182,0.1)', border: '1px solid rgba(46,196,182,0.4)', padding: '3px 8px' }}>{comp.genre}</span>
                  <span style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)' }}>{comp.entrants} entered</span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, marginTop: 10 }}>{comp.title}</div>
                <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 5 }}>Entries close {comp.deadline}</div>
                <button
                  type="button"
                  onClick={() => toggleEnter(comp.id)}
                  style={{
                    marginTop: 12,
                    width: '100%',
                    textAlign: 'center',
                    padding: '11px 0',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    color: isIn ? TEAL : INK,
                    background: isIn ? 'transparent' : 'rgba(1,22,39,0.06)',
                    border: isIn ? '1px solid rgba(46,196,182,0.6)' : 'none',
                    boxShadow: isIn ? '0 0 10px rgba(46,196,182,0.3)' : 'none',
                  }}
                >
                  {isIn ? 'ENTERED' : 'ENTER COMPETITION'}
                </button>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
