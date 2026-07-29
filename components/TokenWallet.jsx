'use client';

import { useState } from 'react';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Mock data only -- no backend/payment wiring exists yet for this pilot.
const TOKEN_BALANCE = 1240;

const TIERS = [
  { id: 'starter', badge: 'S', name: 'Starter', tokens: '500', price: '$4.99', border: 'rgba(1,22,39,0.12)' },
  { id: 'boost', badge: 'B', name: 'Boost', tokens: '1,500', price: '$12.99', border: 'rgba(46,196,182,0.4)' },
  { id: 'superfan', badge: 'SF', name: 'Superfan', tokens: '5,000', price: '$39.99', border: 'rgba(1,22,39,0.12)' },
];

export default function TokenWallet() {
  const [selectedTierId, setSelectedTierId] = useState(null);
  const [hoveredTierId, setHoveredTierId] = useState(null);

  const selectedTier = TIERS.find((t) => t.id === selectedTierId);

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        background: PORCELAIN,
        color: INK,
        padding: '32px 24px 60px',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Wallet</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 22, alignItems: 'flex-start' }}>
          <div
            style={{
              flex: '1 1 220px',
              border: '1px solid rgba(255,159,28,0.4)',
              boxShadow: '0 0 20px rgba(255,159,28,0.15)',
              clipPath: 'polygon(16px 0,100% 0,100% 100%,0 100%,0 16px)',
              padding: 22,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.5)' }}>
              TOKEN BALANCE
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: INK, marginTop: 6, letterSpacing: '-0.01em' }}>
              {TOKEN_BALANCE.toLocaleString()}
            </div>
          </div>

          <div
            style={{
              flex: '1.4 1 260px',
              padding: '16px 18px',
              border: '1px solid rgba(1,22,39,0.1)',
              clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
            }}
          >
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'rgba(1,22,39,0.7)' }}>
              Tokens support artists. A free like and a paid vote carry the same weight in an
              artist&apos;s engagement score — buying tokens funds artists directly, it doesn&apos;t
              change your odds of anything.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>
            BUY TOKENS
          </span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
              marginTop: 12,
            }}
          >
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                onMouseEnter={() => setHoveredTierId(tier.id)}
                onMouseLeave={() => setHoveredTierId((v) => (v === tier.id ? null : v))}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  border: `1px solid ${tier.border}`,
                  clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)',
                  padding: '20px 14px',
                  transition: 'box-shadow 0.15s ease',
                  boxShadow: hoveredTierId === tier.id ? '0 0 16px rgba(46,196,182,0.25)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(46,196,182,0.1)',
                    clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                  }}
                >
                  <span style={{ fontSize: 10, color: TEAL }}>{tier.badge}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{tier.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)' }}>{tier.tokens} tokens</div>
                <button
                  className={selectedTierId === tier.id ? 'btn-active' : ''}
                  onClick={() => setSelectedTierId((v) => (v === tier.id ? null : tier.id))}
                  style={{ background: INK, color: PORCELAIN, padding: '8px 18px', fontSize: 13, marginTop: 4 }}
                >
                  {tier.price}
                </button>
              </div>
            ))}
          </div>
        </div>

        {selectedTier && (
          <div
            style={{
              marginTop: 20,
              padding: '14px 18px',
              border: '1px solid rgba(46,196,182,0.4)',
              clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(1,22,39,0.75)' }}>
              Selected <strong>{selectedTier.name}</strong> — {selectedTier.tokens} tokens for{' '}
              {selectedTier.price}. Checkout isn&apos;t connected in this pilot build.
            </p>
            <button
              onClick={() => setSelectedTierId(null)}
              style={{ background: 'rgba(1,22,39,0.08)', color: INK, padding: '6px 14px', fontSize: 12 }}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
