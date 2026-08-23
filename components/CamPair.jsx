'use client';

import { useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// The phone side of camera pairing.
//
// Deliberately its OWN page rather than a mode bolted onto /cam. This
// device is doing one job -- be a lens in a rehearsal room -- and the
// existing cam page carries a lot of show-time machinery that has
// nothing to do with that.
//
// No account needed, by design: this pairs a DEVICE, not a person. The
// code is the whole claim, which is why it is short-lived and single
// use (app/api/camfeed/pair).
export default function CamPair() {
  const [code, setCode] = useState('');
  const [conn, setConn] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setError('');
    if (!code.trim()) { setError('Enter the code shown on your other screen.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/camfeed/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not pair this device.'); return; }
      setConn(body);
    } catch {
      setError('Could not pair this device.');
    } finally {
      setBusy(false);
    }
  }

  if (conn) {
    return (
      <div style={{ minHeight: '100vh', background: INK, color: PORCELAIN, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', fontSize: 10.5, letterSpacing: '0.1em', color: TEAL }}>
          PAIRED — REHEARSAL CAMERA
        </div>
        {/* Rear camera by default: a paired phone is almost always
            propped facing the artist, not held at arm's length. */}
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          audio={false}
          video={{ facingMode: 'environment' }}
          style={{ flex: 1 }}
        >
          <div style={{ padding: 20, fontSize: 12, color: 'rgba(253,255,252,0.6)', lineHeight: 1.6 }}>
            This phone is now a camera in the rehearsal room. Prop it where you want the shot and
            check the framing on your other screen. Keep this page open and the screen awake.
          </div>
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: INK, color: PORCELAIN, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 320 }}>
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
          onClick={redeem}
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
      </div>
    </div>
  );
}
