'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// THE pairing UI. One component, both contexts.
//
// There used to be two. Kit Check printed a six-character code and a
// sentence telling the artist to type a URL from memory into another
// phone. The live show printed three QR codes whose URLs contained a
// room name and a slot and nothing else — no credential at all, which
// meant a QR code visible in a frame was a working invitation into the
// broadcast. Neither was the right one to keep, but the live show had
// the right SHAPE: a picture you point a camera at, a link you can tap,
// and a code you can read out loud, all describing the same thing.
//
// So this is that shape, backed by the code mechanism: the QR encodes
// /cam/pair?code=XXXXXX, the link is the identical string, and the code
// underneath is the same six characters for anyone whose camera can't
// see the screen. Three affordances, one credential, one code path.
//
// `tone` exists because this renders on two very different surfaces: a
// porcelain studio page, and floating directly over live video. Over
// video, nothing gets a background fill — legibility comes from the dark
// text halo the live surfaces already use (components/reactions.css),
// because a panel fill would sit on top of the performance.

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';
const ORANGE = '#ff9f1c';

export const CAMERA_ROLES = [
  { key: 'wide', label: 'WIDE', hint: 'The whole stage. Prop it back and low.' },
  { key: 'close', label: 'CLOSE', hint: 'Face and shoulders. Prop it near, at eye height.' },
  { key: 'side', label: 'SIDE', hint: 'Hands, instrument, detail. Prop it off to one side.' },
];

function palette(tone) {
  const overVideo = tone === 'over-video';
  return {
    overVideo,
    text: overVideo ? PORCELAIN : INK,
    dim: overVideo ? 'rgba(253,255,252,0.6)' : 'rgba(1,22,39,0.55)',
    faint: overVideo ? 'rgba(253,255,252,0.4)' : 'rgba(1,22,39,0.4)',
    hairline: overVideo ? '1px solid rgba(253,255,252,0.22)' : '1px solid rgba(1,22,39,0.12)',
    halo: overVideo ? 'var(--text-halo)' : 'none',
  };
}

const CHAMFER = 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)';

/**
 * One camera. Either an invitation (QR + link + code) or a paired,
 * publishing device.
 */
function CameraCard({ pairing, connected, onRevoke, tone }) {
  const p = palette(tone);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = pairing.code ? `${origin}/cam/pair?code=${encodeURIComponent(pairing.code)}` : '';

  useEffect(() => {
    let cancelled = false;
    if (!url) { setQr(null); return undefined; }
    // Rendered light-on-dark over video and dark-on-light in the studio.
    // A QR scanner tolerates either, but a white block punched into a
    // live frame does not — and the artist is the one looking at it.
    QRCode.toDataURL(url, {
      margin: 1,
      width: 148,
      color: p.overVideo
        ? { dark: '#fdfffcff', light: '#01162700' }
        : { dark: '#011627ff', light: '#fdfffcff' },
    })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [url, p.overVideo]);

  const roleMeta = CAMERA_ROLES.find((r) => r.key === pairing.role) || { label: (pairing.role || 'CAMERA').toUpperCase(), hint: '' };
  const expired = pairing.expiresAt && new Date(pairing.expiresAt).getTime() < Date.now() && !pairing.pairedAt;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is permission-gated and can simply say no. The link is
      // visible and selectable either way, so this is a convenience that
      // is allowed to fail silently rather than a path anything depends on.
    }
  }

  return (
    <div style={{ width: 176, border: p.hairline, clipPath: CHAMFER, padding: 12, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: p.text, textShadow: p.halo }}>
          {roleMeta.label}
        </span>
        <span
          style={{
            fontSize: 8,
            letterSpacing: '0.08em',
            color: connected ? TEAL : expired ? RED : ORANGE,
            border: `1px solid ${connected ? TEAL : expired ? RED : ORANGE}`,
            borderRadius: 999,
            padding: '2px 7px',
            textShadow: p.halo,
          }}
        >
          {connected ? 'LIVE' : expired ? 'EXPIRED' : pairing.pairedAt ? 'PAIRED' : 'WAITING'}
        </span>
      </div>

      {/* Once the phone is actually publishing, the invitation is noise —
          the artist wants to know it's up and where to point it, not to
          keep looking at a code they've already used. */}
      {connected ? (
        <div style={{ marginTop: 10, fontSize: 10.5, color: p.dim, lineHeight: 1.5, textShadow: p.halo }}>
          {roleMeta.hint || 'Publishing.'}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, height: 148, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`Pairing QR code for the ${roleMeta.label} camera`} width={148} height={148} style={{ display: 'block' }} />
            ) : (
              <div style={{ width: 148, height: 148, background: p.overVideo ? 'rgba(253,255,252,0.06)' : 'rgba(1,22,39,0.05)' }} />
            )}
          </div>

          <div style={{ fontSize: 8.5, letterSpacing: '0.1em', color: p.faint, marginTop: 8, textShadow: p.halo }}>OR ENTER THIS CODE</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.14em', color: p.text, marginTop: 2, textShadow: p.halo }}>
            {pairing.code}
          </div>

          <a
            href={url}
            style={{ fontSize: 8.5, color: TEAL, wordBreak: 'break-all', display: 'block', marginTop: 6, lineHeight: 1.4, textShadow: p.halo }}
          >
            {url}
          </a>

          <button
            type="button"
            onClick={copyLink}
            style={{
              marginTop: 8, width: '100%', padding: '7px 0',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              color: TEAL, background: 'transparent', border: `1px solid ${TEAL}`, borderRadius: 0, cursor: 'pointer',
            }}
          >
            {copied ? 'COPIED' : 'COPY LINK'}
          </button>
        </>
      )}

      {onRevoke && (
        <button
          type="button"
          onClick={() => onRevoke(pairing.id)}
          style={{
            marginTop: 6, width: '100%', padding: '7px 0',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            color: p.dim, background: 'transparent',
            border: p.hairline, borderRadius: 0, cursor: 'pointer',
          }}
        >
          REMOVE
        </button>
      )}
    </div>
  );
}

