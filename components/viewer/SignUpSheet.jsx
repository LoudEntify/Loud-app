'use client';
// components/viewer/SignUpSheet.jsx — the one-page sign-up (SignUp.dc.html,
// YT-GuestSignUp.dc.html) and the kind stop screen (UnderAge.dc.html).
//
// One page, under a minute: watch or perform, name, username, date of
// birth, location, Terms in one line, then Apple / Google / email. Apple
// and Google are shown but not wired: the providers need Korey's Apple
// and Google developer accounts (docs/NEEDS_KOREY.md). Email is the
// working path today.
import { useEffect, useState } from 'react';
import { validateSignup, TERMS_VERSION } from '../../lib/signupRules';
import { api } from '../../lib/viewerApi';
import { getSupabase } from '../../lib/supabaseClient';
import { track } from '../../lib/telemetry';
import { COUNTRY_CODES } from '../../lib/countries';
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code }));
import { refreshProfile } from '../../lib/useSession';
import { Warn } from './Icons';

export function UnderAge({ onWrongDate }) {
  return (
    <div className="v-root v-dark" style={{ minHeight: '100dvh', padding: '52px 20px 36px', display: 'flex', flexDirection: 'column', gap: 22 }} data-testid="under-age">
      <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: 26, width: 'auto' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
        <span className="v-icon-btn" style={{ width: 64, height: 64, background: 'rgba(253,255,252,0.14)' }}><Warn size={30} /></span>
        <h1 style={{ fontSize: 34, lineHeight: 1.1 }}>You need to be 18 to use Loudentify</h1>
        <p style={{ fontSize: 18, lineHeight: 1.5, color: 'rgba(253,255,252,0.88)' }}>Thanks for your interest. Shows here are live and unedited, and fans can send money to artists, so we keep it to adults.</p>
        <p style={{ fontSize: 17, lineHeight: 1.5, color: 'rgba(253,255,252,0.82)' }}>We have not kept the date you entered. Come back when you turn 18 and the music will still be here.</p>
      </div>
      <div className="v-col" style={{ gap: 12 }}>
        <a className="v-btn v-btn-lg v-btn-ghost-dark" href="https://www.youtube.com/music">Find music elsewhere</a>
        <button className="v-link" style={{ alignSelf: 'center' }} onClick={onWrongDate}>I entered the wrong date</button>
      </div>
    </div>
  );
}

const inputStyle = {};

