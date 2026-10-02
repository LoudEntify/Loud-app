// lib/consent.js
// ─────────────────────────────────────────────────────────────
// Cookie consent, kept on the device.
//
// PRD row 106 (UK PECR): "Cookie banner appears before analytics,
// marketing or (where required) YouTube embed cookies run. Privacy-
// enhanced embed domain used." docs/ARCHITECTURE.md Data residency (v2):
// "The embedded player is loaded ... only after cookie consent where the
// rules require it."
//
// Three categories. `necessary` is always on (sign-in, the show state).
// `embed` gates loading the YouTube player at all — until it is granted the
// player's box shows a consent card instead (the card is IN the box, not
// over a player, because there is no player yet). `analytics` gates the
// pseudonymous journey events; metering (needed to run the service) is
// treated as necessary and is pseudonymous.
// ─────────────────────────────────────────────────────────────

export const CONSENT_VERSION = 1;
const KEY = 'loudentify.cookieConsent';

export const DEFAULT_CONSENT = { version: CONSENT_VERSION, decided: false, necessary: true, embed: false, analytics: false, decidedAt: null };

export function loadConsent() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CONSENT };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CONSENT_VERSION) return { ...DEFAULT_CONSENT };
    return { ...DEFAULT_CONSENT, ...parsed, necessary: true };
  } catch { return { ...DEFAULT_CONSENT }; }
}

export function saveConsent(next) {
  const value = { ...DEFAULT_CONSENT, ...next, necessary: true, decided: true, version: CONSENT_VERSION, decidedAt: new Date().toISOString() };
  try { window.localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage-less: banner shows again next time */ }
  try { window.dispatchEvent(new CustomEvent('loudentify:consent', { detail: value })); } catch { /* ignore */ }
  return value;
}

export function acceptAll() { return saveConsent({ embed: true, analytics: true }); }
export function necessaryOnly() { return saveConsent({ embed: false, analytics: false }); }

/** Subscribe to consent changes (returns unsubscribe). */
export function onConsentChange(cb) {
  const handler = (e) => cb(e.detail);
  window.addEventListener('loudentify:consent', handler);
  return () => window.removeEventListener('loudentify:consent', handler);
}
