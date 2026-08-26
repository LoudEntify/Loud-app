'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiveKitRoom } from '@livekit/components-react';
import ReleaseOnShowEnd from './ReleaseOnShowEnd';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// The phone side of camera pairing.
//
// Deliberately its OWN page rather than a mode bolted onto /cam. This
// device is doing one job -- be a lens -- and the existing cam page
// carries a lot of show-time machinery that has nothing to do with that.
//
// No account needed, by design: this pairs a DEVICE, not a person. The
// code is the whole claim, which is why it is short-lived and single use
// (app/api/camfeed/pair).
//
// ── WHAT CHANGED TONIGHT, AND WHY IT MATTERS ──────────────────
// This phone no longer knows which room it is in. It knows which PAIRING
// it is, and it asks the server where that pairing currently lives.
//
// That sounds like a small distinction and is the entire Phase 0b fix.
// The artist frames three phones in Kit Check's rehearsal room, and sixty
// seconds before showtime walks into a live show — a different LiveKit
// room. Before tonight every phone stayed behind, holding a token for a
// room the artist had left, and had to be picked up and re-paired at the
// worst possible moment. Now the handover rewrites one column per phone
// and each phone follows within a poll, on its own, still propped exactly
// where it was put.
//
// The device credential is NOT the six-character code — that dies at
// redeem, as it must, because a human read it off a screen. It is a long
// random secret handed over once at redeem and held only in this tab's
// memory. Deliberately not persisted: a phone that reloads has been
// picked up by a person, and a person can scan the code again.

const HIGH_RES_VIDEO_CAPTURE = { resolution: { height: 1920, aspectRatio: 9 / 16 }, frameRate: { ideal: 30 } };

