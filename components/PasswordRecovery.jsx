'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../lib/supabaseClient';
import styles from '../styles/Auth.module.css';

export default function PasswordRecovery({ reset = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!reset);
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reset) return;
    let alive = true;
    const client = getSupabase();
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has('error') || new URLSearchParams(window.location.search).has('error')) {
      setInvalid(true);
      return;
    }
    // Supabase consumes the recovery hash and initializes the session.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (alive && event === 'PASSWORD_RECOVERY' && session) { setReady(true); setInvalid(false); }
    });
    client.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (!error && data.session) setReady(true);
      else setInvalid(true);
    }).catch(() => { if (alive) setInvalid(true); });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [reset]);

  async function submit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    setError('');
    if (reset && password !== confirmation) return setError('Your passwords don’t match. Please try again.');
    setBusy(true);
    try {
      const client = getSupabase();
      if (reset) {
        const { error } = await client.auth.updateUser({ password });
        if (error) { setError(error.message || 'Could not update your password. Please request a new reset link.'); return; }
        // End this recovery session; the next sign-in uses the new password.
        await client.auth.signOut();
      } else {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: new URL('/reset-password', window.location.origin).toString(),
        });
        if (error) { setError('We couldn’t send the reset link right now. Please wait a moment and try again.'); return; }
      }
      setPassword(''); setConfirmation(''); setDone(true);
    } catch {
      setError('We couldn’t connect. Please check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (done) return <div className={styles.confirmation}><span className={styles.confirmationIcon} aria-hidden="true">✓</span><h3>{reset ? 'Your password is updated.' : 'Check your inbox.'}</h3><p role="status">{reset ? 'Sign in with your new password to get back to the music.' : 'If an account exists for that email address, we’ve sent a password-reset link. Check your inbox and spam folder.'}</p><Link href="/auth" className={styles.submitLink}>Back to sign in →</Link></div>;
  if (invalid) return <div className={styles.confirmation}><p role="alert">This reset link is invalid or has expired. Request a new link to reset your password.</p><Link href="/forgot-password" className={styles.submitLink}>Request a new link →</Link></div>;
  if (!ready) return <p className={styles.helper} role="status">Checking your reset link…</p>;

  return <form className={styles.auth} onSubmit={submit}><fieldset className={styles.fieldset} disabled={busy}><div className={styles.credentials}>
    {reset ? <>
      <div className={styles.field}><label htmlFor="reset-password" className={styles.label}>NEW PASSWORD</label><div className={styles.passwordWrap}><input id="reset-password" className={styles.input} type={visible ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} minLength={8} autoComplete="new-password" aria-describedby="reset-password-help" required /><button type="button" className={styles.showPassword} onClick={() => setVisible(v => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? 'HIDE' : 'SHOW'}</button></div><p id="reset-password-help" className={styles.helper}>At least 8 characters. Use a unique password.</p></div>
      <div className={styles.field}><label htmlFor="confirm-password" className={styles.label}>CONFIRM NEW PASSWORD</label><input id="confirm-password" className={styles.input} type={visible ? 'text' : 'password'} value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={8} autoComplete="new-password" required /></div>
    </> : <div className={styles.field}><label htmlFor="recovery-email" className={styles.label}>EMAIL ADDRESS</label><input id="recovery-email" className={styles.input} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required /></div>}
    </div>{error && <div role="alert" className={styles.error}>{error}</div>}<button type="submit" className={styles.submit} disabled={busy}>{busy ? 'PLEASE WAIT…' : reset ? 'Save new password →' : 'Send reset link →'}</button></fieldset><p className={styles.switchMode}><Link href="/auth">← Back to sign in</Link></p></form>;
}
