'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp, signIn } from '../lib/supabaseAuth';
import { setAccountType } from '../lib/mockAccount';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

const inputStyle = { border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '13px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' };

// Real Supabase Auth (email+password), Accounts & Identity Day 1 --
// replaces the old mock continueAction that never read the email/
// password fields at all. `role` here is the UI's existing 'fan'/
// 'artist' toggle (unchanged copy/branding); it's mapped to the
// profiles table's stored 'viewer'/'artist' values at the signUp() call
// site below, since those are two independent vocabularies (product
// copy vs. the DB CHECK constraint) that happen to mean the same thing.
//
// setAccountType() (lib/mockAccount.js) is still called on success as a
// bridging step -- Sidebar.jsx's PROFILE link destination and
// AccountSettings.jsx still read that localStorage flag, and replacing
// those is out of scope for this round. Real auth is now the source of
// truth for identity; the mock flag just keeps existing nav behavior
// working until that's migrated too.
//
// No genre field here (Day 2 product decision) -- genres are now a fixed-
// list multi-select (lib/genres.js, components/GenreSelect.jsx), and this
// compact signup form never had room for that picker. Every account
// starts with genres: [] and picks them later via Settings.
export default function Auth() {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('fan');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isSignup = mode === 'signup';

  async function continueAction() {
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    try {
      if (isSignup) {
        const dbRole = role === 'artist' ? 'artist' : 'viewer';
        const result = await signUp({
          email: email.trim(),
          password,
          role: dbRole,
          displayName: displayName.trim() || email.trim(),
        });
        if (result.error) {
          setError(result.error.message || 'Sign up failed.');
          return;
        }
        if (result.needsEmailConfirmation) {
          setNotice('Check your email to confirm your account, then log in.');
          setMode('login');
          return;
        }
        setAccountType(dbRole === 'artist' ? 'artist' : 'fan');
        router.push(dbRole === 'artist' ? '/dashboard' : '/profile');
      } else {
        const result = await signIn({ email: email.trim(), password });
        if (result.error) {
          setError(result.error.message || 'Log in failed.');
          return;
        }
        const dbRole = result.profile?.role;
        setAccountType(dbRole === 'artist' ? 'artist' : 'fan');
        router.push(dbRole === 'artist' ? '/dashboard' : '/profile');
      }
    } finally {
      setSubmitting(false);
    }
  }

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
          <>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <input
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={inputStyle}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </div>

        {error && <div style={{ marginTop: 10, fontSize: 12, color: '#e71d36' }}>{error}</div>}
        {notice && <div style={{ marginTop: 10, fontSize: 12, color: TEAL }}>{notice}</div>}

        <button
          type="button"
          onClick={continueAction}
          disabled={submitting}
          style={{ marginTop: 18, width: '100%', display: 'block', textAlign: 'center', padding: '14px 0', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: PORCELAIN, background: 'linear-gradient(90deg,#2ec4b6,#ff9f1c)', opacity: submitting ? 0.6 : 1, border: 'none', cursor: submitting ? 'default' : 'pointer' }}
        >
          {submitting ? 'PLEASE WAIT...' : isSignup ? 'CREATE ACCOUNT' : 'LOG IN'}
        </button>

      </div>
    </div>
  );
}
