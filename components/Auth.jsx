'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp, signIn, getSession, getProfile, validateUsername, isUsernameAvailable, normaliseUsername } from '../lib/supabaseAuth';
import { countryOptions } from '../lib/countries';
import GenreSelect from './GenreSelect';
import { setAccountType } from '../lib/mockAccount';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Age is derived from DOB at validation time and never persisted --
// storing an integer age means storing a number that is wrong tomorrow.
function ageFrom(dob) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

const labelStyle = { fontSize: 10, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)', fontWeight: 700, marginBottom: 4 };

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
  const searchParams = useSearchParams();
  // Where to land after a successful auth. Defaults per role, but a
  // ?next= (set by RequireAuth) wins so a shared show link survives the
  // detour through this page.
  const nextParam = searchParams?.get('next') || '';
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('fan');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [country, setCountry] = useState('');
  const [genres, setGenres] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isSignup = mode === 'signup';

  function destinationFor(dbRole) {
    if (nextParam && nextParam.startsWith('/')) return nextParam;
    return dbRole === 'artist' ? '/dashboard' : '/discover';
  }

  // Already signed in? Don't show a login form. Runs once on mount; the
  // redirect is `replace` so Back doesn't bounce them straight here again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled || !session?.user) return;
      const { profile } = await getProfile(session.user.id);
      if (cancelled) return;
      router.replace(destinationFor(profile?.role));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function continueAction() {
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    if (isSignup) {
      if (!fullName.trim()) {
        setError('Full name is required.');
        return;
      }
      const usernameProblem = validateUsername(username);
      if (usernameProblem) {
        setError(`${role === 'artist' ? 'Stage name' : 'Username'}: ${usernameProblem}`);
        return;
      }
      if (!dateOfBirth) {
        setError('Date of birth is required.');
        return;
      }
      // Age is DERIVED here and never stored -- see DECISIONS.md. 13 is
      // the floor every major platform uses and the one any later
      // payout/age gate will build on.
      const age = ageFrom(dateOfBirth);
      if (age === null || age < 13) {
        setError('You must be at least 13 to create an account.');
        return;
      }
      if (age > 120) {
        setError('Check the date of birth.');
        return;
      }
      if (!country) {
        setError('Select a country.');
        return;
      }
      const free = await isUsernameAvailable(username);
      if (!free) {
        setError(`That ${role === 'artist' ? 'stage name' : 'username'} is taken.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSignup) {
        const dbRole = role === 'artist' ? 'artist' : 'viewer';
        const result = await signUp({
          email: email.trim(),
          password,
          role: dbRole,
          // display_name is what renders on the stage; default it to the
          // handle rather than the raw email, which nobody wants shown.
          displayName: displayName.trim() || normaliseUsername(username),
          fullName: fullName.trim(),
          username,
          dateOfBirth,
          country,
          genres,
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
        router.push(destinationFor(dbRole));
      } else {
        const result = await signIn({ email: email.trim(), password });
        if (result.error) {
          setError(result.error.message || 'Log in failed.');
          return;
        }
        const dbRole = result.profile?.role;
        setAccountType(dbRole === 'artist' ? 'artist' : 'fan');
        router.push(destinationFor(dbRole));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: PORCELAIN, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>Loudentify</div>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <div>
                <div style={labelStyle}>FULL NAME</div>
                <input
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                {/* One column, two labels. Artists think in stage names,
                    fans think in usernames -- but a single namespace is
                    what stops the two colliding once handles are public. */}
                <div style={labelStyle}>{role === 'artist' ? 'STAGE NAME' : 'USERNAME'}</div>
                <input
                  placeholder={role === 'artist' ? 'How you appear on stage' : 'Pick a handle'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.4)', marginTop: 4 }}>
                  {username ? `loudentify.com/@${normaliseUsername(username)}` : 'Lowercase letters, numbers and underscores.'}
                </div>
              </div>

              <div>
                <div style={labelStyle}>DATE OF BIRTH</div>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <div style={labelStyle}>COUNTRY</div>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                >
                  <option value="">Select a country</option>
                  {countryOptions().map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>GENRES <span style={{ fontWeight: 400, letterSpacing: 0 }}>(optional)</span></div>
                <GenreSelect value={genres} onChange={setGenres} />
              </div>
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
