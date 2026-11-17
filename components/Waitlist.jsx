'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { GENRES } from '../lib/genres';
import { CONSENT_VERSION, isValidEmail } from '../lib/waitlist';
import styles from '../styles/Waitlist.module.css';

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

const CONSENT_TEXT =
  'I agree that Loudentify can collect and use the details I enter to contact me about early access and launch, as described above. I can withdraw this at any time.';

export default function Waitlist() {
  const [role, setRole] = useState('artist');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [genre, setGenre] = useState('');

  const [ageConfirmed, setAgeConfirmed] =
    useState(false);

  const [consent, setConsent] =
    useState(false);

  // Honeypot
  const [company, setCompany] = useState('');

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(null);
  const [countsUnavailable, setCountsUnavailable] = useState(false);

  const mountedAt = useRef(Date.now());
  const turnstileToken = useRef('');

  /*
   * Live aggregate artist count.
   */
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch(
          '/api/waitlist/count',
          {
            cache: 'no-store',
          }
        );

        const data = await res.json();

        if (!alive) return;
        if (res.ok && data.ok && ['artists', 'fans', 'total'].every(key => Number.isInteger(data[key]) && data[key] >= 0)) {
          setCounts(data);
          setCountsUnavailable(false);
        } else {
          setCountsUnavailable(true);
        }
      } catch {
        if (alive) setCountsUnavailable(true);
      }
    }

    load();

    const timer = setInterval(
      load,
      30000
    );

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [status]);

  /*
   * Cloudflare Turnstile is optional.
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

    const script =
      document.createElement('script');

    script.id = 'cf-turnstile-script';

    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js';

    script.async = true;
    script.defer = true;

    document.head.appendChild(script);

    window.__wlTurnstileCb = (token) => {
      turnstileToken.current =
        token || '';
    };
  }, []);

  const emailOk = useMemo(
    () =>
      email === '' ||
      isValidEmail(email),
    [email]
  );

  const isArtist =
    role === 'artist';

  const canSubmit =
    status !== 'submitting' &&
    ageConfirmed &&
    consent;

  async function onSubmit(e) {
    e.preventDefault();

    setError('');

    if (!name.trim()) {
      return setError(
        'Please enter your name.'
      );
    }

    if (!isValidEmail(email)) {
      return setError(
        'Please enter a valid email address.'
      );
    }

    if (
      isArtist &&
      !city.trim()
    ) {
      return setError(
        'Please enter your city.'
      );
    }

    if (
      isArtist &&
      !genre
    ) {
      return setError(
        'Please choose a genre.'
      );
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
      const res = await fetch(
        '/api/waitlist',
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json',
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

            ageConfirmed,
            consent,

            consentVersion:
              CONSENT_VERSION,

            consentText:
              CONSENT_TEXT,

            company,

            elapsedMs:
              Date.now() -
              mountedAt.current,

            turnstileToken:
              turnstileToken.current,

            source: 'landing',
          }),
        }
      );

      const data = await res
        .json()
        .catch(() => ({}));

      if (
        !res.ok ||
        !data.ok
      ) {
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
      className={styles.page}
    >
      <div className={styles.shell}>
        {/* =========================================
            LEFT COLUMN
        ========================================== */}

        <div className={styles.leftColumn}>
          <div className={styles.heroTopline}>
            <Link href="/" aria-label="Loudentify home"><Logo height={30} /></Link>
            <span>THE FIRST CHAPTER</span>
          </div>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}><i aria-hidden="true" /> JANUARY 2027 · EARLY ACCESS</span>
            <h1 className={styles.heroTitle}>
              {status === 'done' ? <>You&apos;re part<br />of <span className={styles.accent}>the beginning.</span></> : <>Don&apos;t just<br />hear it.<br /><span className={styles.accent}>Be there.</span></>}
            </h1>
            <p className={styles.heroLead}>
              {status === 'done' ? "You’re on the list. We’ll email you with launch updates and details about getting access." : 'Real artists. Every angle. A whole new way to feel live music. Join the artists and fans building the next stage.'}
            </p>
          </div>
          <div className={styles.community}>
            <div className={styles.communityHeader}><span>THE COMMUNITY STARTS HERE</span><span className={styles.liveStatus}><i aria-hidden="true" />{countsUnavailable ? 'UPDATES UNAVAILABLE' : counts ? 'LIVE WAITLIST' : 'CONNECTING'}</span></div>
            <dl className={styles.counters} aria-label="Waitlist signup counts" aria-busy={!counts && !countsUnavailable}>
              {[['total', 'Total signups'], ['artists', 'Artists'], ['fans', 'Fans']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{!countsUnavailable && counts ? counts[key].toLocaleString('en-GB') : '—'}</dd></div>)}
            </dl>
            <p className={styles.counterNote} role="status">{countsUnavailable ? 'Live counts are temporarily unavailable. You can still join.' : counts ? 'Live signup totals · refreshed every 30 seconds. An email can join once per role.' : 'Loading live signup totals…'}</p>
          </div>
          <div className={styles.heroFooter}><Link href="/" className={styles.backLink}>← Back to Loudentify</Link><span>MANCHESTER · LONDON · EVERYWHERE</span></div>
        </div>

        {/* =========================================
            RIGHT COLUMN
        ========================================== */}

        <div
          className={styles.rightColumn}
        >
          {status === 'done' ? (
            <div
              className={
                styles.successPanel
              }
            >
              <div
                className={
                  styles.successIcon
                }
              >
                ✓
              </div>

              <span
                className={
                  styles.formEyebrow
                }
              >
                YOU&apos;RE IN
              </span>

              <h2
                className={
                  styles.formTitle
                }
              >
                You&apos;re on the waitlist
              </h2>

              <p
                className={
                  styles.formIntro
                }
              >
                Joining the waitlist does not create an account.
                We&apos;ll email you with launch updates and details
                about getting access. Your details stay private.
              </p>

              <Link
                href="/"
                className={
                  styles.submitLink
                }
              >
                Back to home
                <span>→</span>
              </Link>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              noValidate
              className={styles.form}
            >
              <div
                className={
                  styles.formHeader
                }
              >
                <span
                  className={
                    styles.formEyebrow
                  }
                >
                  JOIN THE WAITLIST
                </span>

                <h2
                  className={
                    styles.formTitle
                  }
                >
                  Your next chapter starts here.
                </h2>

                <p
                  className={
                    styles.formIntro
                  }
                >
                  Tell us a little about
                  yourself and we&apos;ll keep
                  you updated.
                </p>
              </div>

              <div className={styles.toggle} aria-label="Choose your waitlist role">
                <button type="button" onClick={() => setRole('artist')} aria-pressed={isArtist} className={`${styles.toggleBtn} ${isArtist ? styles.toggleOn : ''}`}><span aria-hidden="true">♫</span> I&apos;m an artist</button>
                <button type="button" onClick={() => setRole('viewer')} aria-pressed={!isArtist} className={`${styles.toggleBtn} ${!isArtist ? styles.toggleOn : ''}`}><span aria-hidden="true">♡</span> I&apos;m a fan</button>
              </div>

              {/* Honeypot */}

              <div
                aria-hidden="true"
                className={styles.hp}
              >
                <label>
                  Company

                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) =>
                      setCompany(
                        e.target.value
                      )
                    }
                  />
                </label>
              </div>

              {/* FORM FIELDS */}

              <div
                className={
                  styles.fieldsGrid
                }
              >
                <label
                  className={styles.label}
                >
                  NAME

                  <input
                    className={
                      styles.input
                    }
                    type="text"
                    value={name}
                    maxLength={80}
                    autoComplete="name"
                    onChange={(e) =>
                      setName(
                        e.target.value
                      )
                    }
                    placeholder="Your name"
                    required
                  />
                </label>

                <label
                  className={styles.label}
                >
                  EMAIL

                  <input
                    className={`${styles.input} ${
                      emailOk
                        ? ''
                        : styles.inputBad
                    }`}
                    type="email"
                    value={email}
                    maxLength={254}
                    autoComplete="email"
                    onChange={(e) =>
                      setEmail(
                        e.target.value
                      )
                    }
                    placeholder="you@email.com"
                    required
                  />
                </label>

                {isArtist && (
                  <>
                    <label
                      className={
                        styles.label
                      }
                    >
                      CITY

                      <input
                        className={
                          styles.input
                        }
                        type="text"
                        value={city}
                        maxLength={80}
                        autoComplete="address-level2"
                        onChange={(e) =>
                          setCity(
                            e.target.value
                          )
                        }
                        placeholder="e.g. Manchester"
                        required
                      />
                    </label>

                    <label
                      className={
                        styles.label
                      }
                    >
                      GENRE

                      <select
                        className={
                          styles.input
                        }
                        value={genre}
                        onChange={(e) =>
                          setGenre(
                            e.target.value
                          )
                        }
                        required
                      >
                        <option value="">
                          Choose a genre
                        </option>

                        {GENRES.map(
                          (g) => (
                            <option
                              key={g}
                              value={g}
                            >
                              {g}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  </>
                )}
              </div>

              {/* PRIVACY NOTICE */}

              <div
                className={
                  styles.privacyNotice
                }
              >
                <div
                  className={
                    styles.privacyNoticeHeader
                  }
                >
                  <span
                    className={
                      styles.privacyIcon
                    }
                    aria-hidden="true"
                  >
                    i
                  </span>

                  <span>
                    HOW WE USE YOUR
                    INFORMATION
                  </span>
                </div>

                <div
                  className={
                    styles.privacyColumns
                  }
                >
                  <p
                    className={
                      styles.privacyParagraph
                    }
                  >
                    <strong
                      className={
                        styles.privacyStrong
                      }
                    >
                      Who collects this, and
                      why.
                    </strong>{' '}
                    Loudentify is a pre-launch
                    project currently run by
                    Oluwakorede Alashe and its
                    founding team. A UK company
                    is being set up, and this
                    notice will be updated when
                    it is.
                  </p>

                  <p
                    className={
                      styles.privacyParagraph
                    }
                  >
                    We collect your name and
                    email, and your city and
                    genre if you give them,
                    only to contact you about
                    Loudentify early access and
                    launch.
                  </p>

                  <p
                    className={
                      styles.privacyParagraph
                    }
                  >
                    We rely on your consent.
                    You can withdraw it at any
                    time by unsubscribing or
                    emailing{' '}
                    <a
                      href="mailto:build@loudentify.app"
                      className={
                        styles.inlineLink
                      }
                    >
                      build@loudentify.app
                    </a>
                    .
                  </p>

                  <p
                    className={
                      styles.privacyParagraph
                    }
                  >
                    We never sell or share your
                    details. The waitlist count
                    is anonymous. We keep your
                    details only until launch
                    or until you ask us to
                    remove them. You can
                    request a copy or deletion
                    of your data and complain
                    to the{' '}
                    <a
                      href="https://ico.org.uk/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        styles.inlineLink
                      }
                    >
                      ICO
                    </a>
                    .
                  </p>
                </div>

                <Link
                  href="/privacy"
                  className={
                    styles.privacyLink
                  }
                >
                  Full Privacy Notice →
                </Link>
              </div>

              {/* CONSENT */}

              <div
                className={
                  styles.consentGroup
                }
              >
                <label
                  className={
                    styles.consentRow
                  }
                >
                  <input
                    type="checkbox"
                    checked={ageConfirmed}
                    onChange={(e) =>
                      setAgeConfirmed(
                        e.target.checked
                      )
                    }
                    className={
                      styles.checkbox
                    }
                    required
                  />

                  <span
                    className={
                      styles.consentText
                    }
                  >
                    I confirm that I am{' '}
                    <strong>
                      18 or over.
                    </strong>
                  </span>
                </label>

                <label
                  className={
                    styles.consentRow
                  }
                >
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) =>
                      setConsent(
                        e.target.checked
                      )
                    }
                    className={
                      styles.checkbox
                    }
                    required
                  />

                  <span
                    className={
                      styles.consentText
                    }
                  >
                    {CONSENT_TEXT}
                  </span>
                </label>
              </div>

              {TURNSTILE_SITE_KEY && (
                <div
                  className="cf-turnstile"
                  data-sitekey={
                    TURNSTILE_SITE_KEY
                  }
                  data-callback="__wlTurnstileCb"
                />
              )}

              {error && (
                <p
                  role="alert"
                  className={styles.error}
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className={
                  styles.submit
                }
              >
                <span>
                  {status ===
                  'submitting'
                    ? 'Joining…'
                    : 'Join the waitlist'}
                </span>

                {status !==
                  'submitting' && (
                  <span
                    className={
                      styles.submitArrow
                    }
                  >
                    →
                  </span>
                )}
              </button>

              <Link
                href="/auth"
                className={
                  styles.artistLogin
                }
              >
                Already have a Loudentify account?{' '}
                <strong>Sign in</strong>
              </Link>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
