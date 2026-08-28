'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiveKitRoom } from '@livekit/components-react';
import ReleaseOnShowEnd from './ReleaseOnShowEnd';
import CamViewfinder from './CamViewfinder';
import { readCredential, saveCredential, clearCredential, canRemember } from '../lib/camfeedDevice';
import { useWakeLock } from '../lib/useWakeLock';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';

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
// random secret handed over once at redeem.
//
// ── ⚠️ CORRECTION — this file used to say the secret was "deliberately
//    not persisted: a phone that reloads has been picked up by a person,
//    and a person can scan the code again." That was wrong, and the
//    device sitting found it. ──
//
// A tab does not only close because someone decided to close it. iOS
// evicts background tabs under memory pressure; a thumb catches the
// wrong edge; an OS prompt takes over. In every one of those the phone
// is propped on a stand and the person is on stage — and the recovery I
// had designed was "walk off, pick the phone up, generate a new code on
// the other screen, scan it", mid-performance.
//
// The pairing belongs to the DEVICE. The server always believed that:
// /api/camfeed/session authenticates by device secret and hands back the
// SAME device_identity every time, exactly so a camera can come and go
// without the director seeing a new one appear. The reconnection
// machinery was already there; the phone just never remembered who it
// was. It does now — lib/camfeedDevice.js, which carries the security
// reasoning for storing it.
//
// A NEW CODE IS NOW ONLY EVER NEEDED FOR: a genuinely new device, or one
// the artist has revoked. Both are the cases where a new code is the
// correct answer.

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
  // Null until the first attempt settles, so the pairing form does not
  // flash up for half a second on a device that is about to resume.
  const [resuming, setResuming] = useState(true);
  const [rememberable] = useState(() => (typeof window === 'undefined' ? true : canRemember()));

  const startedRef = useRef(false);

  // ── RESUME ────────────────────────────────────────────────────
  // Present the stored secret and take back whatever this pairing
  // currently is: its room, its generation, its role, and — the part
  // that matters most — its identity. The session route hands back the
  // stored `device_identity`, so the director console sees the same
  // camera it has always had, not a stranger joining mid-show.
  const resume = useCallback(async (cred) => {
    try {
      const res = await fetch('/api/camfeed/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId: cred.pairingId, deviceSecret: cred.deviceSecret }),
      });
      const body = await res.json().catch(() => ({}));

      // Revoked, or the row is gone. The credential is dead and keeping
      // it would make every reopen re-discover the same rejection.
      if (res.status === 403 || body.revoked) { clearCredential(); return { outcome: 'revoked' }; }
      // The show this camera belonged to has finished. NOT a revoke: the
      // artist may schedule another and migrate this same pairing to it,
      // so the credential stays and the poll keeps watching.
      if (body.ended) return { outcome: 'ended', body };
      if (body.supported === false) { clearCredential(); return { outcome: 'unsupported' }; }
      if (!res.ok || !body.token) return { outcome: 'failed' };

      return { outcome: 'resumed', body: { ...cred, ...body } };
    } catch {
      // A network blip on reopen is not proof the pairing is dead. Keep
      // the credential; the operator can retry, and the poll will pick
      // it up if they do nothing.
      return { outcome: 'failed' };
    }
  }, []);

  const redeem = useCallback(async (raw) => {
    const value = String(raw ?? '').trim().toUpperCase();
    setError('');
    if (!value) { setError('Enter the code shown on your other screen.'); return false; }
    setBusy(true);
    try {
      const res = await fetch('/api/camfeed/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not pair this device.'); return false; }
      // Remembered BEFORE the room mounts, so a device that dies during
      // its own first connection still comes back as itself.
      saveCredential(body);
      setConn(body);
      return true;
    } catch {
      setError('Could not pair this device.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  // ── What happens when this page opens ─────────────────────────
  //
  // Order matters, and this order is the one that survives the real
  // sequence a phone goes through:
  //
  //   1. A code in the URL wins. The artist just issued it, which is an
  //      explicit instruction to be THIS pairing — including when the
  //      phone is being deliberately re-paired to a new slot.
  //   2. If that code fails, fall through to a stored credential rather
  //      than showing an error. This is the ordinary reopen: the phone
  //      is on /cam/pair?code=… from the original scan, the code was
  //      single-use and died at redeem, and the honest answer to
  //      reopening that URL is "you are already this camera", not "that
  //      code has been used".
  //   3. No code at all, stored credential: resume silently.
  //   4. Nothing: ask for a code.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const stored = readCredential();

      if (codeFromLink) {
        const ok = await redeem(codeFromLink);
        if (ok) { setResuming(false); return; }
        if (!stored) { setResuming(false); return; }
        setError('');
      }

      if (!stored) { setResuming(false); return; }

      const { outcome, body } = await resume(stored);
      if (outcome === 'resumed') setConn(body);
      else if (outcome === 'ended') setShowOver(true);
      else if (outcome === 'revoked') setRevoked(true);
      setResuming(false);
    })();
  }, [codeFromLink, redeem, resume]);

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

        if (res.status === 403) { clearCredential(); setRevoked(true); return; } // stop polling
        if (body.supported === false) return;                 // pre-migration: nothing to follow
        if (body.revoked) { clearCredential(); setRevoked(true); return; }
        // The show finished while this phone was connected but did not
        // hear SHOW_ENDED — a data message missed during a reconnect, or
        // a tab that resumed just after the end. Same destination as the
        // broadcast path, reached by polling instead.
        if (body.ended) { setShowOver(true); return; }

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

  // ── Screen sleep ──────────────────────────────────────────────
  // Held while this device is actually a camera, and released the moment
  // it stops being one — the terminal screens below are a phone in
  // someone's pocket, and a wake lock there is a battery bug.
  const wake = useWakeLock(!!conn && !showOver && !revoked, 'camfeed');

  if (resuming && !conn) {
    return (
      <Shell>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(253,255,252,0.5)' }}>LOUDENTIFY</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>Reconnecting this camera…</div>
        <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.6)', marginTop: 8, lineHeight: 1.55 }}>
          This device is already paired. Picking up where it left off — no new code needed.
        </div>
      </Shell>
    );
  }

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
    return (
      <div style={{ minHeight: '100vh', height: '100vh', background: INK, color: PORCELAIN, display: 'flex', flexDirection: 'column' }}>
        {movedNotice && (
          <div style={{ padding: '10px 14px', fontSize: 11.5, color: INK, background: TEAL, lineHeight: 1.45, fontWeight: 600 }}>
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
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          {/* The phone's own end-of-show handling. Without this it keeps
              filming after End Show -- it runs none of the live show's
              components, so nothing else here was ever listening. */}
          <ReleaseOnShowEnd label="camfeed" onEnded={() => setShowOver(true)} />
          <CamViewfinder conn={conn} wake={wake} />
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
        Codes work once and expire after 10 minutes. Once paired, this device stays paired — if
        the page closes, reopening it reconnects the same camera without a new code.
      </div>

      {/* Said only where it is not true. Private browsing and locked-down
          devices cannot store the credential, and someone about to prop a
          phone on a stand deserves to know the promise above does not
          apply to this one. */}
      {!rememberable && (
        <div style={{ fontSize: 10.5, color: ORANGE, marginTop: 10, lineHeight: 1.5 }}>
          This browser can’t remember the pairing — probably private browsing. It will still work,
          but closing the page will need a new code. A normal window avoids that.
        </div>
      )}
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
