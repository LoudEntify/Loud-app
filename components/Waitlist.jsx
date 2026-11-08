'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { GENRES } from '../lib/genres';
import { CONSENT_NOTICE, isValidEmail } from '../lib/waitlist';

// components/Waitlist.jsx
// ─────────────────────────────────────────────────────────────
// The pre-launch front door: one form, an artist/viewer toggle, and a
// live count of artists already on the list. Mobile-first and fluid, so
// the same component is the page on a phone and on a desktop (the only
// request was "all platforms" — one responsive page serves both).
//
// PRIVACY BY DESIGN: the only thing this page ever READS back from the
// server is a single number (the artist count). It never fetches a name,
// an email or a list. Personal details go one way: into the server route,
// which stores them where no browser key can read them.
//
// SECURITY ON THIS FORM:
//   • honeypot field `company` (hidden; bots fill it, people don't)
//   • elapsedMs since the form mounted (a sub-2.5s fill is automated)
//   • optional Cloudflare Turnstile, shown only if a site key is set
//   • the server re-validates everything and enforces consent
// ─────────────────────────────────────────────────────────────

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const CORAL = '#e71d36';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

const styles = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'transparent',
    color: PORCELAIN,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    background: 'rgba(253,255,252,0.04)',
    border: '1px solid rgba(253,255,252,0.12)',
    borderRadius: 20,
    padding: 'clamp(20px, 5vw, 36px)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(6px)',
  },
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 14 },
  h1: { fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.1, margin: '0 0 10px', fontWeight: 800 },
  lead: { fontSize: 15, lineHeight: 1.5, opacity: 0.82, margin: '0 0 18px' },
  counterBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '12px 14px',
    marginBottom: 18,
    borderRadius: 12,
    background: 'rgba(46,196,182,0.10)',
    border: '1px solid rgba(46,196,182,0.35)',
  },
  counterNum: { fontSize: 30, fontWeight: 800, color: TEAL, lineHeight: 1 },
  counterLabel: { fontSize: 12.5, opacity: 0.85 },
  toggle: { display: 'flex', gap: 8, marginBottom: 16 },
  toggleBtn: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 999,
    border: '1px solid rgba(253,255,252,0.18)',
    background: 'transparent',
    color: PORCELAIN,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  toggleOn: { background: TEAL, color: INK, borderColor: TEAL },
  label: { display: 'block', fontSize: 13, fontWeight: 700, margin: '0 0 12px' },
  input: {
    display: 'block',
    width: '100%',
    marginTop: 6,
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid rgba(253,255,252,0.2)',
    background: 'rgba(1,22,39,0.6)',
    color: PORCELAIN,
    fontSize: 15,
    boxSizing: 'border-box',
  },
  inputBad: { borderColor: CORAL },
  consentRow: { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '4px 0 16px', cursor: 'pointer' },
  checkbox: { marginTop: 3, width: 18, height: 18, flex: '0 0 auto', accentColor: TEAL },
  consentText: { fontSize: 12, lineHeight: 1.45, opacity: 0.85 },
  submit: {
    width: '100%',
    padding: '13px 16px',
    borderRadius: 12,
    border: 'none',
    background: TEAL,
    color: INK,
    fontSize: 16,
    fontWeight: 800,
    cursor: 'pointer',
  },
  privacy: { fontSize: 11.5, lineHeight: 1.45, opacity: 0.65, margin: '12px 0 0' },
  error: { color: CORAL, fontSize: 13, fontWeight: 600, margin: '0 0 12px' },
  counter: { fontSize: 15, margin: '14px 0', color: TEAL },
  quietLink: { display: 'inline-block', marginTop: 16, fontSize: 13, color: PORCELAIN, opacity: 0.7 },
  inlineLink: { color: TEAL },
  hp: { position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' },
};

