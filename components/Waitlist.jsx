'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { GENRES } from '../lib/genres';
import { isValidEmail } from '../lib/waitlist';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const CORAL = '#e71d36';

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

/*
 * Increment this whenever the wording of the consent
 * presented to users materially changes.
 */
const CONSENT_VERSION = 'waitlist-2026-11-09-v1';

const CONSENT_TEXT =
  'I agree that Loudentify can collect and use the details I enter to contact me about early access and launch, as described above. I can withdraw this at any time.';

const styles = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '24px 16px',
    background: 'transparent',
    color: PORCELAIN,
    boxSizing: 'border-box',
  },

  card: {
    width: '100%',
    maxWidth: 500,
    background: 'rgba(253,255,252,0.04)',
    border: '1px solid rgba(253,255,252,0.12)',
    borderRadius: 20,
    padding: 'clamp(20px, 5vw, 36px)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(6px)',
    boxSizing: 'border-box',
  },

  logoWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 14,
  },

  h1: {
    fontSize: 'clamp(24px, 6vw, 32px)',
    lineHeight: 1.1,
    margin: '0 0 10px',
    fontWeight: 800,
  },

  lead: {
    fontSize: 15,
    lineHeight: 1.5,
    opacity: 0.82,
    margin: '0 0 18px',
  },

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

  counterNum: {
    fontSize: 30,
    fontWeight: 800,
    color: TEAL,
    lineHeight: 1,
  },

  counterLabel: {
    fontSize: 12.5,
    opacity: 0.85,
    lineHeight: 1.45,
  },

  toggle: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },

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

  toggleOn: {
    background: TEAL,
    color: INK,
    borderColor: TEAL,
  },

  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 700,
    margin: '0 0 12px',
  },

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

  inputBad: {
    borderColor: CORAL,
  },

  privacyNotice: {
    margin: '20px 0 16px',
    padding: '17px',
    borderRadius: 12,
    background: 'rgba(253,255,252,0.035)',
    border: '1px solid rgba(253,255,252,0.12)',
    color: 'rgba(253,255,252,0.72)',
    fontSize: 11.5,
    lineHeight: 1.6,
  },

  privacyNoticeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 13,
    color: PORCELAIN,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.1em',
  },

  privacyIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 19,
    height: 19,
    borderRadius: '50%',
    border: `1px solid ${TEAL}`,
    color: TEAL,
    fontSize: 10,
    fontWeight: 800,
    flexShrink: 0,
  },

  privacyParagraph: {
    margin: '0 0 10px',
  },

  privacyStrong: {
    color: PORCELAIN,
  },

  privacyLink: {
    display: 'inline-block',
    marginTop: 2,
    color: TEAL,
    fontSize: 11,
    fontWeight: 700,
    textDecoration: 'none',
  },

  consentGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 13,
    margin: '0 0 17px',
  },

  consentRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    cursor: 'pointer',
  },

  checkbox: {
    marginTop: 2,
    width: 18,
    height: 18,
    flex: '0 0 auto',
    accentColor: TEAL,
    cursor: 'pointer',
  },

  consentText: {
    fontSize: 12,
    lineHeight: 1.5,
    opacity: 0.88,
  },

  submit: {
    width: '100%',
    padding: '13px 16px',
    borderRadius: 12,
    border: 'none',
    background: TEAL,
    color: INK,
    fontSize: 16,
    fontWeight: 800,
    transition: 'opacity 0.2s ease',
  },

  error: {
    color: CORAL,
    fontSize: 13,
    fontWeight: 600,
    margin: '0 0 12px',
  },

  counter: {
    fontSize: 15,
    margin: '14px 0',
    color: TEAL,
  },

  quietLink: {
    display: 'inline-block',
    marginTop: 16,
    fontSize: 13,
    color: PORCELAIN,
    opacity: 0.7,
  },

  inlineLink: {
    color: TEAL,
  },

  hp: {
    position: 'absolute',
    left: '-9999px',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
};

