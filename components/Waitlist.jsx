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
import { isValidEmail } from '../lib/waitlist';
import styles from '../styles/Waitlist.module.css';

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

/*
 * Increment this whenever the wording presented to users
 * materially changes.
 */
const CONSENT_VERSION = 'waitlist-2026-11-09-v1';

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
  const [count, setCount] = useState(null);

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

        if (
          alive &&
          data &&
          typeof data.count === 'number'
        ) {
          setCount(data.count);
        }
      } catch {
        // Counter failure must not prevent registration.
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
  }, []);

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
          <div>
            <div className={styles.logoWrap}>
              {/* <Logo /> */}
            </div>

            {status === 'done' ? (
              <div>
                <span className={styles.eyebrow}>
                  EARLY ACCESS
                </span>

                <h1 className={styles.heroTitle}>
                  You&apos;re on
                  <br />
                  the list.
                </h1>

                <p className={styles.heroLead}>
                  Thanks for joining Loudentify.
                  We&apos;ll email you about the
                  January 2027 launch.
                </p>

                {isArtist &&
                  count != null &&
                  count > 0 && (
                    <div
                      className={
                        styles.counterBlock
                      }
                    >
                      <span
                        className={
                          styles.counterNum
                        }
                      >
                        {count.toLocaleString(
                          'en-GB'
                        )}
                      </span>

                      <span
                        className={
                          styles.counterLabel
                        }
                      >
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
                <span
                  className={styles.eyebrow}
                >
                  JANUARY 2027 · EARLY ACCESS
                </span>

                <h1
                  className={
                    styles.heroTitle
                  }
                >
                  Live music.
                  <br />

                  <span
                    className={
                      styles.accent
                    }
                  >
                    Live directed.
                  </span>
                </h1>

                <p
                  className={
                    styles.heroLead
                  }
                >
                  Turn the phones you already
                  own into a produced,
                  multi-camera live show —
                  directed automatically and
                  streamed to your audience.
                </p>

                <div
                  className={
                    styles.counterBlock
                  }
                >
                  {count != null &&
                  count > 0 ? (
                    <>
                      <span
                        className={
                          styles.counterNum
                        }
                      >
                        {count.toLocaleString(
                          'en-GB'
                        )}
                      </span>

                      <span
                        className={
                          styles.counterLabel
                        }
                      >
                        {count === 1
                          ? 'artist on the waitlist'
                          : 'artists on the waitlist'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={
                          styles.counterNum
                        }
                      >
                        60
                      </span>

                      <span
                        className={
                          styles.counterLabel
                        }
                      >
                        target launch cohort ·
                        Manchester &amp; London
                      </span>
                    </>
                  )}
                </div>

                <div
                  className={styles.toggle}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setRole('artist')
                    }
                    className={`${styles.toggleBtn} ${
                      isArtist
                        ? styles.toggleOn
                        : ''
                    }`}
                  >
                    I&apos;m an artist
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setRole('viewer')
                    }
                    className={`${styles.toggleBtn} ${
                      !isArtist
                        ? styles.toggleOn
                        : ''
                    }`}
                  >
                    I&apos;m a fan
                  </button>
                </div>
              </>
            )}
          </div>

          <Link
            href="/"
            className={styles.backLink}
          >
            ← Back to Loudentify
          </Link>
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
                Registration complete
              </h2>

              <p
                className={
                  styles.formIntro
                }
              >
                Your details stay private and
                are never shown publicly. Keep
                an eye on your inbox for
                Loudentify launch updates.
              </p>

              <Link
                href="/auth"
                className={
                  styles.submitLink
                }
              >
                Artist sign in
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
                  Get early access.
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
                Already have an artist
                account?{' '}
                <strong>Sign in</strong>
              </Link>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}