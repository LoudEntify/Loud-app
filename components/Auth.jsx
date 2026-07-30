'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccountType, setAccountType } from '../lib/mockAccount';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Mock signup/login -- no real auth backend. Signup is the one place the
// mock accountType (lib/mockAccount.js) actually gets set, from the
// fan/artist choice below; logging back in just respects whatever
// accountType is already stored (defaulting to fan), since there's no
// real account to look up.
export default function Auth() {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('fan');

  const isSignup = mode === 'signup';

  const continueAction = () => {
    if (isSignup) {
      setAccountType(role);
      router.push(role === 'artist' ? '/dashboard' : '/profile');
    } else {
      router.push(getAccountType() === 'artist' ? '/dashboard' : '/profile');
    }
  };

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: PORCELAIN, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>Neon Meridian</div>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.4)' }}>LIVE MUSIC PLATFORM</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setMode('login')}
            style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', background: mode === 'login' ? 'rgba(46,196,182,0.12)' : 'transparent', color: mode === 'login' ? TEAL : 'rgba(1,22,39,0.5)' }}
          >
            LOG IN
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', background: mode === 'signup' ? 'rgba(46,196,182,0.12)' : 'transparent', color: mode === 'signup' ? TEAL : 'rgba(1,22,39,0.5)' }}
          >
            SIGN UP
          </button>
        </div>

        {isSignup && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <div
              onClick={() => setRole('fan')}
              style={{ flex: 1, textAlign: 'center', padding: '14px 0', cursor: 'pointer', border: role === 'fan' ? '1px solid rgba(46,196,182,0.6)' : 'none', borderRadius: 999 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: role === 'fan' ? TEAL : 'rgba(1,22,39,0.6)' }}>I&apos;M A FAN</span>
            </div>
            <div
              onClick={() => setRole('artist')}
              style={{ flex: 1, textAlign: 'center', padding: '14px 0', cursor: 'pointer', border: role === 'artist' ? '1px solid rgba(46,196,182,0.6)' : 'none', borderRadius: 999 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: role === 'artist' ? TEAL : 'rgba(1,22,39,0.6)' }}>I&apos;M AN ARTIST</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <input placeholder="Email" style={{ border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '13px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }} />
          <input type="password" placeholder="Password" style={{ border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '13px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }} />
        </div>

        <button
          type="button"
          onClick={continueAction}
          style={{ marginTop: 18, width: '100%', display: 'block', textAlign: 'center', padding: '14px 0', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: PORCELAIN, background: 'linear-gradient(90deg,#2ec4b6,#ff9f1c)' }}
        >
          {isSignup ? 'CREATE ACCOUNT' : 'LOG IN'}
        </button>

      </div>
    </div>
  );
}
