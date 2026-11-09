'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp, signIn, getSession, getProfile, validateUsername, isUsernameAvailable, normaliseUsername } from '../lib/supabaseAuth';
import { countryOptions } from '../lib/countries';
import GenreSelect from './GenreSelect';
import { setAccountType } from '../lib/mockAccount';
import styles from '../styles/Auth.module.css';
import '../styles/reactions.css';
import Logo from './Logo';

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

// Platform minimum age. Single source for the client-side check and
// the copy beneath the date field; the server enforces it independently
// (see the DB constraint in docs/age_policy_migration.sql).
export const MIN_AGE = 18;

/**
 * A human-readable message out of ANY error shape.
 *
 * Found while building the authenticated smoke check: a 500 from
 * Supabase signup ("Error sending confirmation email", i.e. the project's
 * SMTP is not configured) rendered on screen as the literal string
 * `{}`. Someone creating an account sees two braces and no idea what to
 * do. Error objects arrive here from three different libraries with
 * three different shapes, so this stops guessing that any one of them
 * has `.message`.
 */
function errorMessage(err, fallback) {
  if (!err) return fallback;
  if (typeof err === 'string') return err.trim() || fallback;
  const msg = err.message || err.error_description || err.error || err.msg;
  if (typeof msg === 'string' && msg.trim() && msg.trim() !== '{}') return msg.trim();
  return fallback;
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
  // ── PILOT 2: NO SELF-SIGNUP ───────────────────────────────────
  // Artist accounts are created by hand in the Supabase dashboard for
  // both pilots, and the audience never reaches this screen at all --
  // they come through the viewer door with a name and an email, and
  // never hold an account.
  //
  // HIDDEN, NOT DELETED, and behind a single flag. Everything the signup
  // path does -- role selection, username validation, the profile row
  // built from user_metadata by ensureProfile -- is left intact and
  // untouched, so restoring it after the 27th is flipping this constant
  // back rather than rebuilding a flow and re-testing it.
  const SELF_SIGNUP_ENABLED = false;
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
  const [showPassword, setShowPassword] = useState(false);
  // Gated as well as hidden. The tab is the only way to reach signup
  // today, but a flag that only hides a button leaves the form one stray
  // setMode away from rendering.
  const isSignup = SELF_SIGNUP_ENABLED && mode === 'signup';

  function destinationFor(dbRole) {
    if (nextParam && nextParam.startsWith('/')) return nextParam;
    return dbRole === 'artist' ? '/dashboard' : '/discover';
  }

  // A brand-new account goes to the walkthrough; everyone else goes where
  // they were headed.
  //
  // Only on SIGN-UP, deliberately. Routing every login through onboarding
  // until it is "complete" would turn a skippable helper into a gate that
  // reappears every session — and someone who skipped the photo step has
  // already told us their answer. Returning accounts get the dismissible
  // bar (components/OnboardingNudge.jsx) instead, which they can act on
  // or ignore.
  //
  // A ?next= still wins: someone who followed a show link and signed up to
  // watch it should land on the show, not on a setup screen. The nudge
  // catches them afterwards.
  function signupDestinationFor(dbRole) {
    if (nextParam && nextParam.startsWith('/')) return nextParam;
    return '/welcome';
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
      // Age is DERIVED here and never stored -- see DECISIONS.md.
      //
      // 18+, not 13+. This is standing launch policy, not a preference:
      // paid voting mechanics, UK Online Safety Act exposure and
      // safeguarding all land on the same floor. Self-declaration is
      // sufficient at this stage; formal age assurance is a later phase.
      const age = ageFrom(dateOfBirth);
      if (age === null || age < MIN_AGE) {
        setError(`You must be at least ${MIN_AGE} to create an account.`);
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
          setError(errorMessage(result.error, 'Sign up failed. If this keeps happening, the email service may be down — try again shortly.'));
          return;
        }
        if (result.needsEmailConfirmation) {
          setNotice('Check your email to confirm your account, then log in.');
          setMode('login');
          return;
        }
        setAccountType(dbRole === 'artist' ? 'artist' : 'fan');
        router.push(signupDestinationFor(dbRole));
      } else {
        const result = await signIn({ email: email.trim(), password });
        if (result.error) {
          setError(errorMessage(result.error, 'Log in failed. Check the email and password.'));
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
  <div className={styles.auth}>
    {SELF_SIGNUP_ENABLED ? (
      <div className={styles.modeTabs}>
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`${styles.modeButton} ${
            mode === 'login' ? styles.modeButtonActive : ''
          }`}
        >
          LOG IN
        </button>

        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`${styles.modeButton} ${
            mode === 'signup' ? styles.modeButtonActive : ''
          }`}
        >
          CREATE ACCOUNT
        </button>
      </div>
    ) : (
      <div
        className={`${styles.modeTabs} ${styles.modeTabsSingle}`}
      >
        <div
          className={`${styles.modeButton} ${styles.modeButtonActive} ${styles.loginLabel}`}
        >
          ARTIST LOG IN
        </div>
      </div>
    )}

    {isSignup && (
      <>
        <div className={styles.roles}>
          <button
            type="button"
            onClick={() => setRole('fan')}
            className={`${styles.roleButton} ${
              role === 'fan' ? styles.roleActive : ''
            }`}
          >
            I'M A FAN
          </button>

          <button
            type="button"
            onClick={() => setRole('artist')}
            className={`${styles.roleButton} ${
              role === 'artist' ? styles.roleActive : ''
            }`}
          >
            I'M AN ARTIST
          </button>
        </div>

        <div className={styles.signupFields}>
          <div className={styles.field}>
            <label className={styles.label}>
              FULL NAME
            </label>

            <input
              className={styles.input}
              placeholder="Your full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              {role === 'artist'
                ? 'STAGE NAME'
                : 'USERNAME'}
            </label>

            <input
              className={styles.input}
              placeholder={
                role === 'artist'
                  ? 'How you appear on stage'
                  : 'Pick a handle'
              }
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
            />

            <p className={styles.helper}>
              {username
                ? `loudentify.com/@${normaliseUsername(
                    username
                  )}`
                : 'Lowercase letters, numbers and underscores.'}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              DATE OF BIRTH
            </label>

            <input
              className={styles.input}
              type="date"
              value={dateOfBirth}
              onChange={(e) =>
                setDateOfBirth(e.target.value)
              }
            />

            <p className={styles.helper}>
              Loudentify is {MIN_AGE}+.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              COUNTRY
            </label>

            <select
              className={styles.select}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">
                Select your country
              </option>

              {countryOptions().map((c) => (
                <option
                  key={c.code}
                  value={c.code}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              GENRES{' '}
              <span className={styles.optional}>
                (optional)
              </span>
            </label>

            <GenreSelect
              value={genres}
              onChange={setGenres}
            />
          </div>
        </div>
      </>
    )}

    <div className={styles.credentials}>
      <div className={styles.field}>
        <label
          className={styles.label}
          htmlFor="loudentify-email"
        >
          EMAIL ADDRESS
        </label>

        <input
          id="loudentify-email"
          className={styles.input}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>

      <div className={styles.field}>
        <label
          className={styles.label}
          htmlFor="loudentify-password"
        >
          PASSWORD
        </label>

        <div className={styles.passwordWrap}>
          <input
            id="loudentify-password"
            className={styles.input}
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            autoComplete={
              isSignup
                ? 'new-password'
                : 'current-password'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) {
                continueAction();
              }
            }}
          />

          <button
            type="button"
            className={styles.showPassword}
            onClick={() =>
              setShowPassword((current) => !current)
            }
            aria-label={
              showPassword
                ? 'Hide password'
                : 'Show password'
            }
          >
            {showPassword ? 'HIDE' : 'SHOW'}
          </button>
        </div>
      </div>
    </div>

    {error && (
      <div
        className={styles.error}
        role="alert"
      >
        {error}
      </div>
    )}

    {notice && (
      <div
        className={styles.notice}
        role="status"
      >
        {notice}
      </div>
    )}

    <button
      type="button"
      onClick={continueAction}
      disabled={submitting}
      className={styles.submit}
    >
      {submitting
        ? 'SIGNING YOU IN...'
        : isSignup
          ? 'CREATE ACCOUNT'
          : 'ENTER LOUDENTIFY →'}
    </button>
  </div>
);
}