export default function Waitlist() {
  const [role, setRole] = useState('artist');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [genre, setGenre] = useState('');

  /*
   * These are deliberately separate.
   *
   * Neither is pre-selected and both are required before
   * the form can be submitted.
   */
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);

  // Honeypot.
  const [company, setCompany] = useState('');

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [count, setCount] = useState(null);

  const mountedAt = useRef(Date.now());
  const turnstileToken = useRef('');

  /*
   * Live artist counter.
   *
   * Only an aggregate count is read from the server.
   * No waitlist personal information is fetched here.
   */
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch('/api/waitlist/count', {
          cache: 'no-store',
        });

        const data = await res.json();

        if (
          alive &&
          data &&
          typeof data.count === 'number'
        ) {
          setCount(data.count);
        }
      } catch {
        // A missing counter should not prevent registration.
      }
    }

    load();

    const timer = setInterval(load, 30000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /*
   * Cloudflare Turnstile is optional.
   * It is only loaded when a public site key is configured.
   */
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    if (
      document.getElementById(
        'cf-turnstile-script'
      )
    ) {
      return;
    }

    const script = document.createElement('script');

    script.id = 'cf-turnstile-script';
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;

    document.head.appendChild(script);

    window.__wlTurnstileCb = (token) => {
      turnstileToken.current = token || '';
    };
  }, []);

  const emailOk = useMemo(
    () => email === '' || isValidEmail(email),
    [email]
  );

  const isArtist = role === 'artist';

  const canSubmit =
    status !== 'submitting' &&
    ageConfirmed &&
    consent;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      return setError('Please enter your name.');
    }

    if (!isValidEmail(email)) {
      return setError(
        'Please enter a valid email address.'
      );
    }

    if (isArtist && !city.trim()) {
      return setError('Please enter your city.');
    }

    if (isArtist && !genre) {
      return setError('Please choose a genre.');
    }

    if (!ageConfirmed) {
      return setError(
        'Please confirm that you are 18 or over.'
      );
    }

    if (!consent) {
      return setError(
        'Please agree to the use of your details for Loudentify early access and launch.'
      );
    }

    setStatus('submitting');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          role,

          name: name.trim(),
          email: email.trim(),

          city: isArtist
            ? city.trim()
            : undefined,

          genre: isArtist
            ? genre
            : undefined,

          /*
           * Both confirmations are sent separately.
           *
           * The API must independently verify both.
           */
          ageConfirmed,
          consent,

          /*
           * Preserve which wording was displayed.
           *
           * The server should create the authoritative
           * timestamp when it accepts the registration.
           */
          consentVersion: CONSENT_VERSION,
          consentText: CONSENT_TEXT,

          company,

          elapsedMs:
            Date.now() - mountedAt.current,

          turnstileToken:
            turnstileToken.current,

          source: 'landing',
        }),
      });

      const data = await res
        .json()
        .catch(() => ({}));

      if (!res.ok || !data.ok) {
        setStatus('error');

        return setError(
          data.error ||
            'Something went wrong. Please try again.'
        );
      }

      setStatus('done');
    } catch {
      setStatus('error');

      setError(
        'Could not reach the server. Please try again.'
      );
    }
  }

  return (
  <section
    id="early-access"
    aria-label="Early access registration"
    style={styles.page}
  >
    <div style={styles.shell}>
      {/* LEFT COLUMN */}
      <div style={styles.leftColumn}>
        <div>
          <div style={styles.logoWrap}>
            <Logo />
          </div>

          {status === 'done' ? (
            <div>
              <span style={styles.eyebrow}>
                EARLY ACCESS
              </span>

              <h1 style={styles.heroTitle}>
                You&apos;re on
                <br />
                the list.
              </h1>

              <p style={styles.heroLead}>
                Thanks for joining Loudentify. We&apos;ll
                email you about the January 2027 launch.
              </p>

              {isArtist && count != null && count > 0 && (
                <div style={styles.counterBlock}>
                  <span style={styles.counterNum}>
                    {count.toLocaleString('en-GB')}
                  </span>

                  <span style={styles.counterLabel}>
                    {count === 1
                      ? 'artist has joined'
                      : 'artists have joined'}{' '}
                    so far.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              <span style={styles.eyebrow}>
                JANUARY 2027 · EARLY ACCESS
              </span>

              <h1 style={styles.heroTitle}>
                Live music.
                <br />
                <span style={styles.accent}>
                  Live directed.
                </span>
              </h1>

              <p style={styles.heroLead}>
                Turn the phones you already own into a
                produced, multi-camera live show — directed
                automatically and streamed to your audience.
              </p>

              <div style={styles.counterBlock}>
                {count != null && count > 0 ? (
                  <>
                    <span style={styles.counterNum}>
                      {count.toLocaleString('en-GB')}
                    </span>

                    <span style={styles.counterLabel}>
                      {count === 1
                        ? 'artist on the waitlist'
                        : 'artists on the waitlist'}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={styles.counterNum}>60</span>

                    <span style={styles.counterLabel}>
                      target launch cohort · Manchester &amp;
                      London
                    </span>
                  </>
                )}
              </div>

              <div style={styles.toggle}>
                <button
                  type="button"
                  onClick={() => setRole('artist')}
                  style={{
                    ...styles.toggleBtn,
                    ...(isArtist ? styles.toggleOn : {}),
                  }}
                >
                  I&apos;m an artist
                </button>

                <button
                  type="button"
                  onClick={() => setRole('viewer')}
                  style={{
                    ...styles.toggleBtn,
                    ...(!isArtist ? styles.toggleOn : {}),
                  }}
                >
                  I&apos;m a fan
                </button>
              </div>
            </>
          )}
        </div>

        <Link href="/" style={styles.backLink}>
          ← Back to Loudentify
        </Link>
      </div>

      {/* RIGHT COLUMN */}
      <div style={styles.rightColumn}>
        {status === 'done' ? (
          <div style={styles.successPanel}>
            <div style={styles.successIcon}>✓</div>

            <h2 style={styles.formTitle}>
              Registration complete
            </h2>

            <p style={styles.formIntro}>
              Your details stay private and are never shown
              publicly. Keep an eye on your inbox for
              Loudentify launch updates.
            </p>

            <Link href="/auth" style={styles.submitLink}>
              Artist sign in →
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate style={styles.form}>
            <div>
              <span style={styles.formEyebrow}>
                JOIN THE WAITLIST
              </span>

              <h2 style={styles.formTitle}>
                Get early access.
              </h2>

              <p style={styles.formIntro}>
                Tell us a little about yourself and
                we&apos;ll keep you updated.
              </p>
            </div>

            {/* Honeypot */}
            <div aria-hidden="true" style={styles.hp}>
              <label>
                Company
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(e) =>
                    setCompany(e.target.value)
                  }
                />
              </label>
            </div>

            <div style={styles.fieldsGrid}>
              <label style={styles.label}>
                NAME
                <input
                  style={styles.input}
                  type="text"
                  value={name}
                  maxLength={80}
                  autoComplete="name"
                  onChange={(e) =>
                    setName(e.target.value)
                  }
                  placeholder="Your name"
                  required
                />
              </label>

              <label style={styles.label}>
                EMAIL
                <input
                  style={{
                    ...styles.input,
                    ...(emailOk ? {} : styles.inputBad),
                  }}
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="email"
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                  placeholder="you@email.com"
                  required
                />
              </label>

              {isArtist && (
                <>
                  <label style={styles.label}>
                    CITY
                    <input
                      style={styles.input}
                      type="text"
                      value={city}
                      maxLength={80}
                      autoComplete="address-level2"
                      onChange={(e) =>
                        setCity(e.target.value)
                      }
                      placeholder="e.g. Manchester"
                      required
                    />
                  </label>

                  <label style={styles.label}>
                    GENRE
                    <select
                      style={styles.input}
                      value={genre}
                      onChange={(e) =>
                        setGenre(e.target.value)
                      }
                      required
                    >
                      <option value="">
                        Choose a genre
                      </option>

                      {GENRES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            <div style={styles.privacyNotice}>
              <div style={styles.privacyNoticeHeader}>
                <span style={styles.privacyIcon}>i</span>
                <span>HOW WE USE YOUR INFORMATION</span>
              </div>

              <div style={styles.privacyColumns}>
                <p style={styles.privacyParagraph}>
                  <strong style={styles.privacyStrong}>
                    Who collects this, and why.
                  </strong>{' '}
                  Loudentify is a pre-launch project
                  currently run by Oluwakorede Alashe and
                  its founding team. A UK company is being
                  set up, and this notice will be updated
                  when it is.
                </p>

                <p style={styles.privacyParagraph}>
                  We collect your name and email, and your
                  city and genre if you give them, only to
                  contact you about Loudentify early access
                  and launch.
                </p>

                <p style={styles.privacyParagraph}>
                  We rely on your consent. You can withdraw
                  it at any time by unsubscribing or
                  emailing{' '}
                  <a
                    href="mailto:build@loudentify.app"
                    style={styles.inlineLink}
                  >
                    build@loudentify.app
                  </a>
                  .
                </p>

                <p style={styles.privacyParagraph}>
                  We never sell or share your details. The
                  waitlist count is anonymous. We keep your
                  details only until launch or until you ask
                  us to remove them. You can request a copy
                  or deletion of your data and complain to
                  the{' '}
                  <a
                    href="https://ico.org.uk/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.inlineLink}
                  >
                    ICO
                  </a>
                  .
                </p>
              </div>

              <Link
                href="/privacy"
                style={styles.privacyLink}
              >
                Full Privacy Notice →
              </Link>
            </div>

            <div style={styles.consentGroup}>
              <label style={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(e) =>
                    setAgeConfirmed(e.target.checked)
                  }
                  style={styles.checkbox}
                  required
                />

                <span style={styles.consentText}>
                  I confirm that I am{' '}
                  <strong>18 or over.</strong>
                </span>
              </label>

              <label style={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) =>
                    setConsent(e.target.checked)
                  }
                  style={styles.checkbox}
                  required
                />

                <span style={styles.consentText}>
                  {CONSENT_TEXT}
                </span>
              </label>
            </div>

            {TURNSTILE_SITE_KEY && (
              <div
                className="cf-turnstile"
                data-sitekey={TURNSTILE_SITE_KEY}
                data-callback="__wlTurnstileCb"
              />
            )}

            {error && (
              <p role="alert" style={styles.error}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                ...styles.submit,
                opacity: canSubmit ? 1 : 0.45,
                cursor: canSubmit
                  ? 'pointer'
                  : 'not-allowed',
              }}
            >
              {status === 'submitting'
                ? 'Joining…'
                : 'Join the waitlist →'}
            </button>

            <Link
              href="/auth"
              style={styles.artistLogin}
            >
              Already have an artist account? Sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  </section>
);
}