export default function Waitlist() {
  const [role, setRole] = useState('artist');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [genre, setGenre] = useState('');
  const [consent, setConsent] = useState(false);
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState('idle'); // idle | submitting | done | error
  const [error, setError] = useState('');
  const [count, setCount] = useState(null);
  const mountedAt = useRef(Date.now());
  const turnstileToken = useRef('');

  // Live artist counter — poll gently. Aggregate only; no personal data.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/waitlist/count', { cache: 'no-store' });
        const data = await res.json();
        if (alive && data && typeof data.count === 'number') setCount(data.count);
      } catch {
        /* a missing counter is not an error worth showing */
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Load the Turnstile widget script only when a key is configured.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (document.getElementById('cf-turnstile-script')) return;
    const s = document.createElement('script');
    s.id = 'cf-turnstile-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    window.__wlTurnstileCb = (token) => {
      turnstileToken.current = token || '';
    };
  }, []);

  const emailOk = useMemo(() => email === '' || isValidEmail(email), [email]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) return setError('Please enter your name.');
    if (!isValidEmail(email)) return setError('Please enter a valid email address.');
    if (role === 'artist' && !city.trim()) return setError('Please enter your city.');
    if (role === 'artist' && !genre) return setError('Please choose a genre.');
    if (!consent) return setError('Please tick the consent box to continue.');

    setStatus('submitting');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role,
          name,
          email,
          city: role === 'artist' ? city : undefined,
          genre: role === 'artist' ? genre : undefined,
          consent,
          company, // honeypot
          elapsedMs: Date.now() - mountedAt.current,
          turnstileToken: turnstileToken.current,
          source: 'landing',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus('error');
        return setError(data.error || 'Something went wrong. Please try again.');
      }
      setStatus('done');
    } catch {
      setStatus('error');
      setError('Could not reach the server. Please try again.');
    }
  }

  const isArtist = role === 'artist';

  return (
    <section id="early-access" aria-label="Early access registration" style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <Logo />
        </div>

        {status === 'done' ? (
          <div style={{ textAlign: 'center' }}>
            <h1 style={styles.h1}>You're on the list.</h1>
            <p style={styles.lead}>
              Thanks for joining. We'll email you about the January 2027 launch. Your details stay
              private and are never shown publicly.
            </p>
            {isArtist && count != null && count > 0 && (
              <p style={styles.counter}>
                <strong>{count.toLocaleString('en-GB')}</strong>{' '}
                {count === 1 ? 'artist has' : 'artists have'} joined so far.
              </p>
            )}
            <Link href="/auth" style={styles.quietLink}>
              Already have an artist account? Sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 style={styles.h1}>Live music, live directed.</h1>
            <p style={styles.lead}>
              Loudentify turns the phones you already own into a produced, multi-camera live show,
              directed automatically, streamed to your own channel. Join the waitlist for the
              January 2027 launch.
            </p>

            <div style={styles.counterBlock} aria-live="polite">
              {count != null && count > 0 ? (
                <>
                  <span style={styles.counterNum}>{count.toLocaleString('en-GB')}</span>
                  <span style={styles.counterLabel}>
                    {count === 1 ? 'artist on the waitlist' : 'artists on the waitlist'} · target launch cohort 60 · Manchester &amp; London
                  </span>
                </>
              ) : (
                <span style={styles.counterLabel}>
                  Be among the first artists on the waitlist · target launch cohort 60 · Manchester &amp; London
                </span>
              )}
            </div>

            <div style={styles.toggle} role="tablist" aria-label="I am joining as">
              <button
                type="button"
                role="tab"
                aria-selected={isArtist}
                onClick={() => setRole('artist')}
                style={{ ...styles.toggleBtn, ...(isArtist ? styles.toggleOn : {}) }}
              >
                I'm an artist
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isArtist}
                onClick={() => setRole('viewer')}
                style={{ ...styles.toggleBtn, ...(!isArtist ? styles.toggleOn : {}) }}
              >
                I'm a fan
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate>
              {/* Honeypot: visually hidden, off the tab order, no autofill. */}
              <div aria-hidden="true" style={styles.hp}>
                <label>
                  Company
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </label>
              </div>

              <label style={styles.label}>
                Name
                <input
                  style={styles.input}
                  type="text"
                  value={name}
                  maxLength={80}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </label>

              <label style={styles.label}>
                Email
                <input
                  style={{ ...styles.input, ...(emailOk ? {} : styles.inputBad) }}
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                />
              </label>

              {isArtist && (
                <>
                  <label style={styles.label}>
                    City
                    <input
                      style={styles.input}
                      type="text"
                      value={city}
                      maxLength={80}
                      autoComplete="address-level2"
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Manchester"
                      required
                    />
                  </label>

                  <label style={styles.label}>
                    Genre
                    <select
                      style={styles.input}
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      required
                    >
                      <option value="">Choose a genre</option>
                      {GENRES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label style={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={styles.checkbox}
                  required
                />
                <span style={styles.consentText}>{CONSENT_NOTICE}</span>
              </label>

              {TURNSTILE_SITE_KEY && (
                <div
                  className="cf-turnstile"
                  data-sitekey={TURNSTILE_SITE_KEY}
                  data-callback="__wlTurnstileCb"
                  style={{ margin: '4px 0 12px' }}
                />
              )}

              {error && (
                <p role="alert" style={styles.error}>
                  {error}
                </p>
              )}

              <button type="submit" disabled={status === 'submitting'} style={styles.submit}>
                {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
              </button>

              <p style={styles.privacy}>
                Your details are kept private and never shown publicly. The count above is an
                anonymous total only. See our{' '}
                <Link href="/privacy" style={styles.inlineLink}>
                  privacy notice
                </Link>
                .
              </p>
            </form>

            <Link href="/auth" style={styles.quietLink}>
              Already have an artist account? Sign in
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

