'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp, signIn, getSession, getProfile, validateUsername, isUsernameAvailable, normaliseUsername, checkSignupSetup } from '../lib/supabaseAuth';
import { countryOptions } from '../lib/countries';
import { setAccountType } from '../lib/mockAccount';
import styles from '../styles/Auth.module.css';

export const MIN_AGE = 18;

function message(error, fallback) {
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
}

function safeNext(value) {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '';
}

export default function Auth({ accountRole = null, initialMode = 'login' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams?.get('next') || '');
  const signup = initialMode === 'signup';
  const [role, setRole] = useState(accountRole || 'fan');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [country, setCountry] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const target = dbRole => next || `/dashboard/${dbRole === 'artist' ? 'artist' : 'fan'}`;
  const withNext = path => next ? `${path}?next=${encodeURIComponent(next)}` : path;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled || !session?.user) return;
        const result = await getProfile(session.user.id);
        if (cancelled) return;
        if (result.error || !['artist', 'viewer'].includes(result.profile?.role)) {
          setError('We couldn’t load your account profile. Please contact build@loudentify.app.');
          return;
        }
        router.replace(target(result.profile.role));
      } catch {
        if (!cancelled) setError('We couldn’t connect to your account. Please try again.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // Each route mounts its own form. Preserve the requested destination on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (submitting || checking) return;
    setError('');
    if (signup) {
      if (!fullName.trim()) return setError('Please enter your full name.');
      const usernameError = validateUsername(username);
      if (usernameError) return setError(usernameError);
      const dob = new Date(`${dateOfBirth}T00:00:00`);
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--;
      if (Number.isNaN(dob.getTime()) || age < MIN_AGE || age > 120) return setError('Please enter a valid date of birth. You must be 18 or over.');
      if (!countryOptions().some(option => option.code === country)) return setError('Please select your country.');
    }
    setSubmitting(true);
    try {
      if (signup) {
        const setup = await checkSignupSetup();
        if (setup.error) return setError(setup.error.message);
        if (!await isUsernameAvailable(username)) {
          setError(`That ${role === 'artist' ? 'stage name' : 'username'} is unavailable. Please choose another.`);
          return;
        }
        const dbRole = role === 'artist' ? 'artist' : 'viewer';
        const result = await signUp({
          email: email.trim(), password, role: dbRole,
          displayName: normaliseUsername(username), fullName: fullName.trim(),
          username, dateOfBirth, country, genres: [],
          emailRedirectTo: new URL(withNext(`/auth/${role}`), window.location.origin).toString(),
        });
        if (result.error) return setError(message(result.error, 'Could not create your account. Please try again.'));
        if (result.needsEmailConfirmation) {
          setPassword('');
          setConfirmation(true);
          return;
        }
        if (!['artist', 'viewer'].includes(result.profile?.role)) return setError('Your account was created, but your profile is not ready. Please sign in again or contact build@loudentify.app.');
        setAccountType(result.profile.role === 'artist' ? 'artist' : 'fan');
        router.push(target(result.profile.role));
      } else {
        const result = await signIn({ email: email.trim(), password });
        if (result.error) return setError(message(result.error, 'Sign in failed. Please check your email and password.'));
        if (!['artist', 'viewer'].includes(result.profile?.role)) return setError('Your account profile is not ready. Please contact build@loudentify.app.');
        setAccountType(result.profile.role === 'artist' ? 'artist' : 'fan');
        router.push(target(result.profile.role));
      }
    } catch {
      setError('We couldn’t connect. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) return <div className={styles.confirmation}><span className={styles.confirmationIcon} aria-hidden="true">✓</span><h3>Check your inbox.</h3><p role="status">We’ve requested a confirmation email for <strong>{email}</strong>. Follow the link if it arrives, then sign in. If you already have an account, you can sign in now.</p><Link className={styles.submitLink} href={withNext(`/auth/${role}`)}>Continue to sign in →</Link></div>;

  return (
    <form className={styles.auth} onSubmit={submit}>
      <fieldset disabled={submitting || checking} className={styles.fieldset}>
        {signup ? <>
          <div className={styles.roles} aria-label="Choose account type">
            <button type="button" onClick={() => setRole('fan')} aria-pressed={role === 'fan'} className={`${styles.roleButton} ${role === 'fan' ? styles.roleActive : ''}`}><span aria-hidden="true">♡</span><strong>I’m a fan</strong><small>Find your front row</small></button>
            <button type="button" onClick={() => setRole('artist')} aria-pressed={role === 'artist'} className={`${styles.roleButton} ${role === 'artist' ? styles.roleActive : ''}`}><span aria-hidden="true">♫</span><strong>I’m an artist</strong><small>Make the stage yours</small></button>
          </div>
          <div className={styles.signupFields}>
            <div className={styles.field}><label className={styles.label} htmlFor="auth-full-name">FULL NAME</label><input id="auth-full-name" className={styles.input} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" autoComplete="name" maxLength={120} required /></div>
            <div className={styles.field}><label className={styles.label} htmlFor="auth-username">{role === 'artist' ? 'STAGE NAME / HANDLE' : 'USERNAME'}</label><input id="auth-username" className={styles.input} value={username} onChange={e => setUsername(e.target.value)} placeholder="your_name" autoComplete="username" autoCapitalize="none" autoCorrect="off" minLength={3} maxLength={20} pattern="[a-z0-9_]{3,20}" aria-describedby="username-help" required /><p id="username-help" className={styles.helper}>3–20 lowercase letters, numbers or underscores.</p></div>
            <div className={styles.field}><label className={styles.label} htmlFor="auth-dob">DATE OF BIRTH</label><input id="auth-dob" className={styles.input} type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} autoComplete="bday" aria-describedby="age-help" required /><p id="age-help" className={styles.helper}>You must be 18 or over.</p></div>
            <div className={styles.field}><label className={styles.label} htmlFor="auth-country">COUNTRY</label><select id="auth-country" className={styles.select} value={country} onChange={e => setCountry(e.target.value)} autoComplete="country" required><option value="">Select country</option>{countryOptions().map(option => <option key={option.code} value={option.code}>{option.name}</option>)}</select></div>
          </div>
        </> : <div className={styles.loginContext}><span aria-hidden="true">●</span>{accountRole === 'artist' ? 'ARTIST' : accountRole === 'fan' ? 'FAN' : 'ACCOUNT'} SIGN IN</div>}
        <div className={styles.credentials}>
          <div className={styles.field}><label className={styles.label} htmlFor="auth-email">EMAIL ADDRESS</label><input id="auth-email" className={styles.input} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required /></div>
          <div className={styles.field}><label className={styles.label} htmlFor="auth-password">PASSWORD</label><div className={styles.passwordWrap}><input id="auth-password" className={styles.input} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={signup ? 'Create a strong password' : 'Your password'} autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 8 : undefined} aria-describedby={signup ? 'password-help' : undefined} required /><button type="button" className={styles.showPassword} onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'HIDE' : 'SHOW'}</button></div>{signup && <p id="password-help" className={styles.helper}>At least 8 characters. Choose a password unique to this account.</p>}</div>
        </div>
        {!signup && <Link href="/forgot-password" className={styles.forgotLink}>Forgot password?</Link>}
        {signup && <p className={styles.privacy}>Read how we handle your details in our <Link href="/privacy">Privacy Notice</Link>. Creating an account does not subscribe you to the waitlist.</p>}
        {error && <div className={styles.error} role="alert">{error}</div>}
        <button type="submit" className={styles.submit} disabled={submitting || checking}>{checking ? 'CHECKING YOUR SESSION…' : submitting ? signup ? 'CREATING YOUR ACCOUNT…' : 'SIGNING YOU IN…' : signup ? 'Create your account →' : 'Step inside →'}</button>
      </fieldset>
      <p className={styles.switchMode}>{signup ? 'Already part of the show?' : 'New to Loudentify?'} <Link href={withNext(signup ? accountRole ? `/auth/${accountRole}` : '/auth' : accountRole ? `/signup/${accountRole}` : '/signup')}>{signup ? 'Sign in' : 'Create an account'} ↗</Link></p>
    </form>
  );
}