/**
 * @param {object[]} pairings      live pairing rows from /api/camfeed/pair
 * @param {Set|string[]} connectedRoles roles currently publishing in the room
 * @param {(role:string)=>void} onAdd
 * @param {(id:string)=>void} onRevoke   omit to hide the remove control
 * @param {'light'|'over-video'} tone
 * @param {boolean} degraded       true when the multi-camera migration
 *                                 has not been applied yet
 */
export default function PairingPanel({
  pairings = [],
  connectedRoles = [],
  onAdd,
  onRevoke,
  busy = false,
  error = '',
  tone = 'light',
  degraded = false,
  degradedNote = '',
}) {
  const p = palette(tone);
  const connected = new Set(Array.from(connectedRoles));

  // Pre-migration the server can only hold one pairing at a time and has
  // no role column, so offering three buttons would be offering something
  // that cannot work. One button, and a sentence saying why.
  const addableRoles = degraded ? CAMERA_ROLES.slice(0, 1) : CAMERA_ROLES;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {addableRoles.map((r) => {
          const alreadyPaired = pairings.some((x) => (x.role || 'wide') === r.key);
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onAdd?.(r.key)}
              disabled={busy || (alreadyPaired && !degraded)}
              title={r.hint}
              style={{
                padding: '9px 13px',
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: alreadyPaired && !degraded ? p.faint : TEAL,
                background: 'transparent',
                border: `1px solid ${alreadyPaired && !degraded ? (p.overVideo ? 'rgba(253,255,252,0.2)' : 'rgba(1,22,39,0.15)') : TEAL}`,
                borderRadius: 0,
                cursor: busy || (alreadyPaired && !degraded) ? 'default' : 'pointer',
                textShadow: p.halo,
              }}
            >
              {busy ? 'ADDING…' : `+ ${r.label}`}
            </button>
          );
        })}
      </div>

      {error && <div style={{ fontSize: 11, color: RED, marginTop: 8, textShadow: p.halo }}>{error}</div>}

      {degraded && (
        <div style={{ fontSize: 10.5, color: p.dim, marginTop: 8, lineHeight: 1.5, textShadow: p.halo }}>
          {degradedNote || 'Multi-camera pairing switches on once the pending database migration is applied. Until then this pairs one rehearsal camera at a time and the phone will need re-pairing when you go live.'}
        </div>
      )}

      {pairings.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {pairings.map((pairing) => (
            <CameraCard
              key={pairing.id || pairing.code}
              pairing={pairing}
              connected={connected.has(pairing.role || 'wide')}
              onRevoke={onRevoke}
              tone={tone}
            />
          ))}
        </div>
      )}
    </div>
  );
}
