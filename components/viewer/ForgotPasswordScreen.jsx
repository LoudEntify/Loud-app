'use client';
// components/viewer/ForgotPasswordScreen.jsx — ask for the reset link
// (design/ForgotPassword.dc.html) and set the new password when the link
// is followed back (/reset-password).
//
// Two screens, one file, because they are two halves of one errand.
//
// What is deliberate here:
//   - The answer is the same whether or not the email has an account
//     ("If that email has an account, the link is on its way"). Telling a
//     stranger which addresses are registered is a way of enumerating our
//     users, and a person who mistypes their own address is no worse off.
//   - Apple and Google accounts have no password to reset, so the screen
//     says so rather than sending a link that cannot help.
//   - The link lands on /reset-password, where Supabase has already put a
//     recovery session in place; setting the password is then one call.
//     An expired or already-used link leaves no session, and that screen
//     says so and offers to send another.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../lib/supabaseClient';
import { track } from '../../lib/telemetry';
import PasswordField from './PasswordField';
import { Warn, Check, Back } from './Icons';
import { validateResetRequest, validateNewPassword, resetErrorMessage, resetRedirectTo, RESET_SENT_MESSAGE, MIN_PASSWORD } from '../../lib/passwordReset';

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const v = validateResetRequest(email);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    const redirectTo = typeof window !== 'undefined' ? resetRedirectTo(window.location.origin) : undefined;
    const { error } = await getSupabase().auth.resetPasswordForEmail(v.email, { redirectTo });
    setBusy(false);
    // A failure here is a mail or network problem, not "no such account":
    // the screen must not become a way of asking whether an email is registered.
    if (error && !/user not found/i.test(error.message || '')) { setErr('We could not send the link just now. Try again in a minute.'); return; }
    track('auth.reset_requested', {});
    setSent(true);
  }

  return (
    <div className="v-screen v-light" data-testid="forgot-password">
      <div className="v-row" style={{ gap: 12 }}>
        <a href="/login" aria-label="Back to log in" className="v-btn v-btn-ghost-light" style={{ width: 44, height: 44, borderRadius: 22, padding: 0, justifyContent: 'center' }}><Back /></a>
        <h1 className="v-h1" style={{ fontSize: 30, margin: 0 }}>Forgot password</h1>
      </div>
      {sent ? (
        <div className="v-card-light v-col" style={{ padding: 16, gap: 8 }} role="status" data-testid="reset-sent">
          <span className="v-row" style={{ gap: 8, fontWeight: 700 }}><span style={{ color: 'var(--teal)' }}><Check /></span>Check your email</span>
          <span className="v-muted" style={{ fontSize: 15 }}>{RESET_SENT_MESSAGE}</span>
          <button type="button" className="v-btn v-btn-ghost-light" onClick={() => { setSent(false); setEmail(''); }}>Use a different email</button>
        </div>
      ) : (
        <form onSubmit={submit} className="v-col" style={{ gap: 12 }}>
          <h2 className="v-h2" style={{ fontSize: 20, margin: 0 }}>Reset your password</h2>
          <span className="v-muted" style={{ fontSize: 15 }}>Type the email you signed up with and we will send you a link.</span>
          <label className="v-field">Email
            <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="reset-email" />
          </label>
          {err && <div className="v-error" role="alert"><span style={{ color: 'var(--red)' }}><Warn /></span><span>{err}</span></div>}
          <button type="submit" className="v-btn v-btn-lg v-btn-ink" disabled={busy} data-testid="send-link">{busy ? 'Sending' : 'Send the link'}</button>
        </form>
      )}
      <div className="v-card-light v-col" style={{ padding: 16, gap: 4 }}>
        <span style={{ fontWeight: 700 }}>Signed up with Apple or Google?</span>
        <span className="v-muted" style={{ fontSize: 15 }}>There is no password to reset. Go back and use that button instead.</span>
      </div>
      <a className="v-link" style={{ alignSelf: 'center' }} href="/login">Back to log in</a>
    </div>
  );
}

export function ResetPasswordScreen() {
  const router = useRouter();
  // 'checking' until Supabase has had its chance to turn the link into a
  // recovery session; 'ready' to type a new password; 'expired' when the
  // link is old or already used; 'done' once it is changed.
  const [state, setState] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let settled = false;
    const decide = (session) => { if (!settled) { settled = true; setState(session ? 'ready' : 'expired'); } };
    // The recovery session arrives either in the URL fragment (handled by the
    // client as it loads) or already in storage; both land here.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) decide(session);
    });
    supabase.auth.getSession().then(({ data }) => { if (data?.session) decide(data.session); });
    const timer = setTimeout(() => decide(null), 3000);
    return () => { clearTimeout(timer); sub?.subscription?.unsubscribe?.(); };
  }, []);

  async function submit(e) {
    e.preventDefault();
    const v = validateNewPassword(password, confirm);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) { setErr(resetErrorMessage(error) || 'That did not work. Ask for a new link and try again.'); return; }
    track('auth.password_reset', {});
    setState('done');
  }

  return (
    <div className="v-screen v-light" data-testid="reset-password">
      <h1 className="v-h1" style={{ fontSize: 30 }}>Choose a new password</h1>
      {state === 'checking' && <div className="v-card-light" style={{ padding: 16 }} role="status">Checking your link…</div>}
      {state === 'expired' && (
        <div className="v-card-light v-col" style={{ padding: 16, gap: 8 }} data-testid="reset-expired">
          <span className="v-row" style={{ gap: 8, fontWeight: 700 }}><span style={{ color: 'var(--red)' }}><Warn /></span>That link has expired</span>
          <span className="v-muted" style={{ fontSize: 15 }}>A reset link works for one hour and once only. Ask for a fresh one and it will land in a moment.</span>
          <a className="v-btn v-btn-lg v-btn-ink" href="/forgot-password">Send me a new link</a>
        </div>
      )}
      {state === 'ready' && (
        <form onSubmit={submit} className="v-col" style={{ gap: 12 }}>
          <PasswordField label="New password" autoComplete="new-password" placeholder={`${MIN_PASSWORD}+ characters`} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus testId="new-password" />
          <PasswordField label="Type it again" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} testId="confirm-password" />
          {err && <div className="v-error" role="alert"><span style={{ color: 'var(--red)' }}><Warn /></span><span>{err}</span></div>}
          <button type="submit" className="v-btn v-btn-lg v-btn-ink" disabled={busy} data-testid="save-password">{busy ? 'Saving' : 'Save the new password'}</button>
        </form>
      )}
      {state === 'done' && (
        <div className="v-card-light v-col" style={{ padding: 16, gap: 8 }} role="status" data-testid="reset-done">
          <span className="v-row" style={{ gap: 8, fontWeight: 700 }}><span style={{ color: 'var(--teal)' }}><Check /></span>Password changed</span>
          <span className="v-muted" style={{ fontSize: 15 }}>You are signed in on this device. On your other devices, use the new password next time.</span>
          <button type="button" className="v-btn v-btn-lg v-btn-teal" onClick={() => router.replace('/discover')}>Go to Discover</button>
        </div>
      )}
    </div>
  );
}