export default function CamPair() {
  const searchParams = useSearchParams();
  const codeFromLink = (searchParams?.get('code') || '').trim().toUpperCase();

  const [code, setCode] = useState(codeFromLink);
  const [conn, setConn] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [movedNotice, setMovedNotice] = useState('');
  // Set when the show ends and this phone releases its camera. Terminal:
  // there is nothing to reconnect to and the light is already out.
  const [showOver, setShowOver] = useState(false);

  const autoRedeemedRef = useRef(false);

  const redeem = useCallback(async (raw) => {
    const value = String(raw ?? '').trim().toUpperCase();
    setError('');
    if (!value) { setError('Enter the code shown on your other screen.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/camfeed/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not pair this device.'); return; }
      setConn(body);
    } catch {
      setError('Could not pair this device.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Scanning the QR lands here with the code already in the URL, so the
  // phone pairs itself. The artist's hands are on a guitar; asking them
  // to walk over and tap PAIR CAMERA on each phone is the exact friction
  // the QR was supposed to remove.
  useEffect(() => {
    if (!codeFromLink || autoRedeemedRef.current) return;
    autoRedeemedRef.current = true;
    redeem(codeFromLink);
  }, [codeFromLink, redeem]);

  // ── The follow loop ───────────────────────────────────────────
  // Asks "where do I belong?" every few seconds. Cheap (one indexed row
  // read), and the only thing standing between a rehearsal-room camera
  // and a show-room camera.
  useEffect(() => {
    if (!conn?.pairingId || !conn?.deviceSecret) return undefined;
    // Nothing to follow once the show is over -- polling on would ask a
    // question whose only honest answer is "nowhere".
    if (showOver) return undefined;
    let cancelled = false;
    let timer = null;

    async function tick() {
      try {
        const res = await fetch('/api/camfeed/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingId: conn.pairingId, deviceSecret: conn.deviceSecret }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 403) { setRevoked(true); return; } // stop polling
        if (body.supported === false) return;                 // pre-migration: nothing to follow
        if (body.revoked) { setRevoked(true); return; }

        if (res.ok && body.token && body.generation !== conn.generation) {
          // A new generation means the room moved. Swap the whole
          // connection object; the LiveKitRoom below is keyed on
          // room:generation, so React unmounts the old connection and
          // mounts a clean one rather than trying to mutate a live
          // session's token underneath it.
          setConn((prev) => ({ ...prev, ...body }));
          setMovedNotice(
            (body.context || 'rehearsal') === 'show'
              ? 'The show started — this camera moved across with it.'
              : 'Moved to a new room.'
          );
          setTimeout(() => setMovedNotice(''), 8000);
          return;
        }
      } catch {
        // A missed poll is a missed poll. The next one is four seconds
        // away and the current connection is untouched, so a flaky
        // network never costs the shot.
      } finally {
        if (!cancelled) timer = setTimeout(tick, conn.pollMs || 4000);
      }
    }

    timer = setTimeout(tick, conn.pollMs || 4000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conn, showOver]);

  if (showOver) {
    return (
      <Shell>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(253,255,252,0.5)' }}>LOUDENTIFY</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>The show has ended</div>
        <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.6)', marginTop: 8, lineHeight: 1.55 }}>
          This camera is off — the light on this phone should be out. Nothing is being sent.
        </div>
      </Shell>
    );
  }

  if (revoked) {
    return (
      <Shell>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(253,255,252,0.5)' }}>LOUDENTIFY</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>This camera was removed</div>
        <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.6)', marginTop: 8, lineHeight: 1.55 }}>
          The artist took this camera out of the rig. Nothing is being sent from this phone any more.
          Scan a new code to pair it again.
        </div>
      </Shell>
    );
  }

  if (conn) {
    const inShow = (conn.context || 'rehearsal') === 'show';
    return (
      <div style={{ minHeight: '100vh', background: INK, color: PORCELAIN, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.1em', color: inShow ? RED : TEAL }}>
            {inShow ? 'LIVE — SHOW CAMERA' : 'PAIRED — REHEARSAL CAMERA'}
          </span>
          {conn.role && (
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: ORANGE, border: `1px solid ${ORANGE}`, borderRadius: 999, padding: '2px 8px' }}>
              {String(conn.role).toUpperCase()}
            </span>
          )}
        </div>

        {movedNotice && (
          <div style={{ margin: '0 16px 10px', fontSize: 11.5, color: TEAL, lineHeight: 1.5 }}>
            {movedNotice}
          </div>
        )}

        {/* Rear camera by default: a paired phone is almost always
            propped facing the artist, not held at arm's length.
            Keyed on room:generation so a room change is a clean remount,
            never a token swapped under a live connection. */}
        <LiveKitRoom
          key={`${conn.room}:${conn.generation ?? 1}`}
          token={conn.token}
          serverUrl={conn.url}
          connect
          audio={false}
          video={{ facingMode: 'environment', ...HIGH_RES_VIDEO_CAPTURE }}
          style={{ flex: 1 }}
        >
          {/* The phone's own end-of-show handling. Without this it keeps
              filming after End Show -- it runs none of the live show's
              components, so nothing else here was ever listening. */}
          <ReleaseOnShowEnd label="camfeed" onEnded={() => setShowOver(true)} />
          <div style={{ padding: 20, fontSize: 12, color: 'rgba(253,255,252,0.6)', lineHeight: 1.6 }}>
            This phone is now a camera{conn.role ? ` — the ${String(conn.role).toUpperCase()} angle` : ''}. Prop it
            where you want the shot and check the framing on your other screen. Keep this page open and the screen awake.
            {conn.pairingId && (
              <>
                {' '}
                <strong style={{ color: PORCELAIN }}>You don&apos;t need to do anything when the show starts</strong> —
                this camera moves across on its own.
              </>
            )}
          </div>
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <Shell>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(253,255,252,0.5)' }}>LOUDENTIFY</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Pair this camera</div>
      <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.6)', marginTop: 8, lineHeight: 1.55 }}>
        Enter the six-character code from your Kit Check screen.
      </div>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABC123"
        autoCapitalize="characters"
        autoCorrect="off"
        maxLength={6}
        style={{
          width: '100%', boxSizing: 'border-box', marginTop: 18,
          background: 'transparent', border: '1px solid rgba(253,255,252,0.3)',
          color: PORCELAIN, fontSize: 26, letterSpacing: '0.24em', textAlign: 'center',
          padding: '14px 12px', outline: 'none', fontFamily: 'inherit',
        }}
      />

      {error && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 10 }}>{error}</div>}

      <button
        type="button"
        onClick={() => redeem(code)}
        disabled={busy}
        style={{
          width: '100%', marginTop: 16, padding: '15px 0',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
          color: INK, background: TEAL, border: 'none',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'PAIRING…' : 'PAIR CAMERA'}
      </button>

      <div style={{ fontSize: 10.5, color: 'rgba(253,255,252,0.4)', marginTop: 14, lineHeight: 1.5 }}>
        Codes work once and expire after 10 minutes.
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: INK, color: PORCELAIN, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 320 }}>{children}</div>
    </div>
  );
}