export default function SignUpSheet({ trigger = 'tap', onDone, onLogin, initialRole = 'viewer', compact = false, embedded = false }) {
  const [role, setRole] = useState(initialRole);
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', dateOfBirth: '', country: 'GB', city: '', email: '', password: '', stageName: '', acceptTerms: false, trainingDataOptOut: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [emailMode, setEmailMode] = useState(true);
  useEffect(() => { track('signup.started', { trigger }); }, [trigger]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const v = validateSignup({ ...form, role });
    if (v.underage) { setUnderage(true); track('signup.underage', { trigger }); return; }
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setBusy(true);
    const res = await api('/api/viewer/signup', { method: 'POST', body: { ...form, role, trigger, termsVersion: TERMS_VERSION } });
    if (res.data?.underage) { setBusy(false); setUnderage(true); return; }
    if (!res.ok) { setBusy(false); setErrors(res.data?.errors || { form: res.data?.error || 'Could not sign you up. Try again.' }); return; }
    const { error } = await getSupabase().auth.signInWithPassword({ email: v.values.email, password: v.values.password });
    setBusy(false);
    if (error) { setErrors({ form: 'Your account was created but signing in failed. Try logging in.' }); return; }
    await refreshProfile();
    track('signup.completed', { trigger, role });
    onDone?.({ role });
  }

  if (underage) return <UnderAge onWrongDate={() => { setUnderage(false); setForm((f) => ({ ...f, dateOfBirth: '' })); }} />;

  return (
    <section aria-labelledby="signup-title" className={embedded ? '' : 'v-sheet'} style={embedded ? { display: 'flex', flexDirection: 'column', gap: 12 } : undefined} data-testid="signup-sheet">
      {!embedded && <div className="v-sheet-handle" />}
      <div className="v-row" style={{ justifyContent: 'space-between' }}>
        <h1 id="signup-title" style={{ fontSize: compact ? 28 : 30, lineHeight: 1.05 }}>Keep watching, free</h1>
        <button className="v-link" onClick={onLogin}>Log in</button>
      </div>
      <p style={{ fontSize: 17, color: 'var(--muted-on-light)' }}>{compact ? 'The show keeps playing while you sign up.' : 'Under a minute. The show keeps playing behind this.'}</p>
      <form onSubmit={submit} className="v-col" style={{ gap: 12 }} noValidate>
        <div className="v-row" role="radiogroup" aria-label="Watch or perform" style={{ gap: 4, padding: 4, borderRadius: 999, background: 'rgba(1,22,39,0.07)' }}>
          {[['viewer', "I'm here to watch"], ['artist', "I'm here to perform"]].map(([r, label]) => (
            <button type="button" key={r} role="radio" aria-checked={role === r} aria-pressed={role === r} onClick={() => setRole(r)} className="v-btn" style={{ flex: 1, height: 40, borderRadius: 20, fontSize: 16, fontWeight: role === r ? 700 : 400, background: role === r ? 'var(--porcelain)' : 'transparent', border: role === r ? '2px solid var(--ink)' : '2px solid transparent', color: 'var(--ink)' }}>{label}</button>
          ))}
        </div>
        <div className="v-row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <label className="v-field" style={{ flex: 1 }}>First name<input autoComplete="given-name" placeholder="First name" value={form.firstName} onChange={set('firstName')} style={inputStyle} />{errors.firstName && <span className="v-err">{errors.firstName}</span>}</label>
          <label className="v-field" style={{ flex: 1 }}>Last name<input autoComplete="family-name" placeholder="Last name" value={form.lastName} onChange={set('lastName')} /></label>
        </div>
        {role === 'artist' && <label className="v-field">Stage name<input placeholder="How fans will see you" value={form.stageName} onChange={set('stageName')} /></label>}
        <label className="v-field">{role === 'artist' ? 'Username' : 'Username'}<input autoComplete="username" placeholder="@yourname" value={form.username} onChange={set('username')} />{errors.username && <span className="v-err">{errors.username}</span>}</label>
        <div className="v-row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <label className="v-field" style={{ width: 150, flexShrink: 0 }}>Date of birth<input inputMode="numeric" placeholder="DD / MM / YYYY" value={form.dateOfBirth} onChange={set('dateOfBirth')} />{errors.dateOfBirth && <span className="v-err">{errors.dateOfBirth}</span>}</label>
          <label className="v-field" style={{ flex: 1 }}>Location
            <div className="v-row" style={{ gap: 6 }}>
              <select value={form.country} onChange={set('country')} aria-label="Country" style={{ width: 92, flexShrink: 0 }}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
              <input placeholder="City" value={form.city} onChange={set('city')} />
            </div>
            {errors.country && <span className="v-err">{errors.country}</span>}
          </label>
        </div>
        {emailMode && (
          <div className="v-row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <label className="v-field" style={{ flex: 1 }}>Email<input type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />{errors.email && <span className="v-err">{errors.email}</span>}</label>
            <label className="v-field" style={{ flex: 1 }}>Password<input type="password" autoComplete="new-password" placeholder="8+ characters" value={form.password} onChange={set('password')} />{errors.password && <span className="v-err">{errors.password}</span>}</label>
          </div>
        )}
        <label className="v-row" style={{ fontSize: 14, lineHeight: 1.35, color: 'rgba(1,22,39,0.8)', alignItems: 'flex-start', gap: 10 }}>
          <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0 }} aria-describedby="terms-line" />
          <span id="terms-line">By continuing you confirm you are 18 or over and agree to the <a href="/terms" className="v-link" style={{ padding: 0 }}>Terms and Conditions</a> and <a href="/community-guidelines" className="v-link" style={{ padding: 0 }}>Community Guidelines</a>.</span>
        </label>
        {errors.acceptTerms && <span className="v-err" style={{ color: 'var(--red)', fontSize: 14 }}>{errors.acceptTerms}</span>}
        {role === 'artist' && (
          <label className="v-row" style={{ fontSize: 14, lineHeight: 1.35, alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, background: 'rgba(46,196,182,0.14)' }}>
            <input type="checkbox" checked={!form.trainingDataOptOut} onChange={(e) => setForm((f) => ({ ...f, trainingDataOptOut: !e.target.checked }))} style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0 }} />
            <span><strong>Help the AI director learn from my shows.</strong> On by default, only your own performance, only inside Loudentify. Switch it off here or any time in Settings.</span>
          </label>
        )}
        {errors.form && <div className="v-error" role="alert"><span style={{ color: 'var(--red)' }}><Warn /></span><span>{errors.form}</span></div>}
        <div className="v-col" style={{ gap: 10 }}>
          {emailMode ? (
            <button type="submit" className="v-btn v-btn-lg v-btn-ink" disabled={busy} data-testid="signup-submit">{busy ? 'Creating your account' : 'Continue with email'}</button>
          ) : null}
          <button type="button" className="v-btn" disabled title="Needs an Apple developer account (see docs/NEEDS_KOREY.md)" style={{ height: 50, borderRadius: 25, background: '#000', color: '#fff', opacity: 0.5 }}>Continue with Apple — soon</button>
          <button type="button" className="v-btn" disabled title="Needs a Google Cloud OAuth client (see docs/NEEDS_KOREY.md)" style={{ height: 50, borderRadius: 25, background: '#fff', color: '#1f1f1f', border: '1px solid #747775', opacity: 0.5 }}>Continue with Google — soon</button>
          {!emailMode && <button type="button" className="v-link" style={{ alignSelf: 'center' }} onClick={() => setEmailMode(true)}>Use email instead</button>}
        </div>
      </form>
    </section>
  );
}

export function LoginSheet({ onDone, onSignUp, embedded = false }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setErr("That email and password don't match."); return; }
    await refreshProfile();
    onDone?.();
  }
  return (
    <section aria-labelledby="login-title" className={embedded ? '' : 'v-sheet'} style={embedded ? { display: 'flex', flexDirection: 'column', gap: 12 } : undefined} data-testid="login-sheet">
      {!embedded && <div className="v-sheet-handle" />}
      <div className="v-row" style={{ justifyContent: 'space-between' }}><h1 id="login-title" style={{ fontSize: 30 }}>Log in</h1><button className="v-link" onClick={onSignUp}>Sign up</button></div>
      <form onSubmit={submit} className="v-col" style={{ gap: 12 }}>
        <label className="v-field">Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="v-field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="v-error" role="alert"><span style={{ color: 'var(--red)' }}><Warn /></span><span>{err}</span></div>}
        <button type="submit" className="v-btn v-btn-lg v-btn-ink" disabled={busy}>{busy ? 'Logging in' : 'Log in'}</button>
        <a className="v-link" style={{ alignSelf: 'center' }} href="/forgot-password">Forgot password?</a>
      </form>
    </section>
  );
}
